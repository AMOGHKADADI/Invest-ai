import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { Gauge } from '../components/charts';
import {
  Card,
  EmptyState,
  MetricTile,
  Note,
  PageHead,
  Pills,
  Section,
  SourceTag,
  Toggle,
} from '../components/ui';
import { DEMO_SENTIMENT_SOURCE, analyzeHeadlines, defaultAnalyzer, positiveShare } from '../lib/sentiment';
import type { SentimentLabel } from '../lib/sentiment';
import { formatDateTime, pct, relativeTime, truncate } from '../lib/format';

type Filter = 'all' | SentimentLabel;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
];

const LABEL_CLASS: Record<SentimentLabel, string> = {
  positive: 'badge badge--buy',
  negative: 'badge badge--sell',
  neutral: 'badge badge--neutral',
};

const LABEL_TEXT: Record<SentimentLabel, string> = {
  positive: 'Positive',
  negative: 'Negative',
  neutral: 'Neutral',
};

export default function Sentiment() {
  const store = useStore();
  const { headlines, settings, updateSettings, market } = store;
  const [filter, setFilter] = useState<Filter>('all');

  const analyses = useMemo(
    () => [...analyzeHeadlines(headlines, defaultAnalyzer)].sort((a, b) => b.at - a.at),
    [headlines],
  );

  const share = useMemo(() => positiveShare(analyses.map((a) => a.result)), [analyses]);

  const counts = useMemo(() => {
    const out: Record<SentimentLabel, number> = { positive: 0, neutral: 0, negative: 0 };
    for (const a of analyses) out[a.result.label] += 1;
    return out;
  }, [analyses]);

  const avgScore = useMemo(() => {
    if (analyses.length === 0) return null;
    return analyses.reduce((acc, a) => acc + a.result.score, 0) / analyses.length;
  }, [analyses]);

  const visible = filter === 'all' ? analyses : analyses.filter((a) => a.result.label === filter);

  return (
    <>
      <PageHead
        title="Sentiment Analysis"
        sub="Financial headline classification with the engine and provenance shown explicitly"
        actions={<SourceTag source={DEMO_SENTIMENT_SOURCE} at={market.dates[market.dates.length - 1]} withTime />}
      />

      <div className="stack">
        <div className="grid grid-main-aside">
          <Card>
            <div className="spread" style={{ gap: 20, flexWrap: 'wrap' }}>
              <Gauge
                fraction={share ?? 0}
                caption="positive share"
                size={150}
              />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="card-label">Aggregate sentiment</div>
                <div
                  className="card-value"
                  style={{
                    color:
                      (avgScore ?? 0) > 0.05 ? '#37D67A' : (avgScore ?? 0) < -0.05 ? '#FF2D3D' : '#F7F7F4',
                    textTransform: 'capitalize',
                  }}
                >
                  {(avgScore ?? 0) > 0.05 ? 'positive' : (avgScore ?? 0) < -0.05 ? 'negative' : 'neutral'}
                </div>
                <div className="card-label" style={{ marginTop: 4 }}>
                  Mean signed score {avgScore === null ? '—' : `${avgScore >= 0 ? '+' : ''}${avgScore.toFixed(3)}`}{' '}
                  across {analyses.length} headlines in [−1, 1]
                </div>
              </div>
            </div>
            <div className="grid grid-3 grid-metrics" style={{ marginTop: 14 }}>
              <MetricTile label="Positive" value={counts.positive} tone="pos" note="classified" />
              <MetricTile label="Neutral" value={counts.neutral} note="classified" />
              <MetricTile label="Negative" value={counts.negative} tone="neg" note="classified" />
            </div>
          </Card>

          <div className="stack">
            <Card>
              <div className="section-title" style={{ marginBottom: 6 }}>
                Engine
              </div>
              <div className="kv">
                <span className="k">Active analyzer</span>
                <span className="v mono">{defaultAnalyzer.engine}</span>
              </div>
              <div className="kv">
                <span className="k">Kind</span>
                <span className="v">{defaultAnalyzer.kind}</span>
              </div>
              <div className="kv">
                <span className="k">Corpus</span>
                <span className="v">{headlines.length} demo headlines</span>
              </div>
              <Toggle
                label="Use sentiment in signals"
                hint="When off, the signal engine ignores news sentiment entirely"
                checked={settings.sentimentEnabled}
                onChange={(next) => updateSettings({ sentimentEnabled: next })}
              />
            </Card>

            <Note tone="alert">
              <span>
                <strong>Not FinBERT.</strong> Classification in the browser uses a transparent financial
                lexicon ({defaultAnalyzer.engine}), not a transformer. A FinBERT adapter ships in{' '}
                <code className="mono">src/lib/sentiment.ts</code> and activates only when{' '}
                <code className="mono">VITE_SENTIMENT_API_URL</code> points at a hosted endpoint; it fails
                closed and never silently falls back. Weights are not downloaded into this static app.
              </span>
            </Note>
          </div>
        </div>

        <Section title="Headlines" note={`${visible.length} of ${analyses.length}`}>
          <div className="spread" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <Pills label="Sentiment filter" options={FILTERS} value={filter} onChange={setFilter} />
            <span className="section-note">
              Market-wide headlines apply to every instrument; symbol headlines only to that instrument.
            </span>
          </div>

          {visible.length === 0 ? (
            <EmptyState title="No headlines match this filter">
              Switch back to “All” to see the full corpus.
            </EmptyState>
          ) : (
            <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
              <div className="list">
                {visible.map((item) => (
                  <div className="row" key={item.id}>
                    <span className="avatar" aria-hidden="true">
                      {(item.symbol ?? 'MKT').slice(0, 3)}
                    </span>
                    <div className="row-main">
                      <div className="row-name" title={item.headline}>
                        {truncate(item.headline, 96)}
                      </div>
                      <div className="row-sub">
                        {item.source} · {item.symbol ?? 'Market-wide'} · {relativeTime(item.at)} ·{' '}
                        <span className="mono">{formatDateTime(item.at)}</span>
                      </div>
                    </div>
                    <div className="row-end" style={{ textAlign: 'right' }}>
                      <span className={LABEL_CLASS[item.result.label]}>
                        {LABEL_TEXT[item.result.label]}
                      </span>
                      <div className="row-sub mono">
                        {item.result.score >= 0 ? '+' : ''}
                        {item.result.score.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        <Note>
          <span>
            <strong>Method.</strong> Each headline is scored by lexical hits scaled to [−1, 1]; the
            aggregate is the mean of headlines published within the last 10 days of the queried session,
            so historical signal evaluation never reads news that had not yet appeared.{' '}
            {share === null ? null : `Positive share is ${pct(share, 0, false)} of the corpus.`}
          </span>
        </Note>

        <p className="disclaimer">
          Sentiment output is research derived from a synthetic demo corpus. It is not investment advice
          and does not represent a live news feed.
        </p>
      </div>
    </>
  );
}
