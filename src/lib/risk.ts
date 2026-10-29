/**
 * Risk management: position sizing, pre-trade checks and the live risk summary.
 *
 * The Phase 1 report describes risk management as a constraint layer that sits
 * between the trading agent and execution: proposed trades are modified or
 * blocked when they would breach limits. `evaluateOrder` implements exactly that
 * contract and is unit tested.
 */

import type { Holding, RiskLevel, Trade } from './types';
import { computeFee, concentration, findHolding, valuePortfolio } from './portfolio';

export interface RiskSettings {
  /** Starting paper capital in INR. */
  initialCapital: number;
  /** Transaction cost in basis points of traded notional. */
  costBps: number;
  /** Per-position stop loss as a fraction, e.g. 0.05 = -5%. */
  stopLossPct: number;
  /** Maximum fraction of portfolio value in any single position. */
  maxPositionPct: number;
  /** Maximum fraction of portfolio value in any single sector. */
  maxSectorPct: number;
  /** Drawdown from the high-water mark at which new buys are halted. */
  drawdownHaltPct: number;
}

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  initialCapital: 100_000,
  costBps: 10,
  stopLossPct: 0.05,
  maxPositionPct: 0.1,
  maxSectorPct: 0.2,
  drawdownHaltPct: 0.15,
};

export interface Account {
  cash: number;
  holdings: Holding[];
}

export type OrderVerdict = {
  allowed: boolean;
  /** Quantity that may actually be executed after constraints are applied. */
  qty: number;
  /** Machine-readable reasons for a block or a trimmed quantity. */
  notes: { code: string; message: string; severity: 'block' | 'trim' | 'warn' }[];
};

export interface EvaluateOrderInput {
  side: 'buy' | 'sell';
  symbol: string;
  sector: string;
  /** symbol -> sector for every symbol in the universe (used for concentration limits). */
  sectors: Record<string, string>;
  /** Requested quantity; must be a positive integer. */
  qty: number;
  price: number;
  account: Account;
  prices: Record<string, number>;
  settings: RiskSettings;
  /** Current drawdown fraction from the high-water mark (0.10 = -10%). */
  currentDrawdown: number;
}

const LOT = 1;

function invalid(message: string, code: string): OrderVerdict {
  return { allowed: false, qty: 0, notes: [{ code, message, severity: 'block' }] };
}

/**
 * Evaluate an order against every risk constraint.
 * Buys may be trimmed (affordability, position cap, sector cap) rather than
 * rejected outright; sells that would close or reduce a position are allowed.
 */
