import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { SignalCard } from '../components/SignalCard';
import { EmptyState, Note, PageHead, Pills, SourceTag } from '../components/ui';
import { defaultAnalyzer } from '../lib/sentiment';
import type { SignalSide } from '../lib/types';
import { formatDateTime } from '../lib/format';

type Filter = 'all' | SignalSide;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'hold', label: 'Hold' },
];

export default function Signals() {
  const store = useStore();
  const { market, settings, lstmStatus, lstmMeta, dqnStatus, dqnMeta, previous } = store;
  const [filter, setFilter] = useState<Filter>('all');

  const signals = useMemo(
    () =>
      market.assets
        .map((asset) => store.signalFor(asset.symbol))
        .filter((s): s is NonNullable<typeof s> => s !== null),
    [market.assets, store],
  );

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: signals.length, buy: 0, sell: 0, hold: 0 };
    for (const s of signals) out[s.side] += 1;
    return out;
  }, [signals]);

  const visible = filter === 'all' ? signals : signals.filter((s) => s.side === filter);
  const sorted = [...visible].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  return (
    <>
      <PageHead
        title="AI Signals"
        sub="Buy / Sell / Hold decisions with the evidence behind them"
        actions={<SourceTag source={market.source} at={market.dates[market.dates.length - 1]} withTime />}
      />

      <div className="stack">
        <div className="grid grid-3">
          <Note>
            <span>
              <strong>Signal engine.</strong> Deterministic ensemble of trend, RSI, MACD, Bollinger and
              momentum features with optional sentiment, forecast and agent inputs. Strength is a
              heuristic score, not a probability of profit.
            </span>
          </Note>
          <Note tone={lstmStatus === 'ready' ? 'ok' : 'default'}>
            <span>
              <strong>LSTM forecast.</strong>{' '}
              {lstmStatus === 'ready' && lstmMeta
                ? `Trained on ${lstmMeta.symbol} · test RMSE ₹${lstmMeta.metrics.testRmse.toFixed(2)}.`
                : 'Not trained yet — forecasts are omitted from signals until you train one on the Forecast page.'}
            </span>
          </Note>
          <Note tone={dqnStatus === 'ready' ? 'ok' : 'default'}>
            <span>
              <strong>DQN agent.</strong>{' '}
              {dqnStatus === 'ready' && dqnMeta
                ? `Trained on ${dqnMeta.symbol} · ${dqnMeta.episodes} episodes, ${dqnMeta.gradientSteps} gradient steps.`
                : 'No trained weights — the agent contributes nothing to signals until trained.'}
            </span>
          </Note>
        </div>

        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Pills label="Signal filter" options={FILTERS} value={filter} onChange={setFilter} />
          <span className="section-note">
            Sentiment: {settings.sentimentEnabled ? `${defaultAnalyzer.engine} (demo mode)` : 'disabled'} ·
            last scored {formatDateTime(market.dates[market.dates.length - 1] ?? 0)}
          </span>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            title={counts.all === 0 ? 'No signals available' : `No ${filter} signals right now`}
            action={
              counts.all === 0 ? undefined : (
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => setFilter('all')}>
                  Show all signals
                </button>
              )
            }
          >
            {counts.all === 0
              ? 'The active dataset does not contain enough sessions to compute indicator-based signals.'
              : 'No instrument currently meets the threshold for this side.'}
          </EmptyState>
        ) : (
          <div className="grid grid-2">
            {sorted.map((signal) => (
              <SignalCard
                key={signal.symbol}
                signal={signal}
                changePct={
                  previous[signal.symbol]
                    ? (signal.price - previous[signal.symbol]) / previous[signal.symbol]
                    : null
                }
              />
            ))}
          </div>
        )}

        <p className="disclaimer">
          Signals are research output from historical and demo data. They are not investment advice, not
          guaranteed outcomes, and no order is ever placed with a real broker by this application.
        </p>
      </div>
    </>
  );
}
