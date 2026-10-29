/**
 * Single-layer LSTM price forecaster, implemented from scratch in TypeScript.
 *
 * Why hand-written: the app must train and run entirely in the browser (GitHub
 * Pages is static hosting), so there is no Python runtime available at request
 * time. The implementation is verified by a finite-difference gradient check in
 * `lstm.test.ts`, which compares analytic gradients against numerical ones.
 *
 * Honesty contract used by the UI:
 *  - `history` reports the real training and validation loss per epoch.
 *  - `metrics` reports held-out test error against a persistence (naive) baseline.
 *  - The confidence band is a heuristic interval derived from validation residuals,
 *    not a statistically calibrated prediction interval.
 */

import { Param, adamUpdate, clipGradients, mulberry32, type AdamState } from './optim';

export interface LstmConfig {
  /** Number of past sessions fed into the network. */
  seqLen: number;
  /** Hidden units. */
  hidden: number;
  epochs: number;
  /** Adam learning rate. */
  lr: number;
  /** Deterministic seed for weight init, shuffling and dropout-free reproducibility. */
  seed: number;
  /** Fraction of sessions used for training (rest split between validation and test). */
  trainFraction: number;
  /** Fraction of sessions used for validation (test receives the remainder). */
  valFraction: number;
  /** Early-stopping patience in epochs (0 disables). */
  patience: number;
}

export const DEFAULT_LSTM_CONFIG: LstmConfig = {
  seqLen: 30,
  hidden: 16,
  epochs: 40,
  lr: 0.006,
  seed: 7,
  trainFraction: 0.6,
  valFraction: 0.2,
  patience: 8,
};

export interface Split {
  trainEnd: number;
  valEnd: number;
  total: number;
}

export interface TrainHistory {
  trainLoss: number[];
  valLoss: number[];
  bestEpoch: number;
  stoppedEarly: boolean;
}

export interface ForecastMetrics {
  /** RMSE in price units on the held-out test segment. */
  testRmse: number;
  testMae: number;
  /** RMSE of the naive persistence baseline (predict yesterday's close) on the same segment. */
  naiveTestRmse: number;
  /** 1 - testRmse / naiveTestRmse. Positive means the LSTM beats persistence. */
  skill: number;
  valRmse: number;
  trainRmse: number;
}

export interface FittedPoint {
  t: number;
  actual: number;
  predicted: number;
}

export interface ForecastPoint {
  t: number;
  predicted: number;
  lower: number;
  upper: number;
}

export interface ForecastOutput {
  fitted: FittedPoint[];
  forecast: ForecastPoint[];
  metrics: ForecastMetrics;
  split: Split;
  history: TrainHistory;
  /** 1.96 * residual standard deviation on the validation segment, in price units. */
  bandWidth: number;
  config: LstmConfig;
}

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export class LstmModel {
  readonly F: number;
  readonly H: number;
  readonly Wf: Param;
  readonly Wi: Param;
  readonly Wg: Param;
  readonly Wo: Param;
  readonly bf: Param;
  readonly bi: Param;
  readonly bg: Param;
  readonly bo: Param;
  readonly Wy: Param;
  readonly by: Param;
  readonly params: Param[];

  mean = 0;
  std = 1;
  config: LstmConfig;

  constructor(config: LstmConfig, inputSize = 1, seedOffset = 0) {
    this.config = { ...config };
    this.F = inputSize;
    this.H = config.hidden;
    const rand = mulberry32(config.seed + seedOffset);
    const z = this.F + this.H;
    const gate = () => new Param(this.H, z, 'xavier', rand);
    this.Wf = gate();
    this.Wi = gate();
    this.Wg = gate();
    this.Wo = gate();
    this.bf = new Param(this.H, 1, 'zeros', rand);
    this.bi = new Param(this.H, 1, 'zeros', rand);
    this.bg = new Param(this.H, 1, 'zeros', rand);
    this.bo = new Param(this.H, 1, 'zeros', rand);
    this.Wy = new Param(1, this.H, 'xavier', rand);
    this.by = new Param(1, 1, 'zeros', rand);
    this.params = [this.Wf, this.Wi, this.Wg, this.Wo, this.bf, this.bi, this.bg, this.bo, this.Wy, this.by];
  }

  zeroGrad(): void {
    for (const p of this.params) p.zeroGrad();
  }
}