export function evaluateOrder(input: EvaluateOrderInput): OrderVerdict {
  const { side, symbol, sector, qty, price, account, settings, currentDrawdown } = input;
  const notes: OrderVerdict['notes'] = [];

  if (!Number.isInteger(qty) || qty <= 0) return invalid('Quantity must be a positive whole number.', 'BAD_QTY');
  if (!Number.isFinite(price) || price <= 0) return invalid('Price must be a positive number.', 'BAD_PRICE');
  if (!Number.isFinite(settings.costBps) || settings.costBps < 0)
    return invalid('Transaction cost must be zero or positive.', 'BAD_COST');

  const { total } = valuePortfolio(account, input.prices);

  if (side === 'sell') {
    const holding = findHolding(account.holdings, symbol);
    if (!holding || holding.qty <= 0)
      return invalid(`No ${symbol} position is held, so it cannot be sold.`, 'NO_POSITION');
    if (qty > holding.qty) {
      notes.push({
        code: 'TRIM_TO_POSITION',
        message: `Sell trimmed from ${qty} to ${holding.qty} shares (position size).`,
        severity: 'trim',
      });
      return { allowed: true, qty: holding.qty, notes };
    }
    return { allowed: true, qty, notes };
  }

  // Buys.
  if (currentDrawdown >= settings.drawdownHaltPct) {
    return invalid(
      `Drawdown limit reached (-${(currentDrawdown * 100).toFixed(1)}% vs -${(settings.drawdownHaltPct * 100).toFixed(0)}% halt). New buys are suspended.`,
      'DRAWDOWN_HALT',
    );
  }

  let allowedQty = Math.floor(qty / LOT) * LOT;
  if (allowedQty <= 0) return invalid('Quantity is below the minimum lot size.', 'BAD_QTY');

  const fee = (n: number) => computeFee('buy', n, price, settings.costBps).fee;
  const existing = findHolding(account.holdings, symbol);
  const existingValue = existing ? existing.qty * price : 0;
  const sectorValue = sectorValueOf(account, input.prices, input.sector, input.sectors);

  // 1. Affordability (cash must cover notional + fee).
  let notional = allowedQty * price + fee(allowedQty);
  if (notional > account.cash) {
    let affordable = Math.floor(account.cash / (price * (1 + settings.costBps / 10_000)));
    while (affordable > 0 && affordable * price + fee(affordable) > account.cash) affordable--;
    if (affordable <= 0)
      return invalid('Insufficient cash for even one share including fees.', 'NO_CASH');
    notes.push({
      code: 'TRIM_TO_CASH',
      message: `Quantity trimmed to ${affordable} shares to stay within available cash.`,
      severity: 'trim',
    });
    allowedQty = affordable;
    notional = allowedQty * price + fee(allowedQty);
  }

  // 2. Single position cap.
  const headroomValue = Math.max(0, settings.maxPositionPct * total - existingValue);
  const maxQtyByPosition = Math.floor(headroomValue / (price * (1 + settings.costBps / 10_000)));
  if (maxQtyByPosition < allowedQty) {
    if (maxQtyByPosition <= 0)
      return invalid(
        `${symbol} already at the ${(settings.maxPositionPct * 100).toFixed(0)}% single-position limit.`,
        'POSITION_LIMIT',
      );
    notes.push({
      code: 'TRIM_TO_POSITION_LIMIT',
      message: `Quantity trimmed to ${maxQtyByPosition} shares to respect the ${(settings.maxPositionPct * 100).toFixed(0)}% position limit.`,
      severity: 'trim',
    });
    allowedQty = maxQtyByPosition;
  }

  // 3. Sector concentration cap.
  const sectorHeadroom = Math.max(0, settings.maxSectorPct * total - sectorValue);
  const maxQtyBySector = Math.floor(sectorHeadroom / (price * (1 + settings.costBps / 10_000)));
  if (maxQtyBySector < allowedQty) {
    if (maxQtyBySector <= 0)
      return invalid(
        `${sector} already at the ${(settings.maxSectorPct * 100).toFixed(0)}% sector limit.`,
        'SECTOR_LIMIT',
      );
    notes.push({
      code: 'TRIM_TO_SECTOR_LIMIT',
      message: `Quantity trimmed to ${maxQtyBySector} shares to respect the ${(settings.maxSectorPct * 100).toFixed(0)}% sector limit.`,
      severity: 'trim',
    });
    allowedQty = maxQtyBySector;
  }

  if (allowedQty <= 0) return invalid('No quantity can be executed under the current risk limits.', 'NO_QTY');
  return { allowed: true, qty: allowedQty, notes };
}

function sectorValueOf(
  account: Account,
  prices: Record<string, number>,
  sector: string,
  sectors: Record<string, string>,
): number {
  let acc = 0;
  for (const h of account.holdings) {
    if ((sectors[h.symbol] ?? 'Other') !== sector) continue;
    const price = prices[h.symbol];
    acc += h.qty * (Number.isFinite(price) && price > 0 ? price : h.avgCost);
  }
  return acc;
}

export interface PositionSizeInput {
  equity: number;
  price: number;
  /** Annualised volatility of the asset (0.14 = 14%). */
  annualVolatility: number;
  /** Fraction of equity risked per trade through the stop loss. */
  riskPerTrade: number;
  stopLossPct: number;
}

