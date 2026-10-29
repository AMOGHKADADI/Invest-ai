/**
 * Financial sentiment analysis.
 *
 * The report specifies FinBERT (a BERT model fine-tuned on financial text) as the
 * sentiment classifier. This module ships two implementations behind one
 * interface so the distinction is never blurred:
 *
 *  - {@link LexiconSentiment} — a transparent, deterministic financial lexicon
 *    scorer used by the browser demo. It is labelled "lexicon" everywhere it is
 *    shown, and is never described as FinBERT.
 *  - {@link HttpSentiment} — a thin client for a hosted FinBERT endpoint. It is
 *    used only when VITE_SENTIMENT_API_URL is configured, and reports a clear
 *    "unavailable" state otherwise.
 */

import type { DataSource } from './types';

export type SentimentLabel = 'positive' | 'negative' | 'neutral';

export interface SentimentResult {
  label: SentimentLabel;
  /** Signed score in [-1, 1]. */
  score: number;
  /** Model that produced the result. */
  engine: string;
  positiveHits: string[];
  negativeHits: string[];
}

export interface SentimentAnalyzer {
  readonly engine: string;
  readonly kind: 'lexicon' | 'transformer';
  analyze(text: string): SentimentResult;
}

const POSITIVE = [
  'beat', 'beats', 'strong', 'strongest', 'growth', 'record', 'surge', 'surges', 'rally', 'rallies',
  'profit', 'profits', 'profitable', 'upgrade', 'upgrades', 'bullish', 'outperform', 'expands',
  'expansion', 'breakthrough', 'dividend', 'buyback', 'resilient', 'rebound', 'rebounds', 'gain',
  'gains', 'raises', 'raised', 'robust', 'optimistic', 'opportunity', 'accelerates', 'accelerate',
  'milestone', 'exceeds', 'exceeded', 'upside', 'demand', 'approved', 'wins', 'record-high',
  'innovation', 'green-energy', 'expansion-plan', 'stronger-than-expected',
];

const NEGATIVE = [
  'miss', 'misses', 'weak', 'loss', 'losses', 'decline', 'declines', 'fall', 'falls', 'drop',
  'drops', 'plunge', 'plunges', 'downgrade', 'downgrades', 'bearish', 'lawsuit', 'probe',
  'layoffs', 'recall', 'risk', 'risks', 'headwinds', 'slowdown', 'slows', 'cuts', 'cut',
  'deficit', 'debt', 'fraud', 'penalty', 'fine', 'fined', 'misses-estimates', 'volatile',
  'uncertainty', 'concerns', 'warning', 'warns', 'disappointing', 'underperform', 'crash',
  'default', 'bankruptcy', 'recession', 'inflation-pressure',
];

const NEGATORS = ['not', 'no', 'never', 'without', 'hardly', "isn't", "aren't", "won't", 'cannot'];

const INTENSIFIERS: Record<string, number> = {
  very: 1.5,
  strongly: 1.5,
  significantly: 1.4,
  sharply: 1.4,
  slightly: 0.6,
  marginally: 0.6,
  broadly: 1.2,
  record: 1.4,
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'%-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Deterministic financial lexicon scorer with negation and intensifier handling.
 * Used for the demo mode only; every UI surface labels it as "lexicon".
 */
export class LexiconSentiment implements SentimentAnalyzer {
  readonly engine = 'Financial lexicon v1';
  readonly kind = 'lexicon' as const;

  analyze(text: string): SentimentResult {
    const tokens = tokenize(text);
    let raw = 0;
    const positiveHits: string[] = [];
    const negativeHits: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const prev = tokens[i - 1];
      const isNegated = prev !== undefined && NEGATORS.includes(prev);
      let weight = 0;
      let matched: 'positive' | 'negative' | null = null;

      if (POSITIVE.includes(token)) {
        weight = 1;
        matched = 'positive';
      } else if (NEGATIVE.includes(token)) {
        weight = -1;
        matched = 'negative';
      }
      if (matched === null) continue;

      if (prev !== undefined && INTENSIFIERS[prev] !== undefined) weight *= INTENSIFIERS[prev];
      if (isNegated) weight *= -1;
      raw += weight;
      (weight > 0 ? positiveHits : negativeHits).push(token);
    }

    const score = Math.tanh(raw / 3);
    const label: SentimentLabel = score > 0.12 ? 'positive' : score < -0.12 ? 'negative' : 'neutral';
    return { label, score, engine: this.engine, positiveHits, negativeHits };
  }
}

