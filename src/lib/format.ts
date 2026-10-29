/** Formatting helpers for financial figures, dates and percentages. */

const INR = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
});
const INR_DECIMAL = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Indian-grouped rupee amount without a symbol: 124350 -> "1,24,350". */
export function inr(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const formatted =
    decimals > 0 ? INR_DECIMAL.format(abs) : INR.format(decimals === 0 ? Math.round(abs) : abs);
  return `${value < 0 ? '-' : ''}₹${formatted}`;
}

export function inrSigned(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : '-'}${inr(Math.abs(value))}`;
}

/** Plain grouped number (no currency symbol). */
export function grouped(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Percentage from a fraction: 0.125 -> "+12.5%". */
export function pct(fraction: number | null, decimals = 1, signed = true): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—';
  const value = fraction * 100;
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Percentage given an already-percent number: 12.5 -> "+12.5%". */
export function pctPoints(value: number | null, decimals = 1, signed = true): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function ratio(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

export function compact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)} K`;
  return value.toFixed(0);
}

const DATE_FMT = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const DATE_SHORT = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});
const MONTH_FMT = new Intl.DateTimeFormat('en-IN', {
  month: 'short',
  timeZone: 'UTC',
});
const TIME_FMT = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDate(ts: number): string {
  return DATE_FMT.format(new Date(ts));
}

export function formatShortDate(ts: number): string {
  return DATE_SHORT.format(new Date(ts));
}

export function formatMonth(ts: number): string {
  return MONTH_FMT.format(new Date(ts));
}

export function formatDateTime(ts: number): string {
  return TIME_FMT.format(new Date(ts));
}

/** "2 mins ago" / "3 days ago" for signal timestamps. */
export function relativeTime(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(ts);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
