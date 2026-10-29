/**
 * Shared domain types for InvestAI.
 *
 * Terminology follows the Phase 1 project report:
 * "AI-Driven Autonomous Investment and Risk Management Using Reinforcement Learning".
 */

/** One daily OHLCV candle. `t` is a UTC day timestamp (ms since epoch). */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Where a price series came from. Every figure in the UI is tagged with one of these. */
export type DataSourceKind = 'demo' | 'imported' | 'model';

export interface DataSource {
  id: string;
  kind: DataSourceKind;
  label: string;
  /** Human readable provenance note shown next to figures. */
  note: string;
}

export interface Asset {
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
}

export interface Series {
  asset: Asset;
  bars: Bar[];
  source: DataSource;
}

export type SignalSide = 'buy' | 'sell' | 'hold';

export interface SignalFactor {
  name: string;
  value: number | string;
  /** Contribution in [-1, 1]: positive supports a buy, negative supports a sell. */
  contribution: number;
}

export interface SignalReason {
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
}

export interface Signal {
  symbol: string;
  side: SignalSide;
  /** Heuristic strength in [0, 1]. Not a calibrated probability. */
  confidence: number;
  at: number;
  price: number;
  reasons: SignalReason[];
  factors: SignalFactor[];
  /** Normalised score in [-1, 1] that the thresholding is applied to. */
  score: number;
}

export type Holding = {
  symbol: string;
  qty: number;
  avgCost: number;
};

export type TradeSide = 'buy' | 'sell';

export interface Trade {
  id: string;
  symbol: string;
  side: TradeSide;
  qty: number;
  price: number;
  fee: number;
  at: number;
  /** Plain-language justification, e.g. "AI signal: BUY (conf 0.72)". */
  reason: string;
  /** Always 'paper' — this project never places real orders. */
  mode: 'paper';
}

export interface Portfolio {
  cash: number;
  holdings: Holding[];
  trades: Trade[];
}

export type RiskLevel = 'low' | 'medium' | 'high';
