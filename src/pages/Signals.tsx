import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { SignalCard } from '../components/SignalCard';
import {
  Card,
  EmptyState,
  ErrorBox,
  MetricTile,
  Note,
  PageHead,
  Pills,
  Progress,
  Section,
  SourceTag,
} from '../components/ui';
import { defaultAnalyzer } from '../lib/sentiment';
import type { SignalSide } from '../lib/types';
import { formatDateTime, pct } from '../lib/format';

type Filter = 'all' | SignalSide;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'hold', label: 'Hold' },
];

export default function Signals() {
  const store = useStore();
  const { market, settings, lstmStatus, lstmMeta, dqnStatus, dqnProgress, dqnError, dqnMeta, previous, trainDqn } =
    store;
  const [filter, setFilter] = useState<Filter>('all');
  const [dqnSymbol, setDqnSymbol] = useState<string>(dqnMeta?.symbol ?? market.assets[0]?.symbol ?? '');

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
                : 'No trained weights — train one in the agent panel below to add its action to signals.'}
            </span>
          </Note>
        </div>

        <Section
          title="Deep Q-Network agent"
          note={
            dqnStatus === 'ready' && dqnMeta
              ? `Weights from ${dqnMeta.symbol} · trained ${formatDateTime(dqnMeta.trainedAt)}`
              : 'Dueling Double-DQN with prioritised replay, trained in this browser'
          }
        >
          <Card>
            <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="field">
                <label className="field-label" htmlFor="dqn-symbol">
                  Instrument
                </label>
                <select
                  id="dqn-symbol"
                  className="select"
                  value={dqnSymbol}
                  onChange={(e) => setDqnSymbol(e.target.value)}
                >
                  {market.assets.map((asset) => (
                    <option key={asset.symbol} value={asset.symbol}>
                      {asset.symbol} — {asset.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={dqnStatus === 'training'}
                  onClick={() => void trainDqn(dqnSymbol)}
                >
                  {dqnStatus === 'training'
                    ? 'Training…'
                    : dqnMeta
                      ? `Retrain for ${dqnMeta.symbol}`
                      : 'Train agent'}
                </button>
              </div>
            </div>

            {dqnStatus === 'training' ? (
              <div style={{ marginTop: 14 }}>
                <Progress value={dqnProgress} label={`Training agent on ${dqnSymbol}`} />
              </div>
            ) : null}

            {dqnStatus === 'error' && dqnError ? (
              <div style={{ marginTop: 14 }}>
                <ErrorBox>{dqnError}</ErrorBox>
              </div>
            ) : null}

            {dqnStatus === 'ready' && dqnMeta ? (
              <>
                <div className="grid grid-4 grid-metrics" style={{ marginTop: 14 }}>
                  <MetricTile label="Episodes" value={dqnMeta.episodes} note={`${dqnMeta.gradientSteps} gradient steps`} />
                  <MetricTile
                    label="Train return"
                    value={pct(dqnMeta.trainReturn)}
                    tone={dqnMeta.trainReturn >= 0 ? 'pos' : 'neg'}
                    note="in-sample"
                  />
                  <MetricTile
                    label="Test return"
                    value={pct(dqnMeta.testReturn)}
                    tone={dqnMeta.testReturn >= 0 ? 'pos' : 'neg'}
                    note="out-of-sample 30%"
                  />
                  <MetricTile
                    label="Buy & hold"
                    value={pct(dqnMeta.buyHoldReturn)}
                    note="same test window"
                  />
                </div>
                <p className="field-hint" style={{ marginTop: 10 }}>
                  {dqnMeta.note}
                </p>
              </>
            ) : dqnStatus !== 'training' && dqnStatus !== 'error' ? (
              <p className="field-hint" style={{ marginTop: 12 }}>
                No weights yet. Training runs a seeded episode schedule against the active dataset with
                transaction costs in the reward and a 70/30 train/test split — expect it to take a few
                seconds.
              </p>
            ) : null}
          </Card>
        </Section>

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
