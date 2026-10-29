import { toCsv } from './csv';

/**
 * Trigger a browser download of a CSV table. The UTF-8 BOM keeps Excel
 * (and Google Sheets) from mangling ₹ and other non-ASCII characters.
 * Safe to call outside a browser: it simply does nothing.
 */
export function downloadCsv(
  filename: string,
  rows: readonly (readonly (string | number | null | undefined)[])[],
): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob(['\uFEFF' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