/** Volatility-adjusted position size: risk budget divided by stop distance. */
export function positionSizeByStop(input: PositionSizeInput): number {
  const { equity, price, riskPerTrade, stopLossPct } = input;
  if (price <= 0 || equity <= 0 || stopLossPct <= 0) return 0;
  const riskAmount = equity * Math.max(0, riskPerTrade);
  const perShareRisk = price * stopLossPct;
  return Math.max(0, Math.floor(riskAmount / perShareRisk));
}

/** Risk-targeted position size: equity scaled by target volatility / realised volatility. */
export function positionSizeByVolatility(input: {
  equity: number;
  price: number;
  annualVolatility: number;
  targetVolatility: number;
}): number {
  const { equity, price, annualVolatility, targetVolatility } = input;
  if (price <= 0 || equity <= 0 || annualVolatility <= 0) return 0;
  const fraction = Math.min(1, targetVolatility / annualVolatility);
  return Math.max(0, Math.floor((equity * fraction) / price));
}

export type ItemStatus = 'ok' | 'warn' | 'breach';

export interface RiskItem {
  key: string;
  label: string;
  detail: string;
  status: ItemStatus;
}

export interface RiskAssessment {
  level: RiskLevel;
  /** 0..1 composite severity used for the meter and level badge. */
  score: number;
  items: RiskItem[];
  drawdown: number;
  peakValue: number;
}

export interface RiskAssessmentInput {
  equityCurve: readonly number[];
  account: Account;
  prices: Record<string, number>;
  sectors: Record<string, string>;
  settings: RiskSettings;
  sharpe: number | null;
  sortino: number | null;
  volatilityAnnual: number | null;
}

/** Combine limit utilisation and portfolio statistics into one risk view. */
export function assessRisk(input: RiskAssessmentInput): RiskAssessment {
  const { account, prices, settings } = input;
  const { total } = valuePortfolio(account, prices);
  const drawdown = drawdownFromCurve(input.equityCurve);
  const items: RiskItem[] = [];

  const weights = account.holdings.map((h) => {
    const value = h.qty * (prices[h.symbol] ?? h.avgCost);
    return total > 0 ? value / total : 0;
  });
  const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
  items.push({
    key: 'position',
    label: 'Position limit',
    detail: `Largest position is ${(maxWeight * 100).toFixed(1)}% of the portfolio (limit ${(settings.maxPositionPct * 100).toFixed(0)}%).`,
    status: maxWeight >= settings.maxPositionPct ? 'breach' : maxWeight > settings.maxPositionPct * 0.85 ? 'warn' : 'ok',
  });

  const sectorWeights = new Map<string, number>();
  for (const h of account.holdings) {
    const sector = input.sectors[h.symbol] ?? 'Other';
    const value = h.qty * (prices[h.symbol] ?? h.avgCost);
    sectorWeights.set(sector, (sectorWeights.get(sector) ?? 0) + (total > 0 ? value / total : 0));
  }
  const maxSector = sectorWeights.size > 0 ? Math.max(...sectorWeights.values()) : 0;
  items.push({
    key: 'sector',
    label: 'Sector concentration',
    detail: `Largest sector is ${(maxSector * 100).toFixed(1)}% of the portfolio (limit ${(settings.maxSectorPct * 100).toFixed(0)}%).`,
    status: maxSector >= settings.maxSectorPct ? 'breach' : maxSector > settings.maxSectorPct * 0.85 ? 'warn' : 'ok',
  });

  const hhi = concentration(weights);
  items.push({
    key: 'diversification',
    label: 'Diversification',
    detail:
      account.holdings.length === 0
        ? 'No open positions — the portfolio is entirely cash.'
        : `Herfindahl index ${hhi.toFixed(2)} across ${account.holdings.length} position${account.holdings.length === 1 ? '' : 's'}; lower is more diversified.`,
    status: hhi > 0.5 ? 'warn' : 'ok',
  });

  items.push({
    key: 'drawdown',
    label: 'Drawdown control',
    detail:
      drawdown >= settings.drawdownHaltPct
        ? `Drawdown of -${(drawdown * 100).toFixed(1)}% has halted new buys (limit -${(settings.drawdownHaltPct * 100).toFixed(0)}%).`
        : `Drawdown -${(drawdown * 100).toFixed(1)}% against a -${(settings.drawdownHaltPct * 100).toFixed(0)}% halt.`,
    status: drawdown >= settings.drawdownHaltPct ? 'breach' : drawdown >= settings.drawdownHaltPct * 0.6 ? 'warn' : 'ok',
  });

  const stops = stoppedPositions(account, prices, settings.stopLossPct);
  items.push({
    key: 'stoploss',
    label: 'Stop loss',
    detail:
      stops.length === 0
        ? `No position is below its -${(settings.stopLossPct * 100).toFixed(0)}% stop level.`
        : `${stops.join(', ')} below the -${(settings.stopLossPct * 100).toFixed(0)}% stop level.`,
    status: stops.length > 0 ? 'warn' : 'ok',
  });

  items.push({
    key: 'sharpe',
    label: 'Risk-adjusted return',
    detail:
      input.sharpe === null
        ? 'Not enough history to compute a Sharpe ratio yet.'
        : `Sharpe ${input.sharpe.toFixed(2)}, Sortino ${input.sortino === null ? '—' : input.sortino.toFixed(2)}, volatility ${input.volatilityAnnual === null ? '—' : `${(input.volatilityAnnual * 100).toFixed(1)}%`} annualised.`,
    status: input.sharpe === null ? 'warn' : input.sharpe < 0 ? 'warn' : 'ok',
  });

  const breaches = items.filter((i) => i.status === 'breach').length;
  const warns = items.filter((i) => i.status === 'warn').length;
  const level: RiskLevel = breaches > 0 ? 'high' : warns >= 2 ? 'medium' : 'low';
  const score = Math.min(1, drawdown / Math.max(1e-9, settings.drawdownHaltPct) * 0.5 + breaches * 0.2 + warns * 0.1);

  return { level, score, items, drawdown, peakValue: peakOf(input.equityCurve) };
}

