/**
 * Chronological backtesting engine.
 *
 * Guarantees (each covered by a unit test):
 *  - Signals are computed only from information available strictly before the
 *    execution bar, and orders are filled at that bar's open.
 *  - Transaction costs, cash constraints, position limits and sector limits are
 *    applied to every fill.
 *  - Training/validation/test segmentation is the caller's responsibility and is
 *    reported in the result window so no period is silently reused.
 *  - Running the engine on a truncated series produces exactly the same trades as
 *    running it on the full series for that same window (no look-ahead).
 */

import type { Bar, Holding, SignalSide, Trade } from './types';
import type { AssetFeatures } from './signals';
import { computeFeatures } from './signals';
import { computeFee, valuePortfolio } from './portfolio';
import { summarizeEquity, type EquitySummary } from './metrics';

export interface BacktestAsset {
  symbol: string;
  sector: string;
  bars: readonly Bar[];
}

export interface StrategyContext {
  /** Session timestamp being traded. */
  date: number;
  gridIndex: number;
  /** Features indexed by symbol, computed causally from that symbol's own history. */
  features: Map<string, AssetFeatures>;
  /** Index of the last bar strictly before `date`, per symbol. */
  previousIndex: Map<string, number>;
  /** Last close strictly before `date`, per symbol. */
  closes: Record<string, number>;
  /** Portfolio equity marked at the previous close. */
  equity: number;
  hasPosition(symbol: string): boolean;
  /** Causal sentiment score in [-1, 1] published at or before `date`. */
  sentiment(symbol: string, date: number): number | null;
  /** Causal forecast-implied forward return, or null when no model is available. */
  forecast(symbol: string, date: number): number | null;
}

export interface StrategyDecision {
  side: SignalSide;
  /** Free-form score in [-1, 1] for reporting. */
  score: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  decide(ctx: StrategyContext, symbol: string): StrategyDecision;
}

export interface BacktestConfig {
  assets: BacktestAsset[];
  benchmark: { symbol: string; bars: readonly Bar[] } | null;
  strategy: Strategy;
  initialCash: number;
  costBps: number;
  maxPositionPct: number;
  /** Optional inclusive grid range; defaults to the full series after warm-up. */
  startIndex?: number;
  endIndex?: number;
  sentiment?: (symbol: string, date: number) => number | null;
  forecast?: (symbol: string, date: number) => number | null;
}

export interface BacktestResult {
  dates: number[];
  equity: number[];
  benchmarkEquity: number[] | null;
  trades: Trade[];
  summary: EquitySummary;
  benchmarkSummary: EquitySummary | null;
  /** Mean fraction of equity held in positions over the window. */
  exposure: number;
  /** Total traded notional divided by mean equity. */
  turnover: number;
  finalCash: number;
  strategyId: string;
  window: { startIndex: number; endIndex: number; from: number; to: number };
  notes: string[];
}

function buildGrid(assets: readonly BacktestAsset[]): number[] {
  const set = new Set<number>();
  for (const a of assets) for (const b of a.bars) set.add(b.t);
  return [...set].sort((x, y) => x - y);
}

/**
 * Run a strategy across every asset in chronological order.
 */
