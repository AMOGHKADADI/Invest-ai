import { describe, expect, it } from 'vitest';
import {
  LexiconSentiment,
  analyzeHeadlines,
  buildDemoHeadlines,
  positiveShare,
  sentimentUpTo,
} from './sentiment';

const analyzer = new LexiconSentiment();

describe('LexiconSentiment', () => {
  it('classifies clearly positive text', () => {
    const result = analyzer.analyze('Record quarterly profit and strong revenue growth with an upgrade');
    expect(result.label).toBe('positive');
    expect(result.score).toBeGreaterThan(0.12);
    expect(result.positiveHits.length).toBeGreaterThan(1);
  });

  it('classifies clearly negative text', () => {
    const result = analyzer.analyze('Profit falls sharply as guidance is cut amid downgrade risk');
    expect(result.label).toBe('negative');
    expect(result.score).toBeLessThan(-0.12);
    expect(result.negativeHits.length).toBeGreaterThan(1);
  });

  it('is neutral when there is no financial evidence', () => {
    const result = analyzer.analyze('The meeting is scheduled for Tuesday.');
    expect(result.label).toBe('neutral');
    expect(result.score).toBeCloseTo(0, 10);
  });

  it('applies negation', () => {
    const positive = analyzer.analyze('The outlook is strong').score;
    const negated = analyzer.analyze('The outlook is not strong').score;
    expect(positive).toBeGreaterThan(0);
    expect(negated).toBeLessThan(positive);
  });

  it('is deterministic and self-describing', () => {
    const a = analyzer.analyze('strong growth');
    const b = analyzer.analyze('strong growth');
    expect(a).toEqual(b);
    expect(analyzer.kind).toBe('lexicon');
    expect(analyzer.engine).not.toMatch(/finbert/i);
  });
});

describe('demo headlines', () => {
  const dates = Array.from({ length: 756 }, (_, i) => Date.UTC(2024, 0, 1) + i * 86_400_000);
  const headlines = buildDemoHeadlines(dates);

  it('are ordered in time and stamped inside the sample window', () => {
    for (let i = 1; i < headlines.length; i++) expect(headlines[i].at).toBeGreaterThanOrEqual(headlines[i - 1].at);
    for (const h of headlines) expect(h.at).toBeGreaterThanOrEqual(dates[0]);
  });

  it('aggregate sentiment only sees news published at or before the timestamp', () => {
    const first = headlines[0];
    const later = headlines[headlines.length - 1];

    const beforeAny = sentimentUpTo(headlines, analyzer, first.at - 1);
    expect(beforeAny.count).toBe(0);
    expect(beforeAny.score).toBe(0);

    const upToFirst = sentimentUpTo(headlines, analyzer, first.at);
    expect(upToFirst.count).toBe(1);

    const upToLast = sentimentUpTo(headlines, analyzer, later.at, 1000 * 60 * 60 * 24 * 900);
    expect(upToLast.count).toBe(headlines.length);
    expect(upToLast.score).toBeGreaterThanOrEqual(-1);
    expect(upToLast.score).toBeLessThanOrEqual(1);
  });

  it('analyses every headline with a score in [-1, 1]', () => {
    const results = analyzeHeadlines(headlines, analyzer);
    expect(results).toHaveLength(headlines.length);
    for (const r of results) {
      expect(r.result.score).toBeGreaterThanOrEqual(-1);
      expect(r.result.score).toBeLessThanOrEqual(1);
    }
    const share = positiveShare(results.map((r) => r.result));
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(1);
    expect(positiveShare([])).toBeNull();
  });
});
