import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../app/store';
import { ALLOCATION_COLORS, Donut, type DonutSlice } from '../components/charts';
import {
  Card,
  EmptyState,
  Icon,
  MetricTile,
  Note,
  PageHead,
  Section,
  SourceTag,
} from '../components/ui';
import { allocationSlices, holdingRows, realizedPnl, sectorAllocation } from '../lib/portfolio';
import { summarizeEquity } from '../lib/metrics';
import { grouped, inr, pct, ratio } from '../lib/format';

export default function PortfolioPage() {
  const store = useStore();
  const { market, assets, prices, previous, holdings, cash, trades, equityCurve, settings, sectors } = store;

  const valuation = store.valuation;
  const summary = useMemo(() => summarizeEquity(equityCurve, { riskFreeRate: 0 }), [equityCurve]);

  const rows = useMemo(
    () => holdingRows({ cash, holdings }, prices, previous, assets, valuation.total),
    [assets, cash, holdings, previous, prices, valuation.total],
  );

  const slices: DonutSlice[] = useMemo(() => {
    const base = allocationSlices({ cash, holdings }, prices, assets, valuation.total);
    return base.map((s, i) => ({
      key: s.key,
      label: s.label,
      value: s.value,
      color: s.kind === 'cash' ? '#7D7D78' : ALLOCATION_COLORS[i % ALLOCATION_COLORS.length],
    }));
  }, [assets, cash, holdings, prices, valuation.total]);

  const sectorSlices = useMemo(
    () => sectorAllocation({ cash, holdings }, prices, assets, valuation.total),
    [assets, cash, holdings, prices, valuation.total],
  );

  const invested = valuation.invested;
  const unrealized = rows.reduce((acc, r) => acc + r.pnl, 0);
  const realized = realizedPnl(trades);
  const costBasis = rows.reduce((acc, r) => acc + r.cost, 0);
  const gainFromStart = valuation.total - settings.initialCapital;

  if (holdings.length === 0 && trades.length === 0) {
    return (
      <>
        <PageHead title="Portfolio" sub="Holdings, allocation and performance" actions={<SourceTag source={market.source} />} />
        <EmptyState
          title="Your paper portfolio is empty"
          action={
            <Link className="btn btn--primary btn--sm" to="/markets">
              Browse instruments
            </Link>
          }
        >
          Start with {inr(settings.initialCapital)} of simulated capital. Place a paper order from any
          asset page and this screen will show holdings, allocation and performance metrics.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Portfolio"
        sub="Holdings, allocation and performance metrics"
        actions={<SourceTag source={market.source} at={market.dates[market.dates.length - 1]} withTime />}
      />

      <div className="stack">
        <div className="grid grid-main-aside">
          <div className="stack">
            <Card tone="yellow">
              <div className="card-label">Current value</div>
              <div className="card-value">{inr(valuation.total)}</div>
              <div className="grid grid-3" style={{ marginTop: 14, gap: 12 }}>
                <div>
                  <div className="card-label">Invested</div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{inr(invested)}</div>
                </div>
                <div>
                  <div className="card-label">Cash</div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{inr(cash)}</div>
                </div>
                <div>
                  <div className="card-label">Total gain</div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 17,
                      color: gainFromStart >= 0 ? '#0b7a3e' : '#8a0009',
                    }}
                  >
                    {gainFromStart >= 0 ? '+' : ''}
                    {inr(gainFromStart)}
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid grid-4 grid-metrics">
              <MetricTile label="Total return" value={pct(summary.totalReturn)} tone={summary.totalReturn !== null && summary.totalReturn >= 0 ? 'pos' : 'neg'} />
              <MetricTile label="Sharpe" value={ratio(summary.sharpe)} note="rf 0%" />
              <MetricTile label="Max drawdown" value={summary.maxDrawdown ? pct(-summary.maxDrawdown.pct) : '—'} tone="neg" />
              <MetricTile label="Unrealised P&L" value={inr(unrealized)} tone={unrealized >= 0 ? 'pos' : 'neg'} />
            </div>

            <Card>
              <div className="section-title" style={{ marginBottom: 6 }}>
                Holdings
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Stock</th>
                      <th className="num">Qty</th>
                      <th className="num">Avg cost</th>
                      <th className="num">Value</th>
                      <th className="num">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.symbol}>
                        <td>
                          <Link to={`/markets/${row.symbol}`} style={{ fontWeight: 650 }}>
                            {row.symbol}
                          </Link>
                          <div className="row-sub">{row.asset?.sector ?? sectors[row.symbol] ?? ''}</div>
                        </td>
                        <td className="num">{grouped(row.qty)}</td>
                        <td className="num">{inr(row.avgCost, 2)}</td>
                        <td className="num">{inr(row.value)}</td>
                        <td className={`num ${row.pnl >= 0 ? 'pos' : 'neg'}`}>
                          {inr(row.pnl)} <span className="muted">({pct(row.pnlPct)})</span>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 650 }}>CASH</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">{inr(cash)}</td>
                      <td className="num muted">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="disclaimer" style={{ marginTop: 8 }}>
                Cost basis {inr(costBasis)} · realised P&amp;L {inr(realized)} · unrealised {inr(unrealized)}.
              </p>
            </Card>
          </div>

          <div className="stack">
            <Card>
              <div className="section-title" style={{ marginBottom: 12 }}>
                Asset allocation
              </div>
              <div className="donut-wrap">
                <Donut slices={slices} />
                <div className="donut-legend">
                  {slices.map((slice) => (
                    <div className="donut-row" key={slice.key}>
                      <span className="swatch" style={{ background: slice.color }} />
                      <span className="label">{slice.label}</span>
                      <span className="value">{pct(slice.value / (valuation.total || 1))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <div className="section-title" style={{ marginBottom: 10 }}>
                Sector exposure
              </div>
              <div className="stack stack--sm">
                {sectorSlices.map((s) => (
                  <div key={s.sector}>
                    <div className="spread" style={{ fontSize: 12.5 }}>
                      <span className="muted">{s.sector}</span>
                      <span style={{ fontWeight: 650 }}>{pct(s.weight)}</span>
                    </div>
                    <div className="progress" style={{ marginTop: 4 }}>
                      <div
                        className="progress-bar"
                        style={{
                          width: `${Math.min(100, s.weight * 100)}%`,
                          background: s.sector === 'Cash' ? '#7D7D78' : '#FFDC16',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="disclaimer" style={{ marginTop: 10 }}>
                Sector limit {(settings.maxSectorPct * 100).toFixed(0)}% · position limit{' '}
                {(settings.maxPositionPct * 100).toFixed(0)}%.
              </p>
            </Card>

            <Note>
              <Icon name="info" className="ico" />
              <span>
                All positions are simulated. Values are marked with {market.source.label.toLowerCase()} at
                the latest session and are never sent to a broker.
              </span>
            </Note>
          </div>
        </div>

        <Section title="Performance" note="replayed from your trade history">
          <Card>
            <div className="grid grid-4 grid-metrics">
              <MetricTile label="Initial capital" value={inr(settings.initialCapital)} />
              <MetricTile label="Current value" value={inr(valuation.total)} />
              <MetricTile
                label="Return since start"
                value={pct(valuation.total > 0 ? gainFromStart / settings.initialCapital : 0)}
                tone={gainFromStart >= 0 ? 'pos' : 'neg'}
              />
              <MetricTile label="CAGR" value={summary.cagr === null ? '—' : pct(summary.cagr)} note="252 sessions/yr" />
            </div>
          </Card>
        </Section>
      </div>
    </>
  );
}
