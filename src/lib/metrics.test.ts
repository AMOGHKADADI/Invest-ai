import { describe, expect, it } from 'vitest';
import {
  cagr,
  drawdownSeries,
  maxDrawdown,
  profitFactor,
  returnsFromEquity,
  sharpeRatio,
  sortinoRatio,
  summarizeEquity,
  totalReturn,
  volatility,
  winRate,
} from './metrics';

describe('returns and totals', () => {
  it('computes simple returns from an equity curve', () => {
    expect(returnsFromEquity([100, 110, 99])).toEqual([0.1, -0.1]);
  });

  it('computes total return over the whole curve', () => {
    expect(totalReturn([100_000, 124_350])).toBeCloseTo(0.2435, 10);
  });

  it('returns null when there is not enough data', () => {
    expect(totalReturn([100])).toBeNull();
    expect(cagr([100])).toBeNull();
  });
});

describe('maxDrawdown', () => {
  it('finds the peak-to-trough loss and the recovery index', () => {
    const equity = [100, 120, 90, 95, 130, 125];
    const dd = maxDrawdown(equity)!;
    expect(dd.pct).toBeCloseTo((120 - 90) / 120, 10);
    expect(dd.peakIndex).toBe(1);
    expect(dd.troughIndex).toBe(2);
    expect(dd.recoveryIndex).toBe(4);
  });

  it('reports no recovery while still under water', () => {
    const dd = maxDrawdown([100, 80, 70])!;
    expect(dd.pct).toBeCloseTo(0.3, 10);
    expect(dd.recoveryIndex).toBeNull();
  });

  it('drawdownSeries is zero at high-water marks', () => {
    const dd = drawdownSeries([100, 110, 105]);
    expect(dd[0]).toBe(0);
    expect(dd[1]).toBe(0);
    expect(dd[2]).toBeCloseTo((110 - 105) / 110, 10);
  });
});

describe('risk ratios', () => {
  it('computes a reproducible Sharpe ratio', () => {
    const returns = [0.01, 0.02, -0.005, 0.015, 0.008, -0.002, 0.011, 0.004];
    const value = sharpeRatio(returns, { riskFreeRate: 0 })!;
    expect(Number.isFinite(value)).toBe(true);
    // Sharpe = mean / sampleStd * sqrt(252)
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    expect(value).toBeCloseTo((mean / Math.sqrt(variance)) * Math.sqrt(252), 10);
  });

  it('returns null when volatility is zero', () => {
    expect(sharpeRatio([0.01, 0.01, 0.01])).toBeNull();
  });

  it('sortino only penalises downside deviation', () => {
    const up = [0.02, 0.01, 0.03, 0.015];
    expect(sortinoRatio(up)).toBeNull(); // no downside at all
    const mixed = [0.02, -0.01, 0.03, -0.005, 0.01];
    const value = sortinoRatio(mixed)!;
    expect(Number.isFinite(value)).toBe(true);
  });

  it('volatility scales the sample deviation by sqrt(252)', () => {
    const returns = [0.01, -0.01, 0.02, -0.02, 0.015];
    const expected = volatility(returns)!;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const sd = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1));
    expect(expected).toBeCloseTo(sd * Math.sqrt(252), 10);
  });
});

describe('trade statistics', () => {
  it('winRate counts strictly positive outcomes', () => {
    // Two positives out of four; a flat result is not a win.
    expect(winRate([0.05, -0.02, 0.01, 0])).toBeCloseTo(0.5, 10);
    expect(winRate([])).toBeNull();
  });

  it('profitFactor balances gross gains against gross losses', () => {
    expect(profitFactor([0.1, -0.05, 0.2, -0.05])).toBeCloseTo(3, 10);
    expect(profitFactor([-0.1, -0.1])).toBe(0);
  });
});

describe('summarizeEquity', () => {
  it('returns every headline metric under the documented assumptions', () => {
    // A zig-zag curve so the downside deviation (and therefore Sortino) is defined.
    const equity = Array.from(
      { length: 252 },
      (_, i) => 100_000 * (1 + 0.0005 * i + (i % 7 === 0 ? -0.004 : 0.001)),
    );
    const summary = summarizeEquity(equity, { riskFreeRate: 0.06 });
    expect(summary.sessions).toBe(252);
    expect(summary.totalReturn!).toBeGreaterThan(0);
    expect(summary.maxDrawdown!.pct).toBeGreaterThan(0);
    expect(summary.sharpe).not.toBeNull();
    expect(summary.sortino).not.toBeNull();
    expect(summary.cagr).not.toBeNull();
  });
});
