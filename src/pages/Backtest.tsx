import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { CHART_COLORS, LineChart, type LineSeries } from '../components/charts';
import {
  Card,
  ErrorBox,
  MetricTile,
  Note,
  PageHead,
  Pills,
  Section,
  SourceTag,
} from '../components/ui';
import { runBacktest, type BacktestResult } from '../lib/backtest';
import { ALL_STRATEGIES, strategyById } from '../lib/strategies';
import { formatShortDate, grouped, pct, ratio } from '../lib/format';

type Range = '3M' | '6M' | '1Y' | 'ALL';

const WINDOWS: { value: Range; label: string; sessions: number }[] = [
  { value: '3M', label: '3M', sessions: 63 },
  { value: '6M', label: '6M', sessions: 126 },
  { value: '1Y', label: '1Y', sessions: 252 },
  { value: 'ALL', label: 'All', sessions: Number.POSITIVE_INFINITY },
];

export default function Backtest() {
  const store = useStore();
  const { market, settings, sentimentAt } = store;
  const [strategyId, setStrategyId] = useState(ALL_STRATEGIES[0].id);
  const [range, setRange] = useState<Range>('1Y');

  const strategy = strategyById(strategyId);

  const outcome = useMemo<{ result: BacktestResult | null; error: string | null }>(() => {
    const assets = market.assets
      .map((asset) => ({ symbol: asset.symbol, sector: asset.sector, bars: market.bars[asset.symbol] ?? [] }))
      .filter((a) => a.bars.length > 60);
    if (assets.length === 0) return { result: null, error: 'No instrument has enough history to backtest.' };

    const sessions = WINDOWS.find((w) => w.value === range)?.sessions ?? Number.POSITIVE_INFINITY;
    const startIndex = Math.max(0, market.dates.length - sessions);

    try {
      const result = runBacktest({
        assets,
        benchmark:
          market.benchmarkAsset && market.benchmark && market.benchmark.length > 0
            ? { symbol: market.benchmarkAsset.symbol, bars: market.benchmark }
            : null,
        strategy: strategyById(strategyId),
        initialCash: settings.initialCapital,
        costBps: settings.costBps,
        maxPositionPct: settings.maxPositionPct,
        startIndex,
        sentiment: settings.sentimentEnabled
          ? (symbol, date) => sentimentAt(symbol, date)
          : undefined,
        // The LSTM forecast callback is deliberately not supplied: its weights are trained on the
        // full series, so feeding them into past sessions would leak future information.
        forecast: undefined,
      });
      return { result, error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : 'Backtest failed.' };
    }
  }, [market, range, sentimentAt, settings.costBps, settings.initialCapital, settings.maxPositionPct, settings.sentimentEnabled, strategyId]);

  const result = outcome.result;

  const series = useMemo<LineSeries[]>(() => {
    if (!result) return [];
    const base = settings.initialCapital;
    const out: LineSeries[] = [
      {
        id: 'strategy',
        label: strategy.name,
        color: CHART_COLORS.signal,
        area: true,
        points: result.dates.map((d, i) => ({ x: d, y: (result.equity[i] / base - 1) * 100 })),
      },
    ];
    if (result.benchmarkEquity) {
      out.push({
        id: 'benchmark',
        label: market.benchmarkAsset ? market.benchmarkAsset.symbol : 'Benchmark',
        color: CHART_COLORS.alert,
        points: result.dates.map((d, i) => ({ x: d, y: (result.benchmarkEquity![i] / base - 1) * 100 })),
      });
    }
    return out;
  }, [result, market.benchmarkAsset, settings.initialCapital, strategy.name]);

  return (
    <>
      <PageHead
        title="Backtesting"
        sub="Chronological simulation vs benchmark — costs, caps and cash constraints applied"
        actions={<SourceTag source={market.source} at={market.dates[market.dates.length - 1]} withTime />}
      />

      <div className="stack">
        <Card>
          <div className="spread" style={{ flexWrap: 'wrap', gap: 14 }}>
            <div className="field">
              <label className="field-label" htmlFor="bt-strategy">
                Strategy
              </label>
              <select
                id="bt-strategy"
                className="select"
                value={strategyId}
                onChange={(e) => setStrategyId(e.target.value)}
              >
                {ALL_STRATEGIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <Pills label="Backtest window" options={WINDOWS} value={range} onChange={setRange} />
          </div>
          <p className="field-hint" style={{ marginTop: 10 }}>
            {strategy.description}
          </p>
        </Card>

        {outcome.error ? <ErrorBox>{outcome.error}</ErrorBox> : null}

        {result ? (
          <>
            <Section
              title="Equity curve"
              note={`${formatShortDate(result.dates[0])} → ${formatShortDate(
                result.dates[result.dates.length - 1],
              )} · ${result.summary.sessions} sessions`}
            >
              <Card>
                <div className="chart-legend" style={{ marginBottom: 8 }}>
                  <span className="legend-key">
                    <span className="legend-swatch" style={{ background: CHART_COLORS.signal }} />{' '}
                    {strategy.name}
                  </span>
                  {result.benchmarkEquity ? (
                    <span className="legend-key">
                      <span className="legend-swatch" style={{ background: CHART_COLORS.alert }} />{' '}
                      {market.benchmarkAsset?.symbol ?? 'Benchmark'}
                    </span>
                  ) : null}
                </div>
                <LineChart
                  series={series}
                  height={280}
                  formatY={(v) => `${v.toFixed(0)}%`}
                  formatX={(v) => formatShortDate(v)}
                />
              </Card>
            </Section>

            <div className="grid grid-4 grid-metrics">
              <MetricTile
                label="Total return"
                value={result.summary.totalReturn === null ? '—' : pct(result.summary.totalReturn)}
                tone={(result.summary.totalReturn ?? 0) >= 0 ? 'pos' : 'neg'}
                note={`from ₹${grouped(settings.initialCapital)}`}
              />
              <MetricTile
                label="Sharpe ratio"
                value={ratio(result.summary.sharpe)}
                note="rf 0%, 252 sessions"
              />
              <MetricTile
                label="Max drawdown"
                value={result.summary.maxDrawdown ? pct(-result.summary.maxDrawdown.pct) : '—'}
                tone="neg"
                note="peak to trough"
              />
              <MetricTile label="Trades" value={result.trades.length} note={`${(result.turnover * 100).toFixed(0)}% turnover`} />
            </div>

            <div className="grid grid-2">
              <Section title="Strategy vs benchmark">
                <Card>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th className="num">{strategy.name}</th>
                          <th className="num">
                            {result.benchmarkSummary ? (market.benchmarkAsset?.symbol ?? 'Benchmark') : 'Benchmark'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <MetricRow label="Total return" a={result.summary.totalReturn} b={result.benchmarkSummary?.totalReturn ?? null} format={(v) => pct(v)} />
                        <MetricRow label="CAGR" a={result.summary.cagr} b={result.benchmarkSummary?.cagr ?? null} format={(v) => pct(v)} />
                        <MetricRow label="Sharpe" a={result.summary.sharpe} b={result.benchmarkSummary?.sharpe ?? null} format={(v) => ratio(v)} />
                        <MetricRow label="Sortino" a={result.summary.sortino} b={result.benchmarkSummary?.sortino ?? null} format={(v) => ratio(v)} />
                        <MetricRow
                          label="Max drawdown"
                          a={result.summary.maxDrawdown ? -result.summary.maxDrawdown.pct : null}
                          b={result.benchmarkSummary?.maxDrawdown ? -result.benchmarkSummary.maxDrawdown.pct : null}
                          format={(v) => pct(v)}
                        />
                        <MetricRow label="Volatility" a={result.summary.volatility} b={result.benchmarkSummary?.volatility ?? null} format={(v) => pct(v)} />
                      </tbody>
                    </table>
                  </div>
                </Card>
              </Section>

              <div className="stack">
                <Section title="Execution detail">
                  <Card>
                    <div className="kv">
                      <span className="k">Closing cash</span>
                      <span className="v mono">₹{grouped(result.finalCash)}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Mean exposure</span>
                      <span className="v mono">{pct(result.exposure, 0, false)}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Turnover</span>
                      <span className="v mono">{pct(result.turnover, 0, false)}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Transaction cost</span>
                      <span className="v mono">{settings.costBps} bps</span>
                    </div>
                    <div className="kv">
                      <span className="k">Position cap</span>
                      <span className="v mono">{Math.round(settings.maxPositionPct * 100)}%</span>
                    </div>
                    <div className="kv">
                      <span className="k">Sentiment input</span>
                      <span className="v">{settings.sentimentEnabled ? 'enabled (causal)' : 'disabled'}</span>
                    </div>
                  </Card>
                </Section>

                <Note>
                  <span>
                    <strong>Why no LSTM/DQN input here.</strong> Those weights are trained on the full
                    series, so replaying them through past sessions would leak future information into the
                    backtest. The ensemble therefore runs on technical features plus causal news sentiment
                    only — the same information a live trader would have had.
                  </span>
                </Note>
              </div>
            </div>

            <Section title="Engine guarantees">
              <Card tone="flat">
                <div className="stack stack--sm">
                  {result.notes.map((note) => (
                    <div className="kv" key={note}>
                      <span className="k" style={{ color: '#b4b4ae' }}>
                        •
                      </span>
                      <span className="v" style={{ textAlign: 'left' }}>
                        {note}
                      </span>
                    </div>
                  ))}
                  <div className="kv">
                    <span className="k" style={{ color: '#b4b4ae' }}>
                      •
                    </span>
                    <span className="v" style={{ textAlign: 'left' }}>
                      Signals are computed from the previous session and filled at the next open — no
                      same-bar or look-ahead fills. Benchmark: buy-and-hold of the index series with the
                      same cost applied at entry.
                    </span>
                  </div>
                </div>
              </Card>
            </Section>
          </>
        ) : null}

        <p className="disclaimer">
          Backtests are simulations on historical or demo data. They do not account for slippage beyond
          the configured cost, liquidity or survivorship effects, and past performance does not indicate
          future results. Nothing here is investment advice.
        </p>
      </div>
    </>
  );
}

function MetricRow({
  label,
  a,
  b,
  format,
}: {
  label: string;
  a: number | null;
  b: number | null;
  format: (v: number) => string;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num mono">{a === null ? '—' : format(a)}</td>
      <td className="num mono">{b === null ? '—' : format(b)}</td>
    </tr>
  );
}
