/**
 * Causal technical indicators.
 *
 * Every function returns an array aligned with the input. Positions that do not
 * yet have enough history are `null` (the warm-up period). Indicators only ever
 * read the current and past observations, which is what allows the backtester to
 * claim freedom from look-ahead bias.
 */

export type NullableSeries = (number | null)[];

function assertPeriod(period: number, name: string): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`${name} period must be a positive integer, received ${period}`);
  }
}

function assertLength(values: readonly number[], name: string): void {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) {
    throw new TypeError(`${name} expects an array of numbers`);
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new RangeError(`${name} received a non-finite value at index ${i}`);
    }
  }
}

/** Simple moving average. */
export function sma(values: readonly number[], period: number): NullableSeries {
  assertPeriod(period, 'sma');
  assertLength(values, 'sma');
  const out: NullableSeries = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(values: readonly number[], period: number): NullableSeries {
  assertPeriod(period, 'ema');
  assertLength(values, 'ema');
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

/** Population standard deviation over a rolling window. */
export function rollingStd(values: readonly number[], period: number): NullableSeries {
  assertPeriod(period, 'rollingStd');
  assertLength(values, 'rollingStd');
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length < period) return out;
  for (let i = period - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += values[j];
    mean /= period;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

/** Rolling z-score of a value against its own trailing window. */
export function rollingZ(values: readonly number[], period: number): NullableSeries {
  const mean = sma(values, period);
  const sd = rollingStd(values, period);
  return values.map((v, i) => {
    const m = mean[i];
    const s = sd[i];
    if (m === null || s === null || s === 0) return null;
    return (v - m) / s;
  });
}

/**
 * Relative Strength Index (Wilder smoothing).
 */
export function rsi(values: readonly number[], period = 14): NullableSeries {
  assertPeriod(period, 'rsi');
  assertLength(values, 'rsi');
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = toRsi(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const g = change > 0 ? change : 0;
    const l = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: NullableSeries;
  signal: NullableSeries;
  histogram: NullableSeries;
}

/** MACD line, signal line and histogram (12/26/9 by convention). */
export function macd(
  values: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  assertLength(values, 'macd');
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const macdLine: NullableSeries = values.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f === null || s === null ? null : f - s;
  });

  // The signal EMA starts at the first index where the MACD line exists.
  const signal: NullableSeries = new Array(values.length).fill(null);
  const firstIdx = macdLine.findIndex((v) => v !== null);
  if (firstIdx !== -1) {
    const valid: number[] = [];
    for (let i = firstIdx; i < values.length; i++) {
      const v = macdLine[i];
      if (v !== null) valid.push(v);
    }
    const sig = ema(valid, signalPeriod);
    for (let k = 0; k < sig.length; k++) {
      const value = sig[k];
      if (value !== null) signal[firstIdx + k] = value;
    }
  }

  const histogram: NullableSeries = values.map((_, i) => {
    const m = macdLine[i];
    const s = signal[i];
    return m === null || s === null ? null : m - s;
  });

  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: NullableSeries;
  middle: NullableSeries;
  lower: NullableSeries;
  /** %B — where the close sits inside the bands (0 = lower band, 1 = upper band). */
  percentB: NullableSeries;
  bandwidth: NullableSeries;
}

/** Bollinger Bands with a 20-period, 2-sigma configuration. */
export function bollinger(values: readonly number[], period = 20, mult = 2): BollingerResult {
  assertPeriod(period, 'bollinger');
  const middle = sma(values, period);
  const sd = rollingStd(values, period);
  const upper: NullableSeries = [];
  const lower: NullableSeries = [];
  const percentB: NullableSeries = [];
  const bandwidth: NullableSeries = [];
  for (let i = 0; i < values.length; i++) {
    const m = middle[i];
    const s = sd[i];
    if (m === null || s === null) {
      upper.push(null);
      lower.push(null);
      percentB.push(null);
      bandwidth.push(null);
      continue;
    }
    const u = m + mult * s;
    const l = m - mult * s;
    upper.push(u);
    lower.push(l);
    percentB.push(u === l ? 0.5 : (values[i] - l) / (u - l));
    bandwidth.push(m === 0 ? 0 : (u - l) / m);
  }
  return { upper, middle, lower, percentB, bandwidth };
}

/** Average True Range (Wilder smoothing). */
export function atr(bars: readonly { h: number; l: number; c: number }[], period = 14): NullableSeries {
  assertPeriod(period, 'atr');
  const out: NullableSeries = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) tr.push(bars[i].h - bars[i].l);
    else {
      const prevClose = bars[i - 1].c;
      tr.push(
        Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - prevClose), Math.abs(bars[i].l - prevClose)),
      );
    }
  }
  let acc = 0;
  for (let i = 1; i <= period; i++) acc += tr[i];
  out[period] = acc / period;
  for (let i = period + 1; i < bars.length; i++) {
    out[i] = (out[i - 1]! * (period - 1) + tr[i]) / period;
  }
  return out;
}

/** Simple period-over-period percentage change; index 0 is `null`. */
export function pctChange(values: readonly number[]): NullableSeries {
  assertLength(values, 'pctChange');
  const out: NullableSeries = new Array(values.length).fill(null);
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    out[i] = prev === 0 ? null : (values[i] - prev) / prev;
  }
  return out;
}

/** Percentage change over a fixed lookback, in percent (not fraction). */
export function momentum(values: readonly number[], lookback = 20): number[] {
  assertPeriod(lookback, 'momentum');
  return values.map((v, i) => {
    if (i < lookback) return 0;
    const base = values[i - lookback];
    return base === 0 ? 0 : ((v - base) / base) * 100;
  });
}

/** Number of consecutive up (or down) sessions at each index; 0 when flat. */
export function streak(values: readonly number[]): number[] {
  const out = values.map(() => 0);
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) out[i] = out[i - 1] >= 0 ? out[i - 1] + 1 : 1;
    else if (change < 0) out[i] = out[i - 1] <= 0 ? out[i - 1] - 1 : -1;
    else out[i] = 0;
  }
  return out;
}
