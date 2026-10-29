/**
 * Deep Q-Network trading agent.
 *
 * Implements the architecture described in the Phase 1 report:
 *  - Dueling network (shared trunk with separate value and advantage streams)
 *  - Prioritised experience replay (proportional sampling + importance weights)
 *  - Double DQN targets (online network selects, target network evaluates)
 *  - Epsilon-greedy exploration with linear decay
 *
 * Environment: a single-asset daily trading MDP with actions {HOLD, BUY, SELL}.
 * Observations are strictly causal (only past sessions are read), rewards are
 * portfolio returns net of a drawdown penalty, and transaction costs are applied
 * to every fill. Training runs on a chronological train segment and is evaluated
 * greedily on a held-out test segment that is never used for learning.
 */

import type { Bar } from './types';
import type { AssetFeatures } from './signals';
import { Param, adamUpdate, clipGradients, createAdam, mulberry32 } from './optim';

export const ACTION_HOLD = 0;
export const ACTION_BUY = 1;
export const ACTION_SELL = 2;
export const ACTION_LABELS = ['HOLD', 'BUY', 'SELL'] as const;
export type Action = 0 | 1 | 2;
export type SignalSideLike = 'hold' | 'buy' | 'sell';

export interface DqnConfig {
  stateSize: number;
  hidden: number;
  gamma: number;
  lr: number;
  batchSize: number;
  bufferSize: number;
  epsilonStart: number;
  epsilonEnd: number;
  epsilonDecaySteps: number;
  targetSyncSteps: number;
  betaStart: number;
  betaEnd: number;
  episodes: number;
  /** Penalty applied to incremental drawdown in the reward signal. */
  drawdownPenalty: number;
  costBps: number;
  seed: number;
}

export const DEFAULT_DQN_CONFIG: DqnConfig = {
  stateSize: 11,
  hidden: 32,
  gamma: 0.99,
  lr: 0.001,
  batchSize: 32,
  bufferSize: 10_000,
  epsilonStart: 1,
  epsilonEnd: 0.05,
  epsilonDecaySteps: 4_000,
  targetSyncSteps: 250,
  betaStart: 0.4,
  betaEnd: 1,
  episodes: 20,
  drawdownPenalty: 0.5,
  costBps: 10,
  seed: 11,
};

/* ------------------------------------------------------------------ */
/* Dueling Q-network                                                   */
/* ------------------------------------------------------------------ */

interface ForwardActs {
  s: Float64Array;
  a1: Float64Array;
  a2: Float64Array;
  q: Float64Array;
}

export class DuelingQNet {
  readonly W1: Param;
  readonly b1: Param;
  readonly W2: Param;
  readonly b2: Param;
  readonly WV: Param;
  readonly bV: Param;
  readonly WA: Param;
  readonly bA: Param;
  readonly params: Param[];

  constructor(
    readonly stateSize: number,
    readonly numActions: number,
    readonly hidden: number,
    seed: number,
  ) {
    const rand = mulberry32(seed);
    this.W1 = new Param(hidden, stateSize, 'xavier', rand);
    this.b1 = new Param(hidden, 1, 'zeros', rand);
    this.W2 = new Param(hidden, hidden, 'xavier', rand);
    this.b2 = new Param(hidden, 1, 'zeros', rand);
    this.WV = new Param(1, hidden, 'xavier', rand);
    this.bV = new Param(1, 1, 'zeros', rand);
    this.WA = new Param(numActions, hidden, 'xavier', rand);
    this.bA = new Param(numActions, 1, 'zeros', rand);
    this.params = [this.W1, this.b1, this.W2, this.b2, this.WV, this.bV, this.WA, this.bA];
  }

  zeroGrad(): void {
    for (const p of this.params) p.zeroGrad();
  }