export const DEMO_SENTIMENT_SOURCE: DataSource = {
  id: 'demo-headlines-v1',
  kind: 'demo',
  label: 'Demo headlines',
  note: 'Synthetic English headlines generated for the demo dataset. Not a live news feed.',
};

export interface Headline {
  id: string;
  symbol: string | null;
  headline: string;
  source: string;
  at: number;
}

/**
 * Deterministic demo headlines spread across the demo sessions.
 * `null` symbol means a market-wide headline.
 */
export function buildDemoHeadlines(dates: readonly number[]): Headline[] {
  const templates: { text: string; symbol: string | null; source: string; dayOffset: number }[] = [
    { text: 'Reliance announces record quarterly profit and a new green energy expansion plan', symbol: 'RELIANCE', source: 'Market Wire', dayOffset: 12 },
    { text: 'TCS reports strong revenue growth and raises its dividend guidance', symbol: 'TCS', source: 'Earnings Daily', dayOffset: 24 },
    { text: 'IT sector faces global headwinds as client spending slows', symbol: null, source: 'Sector Watch', dayOffset: 31 },
    { text: 'RBI maintains key interest rates, signals data-dependent stance', symbol: null, source: 'Macro Desk', dayOffset: 45 },
    { text: 'HDFC bank credit growth accelerates on retail demand', symbol: 'HDFCBANK', source: 'Banking Post', dayOffset: 58 },
    { text: 'Infosys wins large digital contract, order book at record high', symbol: 'INFY', source: 'Market Wire', dayOffset: 77 },
    { text: 'ICICI Bank asset quality improves, slippages decline', symbol: 'ICICIBANK', source: 'Banking Post', dayOffset: 96 },
    { text: 'State Bank of India raises capital, analysts upgrade the stock', symbol: 'SBIN', source: 'Equity Desk', dayOffset: 121 },
    { text: 'Tata Motors deliveries fall short amid supply disruption', symbol: 'TATAMOTORS', source: 'Auto Tracker', dayOffset: 141 },
    { text: 'ITC margin pressures persist as input costs rise', symbol: 'ITC', source: 'Consumer Beat', dayOffset: 168 },
    { text: 'Bharti Airtel tariff hike supports ARPU growth', symbol: 'BHARTIARTL', source: 'Telecom Daily', dayOffset: 196 },
    { text: 'Larsen & Toubro wins major infrastructure order, guidance raised', symbol: 'LT', source: 'Infra Watch', dayOffset: 224 },
    { text: 'Global markets rally as inflation prints come in cooler than expected', symbol: null, source: 'Global Desk', dayOffset: 251 },
    { text: 'Markets slip as rising yields and geopolitical risk pressure sentiment', symbol: null, source: 'Global Desk', dayOffset: 288 },
    { text: 'Reliance retail arm expands store network at record pace', symbol: 'RELIANCE', source: 'Market Wire', dayOffset: 312 },
    { text: 'TCS cautions on weak discretionary spending in banking verticals', symbol: 'TCS', source: 'Earnings Daily', dayOffset: 341 },
    { text: 'Banking sector credit costs rise, lenders flag higher provisions', symbol: null, source: 'Banking Post', dayOffset: 366 },
    { text: 'Infosys guidance disappoints, management flags delayed deal closures', symbol: 'INFY', source: 'Earnings Daily', dayOffset: 392 },
    { text: 'FII outflows weigh on market breadth; rupee under pressure', symbol: null, source: 'Macro Desk', dayOffset: 421 },
    { text: 'HDFC Bank deposit growth outpaces credit growth in quarterly update', symbol: 'HDFCBANK', source: 'Banking Post', dayOffset: 448 },
    { text: 'Renewable capacity additions accelerate across the sector', symbol: 'RELIANCE', source: 'Energy Line', dayOffset: 470 },
    { text: 'IT majors sign a wave of AI deals, pipeline at an all-time high', symbol: null, source: 'Sector Watch', dayOffset: 502 },
    { text: 'Markets reach fresh highs on strong earnings and steady inflows', symbol: null, source: 'Market Wire', dayOffset: 531 },
    { text: 'Regulatory probe into brokerage practices raises sector uncertainty', symbol: null, source: 'Compliance Desk', dayOffset: 566 },
    { text: 'Automotive sales volumes decline for a second straight month', symbol: 'TATAMOTORS', source: 'Auto Tracker', dayOffset: 592 },
    { text: 'Defence order wins lift sentiment for industrial names', symbol: 'LT', source: 'Infra Watch', dayOffset: 621 },
    { text: 'Telecom subscriber losses narrow, competitive intensity eases', symbol: 'BHARTIARTL', source: 'Telecom Daily', dayOffset: 648 },
    { text: 'Consumer staples demand holds up despite rural weakness', symbol: 'ITC', source: 'Consumer Beat', dayOffset: 674 },
    { text: 'Central bank signals potential rate cuts as inflation cools', symbol: null, source: 'Macro Desk', dayOffset: 701 },
    { text: 'Risk appetite returns as banking sector results beat estimates', symbol: null, source: 'Equity Desk', dayOffset: 726 },
  ];

  const headlines: Headline[] = [];
  for (const tpl of templates) {
    const idx = Math.min(dates.length - 1, Math.max(0, dates.length - 1 - tpl.dayOffset));
    headlines.push({
      id: `${tpl.symbol ?? 'MARKET'}-${tpl.dayOffset}`,
      symbol: tpl.symbol,
      headline: tpl.text,
      source: tpl.source,
      at: dates[idx],
    });
  }
  return headlines.sort((a, b) => a.at - b.at);
}

