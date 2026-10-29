/**
 * Portfolio accounting: valuations, realised/unrealised P&L, allocation and fees.
 * All functions are pure so they can be unit tested against known fixtures.
 */

import type { Asset, Holding, Portfolio, Trade } from './types';

export interface Valuation {
  /** Current market value of everything including cash. */
  total: number;
  /** Market value of positions only. */
  invested: number;
  cash: number;
}

export function findHolding(holdings: readonly Holding[], symbol: string): Holding | null {
  return holdings.find((h) => h.symbol === symbol) ?? null;
}

export function positionValue(holding: Holding, price: number): number {
  return holding.qty * price;
}

/** Value the account at a set of last-known prices (missing symbols fall back to cost). */
export function valuePortfolio(
  account: Pick<Portfolio, 'cash' | 'holdings'>,
  prices: Record<string, number>,
): Valuation {
  let invested = 0;
  for (const h of account.holdings) {
    const price = prices[h.symbol];
    invested += h.qty * (Number.isFinite(price) && price > 0 ? price : h.avgCost);
  }
  return { total: invested + account.cash, invested, cash: account.cash };
}

export interface HoldingRow {
  asset: Asset | null;
  symbol: string;
  qty: number;
  avgCost: number;
  price: number;
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
  weight: number;
  dayChangePct: number | null;
}

export function holdingRows(
  account: Pick<Portfolio, 'cash' | 'holdings'>,
  prices: Record<string, number>,
  previous: Record<string, number>,
  assets: readonly Asset[],
  total: number,
): HoldingRow[] {
  return account.holdings
    .map((h) => {
      const price = prices[h.symbol] ?? h.avgCost;
      const prev = previous[h.symbol];
      const value = h.qty * price;
      const cost = h.qty * h.avgCost;
      const pnl = value - cost;
      return {
        asset: assets.find((a) => a.symbol === h.symbol) ?? null,
        symbol: h.symbol,
        qty: h.qty,
        avgCost: h.avgCost,
        price,
        value,
        cost,
        pnl,
        pnlPct: cost === 0 ? 0 : pnl / cost,
        weight: total > 0 ? value / total : 0,
        dayChangePct: prev && prev > 0 ? (price - prev) / prev : null,
      };
    })
    .sort((a, b) => b.value - a.value);
}

export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
  weight: number;
  kind: 'asset' | 'cash';
  sector: string;
}

/** Weight slices of the portfolio, largest first; cash is always included. */
export function allocationSlices(
  account: Pick<Portfolio, 'cash' | 'holdings'>,
  prices: Record<string, number>,
  assets: readonly Asset[],
  total: number,
): AllocationSlice[] {
  const slices: AllocationSlice[] = account.holdings
    .map((h) => {
      const asset = assets.find((a) => a.symbol === h.symbol);
      const value = h.qty * (prices[h.symbol] ?? h.avgCost);
      return {
        key: h.symbol,
        label: h.symbol,
        value,
        weight: total > 0 ? value / total : 0,
        kind: 'asset' as const,
        sector: asset?.sector ?? 'Other',
      };
    })
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  slices.push({
    key: 'CASH',
    label: 'Cash',
    value: account.cash,
    weight: total > 0 ? account.cash / total : 0,
    kind: 'cash',
    sector: 'Cash',
  });
  return slices;
}

export interface SectorSlice {
  sector: string;
  value: number;
  weight: number;
}

export function sectorAllocation(
  account: Pick<Portfolio, 'cash' | 'holdings'>,
  prices: Record<string, number>,
  assets: readonly Asset[],
  total: number,
): SectorSlice[] {
  const map = new Map<string, number>();
  for (const h of account.holdings) {
    const asset = assets.find((a) => a.symbol === h.symbol);
    const sector = asset?.sector ?? 'Other';
    const value = h.qty * (prices[h.symbol] ?? h.avgCost);
    map.set(sector, (map.get(sector) ?? 0) + value);
  }
  map.set('Cash', account.cash);
  return [...map.entries()]
    .map(([sector, value]) => ({ sector, value, weight: total > 0 ? value / total : 0 }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Herfindahl–Hirschman index of position weights (1 = single holding, 0 = fully cash). */
export function concentration(weights: readonly number[]): number {
  return weights.reduce((acc, w) => acc + w * w, 0);
}

export interface FeeBreakdown {
  gross: number;
  fee: number;
  /** Total cash moved: gross + fee for buys, gross - fee for sells. */
  net: number;
}

/** Transaction cost in basis points of traded notional, never below zero. */
export function computeFee(side: 'buy' | 'sell', qty: number, price: number, costBps: number): FeeBreakdown {
  const gross = qty * price;
  const fee = Math.max(0, gross * (Math.max(0, costBps) / 10_000));
  return { gross, fee, net: side === 'buy' ? gross + fee : gross - fee };
}

export interface TradeOutcome {
  symbol: string;
  qty: number;
  avgCost: number;
  proceeds: number;
  cost: number;
  realizedPnl: number;
}

/** Apply a fill to a holding list, returning the new holdings and any realised P&L. */
export function applyFill(
  holdings: readonly Holding[],
  side: 'buy' | 'sell',
  symbol: string,
  qty: number,
  price: number,
): { holdings: Holding[]; outcome: TradeOutcome | null } {
  const existing = holdings.find((h) => h.symbol === symbol);
  if (side === 'buy') {
    const nextQty = (existing?.qty ?? 0) + qty;
    const avgCost = ((existing?.avgCost ?? 0) * (existing?.qty ?? 0) + price * qty) / nextQty;
    const others = holdings.filter((h) => h.symbol !== symbol);
    return {
      holdings: [...others, { symbol, qty: nextQty, avgCost }].sort((a, b) => a.symbol.localeCompare(b.symbol)),
      outcome: { symbol, qty, avgCost, proceeds: 0, cost: qty * price, realizedPnl: 0 },
    };
  }
  if (!existing || existing.qty <= 0) return { holdings: [...holdings], outcome: null };
  const closedQty = Math.min(qty, existing.qty);
  const proceeds = closedQty * price;
  const cost = closedQty * existing.avgCost;
  const remaining = existing.qty - closedQty;
  const others = holdings.filter((h) => h.symbol !== symbol);
  if (remaining > 1e-9) {
    others.push({ symbol, qty: remaining, avgCost: existing.avgCost });
  }
  return {
    holdings: others.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    outcome: {
      symbol,
      qty: closedQty,
      avgCost: existing.avgCost,
      proceeds,
      cost,
      realizedPnl: proceeds - cost,
    },
  };
}

/** Realised P&L summed over every completed trade pair in the history. */
export function realizedPnl(trades: readonly Trade[]): number {
  let realized = 0;
  const open = new Map<string, { qty: number; avg: number }>();
  for (const t of trades) {
    const state = open.get(t.symbol) ?? { qty: 0, avg: 0 };
    if (t.side === 'buy') {
      const total = state.qty + t.qty;
      state.avg = total === 0 ? 0 : (state.avg * state.qty + t.price * t.qty) / total;
      state.qty = total;
      realized -= t.fee; // entry cost reduces realised P&L
    } else {
      const closed = Math.min(t.qty, state.qty);
      realized += (t.price - state.avg) * closed - t.fee;
      state.qty -= closed;
    }
    open.set(t.symbol, state);
  }
  return realized;
}
