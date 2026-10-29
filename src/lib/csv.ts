/**
 * Strict OHLCV CSV import.
 *
 * Accepted header (case-insensitive): date,open,high,low,close,volume
 * `symbol` and `name` columns are optional and override the asset metadata.
 * Rows are validated individually; the first invalid row aborts the import with
 * a message the UI can show to the user.
 */

import type { Asset, Bar, DataSource } from './types';

export interface CsvImportResult {
  asset: Asset;
  bars: Bar[];
  source: DataSource;
  warnings: string[];
}

export class CsvImportError extends Error {
  constructor(
    message: string,
    readonly row: number,
  ) {
    super(message);
    this.name = 'CsvImportError';
  }
}

const HEADER_ALIASES: Record<string, keyof Required<Record<string, never>> | string> = {
  date: 'date',
  datetime: 'date',
  time: 'date',
  timestamp: 'date',
  open: 'open',
  high: 'high',
  low: 'low',
  close: 'close',
  adj_close: 'close',
  adjclose: 'close',
  volume: 'volume',
  symbol: 'symbol',
  name: 'name',
};

function splitLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

function parseDate(raw: string): number | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (dmy) return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const ymd = /^(\d{8})$/.exec(raw);
  if (ymd) {
    const s = ymd[1];
    return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Parse a CSV document into a validated OHLCV series.
 * Throws {@link CsvImportError} with a row number on the first malformed record.
 */
export function parseOhlcvCsv(text: string, fallbackSymbol = 'IMPORTED'): CsvImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new CsvImportError('The file needs a header row and at least one data row.', 1);

  const header = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const columns: Record<string, number> = {};
  header.forEach((h, idx) => {
    const mapped = HEADER_ALIASES[h];
    if (typeof mapped === 'string' && columns[mapped] === undefined) columns[mapped] = idx;
  });
  for (const required of ['date', 'open', 'high', 'low', 'close'] as const) {
    if (columns[required] === undefined) {
      throw new CsvImportError(`Missing required column "${required}". Found: ${header.join(', ')}.`, 1);
    }
  }

  const bars: Bar[] = [];
  const warnings: string[] = [];
  let symbol = fallbackSymbol;
  let name = fallbackSymbol;

  for (let r = 1; r < lines.length; r++) {
    const cells = splitLine(lines[r]);
    const get = (key: string): string => {
      const idx = columns[key];
      return idx === undefined ? '' : (cells[idx] ?? '');
    };
    const t = parseDate(get('date'));
    if (t === null) throw new CsvImportError(`Unparseable date "${get('date')}".`, r + 1);
    const numeric = (key: 'open' | 'high' | 'low' | 'close' | 'volume'): number => {
      const raw = get(key);
      const value = Number(raw.replace(/[₹$,\s]/g, ''));
      if (raw === '' || !Number.isFinite(value)) {
        throw new CsvImportError(`Invalid ${key} value "${raw}".`, r + 1);
      }
      return value;
    };
    const o = numeric('open');
    const h = numeric('high');
    const l = numeric('low');
    const c = numeric('close');
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) {
      throw new CsvImportError('Prices must be greater than zero.', r + 1);
    }
    if (h < Math.max(o, c) || l > Math.min(o, c)) {
      throw new CsvImportError(
        `High/low are inconsistent with open/close (H ${h}, L ${l}, O ${o}, C ${c}).`,
        r + 1,
      );
    }
    const v = columns.volume === undefined ? 0 : numeric('volume');
    if (v < 0) throw new CsvImportError('Volume cannot be negative.', r + 1);
    if (get('symbol')) symbol = get('symbol').toUpperCase();
    if (get('name')) name = get('name');
    bars.push({ t, o, h, l, c, v: Math.round(v) });
  }

  bars.sort((a, b) => a.t - b.t);
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t === bars[i - 1].t) {
      warnings.push(`Duplicate date ${new Date(bars[i].t).toISOString().slice(0, 10)} — later row kept.`);
      bars[i - 1] = bars[i];
      bars.splice(i, 1);
      i--;
    }
  }
  if (bars.length < 30) warnings.push('Fewer than 30 sessions: indicators and models will be unreliable.');

  return {
    asset: { symbol, name, sector: 'Imported', exchange: 'CSV' },
    bars,
    source: {
      id: `import-${symbol}-${bars.length}`,
      kind: 'imported',
      label: 'Imported data',
      note: `Imported from a local CSV file (${bars.length} sessions). Values are exactly as supplied.`,
    },
    warnings,
  };
}

/**
 * Serialise a rectangular table into CSV text (RFC 4180-style escaping).
 * Used for the app's export actions: trades, backtest equity curves.
 */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell === null || cell === undefined ? '' : String(cell);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}
