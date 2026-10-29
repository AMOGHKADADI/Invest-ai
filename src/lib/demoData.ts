/**
 * Deterministic demo market data.
 *
 * The application ships with a synthetic, seeded price history so that every
 * screen, model and backtest produces the same numbers for every user without
 * any API key. Synthetic series are always labelled "Demo data" in the UI and
 * are never presented as live or historical market quotes.
 */

import type { Asset, Bar, DataSource } from './types';

export const DEMO_SOURCE: DataSource = {
  id: 'demo-v1',
  kind: 'demo',
  label: 'Demo data',
  note: 'Deterministic synthetic daily OHLCV (seed 20260101). Not live market data.',
};

export const BENCHMARK_SYMBOL = 'NIFTY50';

export const UNIVERSE: Asset[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', exchange: 'NSE' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'Information Technology', exchange: 'NSE' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Financials', exchange: 'NSE' },
  { symbol: 'INFY', name: 'Infosys', sector: 'Information Technology', exchange: 'NSE' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Financials', exchange: 'NSE' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Financials', exchange: 'NSE' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Automobiles', exchange: 'NSE' },
  { symbol: 'ITC', name: 'ITC Limited', sector: 'Consumer Goods', exchange: 'NSE' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', exchange: 'NSE' },
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Industrials', exchange: 'NSE' },
];

export const BENCHMARK_ASSET: Asset = {
  symbol: BENCHMARK_SYMBOL,
  name: 'NIFTY 50 (demo basket)',
  sector: 'Index',
  exchange: 'NSE',
};

/** Mulberry32 — small, fast, fully deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller transform driven by a supplied uniform generator. */
function gauss(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface DemoMarket {
  /** Ordered UTC trading days (weekdays) shared by every series. */
  dates: number[];
  bars: Record<string, Bar[]>;
  benchmark: Bar[];
  source: DataSource;
  /** Human-readable statement attached to every derived figure. */
  disclaimer: string;
}

const DEMO_SEED = 20260101;
const SESSIONS = 756; // ~3 years of weekday sessions

const START_PRICES: Record<string, number> = {
  RELIANCE: 2380,
  TCS: 3520,
  HDFCBANK: 1490,
  INFY: 1345,
  ICICIBANK: 1045,
  SBIN: 610,
  TATAMOTORS: 640,
  ITC: 335,
  BHARTIARTL: 1120,
  LT: 2240,
  NIFTY50: 21850,
};

interface Regime {
  drift: number;
  vol: number;
}

/** Slowly alternating regimes so trends, pullbacks and a crash-like stretch exist. */
function regimeAt(step: number, seed: number): Regime {
  const phase = Math.sin((step + seed % 60) / 61) * 0.5 + Math.sin((step + seed % 173) / 149) * 0.5;
  const stress = Math.exp(-Math.pow((step - 470) / 34, 2)); // a 2020-style drawdown window
  const drift = 0.00042 * phase - 0.0038 * stress;
  const vol = 0.0105 + 0.006 * Math.abs(phase) + 0.021 * stress;
  return { drift, vol };
}

function generateSeries(symbol: string, dates: number[], baseSeed: number): Bar[] {
  const rand = mulberry32(baseSeed ^ hashString(symbol));
  let price = START_PRICES[symbol] ?? 500;
  const baseVolume = 800_000 + Math.floor(rand() * 4_200_000);
  const bars: Bar[] = [];
  for (let i = 0; i < dates.length; i++) {
    const { drift, vol } = regimeAt(i, hashString(symbol) % 365);
    const shock = gauss(rand) * vol;
    const gap = (rand() - 0.5) * vol * 0.4;
    const next = Math.max(1, price * Math.exp(drift + shock - vol * vol * 0.5) * (1 + gap));
    const o = price * (1 + gap * 0.35);
    const c = next;
    const range = Math.abs(c - o) + price * vol * (0.35 + rand() * 0.5);
    const h = Math.max(o, c) + range * rand() * 0.6;
    const l = Math.min(o, c) - range * rand() * 0.6;
    const volume = Math.round(baseVolume * (0.55 + rand() * 1.2) * (1 + Math.abs(shock) * 6));
    bars.push({
      t: dates[i],
      o: round2(o),
      h: round2(Math.max(h, o, c)),
      l: round2(Math.max(1, Math.min(l, o, c))),
      c: round2(c),
      v: volume,
    });
    price = c;
  }
  return bars;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Weekday sessions ending today, oldest first. */
export function buildSessionDates(count: number, end = new Date()): number[] {
  const dates: number[] = [];
  const cursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.getTime());
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

let cached: DemoMarket | null = null;

/** Lazily build (and memoise) the demo market so first paint stays fast. */
export function getDemoMarket(): DemoMarket {
  if (cached) return cached;
  const dates = buildSessionDates(SESSIONS);
  const bars: Record<string, Bar[]> = {};
  for (const asset of UNIVERSE) bars[asset.symbol] = generateSeries(asset.symbol, dates, DEMO_SEED);
  bars[BENCHMARK_SYMBOL] = generateSeries(BENCHMARK_SYMBOL, dates, DEMO_SEED);
  cached = {
    dates,
    bars,
    benchmark: bars[BENCHMARK_SYMBOL],
    source: DEMO_SOURCE,
    disclaimer:
      'Demo data: deterministic synthetic prices generated in your browser from a fixed seed. ' +
      'They are not real quotes and must not be used for real trading decisions.',
  };
  return cached;
}

export function getAsset(symbol: string): Asset | null {
  if (symbol === BENCHMARK_SYMBOL) return BENCHMARK_ASSET;
  return UNIVERSE.find((a) => a.symbol === symbol) ?? null;
}

/** Last close of a bar series, or null for an empty series. */
export function lastClose(bars: readonly Bar[]): number | null {
  if (bars.length === 0) return null;
  return bars[bars.length - 1].c;
}
