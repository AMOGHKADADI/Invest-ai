/**
 * Portfolio and strategy performance metrics.
 *
 * Documented assumptions (also surfaced in the UI and README):
 *  - Returns are computed from an equity curve sampled once per trading session.
 *  - Risk-free rate is annual and applied per period as rf / periodsPerYear (default 0).
 *  - Volatility and Sharpe use the sample standard deviation (ddof = 1) scaled by
 *    sqrt(periodsPerYear), assuming 252 trading sessions per year.
 *  - Sortino divides by the downside deviation of returns below the per-period
 *    minimum acceptable return (default = per-period risk-free rate = 0).
 *  - Ratios return `null` when there is not enough data to compute them; they are
 *    never silently replaced by a plausible-looking number.
 */

export const TRADING_DAYS_PER_YEAR = 252;

export interface RatioOptions {
  /** Annual risk-free rate, e.g. 0.06 for 6%. */
  riskFreeRate?: number;
  periodsPerYear?: number;
}

function mean(values: readonly number[]): number {
  let acc = 0;
  for (const v of values) acc += v;
  return acc / values.length;
}

/** Sample standard deviation (ddof = 1). Returns 0 for a single observation. */
function sampleStd(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (values.length - 1));
}

/** Simple (arithmetic) returns derived from an equity curve. Index 0 is dropped. */
export function returnsFromEquity(equity: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1];
    out.push(prev === 0 ? 0 : (equity[i] - prev) / prev);
  }
  return out;
}

export function totalReturn(equity: readonly number[]): number | null {
  if (equity.length < 2) return null;
  const first = equity[0];
  if (first === 0) return null;
  return (equity[equity.length - 1] - first) / first;
}

/** Compound annual growth rate from the equity curve. */
export function cagr(equity: readonly number[], periodsPerYear = TRADING_DAYS_PER_YEAR): number | null {
  if (equity.length < 2) return null;
  const first = equity[0];
  const last = equity[equity.length - 1];
  if (first <= 0 || last <= 0) return null;
  const years = (equity.length - 1) / periodsPerYear;
  if (years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

/** Annualised volatility of a return series. */
export function volatility(returns: readonly number[], periodsPerYear = TRADING_DAYS_PER_YEAR): number | null {
  if (returns.length < 2) return null;
  return sampleStd(returns) * Math.sqrt(periodsPerYear);
}

/** Annualised Sharpe ratio. */
export function sharpeRatio(returns: readonly number[], options: RatioOptions = {}): number | null {
  const { riskFreeRate = 0, periodsPerYear = TRADING_DAYS_PER_YEAR } = options;
  if (returns.length < 2) return null;
  const sd = sampleStd(returns);
  if (sd === 0) return null;
  const rfPerPeriod = riskFreeRate / periodsPerYear;
  const excess = returns.map((r) => r - rfPerPeriod);
  return (mean(excess) / sd) * Math.sqrt(periodsPerYear);
}

/** Annualised Sortino ratio (downside deviation only). */
export function sortinoRatio(returns: readonly number[], options: RatioOptions = {}): number | null {
  const { riskFreeRate = 0, periodsPerYear = TRADING_DAYS_PER_YEAR } = options;
  if (returns.length < 2) return null;
  const rfPerPeriod = riskFreeRate / periodsPerYear;
  let acc = 0;
  let count = 0;
  for (const r of returns) {
    const diff = Math.min(0, r - rfPerPeriod);
    acc += diff * diff;
    count++;
  }
  const downside = Math.sqrt(acc / count);
  if (downside === 0) return null;
  const avg = mean(returns) - rfPerPeriod;
  return (avg / downside) * Math.sqrt(periodsPerYear);
}

export interface DrawdownResult {
  /** Maximum peak-to-trough loss as a positive fraction, e.g. 0.068 = -6.8%. */
  pct: number;
  peakIndex: number;
  troughIndex: number;
  /** Index at which the equity recovered its prior peak, or null if still under water. */
  recoveryIndex: number | null;
}

/** Maximum drawdown of an equity curve, with the peak, trough and recovery indices. */
export function maxDrawdown(equity: readonly number[]): DrawdownResult | null {
  if (equity.length < 2) return null;
  let peak = equity[0];
  let peakIdx = 0;
  let worst = 0;
  let worstPeak = 0;
  let worstTrough = 0;
  for (let i = 1; i < equity.length; i++) {
    if (equity[i] > peak) {
      peak = equity[i];
      peakIdx = i;
    } else {
      const dd = peak === 0 ? 0 : (peak - equity[i]) / peak;
      if (dd > worst) {
        worst = dd;
        worstPeak = peakIdx;
        worstTrough = i;
      }
    }
  }
  let recoveryIndex: number | null = null;
  if (worst > 0) {
    const peakValue = equity[worstPeak];
    for (let i = worstTrough + 1; i < equity.length; i++) {
      if (equity[i] >= peakValue) {
        recoveryIndex = i;
        break;
      }
    }
  }
  return { pct: worst, peakIndex: worstPeak, troughIndex: worstTrough, recoveryIndex };
}

/** Drawdown at every point of the equity curve (0 when at a high-water mark). */
export function drawdownSeries(equity: readonly number[]): number[] {
  let peak = equity.length > 0 ? equity[0] : 0;
  return equity.map((value) => {
    if (value > peak) peak = value;
    return peak === 0 ? 0 : (peak - value) / peak;
  });
}

export function winRate(results: readonly number[]): number | null {
  if (results.length === 0) return null;
  const wins = results.filter((r) => r > 0).length;
  return wins / results.length;
}

/** Gross profits divided by gross losses across closed outcomes. */
export function profitFactor(results: readonly number[]): number | null {
  let gains = 0;
  let losses = 0;
  for (const r of results) {
    if (r > 0) gains += r;
    else if (r < 0) losses += -r;
  }
  if (losses === 0) return gains > 0 ? Infinity : null;
  return gains / losses;
}

export interface EquitySummary {
  totalReturn: number | null;
  cagr: number | null;
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: DrawdownResult | null;
  calmar: number | null;
  sessions: number;
}

/** All headline metrics for one equity curve, computed under the documented assumptions. */
export function summarizeEquity(equity: readonly number[], options: RatioOptions = {}): EquitySummary {
  const { periodsPerYear = TRADING_DAYS_PER_YEAR, riskFreeRate = 0 } = options;
  const rets = returnsFromEquity(equity);
  const dd = maxDrawdown(equity);
  const annualReturn = cagr(equity, periodsPerYear);
  return {
    totalReturn: totalReturn(equity),
    cagr: annualReturn,
    volatility: volatility(rets, periodsPerYear),
    sharpe: sharpeRatio(rets, { periodsPerYear, riskFreeRate }),
    sortino: sortinoRatio(rets, { periodsPerYear, riskFreeRate }),
    maxDrawdown: dd,
    calmar: dd && dd.pct > 0 && annualReturn !== null ? annualReturn / dd.pct : null,
    sessions: equity.length,
  };
}
