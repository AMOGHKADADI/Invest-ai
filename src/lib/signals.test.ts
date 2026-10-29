import { describe, expect, it } from 'vitest';
import { computeFeatures, signalAt } from './signals';
import { getDemoMarket } from './demoData';

const bars = getDemoMarket().bars.RELIANCE;
const features = computeFeatures(bars, 'RELIANCE');

describe('computeFeatures', () => {
  it('aligns every feature with the price series', () => {
    expect(features.close).toHaveLength(bars.length);
    expect(features.ema20).toHaveLength(bars.length);
    expect(features.ema50).toHaveLength(bars.length);
    expect(features.rsi14).toHaveLength(bars.length);
    expect(features.macd.histogram).toHaveLength(bars.length);
    expect(features.bollinger.percentB).toHaveLength(bars.length);
    expect(features.symbol).toBe('RELIANCE');
  });

  it('leaves the warm-up period null instead of inventing values', () => {
    expect(features.ema50[10]).toBeNull();
    expect(features.ema50[50]).not.toBeNull();
    expect(features.rsi14[5]).toBeNull();
  });

  it('memoises by series identity', () => {
    expect(computeFeatures(bars, 'RELIANCE')).toBe(features);
  });
});

describe('signalAt', () => {
  it('returns the symbol, price and timestamp of the bar it reads', () => {
    const i = 400;
    const signal = signalAt(features, i, { now: 1_700_000_000_000 });
    expect(signal.symbol).toBe('RELIANCE');
    expect(signal.price).toBe(bars[i].c);
    expect(signal.at).toBe(1_700_000_000_000);
    expect(signal.confidence).toBeGreaterThanOrEqual(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
    expect(signal.reasons.length).toBeGreaterThan(0);
    expect(signal.reasons.length).toBeLessThanOrEqual(4);
    expect(signal.factors.length).toBeGreaterThan(0);
  });

  it('produces a valid side for every session', () => {
    for (let i = 60; i < bars.length; i += 37) {
      const signal = signalAt(features, i);
      expect(['buy', 'sell', 'hold']).toContain(signal.side);
      expect(signal.score).toBeGreaterThanOrEqual(-1);
      expect(signal.score).toBeLessThanOrEqual(1);
      // Thresholding must be consistent with the score.
      if (signal.side === 'buy') expect(signal.score).toBeGreaterThanOrEqual(0.15);
      if (signal.side === 'sell') expect(signal.score).toBeLessThanOrEqual(-0.15);
      if (signal.side === 'hold') expect(Math.abs(signal.score)).toBeLessThan(0.15);
    }
  });

  it('moves the score upwards when sentiment improves', () => {
    const i = 500;
    const bearish = signalAt(features, i, { sentiment: -1 });
    const bullish = signalAt(features, i, { sentiment: 1 });
    expect(bullish.score).toBeGreaterThan(bearish.score);
    expect(reasonText(bullish)).toMatch(/sentiment/i);
  });

  it('incorporates the LSTM forecast direction', () => {
    const i = 500;
    const down = signalAt(features, i, { forecastReturn: -0.1 });
    const up = signalAt(features, i, { forecastReturn: 0.1 });
    expect(up.score).toBeGreaterThan(down.score);
    expect(reasonText(up)).toMatch(/LSTM/i);
  });

  it('surfaces the DQN action when an agent is available', () => {
    const signal = signalAt(features, 300, { dqnAction: 'buy' });
    expect(signal.factors.some((f) => f.name === 'DQN agent' && f.value === 'BUY')).toBe(true);
    expect(reasonText(signal)).toMatch(/DQN/);
  });

  it('reports a stop-loss breach for an underwater position', () => {
    const i = 300;
    const signal = signalAt(features, i, {
      position: { qty: 10, avgCost: bars[i].c * 1.2 },
      stopLossPct: 0.05,
    });
    expect(reasonText(signal)).toMatch(/stop-loss/i);
  });

  it('degrades gracefully with almost no history', () => {
    const signal = signalAt(features, 0);
    expect(signal.side).toBe('hold');
    expect(signal.reasons.length).toBeGreaterThan(0);
  });
});

function reasonText(signal: { reasons: { text: string }[] }): string {
  return signal.reasons.map((r) => r.text).join(' ');
}