interface WindowActivations {
  z: Float64Array[];
  i: Float64Array[];
  f: Float64Array[];
  g: Float64Array[];
  o: Float64Array[];
  h: Float64Array[];
  c: Float64Array[];
  y: number;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Forward pass over one window. Returns every activation needed by the backward
 * pass so gradients can be computed exactly (BPTT over the window).
 */
export function forwardWindow(model: LstmModel, x: readonly number[]): WindowActivations {
  const { F, H } = model;
  if (x.length === 0) throw new Error('forwardWindow: empty window');
  const z: Float64Array[] = [];
  const i: Float64Array[] = [];
  const f: Float64Array[] = [];
  const g: Float64Array[] = [];
  const o: Float64Array[] = [];
  const h: Float64Array[] = [];
  const c: Float64Array[] = [];

  let hPrev = new Float64Array(H);
  let cPrev = new Float64Array(H);
  const zSize = F + H;

  for (let t = 0; t < x.length; t++) {
    const zt = new Float64Array(zSize);
    for (let k = 0; k < F; k++) zt[k] = x[t];
    zt.set(hPrev, F);
    z.push(zt);
    const it = new Float64Array(H);
    const ft = new Float64Array(H);
    const gt = new Float64Array(H);
    const ot = new Float64Array(H);
    const ht = new Float64Array(H);
    const ct = new Float64Array(H);

    for (let r = 0; r < H; r++) {
      let preI = model.bi.w[r];
      let preF = model.bf.w[r];
      let preG = model.bg.w[r];
      let preO = model.bo.w[r];
      const rowI = r * zSize;
      for (let k = 0; k < zSize; k++) {
        const v = zt[k];
        preI += model.Wi.w[rowI + k] * v;
        preF += model.Wf.w[rowI + k] * v;
        preG += model.Wg.w[rowI + k] * v;
        preO += model.Wo.w[rowI + k] * v;
      }
      it[r] = sigmoid(preI);
      ft[r] = sigmoid(preF);
      gt[r] = Math.tanh(preG);
      ot[r] = sigmoid(preO);
      ct[r] = ft[r] * cPrev[r] + it[r] * gt[r];
      ht[r] = ot[r] * Math.tanh(ct[r]);
    }

    i.push(it);
    f.push(ft);
    g.push(gt);
    o.push(ot);
    h.push(ht);
    c.push(ct);
    hPrev = ht;
    cPrev = ct;
  }

  const hLast = h[h.length - 1];
  let y = model.by.w[0];
  for (let r = 0; r < H; r++) y += model.Wy.w[r] * hLast[r];

  return { z, i, f, g, o, h, c, y };
}

/**
 * Backward pass for squared loss 0.5 * (y - target)^2 with target 1-D.
 * Accumulates gradients into `model.params` (caller must call `zeroGrad` first).
 * Returns the scalar loss.
 */
export function backwardWindow(model: LstmModel, acts: WindowActivations, target: number): number {
  const { F, H } = model;
  const zSize = F + H;
  const err = acts.y - target;
  const loss = 0.5 * err * err;

  // Output layer.
  model.by.g[0] += err;
  const hLast = acts.h[acts.h.length - 1];
  for (let r = 0; r < H; r++) model.Wy.g[r] += err * hLast[r];

  let dh = new Float64Array(H);
  for (let r = 0; r < H; r++) dh[r] = model.Wy.w[r] * err;
  let dc = new Float64Array(H);

  for (let t = acts.h.length - 1; t >= 0; t--) {
    const zt = acts.z[t];
    const it = acts.i[t];
    const ft = acts.f[t];
    const gt = acts.g[t];
    const ot = acts.o[t];
    const ct = acts.c[t];
    const cPrev = t > 0 ? acts.c[t - 1] : new Float64Array(H);

    const dhPrev = new Float64Array(H);
    const dcNext = new Float64Array(H);

    for (let r = 0; r < H; r++) {
      const tanhC = Math.tanh(ct[r]);
      // Gradient of the loss w.r.t. c_t: contribution from h_t and from c_{t+1}.
      const dcTotal = dh[r] * ot[r] * (1 - tanhC * tanhC) + dc[r];
      const dOr = dh[r] * tanhC * ot[r] * (1 - ot[r]);
      const dFr = dcTotal * cPrev[r] * ft[r] * (1 - ft[r]);
      const dIr = dcTotal * gt[r] * it[r] * (1 - it[r]);
      const dGr = dcTotal * it[r] * (1 - gt[r] * gt[r]);
      // c_t = f * c_{t-1} + i * g  =>  gradient carried to c_{t-1}.
      dcNext[r] = dcTotal * ft[r];

      model.bi.g[r] += dIr;
      model.bf.g[r] += dFr;
      model.bg.g[r] += dGr;
      model.bo.g[r] += dOr;

      const rowI = r * zSize;
      for (let k = 0; k < zSize; k++) {
        const zv = zt[k];
        model.Wi.g[rowI + k] += dIr * zv;
        model.Wf.g[rowI + k] += dFr * zv;
        model.Wg.g[rowI + k] += dGr * zv;
        model.Wo.g[rowI + k] += dOr * zv;
      }
      for (let k = 0; k < H; k++) {
        dhPrev[k] +=
          dIr * model.Wi.w[rowI + F + k] +
          dFr * model.Wf.w[rowI + F + k] +
          dGr * model.Wg.w[rowI + F + k] +
          dOr * model.Wo.w[rowI + F + k];
      }
    }

    dc = dcNext;
    dh = dhPrev;
  }

  return loss;
}

export interface TrainProgress {
  epoch: number;
  epochs: number;
  trainLoss: number;
  valLoss: number | null;
  bestValLoss: number;
}

export interface TrainResult {
  model: LstmModel;
  history: TrainHistory;
  split: Split;
  metrics: ForecastMetrics;
  /** Validation residual std in price units (basis of the confidence band). */
  bandWidth: number;
  fitted: FittedPoint[];
}

export function computeSplit(total: number, config: LstmConfig): Split {
  const trainEnd = Math.max(10, Math.floor(total * config.trainFraction));
  const valEnd = Math.max(trainEnd + 5, Math.floor(total * (config.trainFraction + config.valFraction)));
  return { trainEnd, valEnd: Math.min(valEnd, total - 1), total };
}

interface WindowSet {
  inputs: number[][];
  targets: number[];
  targetIndex: number[];
}

function buildWindows(series: readonly number[], split: Split, seqLen: number): {
  train: WindowSet;
  val: WindowSet;
  test: WindowSet;
} {
  const train: WindowSet = { inputs: [], targets: [], targetIndex: [] };
  const val: WindowSet = { inputs: [], targets: [], targetIndex: [] };
  const test: WindowSet = { inputs: [], targets: [], targetIndex: [] };
  for (let j = seqLen; j < series.length; j++) {
    const input = series.slice(j - seqLen, j);
    const bucket = j < split.trainEnd ? train : j < split.valEnd ? val : test;
    bucket.inputs.push(input);
    bucket.targets.push(series[j]);
    bucket.targetIndex.push(j);
  }
  return { train, val, test };
}

function rmseOn(model: LstmModel, set: WindowSet, std: number, mean: number): { rmse: number; mae: number; predictions: number[]; actual: number[] } {
  const predictions: number[] = [];
  const actual: number[] = [];
  let se = 0;
  let ae = 0;
  for (let k = 0; k < set.inputs.length; k++) {
    const acts = forwardWindow(model, set.inputs[k]);
    const predicted = acts.y * std + mean;
    const truth = set.targets[k] * std + mean;
    predictions.push(predicted);
    actual.push(truth);
    se += (predicted - truth) ** 2;
    ae += Math.abs(predicted - truth);
  }
  const n = Math.max(1, set.inputs.length);
  return { rmse: Math.sqrt(se / n), mae: ae / n, predictions, actual };
}

/**
 * Train an LSTM on a close-price series.
 *
 * The series is split chronologically into train/validation/test (default
 * 60/20/20). Normalisation statistics come from the training segment only, so
 * validation and test information never leaks into training.
 */
export async function trainLstm(
  closes: readonly number[],
  config: LstmConfig = DEFAULT_LSTM_CONFIG,
  options: { timestamps?: readonly number[]; onProgress?: (p: TrainProgress) => void } = {},
): Promise<TrainResult> {
  const timestamps = options.timestamps ?? [];
  const onProgress = options.onProgress;
  if (closes.length < config.seqLen + 20) {
    throw new Error(
      `Need at least ${config.seqLen + 20} sessions to train (received ${closes.length}).`,
    );
  }
  const split = computeSplit(closes.length, config);

  // Normalisation from the training segment only.
  let mean = 0;
  for (let i = 0; i < split.trainEnd; i++) mean += closes[i];
  mean /= split.trainEnd;
  let variance = 0;
  for (let i = 0; i < split.trainEnd; i++) variance += (closes[i] - mean) ** 2;
  const std = Math.sqrt(variance / split.trainEnd) || 1;

  const normalised = closes.map((v) => (v - mean) / std);
  const windows = buildWindows(normalised, split, config.seqLen);
  if (windows.train.inputs.length < 5) throw new Error('Training segment is too small for the chosen sequence length.');
  if (windows.val.inputs.length === 0) {
    throw new Error(
      `Validation segment is empty (split at ${split.trainEnd}/${split.valEnd} of ${split.total} sessions). Reduce the sequence length or add data.`,
    );
  }

  const model = new LstmModel(config);
  model.mean = mean;
  model.std = std;

  const adam: AdamState = { b1: 0.9, b2: 0.999, eps: 1e-8, step: 0 };
  const rand = mulberry32(config.seed * 31 + 1);
  const history: TrainHistory = { trainLoss: [], valLoss: [], bestEpoch: 0, stoppedEarly: false };

  let bestLoss = Infinity;
  let bestWeights = new Map<Param, Float64Array>();
  let epochsWithoutImprovement = 0;
  const order = new Int32Array(windows.train.inputs.length);

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    // Shuffle training windows (seeded, so runs are reproducible).
    for (let k = 0; k < order.length; k++) order[k] = k;
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      const tmp = order[k];
      order[k] = order[j];
      order[j] = tmp;
    }

