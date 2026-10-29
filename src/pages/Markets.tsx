import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../app/store';
import { Avatar, EmptyState, Icon, PageHead, SourceTag, Tabs } from '../components/ui';
import { inr, pct } from '../lib/format';

type TabValue = 'gainers' | 'losers' | 'watchlist';

export default function Markets() {
  const { market, assets, prices, previous, watchlist, toggleWatch } = useStore();
  const [tab, setTab] = useState<TabValue>('gainers');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const list = assets
      .map((asset) => {
        const price = prices[asset.symbol];
        const prev = previous[asset.symbol];
        const change = price && prev ? (price - prev) / prev : null;
        return { asset, price: price ?? 0, change };
      })
      .filter((row) => row.price > 0)
      .filter((row) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return (
          row.asset.symbol.toLowerCase().includes(q) || row.asset.name.toLowerCase().includes(q)
        );
      });

    if (tab === 'watchlist') return list.filter((row) => watchlist.includes(row.asset.symbol));
    const sorted = [...list].sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
    return tab === 'gainers' ? sorted : sorted.reverse();
  }, [assets, prices, previous, query, tab, watchlist]);

  const benchmark = useMemo(() => {
    const bars = market.benchmark;
    if (!bars || bars.length < 2) return null;
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    return { value: last.c, change: (last.c - prev.c) / prev.c };
  }, [market.benchmark]);

  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    let flat = 0;
    for (const asset of assets) {
      const price = prices[asset.symbol];
      const prev = previous[asset.symbol];
      if (!price || !prev) continue;
      const change = (price - prev) / prev;
      if (change > 0.0001) up += 1;
      else if (change < -0.0001) down += 1;
      else flat += 1;
    }
    return { up, down, flat };
  }, [assets, prices, previous]);

  const baskets = useMemo(() => {
    const groups = new Map<string, { sum: number; count: number }>();
    for (const asset of assets) {
      const price = prices[asset.symbol];
      const prev = previous[asset.symbol];
      if (!price || !prev) continue;
      const group = groups.get(asset.sector) ?? { sum: 0, count: 0 };
      group.sum += (price - prev) / prev;
      group.count += 1;
      groups.set(asset.sector, group);
    }
    return [...groups.entries()]
      .map(([sector, g]) => ({ sector, change: g.sum / g.count, count: g.count }))
      .filter((g) => g.count >= 2)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 2);
  }, [assets, previous, prices]);

  return (
    <>
      <PageHead
        title="Market"
        sub="Search the universe, open a chart and place paper orders"
        actions={<SourceTag source={market.source} />}
      />

      <div className="stack">
        <label className="field">
          <span className="field-label" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
            Search stocks
          </span>
          <input
            className="input input--search"
            type="search"
            placeholder="Search stocks (e.g. RELIANCE, TCS)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <div className="pills">
          {benchmark ? (
            <span className="tag" style={{ padding: '7px 13px', fontSize: 12.5 }}>
              NIFTY 50 <strong style={{ color: '#f7f7f4' }}>{benchmark.value.toFixed(2)}</strong>{' '}
              <span className={benchmark.change >= 0 ? 'pos' : 'neg'}>{pct(benchmark.change)}</span>
            </span>
          ) : null}
          <span
            className="tag"
            style={{ padding: '7px 13px', fontSize: 12.5 }}
            title={`Breadth across ${breadth.up + breadth.down + breadth.flat} instruments today`}
          >
            Breadth{' '}
            <strong style={{ color: '#37D67A' }}>{breadth.up}↑</strong>
            <span className="muted"> / </span>
            <strong style={{ color: '#FF2D3D' }}>{breadth.down}↓</strong>
            {breadth.flat > 0 ? <span className="muted"> · {breadth.flat} flat</span> : null}
          </span>
          {baskets.map((b) => (
            <span className="tag" style={{ padding: '7px 13px', fontSize: 12.5 }} key={b.sector}>
              {b.sector} basket{' '}
              <span className={b.change >= 0 ? 'pos' : 'neg'}>{pct(b.change)}</span>
            </span>
          ))}
        </div>

        <Tabs
          label="Market filter"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'gainers', label: 'Top gainers' },
            { value: 'losers', label: 'Top losers' },
            { value: 'watchlist', label: 'Watchlist' },
          ]}
        />

        {rows.length === 0 ? (
          <EmptyState
            title={tab === 'watchlist' ? 'Your watchlist is empty' : 'No matching instruments'}
            action={
              tab === 'watchlist' ? (
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => setTab('gainers')}>
                  Browse top gainers
                </button>
              ) : undefined
            }
          >
            {tab === 'watchlist'
              ? 'Star an instrument from any list to track it here.'
              : 'Try a different symbol or company name.'}
          </EmptyState>
        ) : (
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className="list">
              {rows.map(({ asset, price, change }) => {
                const starred = watchlist.includes(asset.symbol);
                return (
                  <div className="row row--link" key={asset.symbol}>
                    <Avatar symbol={asset.symbol} />
                    <Link className="row-main" to={`/markets/${asset.symbol}`}>
                      <div className="row-name">{asset.symbol}</div>
                      <div className="row-sub">
                        {asset.name} · {asset.sector}
                      </div>
                    </Link>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      aria-pressed={starred}
                      aria-label={`${starred ? 'Remove' : 'Add'} ${asset.symbol} ${
                        starred ? 'from' : 'to'
                      } watchlist`}
                      onClick={() => toggleWatch(asset.symbol)}
                      style={{ color: starred ? '#FFDC16' : '#7d7d78', borderColor: starred ? '#FFDC16' : undefined }}
                    >
                      <Icon name="star" className="ico" />
                    </button>
                    <Link className="row-end" to={`/markets/${asset.symbol}`}>
                      <div className="row-price">{inr(price, 2)}</div>
                      <div className={`row-change ${change !== null && change >= 0 ? 'pos' : 'neg'}`}>
                        {pct(change)}
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="disclaimer">
          Prices shown are {market.source.label.toLowerCase()} — {market.source.note} Sector baskets are
          simple averages of the constituent daily changes, not published index levels.
        </p>
      </div>
    </>
  );
}
