import { describe, expect, it } from 'vitest';
import { atr, bollinger, ema, macd, momentum, pctChange, rollingStd, rsi, sma, streak } from './indicators';

const series = [10, 11, 12, 11, 13, 14, 15, 14, 16, 17, 18, 17, 19, 20, 21, 22, 21, 23, 24, 25];

describe('sma', () => {
  it('computes the rolling mean and reports null during warm-up', () => {
    const out = sma([1, 2, 3, 4], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[3]).toBeCloseTo(3, 10);
  });

  it('rejects invalid periods', () => {
    expect(() => sma(series, 0)).toThrow(RangeError);
    expect(() => sma(series, 2.5)).toThrow(RangeError);
  });

  it('rejects non-finite inputs', () => {
    expect(() => sma([1, Number.NaN, 3], 2)).toThrow(RangeError);
  });
});

describe('ema', () => {
  it('seeds with the SMA of the first window', () => {
    const input = [1, 2, 3, 4, 5];
    const out = ema(input, 3);
    expect(out[0]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10);
    const alpha = 2 / 4;
    expect(out[3]).toBeCloseTo(4 * alpha + 2 * (1 - alpha), 10);
  });

  it('returns all nulls when the series is shorter than the period', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });
});

describe('rsi', () => {
  it('stays bounded and is 100 on a monotonically rising series', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    const out = rsi(rising, 14);
    expect(out[14]).toBeCloseTo(100, 6);
    for (const v of out) if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('approaches 0 on a monotonically falling series', () => {
    const falling = Array.from({ length: 30 }, (_, i) => 100 - i);
    const out = rsi(falling, 14);
    expect(out[14]).toBeCloseTo(0, 6);
  });

  it('warms up before the first value', () => {
    const out = rsi(series, 14);
    expect(out[13]).toBeNull();
    expect(out[14]).not.toBeNull();
  });
});

describe('macd', () => {
  it('produces a histogram equal to macd minus signal', () => {
    const out = macd(series, 3, 6, 3);
    for (let i = 0; i < series.length; i++) {
      const m = out.macd[i];
      const s = out.signal[i];
      const h = out.histogram[i];
      if (m === null || s === null) expect(h).toBeNull();
      else expect(h).toBeCloseTo(m - s, 10);
    }
  });
});

describe('bollinger', () => {
  it('places the middle band on the moving average and %B accordingly', () => {
    const input = Array.from({ length: 25 }, (_, i) => 100 + (i % 4));
    const out = bollinger(input, 20, 2);
    const i = 24;
    expect(out.middle[i]).toBeCloseTo(sma(input, 20)[i]!, 10);
    expect(out.percentB[i]).not.toBeNull();
    expect(out.upper[i]!).toBeGreaterThan(out.lower[i]!);
    // A value at the middle band has %B = 0.5.
    const flat = new Array(25).fill(100);
    const flatOut = bollinger(flat, 20, 2);
    expect(flatOut.lower[24]).toBe(100);
    expect(flatOut.percentB[24]).toBe(0.5);
  });
});

describe('other indicators', () => {
  it('pctChange nulls the first value', () => {
    expect(pctChange([100, 110])[0]).toBeNull();
    expect(pctChange([100, 110])[1]).toBeCloseTo(0.1, 10);
  });

  it('rollingStd matches the population deviation', () => {
    const out = rollingStd([2, 4, 4, 4, 5, 5, 7, 9], 8);
    expect(out[7]).toBeCloseTo(2, 10);
  });

  it('momentum measures change over the lookback in percent', () => {
    const out = momentum([100, 105, 110], 2);
    expect(out[0]).toBe(0);
    expect(out[2]).toBeCloseTo(10, 10);
  });

  it('streak counts consecutive up sessions', () => {
    expect(streak([1, 2, 3, 2, 3])).toEqual([0, 1, 2, -1, 1]);
  });

  it('atr is positive for valid bars', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ h: 110 + i, l: 90 + i, c: 100 + i }));
    const out = atr(bars, 14);
    expect(out[14]).toBeGreaterThan(0);
  });
});