    let trainLoss = 0;
    for (let k = 0; k < order.length; k++) {
      const idx = order[k];
      model.zeroGrad();
      const acts = forwardWindow(model, windows.train.inputs[idx]);
      const loss = backwardWindow(model, acts, windows.train.targets[idx]);
      clipGradients(model.params, 5);
      adamUpdate(model.params, config.lr, adam);
      trainLoss += loss;
    }
    trainLoss /= order.length;

    const valOut = rmseOn(model, windows.val, std, mean);
    // Convert RMSE (price units) back to normalised squared error for comparability.
    const valLoss = (valOut.rmse / std) ** 2;
    history.trainLoss.push(trainLoss);
    history.valLoss.push(valLoss);

    if (valLoss < bestLoss - 1e-9) {
      bestLoss = valLoss;
      history.bestEpoch = epoch;
      epochsWithoutImprovement = 0;
      bestWeights = new Map(model.params.map((p) => [p, Float64Array.from(p.w)]));
    } else {
      epochsWithoutImprovement += 1;
      if (config.patience > 0 && epochsWithoutImprovement >= config.patience) {
        history.stoppedEarly = true;
        onProgress?.({ epoch, epochs: config.epochs, trainLoss, valLoss, bestValLoss: bestLoss });
        break;
      }
    }