  forward(s: Float64Array): ForwardActs {
    const H = this.hidden;
    const a1 = new Float64Array(H);
    const a2 = new Float64Array(H);
    for (let i = 0; i < H; i++) {
      let z = this.b1.w[i];
      const row = i * this.stateSize;
      for (let j = 0; j < this.stateSize; j++) z += this.W1.w[row + j] * s[j];
      a1[i] = z > 0 ? z : 0;
    }
    for (let i = 0; i < H; i++) {
      let z = this.b2.w[i];
      const row = i * H;
      for (let j = 0; j < H; j++) z += this.W2.w[row + j] * a1[j];
      a2[i] = z > 0 ? z : 0;
    }
    let v = this.bV.w[0];
    for (let j = 0; j < H; j++) v += this.WV.w[j] * a2[j];
    const adv = new Float64Array(this.numActions);
    let advMean = 0;
    for (let k = 0; k < this.numActions; k++) {
      let a = this.bA.w[k];
      const row = k * H;
      for (let j = 0; j < H; j++) a += this.WA.w[row + j] * a2[j];
      adv[k] = a;
      advMean += a;
    }
    advMean /= this.numActions;
    const q = new Float64Array(this.numActions);
    for (let k = 0; k < this.numActions; k++) q[k] = v + adv[k] - advMean;
    return { s, a1, a2, q };
  }

  qValues(s: Float64Array): Float64Array {
    return this.forward(s).q;
  }

  /** Accumulate gradients of d(loss)/d(q) for one forward pass. */
  backward(acts: ForwardActs, dq: Float64Array): void {
    const H = this.hidden;
    const A = this.numActions;
    let dqMean = 0;
    let dv = 0;
    for (let k = 0; k < A; k++) {
      dqMean += dq[k];
      dv += dq[k];
    }
    dqMean /= A;

    const { a1, a2 } = acts;
    // Advantage stream.
    for (let k = 0; k < A; k++) {
      const dAdv = dq[k] - dqMean;
      this.bA.g[k] += dAdv;
      const row = k * H;
      for (let j = 0; j < H; j++) this.WA.g[row + j] += dAdv * a2[j];
    }
    // Value stream.
    this.bV.g[0] += dv;
    for (let j = 0; j < H; j++) this.WV.g[j] += dv * a2[j];

    // Shared trunk.
    const dA2 = new Float64Array(H);
    for (let j = 0; j < H; j++) {
      let grad = dv * this.WV.w[j];
      for (let k = 0; k < A; k++) grad += (dq[k] - dqMean) * this.WA.w[k * H + j];
      dA2[j] = a2[j] > 0 ? grad : 0;
    }
    const dA1 = new Float64Array(H);
    for (let i = 0; i < H; i++) {
      this.b2.g[i] += dA2[i];
      const row = i * H;
      for (let j = 0; j < H; j++) {
        this.W2.g[row + j] += dA2[i] * a1[j];
        dA1[j] += this.W2.w[row + j] * dA2[i];
      }
    }
    for (let i = 0; i < H; i++) {
      const grad = a1[i] > 0 ? dA1[i] : 0;
      this.b1.g[i] += grad;
      const row = i * this.stateSize;
      for (let j = 0; j < this.stateSize; j++) this.W1.g[row + j] += grad * acts.s[j];
    }
  }

  copyFrom(other: DuelingQNet): void {
    if (other.params.length !== this.params.length) throw new Error('Network shape mismatch');
    for (let i = 0; i < this.params.length; i++) this.params[i].w.set(other.params[i].w);
  }
}

/* ------------------------------------------------------------------ */
/* Prioritised replay buffer                                           */
/* ------------------------------------------------------------------ */

interface Transition {
  state: Float64Array;
  action: Action;
  reward: number;
  next: Float64Array;
  done: boolean;
}

/** Flat binary tree over transition priorities (proportional PER). */
class SumTree {
  private readonly tree: Float64Array;
  private readonly size: number;

  constructor(capacity: number) {
    this.size = capacity;
    this.tree = new Float64Array(capacity * 2);
  }