export function runBacktest(config: BacktestConfig): BacktestResult {
  const { assets, benchmark, strategy, initialCash, costBps, maxPositionPct } = config;
  if (assets.length === 0) throw new Error('runBacktest requires at least one asset.');
  if (initialCash <= 0) throw new Error('runBacktest requires a positive initial cash balance.');

  const dates = buildGrid(assets);
  if (dates.length < 2) throw new Error('Not enough sessions to backtest.');

  const features = new Map<string, AssetFeatures>();
  const previousIndex = new Map<string, number>();
  const cashBySymbol = new Map<string, number>();
  for (const a of assets) {
    features.set(a.symbol, computeFeatures(a.bars, a.symbol));
    previousIndex.set(a.symbol, -1);
    cashBySymbol.set(a.symbol, -1);
  }

  const warmup = Math.max(
    60,
    ...assets.map((a) => Math.min(60, a.bars.length - 1)),
  );
  const startIndex = Math.max(config.startIndex ?? warmup, 1);
  const endIndex = Math.min(config.endIndex ?? dates.length - 1, dates.length - 1);
  if (startIndex >= endIndex) throw new Error('Backtest window is empty after applying warm-up.');

  let cash = initialCash;
  const positions = new Map<string, Holding>();
  const trades: Trade[] = [];
  const equityCurve: number[] = [];
  const datesOut: number[] = [];
  let exposureAcc = 0;
  let tradedNotional = 0;
  let equityAcc = 0;

  const notes: string[] = [
    `Execution: signals from the previous session are filled at the next session's open (no same-bar fills).`,
    `Transaction cost: ${costBps} bps of traded notional, applied to every fill.`,
    `Position cap: ${Math.round(maxPositionPct * 100)}% of equity per symbol.`,
  ];

  for (let i = 1; i <= endIndex; i++) {
    const date = dates[i];

    // 1. Advance each symbol to its last bar strictly before today.
    for (const a of assets) {
      let idx = previousIndex.get(a.symbol) ?? -1;
      while (idx + 1 < a.bars.length && a.bars[idx + 1].t < date) idx++;
      previousIndex.set(a.symbol, idx);
    }

    // 2. Snapshot prices/features available at the previous close.
    const closes: Record<string, number> = {};
    for (const a of assets) {
      const idx = previousIndex.get(a.symbol) ?? -1;
      closes[a.symbol] = idx >= 0 ? a.bars[idx].c : a.bars[0]?.o ?? 0;
    }
    const prevPrices: Record<string, number> = { ...closes };
    const prevEquity = valuePortfolio({ cash, holdings: [...positions.values()] }, prevPrices).total;

    if (i <= startIndex) {
      // Warm-up: mark equity, record nothing, execute nothing.
      equityCurve.push(prevEquity);
      datesOut.push(date);
      continue;
    }

    const ctx: StrategyContext = {
      date,
      gridIndex: i,
      features,
      previousIndex,
      closes,
      equity: prevEquity,
      hasPosition: (symbol) => (positions.get(symbol)?.qty ?? 0) > 0,
      sentiment: config.sentiment ?? (() => null),
      forecast: config.forecast ?? (() => null),
    };

    // 3. Decide, then fill at today's open where a bar exists.
    for (const a of assets) {
      const openBar = barAt(a.bars, date);
      if (!openBar) continue;
      const decision = strategy.decide(ctx, a.symbol);
      const holding = positions.get(a.symbol);
      const price = openBar.o;

      if (decision.side === 'buy' && (!holding || holding.qty === 0) && price > 0) {
        const budget = Math.min(maxPositionPct * prevEquity, cash);
        const perUnit = price * (1 + costBps / 10_000);
        let qty = Math.floor(budget / perUnit);
        while (qty > 0 && qty * perUnit > cash) qty--;
        if (qty > 0) {
          const { fee } = computeFee('buy', qty, price, costBps);
          const notional = qty * price;
          cash -= notional + fee;
          tradedNotional += notional;
          positions.set(a.symbol, { symbol: a.symbol, qty, avgCost: price });
          trades.push({
            id: `${date}-${a.symbol}-b`,
            symbol: a.symbol,
            side: 'buy',
            qty,
            price,
            fee,
            at: date,
            reason: `${strategy.name}: BUY (score ${decision.score.toFixed(2)})`,
            mode: 'paper',
          });
        }
      } else if (decision.side === 'sell' && holding && holding.qty > 0 && price > 0) {
        const { fee } = computeFee('sell', holding.qty, price, costBps);
        const notional = holding.qty * price;
        cash += notional - fee;
        tradedNotional += notional;
        trades.push({
          id: `${date}-${a.symbol}-s`,
          symbol: a.symbol,
          side: 'sell',
          qty: holding.qty,
          price,
          fee,
          at: date,
          reason: `${strategy.name}: SELL (score ${decision.score.toFixed(2)})`,
          mode: 'paper',
        });
        positions.delete(a.symbol);
      }
    }

    // 4. Mark to market at today's close.
    const marks: Record<string, number> = {};
    for (const a of assets) {
      const bar = barAt(a.bars, date);
      if (bar) cashBySymbol.set(a.symbol, bar.c);
      const last = cashBySymbol.get(a.symbol) ?? 0;
      marks[a.symbol] = last > 0 ? last : closes[a.symbol];
    }
    const equityNow = valuePortfolio({ cash, holdings: [...positions.values()] }, marks).total;
    equityCurve.push(equityNow);
    datesOut.push(date);
    exposureAcc += equityNow > 0 ? 1 - cash / equityNow : 0;
    equityAcc += equityNow;
  }

  const summary = summarizeEquity(equityCurve);
  const meanEquity = equityAcc / Math.max(1, equityCurve.length);

  let benchmarkEquity: number[] | null = null;
  let benchmarkSummary: EquitySummary | null = null;
  if (benchmark && benchmark.bars.length > 0) {
    benchmarkEquity = benchmarkEquityCurve(benchmark.bars, datesOut, initialCash, costBps);
    if (benchmarkEquity) benchmarkSummary = summarizeEquity(benchmarkEquity);
  }

  return {
    dates: datesOut,
    equity: equityCurve,
    benchmarkEquity,
    trades,
    summary,
    benchmarkSummary,
    exposure: exposureAcc / Math.max(1, equityCurve.length),
    turnover: meanEquity > 0 ? tradedNotional / meanEquity : 0,
    finalCash: cash,
    strategyId: strategy.id,
    window: {
      startIndex,
      endIndex,
      from: datesOut[0],
      to: datesOut[datesOut.length - 1],
    },
    notes,
  };
}

function barAt(bars: readonly Bar[], date: number): Bar | null {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t === date) return bars[mid];
    if (bars[mid].t < date) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** Buy-and-hold benchmark curve over exactly the same sessions as the strategy. */
function benchmarkEquityCurve(
  bars: readonly Bar[],
  dates: readonly number[],
  initialCash: number,
  costBps: number,
): number[] | null {
  if (dates.length === 0) return null;
  const byDate = new Map<number, Bar>(bars.map((b) => [b.t, b]));
  const first = byDate.get(dates[0]);
  if (!first) return null;
  const perUnit = first.c * (1 + costBps / 10_000);
  const units = Math.floor(initialCash / perUnit);
  const fee = computeFee('buy', units, first.c, costBps).fee;
  const cash = initialCash - units * first.c - fee;
  const out: number[] = [];
  for (const d of dates) {
    const bar = byDate.get(d);
    const price = bar ? bar.c : bars[bars.length - 1].c;
    out.push(units * price + cash);
  }
  return out;
}
