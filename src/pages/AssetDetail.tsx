import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore, type OrderOutcome } from '../app/store';
import { SignalCard } from '../components/SignalCard';
import { LineChart, type LineSeries } from '../components/charts';
import {
  Card,
  EmptyState,
  ErrorBox,
  Icon,
  MetricTile,
  Note,
  PageHead,
  Pills,
  Section,
  SourceTag,
} from '../components/ui';
import { computeFee } from '../lib/portfolio';
import { formatShortDate, grouped, inr, pct, pctPoints } from '../lib/format';

const RANGES = [
  { value: '3M', label: '3M', sessions: 63 },
  { value: '6M', label: '6M', sessions: 126 },
  { value: '1Y', label: '1Y', sessions: 252 },
  { value: 'ALL', label: 'ALL', sessions: Number.POSITIVE_INFINITY },
] as const;

type RangeValue = (typeof RANGES)[number]['value'];

export default function AssetDetail() {
  const { symbol = '' } = useParams();
  const store = useStore();
  const { market, prices, previous, watchlist, toggleWatch, settings, holdings } = store;
  const asset = market.assets.find((a) => a.symbol === symbol);
  const bars = market.bars[symbol];

  const [range, setRange] = useState<RangeValue>('6M');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState('1');
  const [result, setResult] = useState<OrderOutcome | null>(null);

  const features = asset ? store.featuresFor(symbol) : null;
  const signal = asset ? store.signalFor(symbol) : null;
  const forecast = store.forecastFor(symbol);
  const holding = holdings.find((h) => h.symbol === symbol);

  const price = prices[symbol];
  const prev = previous[symbol];
  const change = price && prev ? (price - prev) / prev : null;

  const series: LineSeries[] = useMemo(() => {
    if (!bars || bars.length === 0) return [];
    const sessions = Math.min(range === 'ALL' ? bars.length : RANGES.find((r) => r.value === range)!.sessions, bars.length);
    const slice = bars.slice(-sessions);
    const closes = slice.map((b) => b.c);
    const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
    return [
      {
        id: 'price',
        label: 'Close',
        points: slice.map((b) => ({ x: b.t, y: b.c })),
        color: '#FFDC16',
        area: true,
      },
      {
        id: 'mean',
        label: `Mean of window (${avg.toFixed(0)})`,
        points: slice.map((b) => ({ x: b.t, y: avg })),
        color: '#7D7D78',
        dashed: true,
      },
    ];
  }, [bars, range]);

  if (!asset || !bars || bars.length === 0) {
    return (
      <>
        <PageHead title={symbol || 'Unknown asset'} sub="Instrument not found in the active dataset" />
        <EmptyState
          title={`No data for ${symbol || 'this symbol'}`}
          action={
            <Link className="btn btn--primary btn--sm" to="/markets">
              Back to markets
            </Link>
          }
        >
          The active dataset does not include this instrument. Import a CSV or switch back to demo data
          in Settings.
        </EmptyState>
      </>
    );
  }

  const last = bars[bars.length - 1];
  const index = bars.length - 1;
  const rsiValue = features?.rsi14[index] ?? null;
  const histValue = features?.macd.histogram[index] ?? null;
  const ema20 = features?.ema20[index] ?? null;
  const ema50 = features?.ema50[index] ?? null;
  const momentum = features?.mom20[index] ?? 0;
  const vol = features?.vol20[index] ?? null;
  const annualVol = vol !== null ? vol * Math.sqrt(252) : null;

  const numericQty = Number(qty);
  const feePreview =
    Number.isFinite(numericQty) && numericQty > 0 && price
      ? computeFee(side, Math.floor(numericQty), price, settings.costBps)
      : null;

  const submit = () => {
    const quantity = Math.floor(Number(qty));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setResult({
        ok: false,
        code: 'BAD_QTY',
        appliedQty: 0,
        message: 'Enter a whole number of shares greater than zero.',
      });
      return;
    }
    setResult(store.placeOrder(symbol, side, quantity));
  };

  return (
    <>
      <PageHead
        title={`${asset.symbol}`}
        sub={`${asset.name} · ${asset.exchange} · ${asset.sector}`}
        actions={
          <>
            <SourceTag source={market.source} at={last.t} withTime />
            <button
              type="button"
              className={`btn ${watchlist.includes(symbol) ? 'btn--primary' : 'btn--ghost'} btn--sm`}
              onClick={() => toggleWatch(symbol)}
              aria-pressed={watchlist.includes(symbol)}
            >
              <Icon name="star" className="ico" />
              {watchlist.includes(symbol) ? 'Watching' : 'Watch'}
            </button>
          </>
        }
      />

      <div className="stack">
        <Card tone="yellow">
          <div className="spread">
            <div>
              <div className="card-label">Last price</div>
              <div className="card-value">{inr(price ?? last.c, 2)}</div>
              <div className="card-label" style={{ marginTop: 4 }}>
                Session {formatShortDate(last.t)} · volume {grouped(last.v)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                className="card-value card-value--sm"
                style={{ color: (change ?? 0) >= 0 ? '#0b7a3e' : '#8a0009' }}
              >
                {pct(change)}
              </div>
              <div className="card-label">vs previous close</div>
            </div>
          </div>
        </Card>

        <div className="grid grid-main-aside">
          <div className="stack">
            <Card>
              <div className="spread" style={{ marginBottom: 14 }}>
                <div className="section-title">Price history</div>
                <Pills
                  label="Chart range"
                  options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
                  value={range}
                  onChange={setRange}
                />
              </div>
              <LineChart series={series} height={260} formatY={(v) => v.toFixed(0)} />
            </Card>

            <div className="grid grid-4 grid-metrics">
              <MetricTile
                label="RSI(14)"
                value={rsiValue === null ? '—' : rsiValue.toFixed(1)}
                note={
                  rsiValue === null
                    ? 'warm-up'
                    : rsiValue >= 70
                      ? 'overbought'
                      : rsiValue <= 30
                        ? 'oversold'
                        : 'neutral zone'
                }
              />
              <MetricTile
                label="MACD hist"
                value={histValue === null ? '—' : histValue.toFixed(2)}
                tone={histValue === null ? 'flat' : histValue >= 0 ? 'pos' : 'neg'}
                note={histValue !== null && histValue >= 0 ? 'above signal' : 'below signal'}
              />
              <MetricTile
                label="20-session mom."
                value={pctPoints(momentum)}
                tone={momentum >= 0 ? 'pos' : 'neg'}
                note="price change"
              />
              <MetricTile
                label="Volatility"
                value={annualVol === null ? '—' : pct(annualVol)}
                note="20d, annualised"
              />
            </div>

            <Card>
              <div className="section-title" style={{ marginBottom: 10 }}>
                Trend structure
              </div>
              <div className="grid grid-3" style={{ gap: 10 }}>
                <div className="kv">
                  <span className="k">EMA(20)</span>
                  <span className="v">{ema20 ? inr(ema20, 2) : '—'}</span>
                </div>
                <div className="kv">
                  <span className="k">EMA(50)</span>
                  <span className="v">{ema50 ? inr(ema50, 2) : '—'}</span>
                </div>
                <div className="kv">
                  <span className="k">Close vs EMA(50)</span>
                  <span className={`v ${ema50 && price >= ema50 ? 'pos' : 'neg'}`}>
                    {ema50 ? pct((price - ema50) / ema50) : '—'}
                  </span>
                </div>
              </div>
            </Card>

            {signal ? (
              <Section title="AI signal" note="computed from the features above">
                <SignalCard signal={signal} changePct={change} showLink={false} />
              </Section>
            ) : null}

            {forecast ? (
              <Card>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <div className="section-title">LSTM forecast</div>
                  <Link className="section-note" to="/forecast" style={{ color: '#ffdc16' }}>
                    Model detail →
                  </Link>
                </div>
                <div className="grid grid-3" style={{ gap: 10 }}>
                  <div className="kv">
                    <span className="k">Current</span>
                    <span className="v">{inr(price, 2)}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Next session</span>
                    <span className="v">{inr(forecast[0].predicted, 2)}</span>
                  </div>
                  <div className="kv">
                    <span className="k">7-session implied</span>
                    <span className={`v ${forecast[0].predicted >= price ? 'pos' : 'neg'}`}>
                      {pct((forecast[0].predicted - price) / price)}
                    </span>
                  </div>
                </div>
                <p className="disclaimer" style={{ marginTop: 8 }}>
                  Model: LSTM ({store.lstmMeta?.config.hidden} units, seq {store.lstmMeta?.config.seqLen}),
                  trained {store.lstmMeta ? new Date(store.lstmMeta.trainedAt).toLocaleString() : ''}. Band is a
                  heuristic interval from validation residuals, not a calibrated prediction interval.
                </p>
              </Card>
            ) : null}
          </div>

          <div className="stack">
            <Card>
              <div className="section-title" style={{ marginBottom: 12 }}>
                Paper order
              </div>
              <div className="pills" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className={`pill${side === 'buy' ? ' active' : ''}`}
                  onClick={() => setSide('buy')}
                >
                  Buy
                </button>
                <button
                  type="button"
                  className={`pill${side === 'sell' ? ' active' : ''}`}
                  onClick={() => setSide('sell')}
                >
                  Sell
                </button>
              </div>

              <div className="stack stack--sm">
                <label className="field">
                  <span className="field-label">Quantity (shares)</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    step={1}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    inputMode="numeric"
                  />
                </label>

                <div className="kv">
                  <span className="k">Est. price</span>
                  <span className="v">{inr(price, 2)}</span>
                </div>
                <div className="kv">
                  <span className="k">Notional</span>
                  <span className="v">{feePreview ? inr(feePreview.gross) : '—'}</span>
                </div>
                <div className="kv">
                  <span className="k">Fee ({settings.costBps} bps)</span>
                  <span className="v">{feePreview ? inr(feePreview.fee, 2) : '—'}</span>
                </div>
                <div className="kv">
                  <span className="k">{side === 'buy' ? 'Cash required' : 'Cash received'}</span>
                  <span className="v">{feePreview ? inr(feePreview.net) : '—'}</span>
                </div>
                <div className="kv">
                  <span className="k">Available cash</span>
                  <span className="v">{inr(store.cash)}</span>
                </div>
                {holding ? (
                  <div className="kv">
                    <span className="k">Position</span>
                    <span className="v">
                      {grouped(holding.qty)} @ {inr(holding.avgCost, 2)}
                    </span>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className={`btn btn--block ${side === 'buy' ? 'btn--primary' : 'btn--danger'}`}
                style={{ marginTop: 14 }}
                onClick={submit}
              >
                Place paper {side} order
              </button>

              {result ? (
                <div style={{ marginTop: 10 }}>
                  {result.ok ? (
                    <Note tone="ok">{result.message}</Note>
                  ) : (
                    <ErrorBox>{result.message}</ErrorBox>
                  )}
                </div>
              ) : null}

              <p className="disclaimer" style={{ marginTop: 10 }}>
                Simulated execution at the latest session close. No real brokerage is connected and no
                funds move.
              </p>
            </Card>

            <Card>
              <div className="section-title" style={{ marginBottom: 10 }}>
                Risk context
              </div>
              <div className="kv">
                <span className="k">Position limit</span>
                <span className="v">{(settings.maxPositionPct * 100).toFixed(0)}% of equity</span>
              </div>
              <div className="kv">
                <span className="k">Stop loss</span>
                <span className="v">-{(settings.stopLossPct * 100).toFixed(0)}%</span>
              </div>
              <div className="kv">
                <span className="k">Drawdown halt</span>
                <span className="v">-{(settings.drawdownHaltPct * 100).toFixed(0)}%</span>
              </div>
              <div className="kv">
                <span className="k">Current portfolio drawdown</span>
                <span className="v neg">{pct(-store.drawdown)}</span>
              </div>
              <div className="inline" style={{ marginTop: 12 }}>
                <Link className="btn btn--ghost btn--sm" to="/risk">
                  <Icon name="risk" className="ico" /> Manage limits
                </Link>
              </div>
            </Card>

            <Note>
              <Icon name="info" className="ico" />
              <span>{market.source.note}</span>
            </Note>
          </div>
        </div>
      </div>
    </>
  );
}