  set(index: number, priority: number): void {
    let i = index + this.size;
    this.tree[i] = priority;
    while (i > 1) {
      i >>= 1;
      this.tree[i] = this.tree[i * 2] + this.tree[i * 2 + 1];
    }
  }

  get(index: number): number {
    return this.tree[index + this.size];
  }

  total(): number {
    return this.tree[1];
  }

  /** Leaf index whose interval contains `value` in [0, total). */
  find(value: number): number {
    let i = 1;
    while (i < this.size) {
      const left = this.tree[i * 2];
      if (value < left) i = i * 2;
      else {
        value -= left;
        i = i * 2 + 1;
      }
    }
    return i - this.size;
  }
}

export class ReplayBuffer {
  private readonly data: (Transition | undefined)[];
  private readonly tree: SumTree;
  private readonly capacityPow2: number;
  private cursor = 0;
  private count = 0;

  constructor(capacity: number) {
    // The sum-tree traversal assumes a power-of-two leaf count.
    this.capacityPow2 = 2 ** Math.ceil(Math.log2(Math.max(2, capacity)));
    this.data = new Array<Transition | undefined>(this.capacityPow2).fill(undefined);
    this.tree = new SumTree(this.capacityPow2);
  }

  get size(): number {
    return this.count;
  }

  push(t: Transition, priority: number): void {
    const index = this.cursor;
    this.data[index] = t;
    this.tree.set(index, Math.max(priority, 1e-6));
    this.cursor = (this.cursor + 1) % this.capacityPow2;
    this.count = Math.min(this.count + 1, this.capacityPow2);
  }

  updatePriority(index: number, priority: number): void {
    this.tree.set(index, Math.max(priority, 1e-6));
  }

  /**
   * Proportional sample with importance-sampling weights.
   * `beta` anneals from 0 (uniform) towards 1 (fully corrected).
   * `rand` is injectable so sampling is reproducible under a seeded PRNG.
   */
  sample(batchSize: number, beta: number, rand: () => number = Math.random): {
    indices: number[];
    weights: Float64Array;
  } {
    if (this.count === 0) throw new Error('Cannot sample from an empty replay buffer');
    const n = Math.min(batchSize, this.count);
    const indices: number[] = [];
    const weights = new Float64Array(n);
    const total = this.tree.total();
    let maxWeight = 0;
    const probs: number[] = [];
    for (let k = 0; k < n; k++) {
      const target = rand() * total;
      const index = this.tree.find(target);
      indices.push(index);
      const p = this.tree.get(index) / total;
      const w = Math.pow(this.count * p, -beta);
      probs.push(w);
      if (w > maxWeight) maxWeight = w;
    }
    for (let k = 0; k < n; k++) weights[k] = probs[k] / (maxWeight || 1);
    return { indices, weights };
  }

  at(index: number): Transition {
    const t = this.data[index];
    if (!t) throw new Error(`Replay buffer slot ${index} is empty`);
    return t;
  }
}

/* ------------------------------------------------------------------ */
/* Trading environment                                                 */
/* ------------------------------------------------------------------ */

export interface EpisodeSpec {
  /** First session index the agent may observe. */
  start: number;
  /** Last session index (inclusive) the agent may act on. */
  end: number;
}

export interface StepResult {
  reward: number;
  done: boolean;
  equity: number;
  traded: boolean;
}

export class TradingEnv {
  private index = 0;
  private cash = 0;
  private qty = 0;
  private peak = 0;
  private prevDrawdown = 0;
  readonly initialEquity: number;
  trades = 0;
  readonly prices: number[];

  constructor(
    readonly bars: readonly Bar[],
    readonly features: AssetFeatures,
    readonly config: DqnConfig,
    readonly episode: EpisodeSpec,
    initialEquity = 100_000,
  ) {
    this.initialEquity = initialEquity;
    this.prices = bars.map((b) => b.c);
    this.reset();
  }