    onProgress?.({ epoch, epochs: config.epochs, trainLoss, valLoss, bestValLoss: bestLoss });
    // Yield to the event loop so the UI can paint progress.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  // Restore the best-validation weights.
  for (const [param, weights] of bestWeights) param.w.set(weights);

  const trainOut = rmseOn(model, windows.train, std, mean);
  const valOut = rmseOn(model, windows.val, std, mean);
  const testOut = rmseOn(model, windows.test, std, mean);

  // Persistence baseline on the same test targets.
  let naiveSe = 0;
  for (let k = 0; k < windows.test.inputs.length; k++) {
    const input = windows.test.inputs[k];
    const naiveNormalised = input[input.length - 1];
    const predicted = naiveNormalised * std + mean;
    const truth = windows.test.targets[k] * std + mean;
    naiveSe += (predicted - truth) ** 2;
  }
  const naiveRmse = Math.sqrt(naiveSe / Math.max(1, windows.test.inputs.length));

  // Validation residuals drive the heuristic confidence band.
  let residualSe = 0;
  for (let k = 0; k < windows.val.inputs.length; k++) {
    const predicted = forwardWindow(model, windows.val.inputs[k]).y;
    residualSe += (predicted - windows.val.targets[k]) ** 2;
  }
  const residualStdNormalised = Math.sqrt(residualSe / Math.max(1, windows.val.inputs.length));