function peakOf(curve: readonly number[]): number {
  let peak = 0;
  for (const v of curve) if (v > peak) peak = v;
  return peak;
}

export function drawdownFromCurve(curve: readonly number[]): number {
  if (curve.length === 0) return 0;
  let peak = curve[0];
  let worst = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    else if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
  }
  return worst;
}

/** Symbols whose mark is at or beyond the stop-loss threshold. */
export function stoppedPositions(
  account: Pick<Account, 'holdings'>,
  prices: Record<string, number>,
  stopLossPct: number,
): string[] {
  const out: string[] = [];
  for (const h of account.holdings) {
    const price = prices[h.symbol];
    if (!price || h.avgCost <= 0) continue;
    const change = (price - h.avgCost) / h.avgCost;
    if (change <= -Math.abs(stopLossPct)) out.push(h.symbol);
  }
  return out;
}

/** True when an existing holding is below its stop level. */
export function isStopped(holding: Holding | undefined, price: number, stopLossPct: number): boolean {
  if (!holding || holding.avgCost <= 0 || !Number.isFinite(price)) return false;
  return (price - holding.avgCost) / holding.avgCost <= -Math.abs(stopLossPct);
}

/** Trailing stop check used by the paper-trading engine. */
export function shouldTriggerStop(entryPrice: number, price: number, stopLossPct: number): boolean {
  if (entryPrice <= 0) return false;
  return (price - entryPrice) / entryPrice <= -Math.abs(stopLossPct);
}

export function tradeFee(side: 'buy' | 'sell', qty: number, price: number, costBps: number): number {
  return computeFee(side, qty, price, costBps).fee;
}

export function lastTrade(trades: readonly Trade[]): Trade | null {
  return trades.length > 0 ? trades[trades.length - 1] : null;
}