  reset(): Float64Array {
    this.index = this.episode.start;
    this.cash = this.initialEquity;
    this.qty = 0;
    this.peak = this.initialEquity;
    this.prevDrawdown = 0;
    this.trades = 0;
    return this.observe();
  }

  get stepIndex(): number {
    return this.index;
  }

  get heldQty(): number {
    return this.qty;
  }

  equityAt(index = this.index): number {
    return this.cash + this.qty * this.prices[index];
  }

  /** Causal observation: only information from `index` and earlier. */
  observe(): Float64Array {
    const f = this.features;
    const i = this.index;
    const price = this.prices[i];
    const out = new Float64Array(this.config.stateSize);
    const ret = (lookback: number): number => {
      const prev = i - lookback;
      if (prev < 0 || this.prices[prev] === 0) return 0;
      return Math.max(-1, Math.min(1, (price / this.prices[prev] - 1) * 10));
    };
    const at = (arr: (number | null)[]): number => arr[i] ?? 0;

    out[0] = ret(5);
    out[1] = ret(20);
    out[2] = (at(f.rsi14) - 50) / 50;
    const e20 = f.ema20[i];
    const e50 = f.ema50[i];
    out[3] = e20 ? (price - e20) / e20 : 0;
    out[4] = e20 && e50 ? (e20 - e50) / e50 : 0;
    out[5] = (f.macd.histogram[i] ?? 0) / Math.max(1e-9, price * 0.006);
    out[6] = (f.bollinger.percentB[i] ?? 0.5) - 0.5;
    const vol = f.vol20[i];
    out[7] = vol ? vol * Math.sqrt(252) : 0;
    const equity = this.equityAt();
    const marketValue = this.qty * price;
    out[8] = marketValue > 0 ? 1 : 0;
    out[9] = marketValue > 0 && this.qty > 0 ? (price - this.avgCost()) / this.avgCost() : 0;
    out[10] = equity > 0 ? this.cash / equity : 1;
    return out;
  }

  private avgCostReference = 0;

  private avgCost(): number {
    return this.avgCostReference || 1;
  }

  step(action: Action): StepResult {
    const price = this.prices[this.index];
    const prevEquity = this.equityAt();
    let traded = false;

    if (action === ACTION_BUY && this.qty === 0 && price > 0) {
      const perUnit = price * (1 + this.config.costBps / 10_000);
      let qty = Math.floor(this.cash / perUnit);
      while (qty > 0 && qty * perUnit > this.cash) qty--;
      if (qty > 0) {
        this.cash -= qty * perUnit;
        this.qty = qty;
        this.avgCostReference = price;
        this.trades += 1;
        traded = true;
      }
    } else if (action === ACTION_SELL && this.qty > 0 && price > 0) {
      const perUnit = price * (1 - this.config.costBps / 10_000);
      this.cash += this.qty * perUnit;
      this.qty = 0;
      this.avgCostReference = 0;
      this.trades += 1;
      traded = true;
    }

    this.index += 1;
    const done = this.index >= this.episode.end;
    const equity = this.equityAt();
    const ret = prevEquity > 0 ? (equity - prevEquity) / prevEquity : 0;

    this.peak = Math.max(this.peak, equity);
    const drawdown = this.peak > 0 ? (this.peak - equity) / this.peak : 0;
    const ddIncrease = Math.max(0, drawdown - this.prevDrawdown);
    this.prevDrawdown = drawdown;

    return { reward: ret - this.config.drawdownPenalty * ddIncrease, done, equity, traded };
  }
}

/* ------------------------------------------------------------------ */
/* Training                                                            */
/* ------------------------------------------------------------------ */

export interface DqnHistory {
  loss: number[];
  episodeReturn: number[];
  epsilon: number[];
}

export interface RolloutResult {
  startEquity: number;
  endEquity: number;
  totalReturn: number;
  buyHoldReturn: number;
  trades: number;
  equityCurve: number[];
}

