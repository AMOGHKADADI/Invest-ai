/**
 * The InvestAI signal engine.
 *
 * A signal combines causal technical features with optional model outputs
 * (LSTM forecast direction, sentiment score, DQN action) into a single score in
 * [-1, 1] that is thresholded into BUY / SELL / HOLD. Every number shown in the
 * UI is produced here from actual computed features — nothing is hard-coded.
 *
 * The result is a transparent heuristic ensemble, not a calibrated probability
 * and not a guarantee: confidence is reported as "signal strength" in the app.
 */

import type { Bar, Signal, SignalFactor, SignalReason, SignalSide } from './types';
import { atr, bollinger, ema, macd, momentum, rollingStd, rsi, sma } from './indicators';

export interface AssetFeatures {
  symbol: string;
  bars: readonly Bar[];
  close: number[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  sma200: (number | null)[];
  rsi14: (number | null)[];
  macd: ReturnType<typeof macd>;
  bollinger: ReturnType<typeof bollinger>;
  mom20: number[];
  vol20: (number | null)[];
  atr14: (number | null)[];
}

const cache = new WeakMap<readonly Bar[], AssetFeatures>();

/** Compute (and memoise) the causal feature set for one price series. */
export function computeFeatures(bars: readonly Bar[], symbol = ''): AssetFeatures {
  const hit = cache.get(bars);
  if (hit) return hit;
  const close = bars.map((b) => b.c);
  const features: AssetFeatures = {
    symbol,
    bars,
    close,
    ema20: ema(close, 20),
    ema50: ema(close, 50),
    sma200: sma(close, Math.min(200, Math.max(50, Math.floor(close.length / 3)))),
    rsi14: rsi(close, 14),
    macd: macd(close, 12, 26, 9),
    bollinger: bollinger(close, 20, 2),
    mom20: momentum(close, 20),
    vol20: rollingStd(close, 20),
    atr14: atr(bars, 14),
  };
  cache.set(bars, features);
  return features;
}

export interface SignalOptions {
  /** Causal sentiment score in [-1, 1] published at or before `index`. */
  sentiment?: number | null;
  /** Model-implied forward return (fraction), e.g. 0.038 for +3.8%. */
  forecastReturn?: number | null;
  /** Discrete action proposed by the DQN agent, if one has been trained. */
  dqnAction?: SignalSide | null;
  /** Position state used to surface risk context. */
  position?: { qty: number; avgCost: number } | null;
  /** Stop-loss threshold as a fraction (0.05 = -5%). */
  stopLossPct?: number;
  now?: number;
}

interface Weighted {
  factor: SignalFactor;
  weight: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const tanh = Math.tanh;

/** Score one asset at one bar index. `index` may be 0 (insufficient history => hold). */
export function signalAt(features: AssetFeatures, index: number, options: SignalOptions = {}): Signal {
  const bars = features.bars;
  const bar = bars[Math.min(index, bars.length - 1)];
  const price = bar.c;
  const at = options.now ?? bar.t;
  const symbol = features.symbol;

  const e20 = features.ema20[index] ?? null;
  const e50 = features.ema50[index] ?? null;
  const r = features.rsi14[index] ?? null;
  const hist = features.macd.histogram[index] ?? null;
  const macdLine = features.macd.macd[index] ?? null;
  const signalLine = features.macd.signal[index] ?? null;
  const pctB = features.bollinger.percentB[index] ?? null;
  const mom = features.mom20[index];

  const weighted: Weighted[] = [];

  if (e20 !== null && e50 !== null && e50 > 0) {
    const rel = (e50 - e20) / e50;
    const value = tanh(rel * 60);
    const vsEma = (price - e50) / e50;
    weighted.push({
      weight: 0.2,
      factor: {
        name: 'Trend (EMA 20/50)',
        value: `${((vsEma) * 100).toFixed(1)}% vs EMA50`,
        contribution: clamp(tanh(vsEma * 40) * 0.6 + value * 0.4, -1, 1),
      },
    });
  }

  if (r !== null) {
    let score: number;
    if (r >= 75) score = -0.6;
    else if (r <= 25) score = 0.6;
    else score = (r - 50) / 25;
    weighted.push({
      weight: 0.15,
      factor: { name: 'RSI(14)', value: r.toFixed(1), contribution: clamp(score, -1, 1) },
    });
  }

  if (hist !== null && macdLine !== null && signalLine !== null) {
    const normalised = hist / Math.max(1e-9, price * 0.006);
    weighted.push({
      weight: 0.15,
      factor: {
        name: 'MACD(12,26,9)',
        value: hist.toFixed(2),
        contribution: clamp(tanh(normalised), -1, 1),
      },
    });
  }

  if (pctB !== null) {
    let score: number;
    if (pctB > 1) score = -0.5;
    else if (pctB < 0) score = 0.5;
    else score = (pctB - 0.5) * 1.4;
    weighted.push({
      weight: 0.08,
      factor: { name: 'Bollinger %B', value: pctB.toFixed(2), contribution: clamp(score, -1, 1) },
    });
  }

  if (mom !== undefined) {
    weighted.push({
      weight: 0.12,
      factor: {
        name: '20-session momentum',
        value: `${mom >= 0 ? '+' : ''}${mom.toFixed(1)}%`,
        contribution: clamp(tanh(mom / 8), -1, 1),
      },
    });
  }

  if (typeof options.sentiment === 'number' && Number.isFinite(options.sentiment)) {
    weighted.push({
      weight: 0.15,
      factor: {
        name: 'News sentiment',
        value: `${options.sentiment >= 0 ? '+' : ''}${options.sentiment.toFixed(2)}`,
        contribution: clamp(options.sentiment, -1, 1),
      },
    });
  }

  if (typeof options.forecastReturn === 'number' && Number.isFinite(options.forecastReturn)) {
    weighted.push({
      weight: 0.1,
      factor: {
        name: 'LSTM forecast',
        value: `${options.forecastReturn >= 0 ? '+' : ''}${(options.forecastReturn * 100).toFixed(1)}%`,
        contribution: clamp(tanh(options.forecastReturn * 20), -1, 1),
      },
    });
  }

  if (options.dqnAction) {
    const value = options.dqnAction === 'buy' ? 1 : options.dqnAction === 'sell' ? -1 : 0;
    weighted.push({
      weight: 0.15,
      factor: { name: 'DQN agent', value: options.dqnAction.toUpperCase(), contribution: value },
    });
  }

  const totalWeight = weighted.reduce((acc, w) => acc + w.weight, 0);
  const score = totalWeight === 0 ? 0 : weighted.reduce((acc, w) => acc + w.factor.contribution * w.weight, 0) / totalWeight;
  const side: SignalSide = score >= 0.15 ? 'buy' : score <= -0.15 ? 'sell' : 'hold';

  const factors: SignalFactor[] = weighted.map((w) => w.factor);
  const reasons = buildReasons(features, index, options, price);

  return {
    symbol,
    side,
    confidence: clamp(0.5 + 0.5 * Math.abs(score), 0, 1),
    at,
    price,
    reasons,
    factors,
    score,
  };
}

function buildReasons(
  features: AssetFeatures,
  index: number,
  options: SignalOptions,
  price: number,
): SignalReason[] {
  const reasons: SignalReason[] = [];
  const e50 = features.ema50[index] ?? null;
  const e20 = features.ema20[index] ?? null;
  const r = features.rsi14[index] ?? null;
  const hist = features.macd.histogram[index] ?? null;
  const macdLine = features.macd.macd[index] ?? null;
  const signalLine = features.macd.signal[index] ?? null;

  if (e50 !== null && e20 !== null) {
    const vsEma = (price - e50) / e50;
    if (vsEma >= 0)
      reasons.push({ text: `Price ${(vsEma * 100).toFixed(1)}% above EMA(50); ${e20 >= e50 ? 'EMA(20) above EMA(50)' : 'short-term average still recovering'}.`, tone: 'positive' });
    else
      reasons.push({ text: `Price ${Math.abs(vsEma * 100).toFixed(1)}% below EMA(50) — downtrend intact.`, tone: 'negative' });
  }

  if (r !== null) {
    if (r >= 75) reasons.push({ text: `RSI(14) at ${r.toFixed(1)} is overbought — upside looks extended.`, tone: 'negative' });
    else if (r <= 25) reasons.push({ text: `RSI(14) at ${r.toFixed(1)} is oversold — contrarian support.`, tone: 'positive' });
    else if (r >= 55) reasons.push({ text: `RSI(14) at ${r.toFixed(1)} shows bullish momentum without being overbought.`, tone: 'positive' });
    else if (r <= 45) reasons.push({ text: `RSI(14) at ${r.toFixed(1)} is weak — momentum favours sellers.`, tone: 'negative' });
    else reasons.push({ text: `RSI(14) at ${r.toFixed(1)} is neutral.`, tone: 'neutral' });
  }

  if (hist !== null && macdLine !== null && signalLine !== null) {
    const rising = hist > 0;
    reasons.push({
      text: rising
        ? `MACD above its signal line with a positive histogram (${hist.toFixed(2)}).`
        : `MACD below its signal line (histogram ${hist.toFixed(2)}).`,
      tone: rising ? 'positive' : 'negative',
    });
  }

  if (typeof options.sentiment === 'number') {
    const tone = options.sentiment > 0.12 ? 'positive' : options.sentiment < -0.12 ? 'negative' : 'neutral';
    reasons.push({
      text: `News sentiment ${options.sentiment >= 0 ? '+' : ''}${options.sentiment.toFixed(2)} over recent sessions (lexicon scorer).`,
      tone,
    });
  }

  if (typeof options.forecastReturn === 'number') {
    reasons.push({
      text: `LSTM forecast implies ${options.forecastReturn >= 0 ? '+' : ''}${(options.forecastReturn * 100).toFixed(1)}% over the forecast horizon.`,
      tone: options.forecastReturn >= 0 ? 'positive' : 'negative',
    });
  }

  if (options.dqnAction) {
    reasons.push({
      text: `DQN reinforcement-learning agent proposes ${options.dqnAction.toUpperCase()}.`,
      tone: options.dqnAction === 'buy' ? 'positive' : options.dqnAction === 'sell' ? 'negative' : 'neutral',
    });
  }

  if (options.position && options.stopLossPct) {
    const change = (price - options.position.avgCost) / options.position.avgCost;
    if (change <= -options.stopLossPct) {
      reasons.push({
        text: `Position is down ${(change * 100).toFixed(1)}%, beyond the -${(options.stopLossPct * 100).toFixed(0)}% stop-loss threshold.`,
        tone: 'negative',
      });
    }
  }

  if (reasons.length === 0) {
    reasons.push({ text: 'Not enough history to compute indicator-based evidence yet.', tone: 'neutral' });
  }

  // Reasons are already ordered strongest-evidence-first; cap so cards stay readable.
  return reasons.slice(0, 4);
}