/**
 * Causal aggregate sentiment: mean score of headlines published up to and
 * including the given timestamp (never looks at later news).
 */
export function sentimentUpTo(
  headlines: readonly Headline[],
  analyzer: SentimentAnalyzer,
  at: number,
  lookbackMs = 1000 * 60 * 60 * 24 * 10,
): { score: number; count: number; engine: string } {
  const window = headlines.filter((h) => h.at <= at && h.at > at - lookbackMs);
  if (window.length === 0) return { score: 0, count: 0, engine: analyzer.engine };
  const total = window.reduce((acc, h) => acc + analyzer.analyze(h.headline).score, 0);
  return { score: total / window.length, count: window.length, engine: analyzer.engine };
}

export interface HeadlineAnalysis extends Headline {
  result: SentimentResult;
}

export function analyzeHeadlines(
  headlines: readonly Headline[],
  analyzer: SentimentAnalyzer,
): HeadlineAnalysis[] {
  return headlines.map((h) => ({ ...h, result: analyzer.analyze(h.headline) }));
}

/** Share of positive classifications among analysed headlines, in [0, 1]. */
export function positiveShare(results: readonly SentimentResult[]): number | null {
  if (results.length === 0) return null;
  return results.filter((r) => r.label === 'positive').length / results.length;
}

/**
 * FinBERT adapter for a server-hosted model.
 * Fails closed with a descriptive message when the endpoint is not configured —
 * it never falls back to the lexicon while claiming to be FinBERT.
 */
export class HttpSentiment {
  readonly kind = 'transformer' as const;

  constructor(private readonly endpoint: string) {}

  get engine(): string {
    return 'FinBERT (hosted)';
  }

  async analyze(text: string): Promise<SentimentResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`Sentiment endpoint returned HTTP ${response.status}.`);
    const data = (await response.json()) as { label?: string; score?: number };
    if (typeof data.score !== 'number' || !data.label) {
      throw new Error('Sentiment endpoint returned an unexpected payload.');
    }
    const label = data.label === 'positive' || data.label === 'negative' ? data.label : 'neutral';
    return { label, score: data.score, engine: this.engine, positiveHits: [], negativeHits: [] };
  }
}

/** Returns the hosted analyzer when VITE_SENTIMENT_API_URL is set, else null. */
export function createConfiguredAnalyzer(): HttpSentiment | null {
  const url = import.meta.env.VITE_SENTIMENT_API_URL as string | undefined;
  if (!url) return null;
  return new HttpSentiment(url);
}

export const defaultAnalyzer = new LexiconSentiment();