export interface DqnTrainResult {
  /** The trained online network (target network weights are already synced). */
  net: DuelingQNet;
  config: DqnConfig;
  history: DqnHistory;
  gradientSteps: number;
  train: RolloutResult;
  /** Held-out greedy evaluation on sessions the agent never learned from. */
  test: RolloutResult;
  durationMs: number;
  note: string;
}

export function epsilonForStep(config: DqnConfig, step: number): number {
  const t = Math.min(1, step / Math.max(1, config.epsilonDecaySteps));
  return config.epsilonStart + t * (config.epsilonEnd - config.epsilonStart);
}

function argmax(q: Float64Array): Action {
  let best = 0;
  for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i;
  return best as Action;
}

/** Greedy rollout used for evaluation (no exploration, no learning). */
export function rollout(net: DuelingQNet, env: TradingEnv): RolloutResult {
  const state = env.reset();
  const startEquity = env.equityAt();
  const startPrice = env.prices[env.episode.start];
  const endPrice = env.prices[env.episode.end];
  const equityCurve: number[] = [startEquity];
  let done = false;
  let guard = 0;
  while (!done && guard++ < 1_000_000) {
    const action = argmax(net.qValues(state));
    const result = env.step(action);
    done = result.done;
    equityCurve.push(result.equity);
  }
  const endEquity = equityCurve[equityCurve.length - 1];
  return {
    startEquity,
    endEquity,
    totalReturn: startEquity > 0 ? endEquity / startEquity - 1 : 0,
    buyHoldReturn: startPrice > 0 ? endPrice / startPrice - 1 : 0,
    trades: env.trades,
    equityCurve,
  };
}

export interface TrainDqnOptions {
  bars: readonly Bar[];
  features: AssetFeatures;
  config?: Partial<DqnConfig>;
  train: EpisodeSpec;
  test: EpisodeSpec;
  onProgress?: (p: { episode: number; episodes: number; avgReturn: number; loss: number; epsilon: number }) => void;
}

/**
 * Train the DQN agent on the training segment, then evaluate it greedily on the
 * held-out test segment. Returns real measured returns — no figure is hard-coded.
 */
