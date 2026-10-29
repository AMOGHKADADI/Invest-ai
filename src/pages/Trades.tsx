import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../app/store';
import {
  EmptyState,
  MetricTile,
  Note,
  PageHead,
  Pills,
  SideBadge,
  SourceTag,
} from '../components/ui';
import type { TradeSide } from '../lib/types';
import { formatDateTime, grouped, inr } from '../lib/format';

type Filter = 'all' | TradeSide;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
];

export default function Trades() {
  const store = useStore();
  const { trades, market, settings } = store;
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const sorted = [...trades].sort((a, b) => b.at - a.at);
    return filter === 'all' ? sorted : sorted.filter((t) => t.side === filter);
  }, [trades, filter]);

  const counts = useMemo(() => {
    let buys = 0;
    let sells = 0;
    let fees = 0;
    for (const t of trades) {
      if (t.side === 'buy') buys += 1;
      else sells += 1;
      fees += t.fee;
    }
    return { buys, sells, fees };
  }, [trades]);

  const notional = useMemo(
    () => rows.reduce((acc, t) => acc + t.qty * t.price, 0),
    [rows],
  );

  return (
    <>
      <PageHead
        title="Trade History"
        sub="Every simulated transaction with quantity, price and fees"
        actions={<SourceTag source={market.source} at={market.dates[market.dates.length - 1]} withTime />}
      />

      <div className="stack">
        <Note tone="alert">
          <span>
            <strong>Paper trading only.</strong> These are hypothetical fills produced inside this app
            against the active dataset. No brokerage account is connected, no order ever leaves your
            browser, and no real funds are involved.
          </span>
        </Note>

        <div className="grid grid-4 grid-metrics">
          <MetricTile label="Transactions" value={trades.length} note="all time" />
          <MetricTile label="Buys" value={counts.buys} tone="pos" note="paper fills" />
          <MetricTile label="Sells" value={counts.sells} tone="neg" note="paper fills" />
          <MetricTile label="Fees paid" value={inr(counts.fees, 2)} note={`${settings.costBps} bps per fill`} />
        </div>

        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Pills label="Side filter" options={FILTERS} value={filter} onChange={setFilter} />
          <span className="section-note">
            {rows.length} shown · notional {inr(notional, 0)}
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={trades.length === 0 ? 'No paper trades yet' : `No ${filter} trades`}
            action={
              trades.length === 0 ? (
                <Link className="btn btn--outline-signal btn--sm" to="/markets">
                  Browse markets
                </Link>
              ) : (
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => setFilter('all')}>
                  Show all trades
                </button>
              )
            }
          >
            {trades.length === 0
              ? 'Open an instrument and place a paper order to start building history. Risk limits apply to every fill.'
              : 'No transaction of this type has been recorded.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Stock</th>
                  <th>Type</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Value</th>
                  <th className="num">Fee</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((trade) => (
                  <tr key={trade.id}>
                    <td className="mono nowrap">{formatDateTime(trade.at)}</td>
                    <td>
                      <Link className="mono" to={`/markets/${trade.symbol}`}>
                        {trade.symbol}
                      </Link>
                    </td>
                    <td>
                      <SideBadge side={trade.side} />
                    </td>
                    <td className="num mono">{grouped(trade.qty)}</td>
                    <td className="num mono">{inr(trade.price, 2)}</td>
                    <td className="num mono">{inr(trade.qty * trade.price, 0)}</td>
                    <td className="num mono">{inr(trade.fee, 2)}</td>
                    <td className="muted">{trade.reason}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Totals</td>
                  <td className="num mono">{inr(notional, 0)}</td>
                  <td className="num mono">{inr(rows.reduce((acc, t) => acc + t.fee, 0), 2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="disclaimer">
          Simulated results are for research and education. They are not investment advice, not a record
          of real transactions, and not a prediction of future performance.
        </p>
      </div>
    </>
  );
}
