import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../app/store';
import { SignalCard } from '../components/SignalCard';
import { LineChart, MiniBars, type LineSeries } from '../components/charts';
import { Card, EmptyState, Icon, MetricTile, Note, PageHead, Pills, Section, SourceTag } from '../components/ui';
import { assessRisk } from '../lib/risk';
import { summarizeEquity } from '../lib/metrics';
import { formatDateTime, grouped, inr, pct, ratio, relativeTime } from '../lib/format';

const RANGES = [
  { value: '1W', label: '1W', sessions: 5 },
  { value: '1M', label: '1M', sessions: 21 },
  { value: '3M', label: '3M', sessions: 63 },
  { value: '1Y', label: '1Y', sessions: 252 },
  { value: 'ALL', label: 'ALL', sessions: Number.POSITIVE_INFINITY },
] as const;

type RangeValue = (typeof RANGES)[number]['value'];

export default function Dashboard() {
  const store = useStore();
  const { market, equityCurve, valuation, settings, prices, previous, assets, trades, holdings } = store;
  const [range, setRange] = useState<RangeValue>('3M');

  const summary = useMemo(
    () => summarizeEquity(equityCurve, { riskFreeRate: 0 }),
    [equityCurve],
  );

  const risk = useMemo(
    () =>
      assessRisk({
        equityCurve,
        account: { cash: store.cash, holdings },
        prices,
        sectors: store.sectors,
        settings,
        sharpe: summary.sharpe,
        sortino: summary.sortino,
        volatilityAnnual: summary.volatility,
      }),
    [equityCurve, holdings, prices, settings, store.cash, store.sectors, summary],
  );

  const signals = useMemo(
    () =>
      market.assets
        .map((asset) => store.signalFor(asset.symbol))
        .filter((s): s is NonNullable<typeof s> => s !== null),
    [market.assets, store],
  );

  const headline = useMemo(() => {
    if (signals.length === 0) return null;
    return [...signals].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
  }, [signals]);

  const rangeConfig = RANGES.find((r) => r.value === range)!;
  const visibleSessions = Math.min(rangeConfig.sessions, equityCurve.length);

  const series: LineSeries[] = useMemo(() => {
    const start = Math.max(0, equityCurve.length - visibleSessions);
    const points = market.dates.slice(start).map((t, i) => ({ x: t, y: equityCurve[start + i] }));
    return [{ id: 'equity', label: 'Portfolio value', points, color: '#FFDC16', area: true }];
  }, [equityCurve, market.dates, visibleSessions]);

  const recentTrades = [...trades].slice(-5).reverse();
  const invested = valuation.invested;
  const totalReturn = summary.totalReturn;

  return (
    <>
      <PageHead
        title="Hello, Investor"
        sub="Your AI-powered research and paper-trading assistant"
        actions={
          <SourceTag source={market.source} at={market.dates[market.dates.length - 1]} withTime />
        }
      />

      <div className="grid grid-main-aside">
        <div className="stack">
          <Card tone="yellow">
            <div className="spread">
              <div>
                <div className="card-label">Total portfolio value</div>
                <div className="card-value">{inr(valuation.total)}</div>
                <div className="inline" style={{ marginTop: 6 }}>
                  <span
                    className="badge"
                    style={{
                      background:
                        (store.dayChangePct ?? 0) >= 0 ? 'rgba(11,11,11,0.14)' : 'rgba(255,45,61,0.18)',
                      color: (store.dayChangePct ?? 0) >= 0 ? '#0b0b0b' : '#8a0009',
                    }}
                  >
                    {(store.dayChangePct ?? 0) >= 0 ? '↑' : '↓'} {pct(Math.abs(store.dayChangePct ?? 0))}
                  </span>
                  <span className="card-label">since last close</span>
                </div>
              </div>
              <MiniBars
                values={equityCurve.slice(-8).map((v, i, arr) => (i === 0 ? 0 : v - arr[i - 1]))}
                color="#0b0b0b"
              />
            </div>
            <div className="inline" style={{ marginTop: 14 }}>
              <span className="card-label">Invested {inr(invested)}</span>
              <span className="card-label">·</span>
              <span className="card-label">Cash {inr(valuation.cash)}</span>
            </div>
          </Card>

          <div className="grid grid-metrics grid-3">
            <MetricTile
              label="Total return"
              value={pct(totalReturn)}
              tone={totalReturn === null ? 'flat' : totalReturn >= 0 ? 'pos' : 'neg'}
              note={`${grouped(summary.sessions)} sessions replayed`}
            />
            <MetricTile label="Sharpe ratio" value={ratio(summary.sharpe)} note="rf = 0, annualised" />
            <MetricTile
              label="Max drawdown"
              value={summary.maxDrawdown ? pct(-summary.maxDrawdown.pct) : '—'}
              tone="neg"
              note={`Halt limit -${(settings.drawdownHaltPct * 100).toFixed(0)}%`}
            />
          </div>

          <Card>
            <div className="spread" style={{ marginBottom: 14 }}>
              <div>
                <div className="section-title">Portfolio performance</div>
                <div className="section-note">
                  Replayed from your paper-trade history · {formatDateTime(market.dates[0] ?? 0)}
                </div>
              </div>
              <Pills
                label="Performance range"
                options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
                value={range}
                onChange={setRange}
              />
            </div>
            {trades.length === 0 ? (
              <EmptyState
                title="No paper trades yet"
                action={
                  <Link className="btn btn--primary btn--sm" to="/markets">
                    Open markets
                  </Link>
                }
              >
                Your equity curve is flat at the initial capital of {inr(settings.initialCapital)}.
                Place a paper order to start generating a performance history.
              </EmptyState>
            ) : (
              <LineChart series={series} height={240} />
            )}
          </Card>
        </div>

        <div className="stack">
          <Card>
            <div className="spread" style={{ marginBottom: 10 }}>
              <div className="section-title">Risk summary</div>
              <span
                className={`badge ${
                  risk.level === 'high' ? 'badge--sell' : risk.level === 'medium' ? 'badge--warn' : 'badge--buy'
                }`}
              >
                {risk.level}
              </span>
            </div>
            <div className="grid grid-metrics" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <MetricTile label="Volatility" value={pct(summary.volatility)} note="annualised" />
              <MetricTile label="Sortino" value={ratio(summary.sortino)} note="downside only" />
            </div>
            <div className="stack stack--sm" style={{ marginTop: 12 }}>
              {risk.items.slice(0, 3).map((item) => (
                <div className="inline" key={item.key} style={{ gap: 8, alignItems: 'flex-start' }}>
                  <span
                    className={`status-dot${
                      item.status === 'breach' ? ' status-dot--breach' : item.status === 'warn' ? ' status-dot--warn' : ''
                    }`}
                    style={{ marginTop: 6 }}
                  />
                  <span className="section-note" style={{ lineHeight: 1.5 }}>
                    <strong style={{ color: '#f7f7f4' }}>{item.label}.</strong> {item.detail}
                  </span>
                </div>
              ))}
            </div>
            <div className="inline" style={{ marginTop: 12 }}>
              <Link className="btn btn--ghost btn--sm" to="/risk">
                <Icon name="risk" className="ico" /> Open risk controls
              </Link>
            </div>
          </Card>

          <Card>
            <div className="spread" style={{ marginBottom: 10 }}>
              <div className="section-title">Latest AI signal</div>
              <Link className="section-note" to="/signals" style={{ color: '#ffdc16' }}>
                All signals →
              </Link>
            </div>
            {headline ? (
              <SignalCard
                signal={headline}
                changePct={
                  previous[headline.symbol]
                    ? (headline.price - previous[headline.symbol]) / previous[headline.symbol]
                    : null
                }
              />
            ) : (
              <EmptyState title="No signal available">Not enough history to score an asset.</EmptyState>
            )}
          </Card>

          <Card>
            <div className="section-title" style={{ marginBottom: 8 }}>
              Recent activity
            </div>
            {recentTrades.length === 0 ? (
              <p className="section-note">No transactions recorded in this session.</p>
            ) : (
              <div className="list">
                {recentTrades.map((trade) => (
                  <div className="row" key={trade.id}>
                    <span className={`badge ${trade.side === 'buy' ? 'badge--buy' : 'badge--sell'}`}>
                      {trade.side}
                    </span>
                    <div className="row-main">
                      <div className="row-name">{trade.symbol}</div>
                      <div className="row-sub">
                        {grouped(trade.qty)} @ {inr(trade.price, 2)} · fee {inr(trade.fee, 2)}
                      </div>
                    </div>
                    <div className="row-end">
                      <div className="row-sub">{relativeTime(trade.at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Note>
            <Icon name="info" className="ico" />
            <span>
              {market.disclaimer} Figures carry no live-market meaning and are for research and
              education only.
            </span>
          </Note>
        </div>
      </div>

      <Section
        title="Universe"
        note={`${assets.length} instruments · ${market.source.label}`}
        action={
          <Link className="section-note" to="/markets" style={{ color: '#ffdc16' }}>
            Explore →
          </Link>
        }
      >
        <div className="grid grid-4">
          {assets.slice(0, 4).map((asset) => {
            const price = prices[asset.symbol];
            const prev = previous[asset.symbol];
            const change = prev && price ? (price - prev) / prev : null;
            const holding = holdings.find((h) => h.symbol === asset.symbol);
            return (
              <Card key={asset.symbol} className="card--flat">
                <Link to={`/markets/${asset.symbol}`}>
                  <div className="spread">
                    <span className="row-name">{asset.symbol}</span>
                    <span className={`row-change ${change !== null && change >= 0 ? 'pos' : 'neg'}`}>
                      {pct(change)}
                    </span>
                  </div>
                  <div className="tile-value" style={{ marginTop: 4 }}>
                    {inr(price ?? 0, 2)}
                  </div>
                  <div className="row-sub">{holding ? `Held · ${grouped(holding.qty)} qty` : asset.sector}</div>
                </Link>
              </Card>
            );
          })}
        </div>
      </Section>
    </>
  );
}
