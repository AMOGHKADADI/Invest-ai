import { describe, expect, it } from 'vitest';
import { CsvImportError, parseOhlcvCsv } from './csv';

function buildCsv(rows: number): string {
  const lines = ['date,open,high,low,close,volume'];
  for (let i = 0; i < rows; i++) {
    const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    const o = 100 + i;
    lines.push(`${date},${o},${o + 5},${o - 1},${o + 4},1000000`);
  }
  return lines.join('\n');
}

const VALID = buildCsv(40);

describe('parseOhlcvCsv', () => {
  it('parses a well-formed file', () => {
    const result = parseOhlcvCsv(VALID, 'TEST');
    expect(result.bars).toHaveLength(40);
    expect(result.asset.symbol).toBe('TEST');
    expect(result.source.kind).toBe('imported');
    expect(result.bars[0]).toMatchObject({ o: 100, h: 105, l: 99, c: 104, v: 1000000 });
    expect(result.warnings).toHaveLength(0);
  });

  it('sorts rows chronologically', () => {
    const shuffled = `date,open,high,low,close
2024-01-03,107,110,101,102
2024-01-01,100,105,99,104
2024-01-02,104,108,103,107
`;
    const result = parseOhlcvCsv(shuffled);
    expect(result.bars.map((b) => b.t)).toEqual([
      Date.UTC(2024, 0, 1),
      Date.UTC(2024, 0, 2),
      Date.UTC(2024, 0, 3),
    ]);
  });

  it('accepts dd/mm/yyyy dates and currency symbols', () => {
    const csv = `date,open,high,low,close
01/02/2024,"₹100","₹105","₹99","₹104"
`;
    const result = parseOhlcvCsv(csv);
    expect(result.bars[0].c).toBe(104);
    expect(result.bars[0].t).toBe(Date.UTC(2024, 1, 1));
  });

  it('reports the row number for a malformed value', () => {
    const csv = `date,open,high,low,close
2024-01-01,100,105,99,104
2024-01-02,abc,108,103,107
`;
    try {
      parseOhlcvCsv(csv);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CsvImportError);
      expect((error as CsvImportError).row).toBe(3);
      expect((error as CsvImportError).message).toMatch(/open/);
    }
  });

  it('rejects high/low that contradict open/close', () => {
    const csv = `date,open,high,low,close
2024-01-01,100,95,104,102
`;
    expect(() => parseOhlcvCsv(csv)).toThrow(/inconsistent/);
  });

  it('rejects a file without a close column', () => {
    const csv = `date,open,high,low
2024-01-01,100,105,99
`;
    expect(() => parseOhlcvCsv(csv)).toThrow(/Missing required column "close"/);
  });

  it('rejects an empty file', () => {
    expect(() => parseOhlcvCsv('')).toThrow(CsvImportError);
  });

  it('warns about duplicate dates instead of silently keeping both', () => {
    const csv = `date,open,high,low,close
2024-01-01,100,105,99,104
2024-01-01,101,106,100,105
`;
    const result = parseOhlcvCsv(csv);
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].c).toBe(105);
    expect(result.warnings[0]).toMatch(/Duplicate date/);
  });
});
