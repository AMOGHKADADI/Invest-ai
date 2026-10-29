import { describe, expect, it } from 'vitest';
import type { Param } from './optim';
import {
  ACTION_BUY,
  ACTION_HOLD,
  ACTION_SELL,
  DEFAULT_DQN_CONFIG,
  DuelingQNet,
  ReplayBuffer,
  TradingEnv,
  epsilonForStep,
  trainDqn,
} from './dqn';
import { computeFeatures } from './signals';
import { getDemoMarket } from './demoData';

describe('DuelingQNet', () => {
  it('produces a Q value per action', () => {
    const net = new DuelingQNet(11, 3, 8, 1);
    const q = net.qValues(new Float64Array(11));
    expect(q).toHaveLength(3);
    for (const v of q) expect(Number.isFinite(v)).toBe(true);
  });

  it('matches finite-difference gradients for a scalar loss', () => {
    const net = new DuelingQNet(5, 3, 4, 2);
    const s = new Float64Array([0.3, -0.2, 0.5, 0.1, -0.4]);

    const loss = (): number => {
      const q = net.qValues(s);
      let acc = 0;
      for (const v of q) acc += 0.5 * v * v;
      return acc;
    };

    net.zeroGrad();
    const acts = net.forward(s);
    const dq = new Float64Array(3);
    for (let k = 0; k < 3; k++) dq[k] = acts.q[k];
    net.backward(acts, dq);

    const eps = 1e-6;
    let worst = 0;
    const picks: [Param, number][] = [];
    for (let i = 0; i < net.WA.w.length; i += 3) picks.push([net.WA, i]);
    for (let i = 0; i < net.W1.w.length; i += 5) picks.push([net.W1, i]);
    for (let i = 0; i < net.W2.w.length; i += 7) picks.push([net.W2, i]);
    picks.push([net.WV, 0], [net.bV, 0], [net.bA, 1], [net.b1, 0], [net.b2, 1]);

    for (const [param, index] of picks) {
      const original = param.w[index];
      param.w[index] = original + eps;
      const plus = loss();
      param.w[index] = original - eps;
      const minus = loss();
      param.w[index] = original;
      const numeric = (plus - minus) / (2 * eps);
      const analytic = param.g[index];
      const denom = Math.max(1e-6, Math.abs(numeric), Math.abs(analytic));
      worst = Math.max(worst, Math.abs(numeric - analytic) / denom);
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('copies weights from another network', () => {
    const a = new DuelingQNet(4, 3, 8, 1);
    const b = new DuelingQNet(4, 3, 8, 2);
    const input = new Float64Array([0.5, -0.3, 0.25, 0.75]);
    const before = Array.from(b.qValues(input));
    b.copyFrom(a);
    const after = Array.from(b.qValues(input));
    expect(after).not.toEqual(before);
    expect(Array.from(a.qValues(input))).toEqual(after);
  });
});

describe('ReplayBuffer', () => {
  const make = (_priority: number, value = 0) => ({
    state: new Float64Array([value]),
    action: 0 as const,
    reward: 1,
    next: new Float64Array([value]),
    done: false,
  });

  it('stores and samples within bounds', () => {
    const buffer = new ReplayBuffer(128);
    for (let i = 0; i < 100; i++) buffer.push(make(1, i), 1);
    expect(buffer.size).toBe(100);
    const { indices, weights } = buffer.sample(16, 1, seeded(1));
    expect(indices).toHaveLength(16);
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(128);
      expect(buffer.at(idx).state).toBeInstanceOf(Float64Array);
    }
    for (const w of weights) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('samples high-priority transitions more often', () => {
    const buffer = new ReplayBuffer(16);
    buffer.push(make(1), 1e-6); // index 0: near-zero priority
    buffer.push(make(1), 100); // index 1: high priority
    let hot = 0;
    const rand = seeded(7);
    for (let i = 0; i < 200; i++) {
      const { indices } = buffer.sample(1, 1, rand);
      if (indices[0] === 1) hot += 1;
    }
    expect(hot).toBeGreaterThan(150);
  });

  it('refuses to sample an empty buffer', () => {
    expect(() => new ReplayBuffer(16).sample(4, 0.5)).toThrow(/empty/);
  });
});

/** Small deterministic PRNG for reproducible sampling assertions. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('TradingEnv', () => {
  const market = getDemoMarket();
  const bars = market.bars.RELIANCE;
  const features = computeFeatures(bars, 'RELIANCE');
  const config = { ...DEFAULT_DQN_CONFIG, costBps: 10 };

  it('exposes a fixed-size causal state', () => {
    const env = new TradingEnv(bars, features, config, { start: 60, end: 90 });
    const state = env.reset();
    expect(state).toHaveLength(config.stateSize);
    for (const v of state) expect(Number.isFinite(v)).toBe(true);
    // Position flag is zero while flat.
    expect(state[8]).toBe(0);
  });

  it('round trip costs money', () => {
    const withCost = new TradingEnv(bars, features, config, { start: 60, end: 90 });
    const free = new TradingEnv(bars, features, { ...config, costBps: 0 }, { start: 60, end: 90 });
    withCost.reset();
    free.reset();

    expect(withCost.step(ACTION_BUY).traded).toBe(true);
    free.step(ACTION_BUY);
    const paid = withCost.step(ACTION_SELL);
    const freeRide = free.step(ACTION_SELL);

    expect(paid.traded).toBe(true);
    expect(withCost.trades).toBe(2);
    // Identical price path, so the gap is exactly the fees paid.
    expect(paid.equity).toBeLessThan(freeRide.equity);
    expect(freeRide.equity - paid.equity).toBeGreaterThan(0);
  });

  it('does nothing when flat and asked to hold', () => {
    const env = new TradingEnv(bars, features, config, { start: 60, end: 90 });
    env.reset();
    const result = env.step(ACTION_HOLD);
    expect(result.traded).toBe(false);
    expect(result.equity).toBeCloseTo(env.initialEquity, 6);
  });

  it('terminates at the end of the episode', () => {
    const env = new TradingEnv(bars, features, config, { start: 60, end: 62 });
    env.reset();
    expect(env.step(ACTION_HOLD).done).toBe(false);
    expect(env.step(ACTION_HOLD).done).toBe(true);
  });
});

describe('epsilon schedule', () => {
  it('decays linearly from start to end', () => {
    const config = { ...DEFAULT_DQN_CONFIG, epsilonDecaySteps: 100 };
    expect(epsilonForStep(config, 0)).toBeCloseTo(config.epsilonStart, 10);
    expect(epsilonForStep(config, 50)).toBeCloseTo((config.epsilonStart + config.epsilonEnd) / 2, 10);
    expect(epsilonForStep(config, 1000)).toBeCloseTo(config.epsilonEnd, 10);
  });
});

describe('trainDqn', () => {
  it('trains on the train segment and evaluates on held-out sessions', async () => {
    const bars = getDemoMarket().bars.RELIANCE;
    const features = computeFeatures(bars, 'RELIANCE');
    const progress: number[] = [];
    const result = await trainDqn({
      bars,
      features,
      config: { episodes: 3, batchSize: 8, hidden: 8, bufferSize: 500, targetSyncSteps: 40, seed: 3 },
      train: { start: 60, end: 150 },
      test: { start: 150, end: 190 },
      onProgress: (p) => progress.push(p.episode),
    });

    expect(progress).toHaveLength(3);
    expect(result.history.episodeReturn).toHaveLength(3);
    expect(result.gradientSteps).toBeGreaterThan(0);
    expect(Number.isFinite(result.test.totalReturn)).toBe(true);
    expect(Number.isFinite(result.test.buyHoldReturn)).toBe(true);
    expect(result.test.equityCurve.length).toBeGreaterThan(1);
    expect(result.note).toContain('Double DQN');
  }, 60_000);
});