export async function trainDqn(options: TrainDqnOptions): Promise<DqnTrainResult> {
  const config: DqnConfig = { ...DEFAULT_DQN_CONFIG, ...options.config };
  const started = Date.now();

  const online = new DuelingQNet(config.stateSize, 3, config.hidden, config.seed);
  const target = new DuelingQNet(config.stateSize, 3, config.hidden, config.seed + 1);
  target.copyFrom(online);

  const buffer = new ReplayBuffer(config.bufferSize);
  const adam = createAdam();
  const rand = mulberry32(config.seed * 7 + 3);
  const history: DqnHistory = { loss: [], episodeReturn: [], epsilon: [] };

  const trainEnv = new TradingEnv(options.bars, options.features, config, options.train);
  let globalStep = 0;
  let gradientSteps = 0;

  const betaAt = (steps: number): number => {
    const t = Math.min(1, steps / Math.max(1, config.episodes * 200));
    return config.betaStart + t * (config.betaEnd - config.betaStart);
  };

  for (let episode = 0; episode < config.episodes; episode++) {
    let state = trainEnv.reset();
    let episodeReward = 0;
    let done = false;

    while (!done) {
      const epsilon = epsilonForStep(config, globalStep);
      const action: Action =
        rand() < epsilon ? (Math.floor(rand() * 3) as Action) : argmax(online.qValues(state));
      const result = trainEnv.step(action);
      const nextState = trainEnv.observe();
      episodeReward += result.reward;
      globalStep += 1;

      const nextQ = online.qValues(nextState);
      const bestNext = argmax(nextQ);
      const targetQ = target.qValues(nextState);
      const tdTarget = result.reward + (result.done ? 0 : config.gamma * targetQ[bestNext]);
      const currentQ = online.qValues(state)[action];
      const tdError = tdTarget - currentQ;
      buffer.push(
        { state, action, reward: result.reward, next: nextState, done: result.done },
        Math.abs(tdError) + 1e-6,
      );

      // Learn from a mini-batch once the buffer holds enough experience.
      if (buffer.size >= config.batchSize * 2) {
        const { indices, weights } = buffer.sample(config.batchSize, betaAt(episode), rand);
        online.zeroGrad();
        let loss = 0;
        for (let k = 0; k < indices.length; k++) {
          const t = buffer.at(indices[k]);
          const acts = online.forward(t.state);
          const nQ = online.qValues(t.next);
          const bestNextAction = argmax(nQ);
          const tq = target.qValues(t.next);
          const y = t.reward + (t.done ? 0 : config.gamma * tq[bestNextAction]);
          const dq = new Float64Array(3);
          const w = weights[k];
          for (let a = 0; a < 3; a++) {
            const diff = acts.q[a] - (a === t.action ? y : acts.q[a]);
            dq[a] = (a === t.action ? w * diff : 0) / indices.length;
            if (a === t.action) loss += w * diff * diff;
          }
          online.backward(acts, dq);
        }
        clipGradients(online.params, 10);
        adamUpdate(online.params, config.lr, adam);
        gradientSteps += 1;
        history.loss.push(loss / indices.length);
        if (gradientSteps % config.targetSyncSteps === 0) target.copyFrom(online);
      }

      state = nextState;
      done = result.done;
    }

    history.episodeReturn.push(episodeReward);
    history.epsilon.push(epsilonForStep(config, globalStep));
    const avg =
      history.episodeReturn.slice(-5).reduce((a, b) => a + b, 0) /
      Math.min(5, history.episodeReturn.length);
    options.onProgress?.({
      episode,
      episodes: config.episodes,
      avgReturn: avg,
      loss: history.loss[history.loss.length - 1] ?? 0,
      epsilon: epsilonForStep(config, globalStep),
    });
    // Yield so the UI can paint progress between episodes.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const train = rollout(online, new TradingEnv(options.bars, options.features, config, options.train));
  const test = rollout(online, new TradingEnv(options.bars, options.features, config, options.test));

  return {
    net: online,
    config,
    history,
    gradientSteps,
    train,
    test,
    durationMs: Date.now() - started,
    note:
      `Trained ${config.episodes} episodes (${gradientSteps} gradient steps) on the training segment ` +
      `with Double DQN targets, dueling heads and prioritised replay; evaluated greedily on the held-out test segment.`,
  };
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

export interface SerialisedDqn {
  v: number;
  stateSize: number;
  numActions: number;
  hidden: number;
  config: DqnConfig;
  weights: number[][];
  meta: { episodes: number; gradientSteps: number; trainReturn: number; testReturn: number; trainedAt: number };
}

export function serialiseDqn(
  net: DuelingQNet,
  config: DqnConfig,
  meta: SerialisedDqn['meta'],
): string {
  const payload: SerialisedDqn = {
    v: 1,
    stateSize: net.stateSize,
    numActions: net.numActions,
    hidden: net.hidden,
    config,
    weights: net.params.map((p) => Array.from(p.w)),
    meta,
  };
  return JSON.stringify(payload);
}

export function deserialiseDqn(json: string): { net: DuelingQNet; config: DqnConfig; meta: SerialisedDqn['meta'] } {
  const parsed = JSON.parse(json) as SerialisedDqn;
  if (parsed.v !== 1) throw new Error('Unsupported DQN model version.');
  const net = new DuelingQNet(parsed.stateSize, parsed.numActions, parsed.hidden, 1);
  if (parsed.weights.length !== net.params.length) throw new Error('DQN parameter count mismatch.');
  parsed.weights.forEach((w, i) => {
    if (w.length !== net.params[i].w.length) throw new Error('DQN parameter shape mismatch.');
    net.params[i].w.set(w);
  });
  return { net, config: parsed.config, meta: parsed.meta };
}
