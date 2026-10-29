import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LSTM_CONFIG,
  LstmModel,
  backwardWindow,
  computeSplit,
  deserialiseModel,
  forecastPrices,
  forwardWindow,
  serialiseModel,
  trainLstm,
  type LstmConfig,
} from './lstm';
import { getDemoMarket } from './demoData';

const tinyConfig: LstmConfig = {
  ...DEFAULT_LSTM_CONFIG,
  seqLen: 5,
  hidden: 3,
  epochs: 2,
  lr: 0.01,
  seed: 4,
  patience: 0,
};

function lossFor(model: LstmModel, x: number[], target: number): number {
  const acts = forwardWindow(model, x);
  return 0.5 * (acts.y - target) ** 2;
}

describe('gradient check', () => {
  it('analytic gradients match finite differences', () => {
    const model = new LstmModel(tinyConfig);
    const x = [0.1, -0.35, 0.42, 0.18, -0.27];
    const target = 0.09;

    model.zeroGrad();
    const acts = forwardWindow(model, x);
    backwardWindow(model, acts, target);

    const eps = 1e-6;
    let checked = 0;
    let worst = 0;
    // Sample parameters from every gate plus the output layer.
    const picks: { param: (typeof model.params)[number]; index: number }[] = [
      { param: model.Wf, index: 3 },
      { param: model.Wi, index: 7 },
      { param: model.Wg, index: 11 },
      { param: model.Wo, index: 5 },
      { param: model.bf, index: 1 },
      { param: model.bi, index: 2 },
      { param: model.bg, index: 0 },
      { param: model.bo, index: 1 },
      { param: model.Wy, index: 2 },
      { param: model.by, index: 0 },
    ];
    // Also sweep a handful of weight-matrix entries.
    for (let idx = 0; idx < model.Wi.w.length; idx += 7) picks.push({ param: model.Wi, index: idx });

    for (const { param, index } of picks) {
      const original = param.w[index];
      param.w[index] = original + eps;
      const plus = lossFor(model, x, target);
      param.w[index] = original - eps;
      const minus = lossFor(model, x, target);
      param.w[index] = original;
      const numeric = (plus - minus) / (2 * eps);
      const analytic = param.g[index];
      const denom = Math.max(1e-6, Math.abs(numeric), Math.abs(analytic));
      worst = Math.max(worst, Math.abs(numeric - analytic) / denom);
      checked += 1;
    }

    expect(checked).toBeGreaterThan(10);
    expect(worst).toBeLessThan(1e-5);
  });
});

describe('computeSplit', () => {
  it('produces chronological, non-overlapping segments', () => {
    const split = computeSplit(756, DEFAULT_LSTM_CONFIG);
    expect(split.trainEnd).toBeLessThan(split.valEnd);
    expect(split.valEnd).toBeLessThan(split.total);
    expect(split.total).toBe(756);
  });
});

describe('trainLstm', () => {
  const closes = getDemoMarket().bars.RELIANCE.map((b) => b.c);
  const timestamps = getDemoMarket().bars.RELIANCE.map((b) => b.t);
  const config: LstmConfig = {
    ...DEFAULT_LSTM_CONFIG,
    seqLen: 10,
    hidden: 6,
    epochs: 3,
    lr: 0.01,
    seed: 21,
    patience: 0,
  };

  it('trains and reports real held-out metrics', async () => {
    const result = await trainLstm(closes, config, { timestamps });
    expect(result.history.trainLoss).toHaveLength(3);
    expect(result.history.valLoss).toHaveLength(3);
    expect(result.history.trainLoss.every((v) => Number.isFinite(v))).toBe(true);
    expect(result.metrics.testRmse).toBeGreaterThan(0);
    expect(result.metrics.naiveTestRmse).toBeGreaterThan(0);
    expect(Number.isFinite(result.metrics.skill)).toBe(true);
    expect(result.bandWidth).toBeGreaterThan(0);
    expect(result.fitted.length).toBeGreaterThan(0);
    expect(result.fitted[0].t).toBeGreaterThan(0);
    expect(result.split.valEnd).toBeLessThan(closes.length);
  }, 30_000);

  it('is reproducible for a fixed seed', async () => {
    const a = await trainLstm(closes, config, { timestamps });
    const b = await trainLstm(closes, config, { timestamps });
    expect(b.metrics.testRmse).toBeCloseTo(a.metrics.testRmse, 12);
    expect(b.history.trainLoss).toEqual(a.history.trainLoss);
  }, 30_000);

  it('rejects series that are too short', async () => {
    await expect(trainLstm([1, 2, 3], config)).rejects.toThrow(/at least/);
  });

  it('falls back with a clear error instead of fabricating a forecast', async () => {
    const badSplit: LstmConfig = { ...config, seqLen: 700 };
    await expect(trainLstm(closes, badSplit)).rejects.toThrow();
  }, 30_000);
});

describe('forecastPrices', () => {
  it('extrapolates with a widening band and returns the requested horizon', async () => {
    const closes = getDemoMarket().bars.RELIANCE.map((b) => b.c);
    const timestamps = getDemoMarket().bars.RELIANCE.map((b) => b.t);
    const result = await trainLstm(
      closes,
      { ...DEFAULT_LSTM_CONFIG, seqLen: 10, hidden: 6, epochs: 2, seed: 5, patience: 0 },
      { timestamps },
    );
    const points = forecastPrices(result.model, closes, 7, timestamps);
    expect(points).toHaveLength(7);
    for (const p of points) {
      expect(Number.isFinite(p.predicted)).toBe(true);
      expect(p.lower).toBeLessThan(p.predicted);
      expect(p.upper).toBeGreaterThan(p.predicted);
    }
    // The band must widen with the horizon.
    expect(points[6].upper - points[6].predicted).toBeGreaterThan(
      points[0].upper - points[0].predicted,
    );
    expect(points[0].t).toBeGreaterThan(timestamps[timestamps.length - 1]);
  }, 30_000);
});

describe('serialisation', () => {
  it('round-trips weights without changing predictions', async () => {
    const closes = getDemoMarket().bars.RELIANCE.map((b) => b.c);
    const config: LstmConfig = { ...DEFAULT_LSTM_CONFIG, seqLen: 10, hidden: 4, epochs: 1, seed: 9, patience: 0 };
    const { model } = await trainLstm(closes, config);
    const restored = deserialiseModel(serialiseModel(model));
    const sample = closes.slice(-10).map((v) => (v - model.mean) / model.std);
    expect(forwardWindow(restored, sample).y).toBeCloseTo(forwardWindow(model, sample).y, 12);
  }, 30_000);
});