  const metrics: ForecastMetrics = {
    testRmse: testOut.rmse,
    testMae: testOut.mae,
    naiveTestRmse: naiveRmse,
    skill: naiveRmse > 0 ? 1 - testOut.rmse / naiveRmse : 0,
    valRmse: valOut.rmse,
    trainRmse: trainOut.rmse,
  };

  const bandWidth = 1.96 * residualStdNormalised * std;
  setBandWidth(model, bandWidth);

  const fitted: FittedPoint[] = windows.test.targetIndex.map((idx, k) => ({
    t: timestamps[idx] ?? idx,
    actual: testOut.actual[k],
    predicted: testOut.predictions[k],
  }));

  return {
    model,
    history,
    split,
    metrics,
    bandWidth,
    fitted,
  };
}

/** Recursively forecast `horizon` sessions ahead from the tail of a series. */
export function forecastPrices(
  model: LstmModel,
  closes: readonly number[],
  horizon: number,
  timestamps: readonly number[] = [],
): ForecastPoint[] {
  if (closes.length < model.config.seqLen) {
    throw new Error('Not enough history for the configured sequence length.');
  }
  const mean = model.mean;
  const std = model.std;
  const window = closes.slice(-model.config.seqLen).map((v) => (v - mean) / std);
  const out: ForecastPoint[] = [];
  const lastTs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0;

  for (let step = 1; step <= horizon; step++) {
    const acts = forwardWindow(model, window);
    const predictedNorm = acts.y;
    const predicted = predictedNorm * std + mean;
    // The interval widens with sqrt(horizon) — a documented heuristic, not a calibrated interval.
    const width = bandWidthFor(model) * Math.sqrt(step);
    out.push({
      t: lastTs + step * 86_400_000,
      predicted,
      lower: predicted - width,
      upper: predicted + width,
    });
    window.shift();
    window.push(predictedNorm);
  }
  return out;
}

const bandWidthCache = new WeakMap<LstmModel, number>();

/** Attach the validation-derived band width computed during training. */
export function setBandWidth(model: LstmModel, width: number): void {
  bandWidthCache.set(model, width);
}

function bandWidthFor(model: LstmModel): number {
  return bandWidthCache.get(model) ?? 0;
}

/** Serialise weights for localStorage persistence. */
export function serialiseModel(model: LstmModel): string {
  return JSON.stringify({
    v: 1,
    F: model.F,
    H: model.H,
    config: model.config,
    mean: model.mean,
    std: model.std,
    weights: model.params.map((p) => ({ rows: p.rows, cols: p.cols, w: Array.from(p.w) })),
    band: bandWidthCache.get(model) ?? 0,
  });
}

export function deserialiseModel(json: string): LstmModel {
  const parsed = JSON.parse(json) as {
    v: number;
    F: number;
    H: number;
    config: LstmConfig;
    mean: number;
    std: number;
    weights: { rows: number; cols: number; w: number[] }[];
    band: number;
  };
  if (parsed.v !== 1) throw new Error('Unsupported model format version.');
  const model = new LstmModel(parsed.config, parsed.F);
  model.mean = parsed.mean;
  model.std = parsed.std;
  if (parsed.weights.length !== model.params.length) throw new Error('Model parameter count mismatch.');
  parsed.weights.forEach((w, idx) => {
    const param = model.params[idx];
    if (param.w.length !== w.w.length) throw new Error('Model parameter shape mismatch.');
    param.w.set(w.w);
  });
  setBandWidth(model, parsed.band);
  return model;
}
