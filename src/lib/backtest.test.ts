import { describe, expect, it } from 'vitest';
import { getDemoMarket, UNIVERSE } from './demoData';
import { runBacktest, type BacktestAsset } from './backtest';
import { buyAndHoldStrategy, investaiStrategy, smaCrossoverStrategy } from './strategies';
import { computeFeatures } from './signals';

const market = getDemoMarket();
const asset: BacktestAsset = {
  symbol: 'RELIANCE',
  sector: 'Energy',
  bars: market.bars.RELIANCE,
};

const baseConfig = {
  assets: [asset],
  benchmark: { symbol: 'NIFTY50', bars: market.benchmark },
  strategy: investaiStrategy({ useForecast: false }),
  initialCash: 100_000,
  costBps: 10,
  maxPositionPct: 0.2,
};

describe('runBacktest', () => {
  it('produces an equity curve covering the whole window', () => {
    const result = runBacktest(baseConfig);
    expect(result.equity.length).toBeGreaterThan(400);
    expect(result.equity.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
    expect(result.dates).toHaveLength(result.equity.length);
    expect(result.benchmarkEquity).not.toBeNull();
    expect(result.benchmarkEquity!).toHaveLength(result.equity.length);
    expect(result.summary.totalReturn).not.toBeNull();
  });

  it('records trades with fees and never spends cash it does not have', () => {
    const result = runBacktest(baseConfig);
    let cash = 100_000;
    for (const t of result.trades) {
      expect(t.fee).toBeGreaterThanOrEqual(0);
      expect(t.mode).toBe('paper');
      expect(t.price).toBeGreaterThan(0);
      cash += t.side === 'buy' ? -(t.qty * t.price + t.fee) : t.qty * t.price - t.fee;
      expect(cash).toBeGreaterThan(-1e-6);
    }
    expect(result.trades.length).toBeGreaterThan(0);
  });

  it('is free of look-ahead: a truncated run matches the full run', () => {
    const cutoff = 300;
    const full = runBacktest(baseConfig);
    const cutDate = full.dates[Math.min(cutoff, full.dates.length - 1)];

    const truncated = runBacktest({
      ...baseConfig,
      assets: [{ ...asset, bars: asset.bars.slice(0, cutoff) }],
      benchmark: null,
    });

    const fullTrades = full.trades.filter((t) => t.at < cutDate);
    expect(truncated.trades).toHaveLength(fullTrades.length);
    for (let i = 0; i < fullTrades.length; i++) {
      expect(truncated.trades[i].at).toBe(fullTrades[i].at);
      expect(truncated.trades[i].side).toBe(fullTrades[i].side);
      expect(truncated.trades[i].qty).toBe(fullTrades[i].qty);
      expect(truncated.trades[i].price).toBe(fullTrades[i].price);
    }
    // Equity curves must agree up to the truncation point.
    for (let i = 0; i < truncated.equity.length; i++) {
      expect(truncated.equity[i]).toBeCloseTo(full.equity[i], 6);
    }
  });

  it('transaction costs reduce the final equity', () => {
    const free = runBacktest({ ...baseConfig, costBps: 0 });
    const costly = runBacktest({ ...baseConfig, costBps: 100 });
    expect(costly.equity[costly.equity.length - 1]).toBeLessThan(
      free.equity[free.equity.length - 1],
    );
    expect(costly.trades.length).toBeGreaterThan(0);
    expect(costly.trades.length).toBeLessThanOrEqual(free.trades.length);
  });

  it('a never-trading strategy keeps equity flat apart from the initial mark', () => {
    const result = runBacktest({
      ...baseConfig,
      strategy: {
        id: 'never',
        name: 'Never trade',
        description: 'test',
        decide: () => ({ side: 'hold', score: 0 }),
      },
    });
    expect(result.trades).toHaveLength(0);
    expect(result.equity.every((v) => Math.abs(v - 100_000) < 1e-6)).toBe(true);
    expect(result.exposure).toBe(0);
  });

  it('buy & hold keeps the position until the end', () => {
    const result = runBacktest({ ...baseConfig, strategy: buyAndHoldStrategy });
    const buys = result.trades.filter((t) => t.side === 'buy');
    const sells = result.trades.filter((t) => t.side === 'sell');
    expect(buys).toHaveLength(1);
    expect(sells).toHaveLength(0);
    // The position cap sizes the trade at ~20% of equity.
    expect(result.exposure).toBeGreaterThan(0.1);
  });

  it('reports exposure, turnover and a window', () => {
    const result = runBacktest(baseConfig);
    expect(result.exposure).toBeGreaterThanOrEqual(0);
    expect(result.exposure).toBeLessThanOrEqual(1);
    expect(result.turnover).toBeGreaterThanOrEqual(0);
    expect(result.window.from).toBeLessThan(result.window.to);
    expect(result.notes.join(' ')).toContain('open');
  });

  it('rejects an empty configuration', () => {
    expect(() =>
      runBacktest({ ...baseConfig, assets: [] }),
    ).toThrow(/at least one asset/);
  });
});

describe('strategies', () => {
  it('SMA crossover fires only after enough history', () => {
    const strategy = smaCrossoverStrategy(20, 50);
    const features = computeFeatures(asset.bars, asset.symbol);
    const early = strategy.decide(
      {
        date: asset.bars[10].t,
        gridIndex: 10,
        features: new Map([[asset.symbol, features]]),
        previousIndex: new Map([[asset.symbol, 10]]),
        closes: { RELIANCE: asset.bars[10].c },
        equity: 100_000,
        hasPosition: () => false,
        sentiment: () => null,
        forecast: () => null,
      },
      'RELIANCE',
    );
    expect(early.side).toBe('hold');
  });

  it('every strategy has a stable identity', () => {
    expect(buyAndHoldStrategy.id).toBe('buy-and-hold');
    expect(investaiStrategy().id).toBe('investai-ensemble');
    expect(smaCrossoverStrategy(20, 50).id).toBe('sma-20-50');
  });

  it('the demo universe is unique and non-empty', () => {
    const symbols = new Set(UNIVERSE.map((a) => a.symbol));
    expect(symbols.size).toBe(UNIVERSE.length);
    expect(UNIVERSE.length).toBeGreaterThanOrEqual(8);
  });
});
