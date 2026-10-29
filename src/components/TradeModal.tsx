import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { useOverlay } from '../app/overlay';
import { Icon, Pills } from './ui';
import { inr, pct } from '../lib/format';

/**
 * The paper order ticket, reachable from any screen (signal cards, command
 * palette, asset pages). Shows a live risk-layer preview — trims and blocks —
 * before anything is submitted, then reports the outcome as a toast.
 */
export function TradeModal({
  target,
  onClose,
}: {
  target: { symbol: string; side: 'buy' | 'sell' } | null;
  onClose: () => void;
}) {
  const store = useStore();
  const { toast } = useOverlay();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState('1');

  useEffect(() => {
    if (!target) return;
    setSide(target.side);
    setQty('1');
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  const asset = target ? store.assets.find((a) => a.symbol === target.symbol) : null;
  const symbol = target?.symbol ?? '';
  const price = store.prices[symbol] ?? 0;
  const prev = store.previous[symbol];
  const changePct = prev && prev > 0 ? (price - prev) / prev : null;

  const parsedQty = Number(qty);
  const qtyValid = Number.isInteger(parsedQty) && parsedQty > 0;

  const preview = target && qtyValid ? store.previewOrder(symbol, side, parsedQty) : null;

  const holding = store.holdings.find((h) => h.symbol === symbol);
  const notional = qtyValid ? price * parsedQty : 0;

  if (!target || !asset) return null;

  const blocking = preview && !preview.allowed;
  const shownNotes = (preview?.notes ?? []).filter((n) => !(n.code === 'BAD_QTY'));

  const submit = () => {
    if (!qtyValid) return;
    const outcome = store.placeOrder(symbol, side, parsedQty);
    toast(outcome.message, outcome.ok ? 'ok' : 'error');
    if (outcome.ok) onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Paper order: ${symbol}`}>
        <div className="modal-head">
          <div>
            <div className="row-name" style={{ fontSize: 17 }}>
              {symbol}
            </div>
            <div className="row-sub">{asset.name} · {asset.sector}</div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close order ticket">
            <Icon name="close" />
          </button>
        </div>

        <div className="modal-price">
          <span className="tile-value">{inr(price, 2)}</span>
          {changePct !== null ? (
            <span className={`row-change ${changePct >= 0 ? 'pos' : 'neg'}`}>{pct(changePct)}</span>
          ) : null}
          <span className="tag">Paper · demo data</span>
        </div>

        <Pills
          label="Order side"
          options={[
            { value: 'buy', label: 'Buy' },
            { value: 'sell', label: 'Sell' },
          ]}
          value={side}
          onChange={setSide}
        />

        <label className="field" style={{ marginTop: 14 }}>
          <span className="field-label">Quantity (shares)</span>
          <input
            className="input"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={qty}
            autoFocus
            onChange={(e) => setQty(e.target.value)}
          />
        </label>

        <div className="stack stack--sm" style={{ marginTop: 4 }}>
          <div className="kv">
            <span className="k">Notional</span>
            <span className="v mono">{qtyValid ? inr(notional, 2) : '—'}</span>
          </div>
          <div className="kv">
            <span className="k">Fee ({store.settings.costBps} bps)</span>
            <span className="v mono">{preview?.allowed ? inr(preview.fee, 2) : '—'}</span>
          </div>
          <div className="kv">
            <span className="k">Available cash</span>
            <span className="v mono">{inr(store.cash, 2)}</span>
          </div>
          {holding ? (
            <div className="kv">
              <span className="k">Position</span>
              <span className="v mono">
                {holding.qty} @ {inr(holding.avgCost, 2)}
              </span>
            </div>
          ) : null}
        </div>

        {shownNotes.length > 0 ? (
          <div className={`note ${blocking ? 'note--alert' : ''}`} style={{ marginTop: 12 }}>
            {shownNotes.map((n) => (
              <div key={n.code}>{n.message}</div>
            ))}
          </div>
        ) : preview && preview.allowed ? (
          <div className="note note--ok" style={{ marginTop: 12 }}>
            Ready: {side} {preview.qty} {symbol} at {inr(preview.price, 2)}.
          </div>
        ) : null}

        <button
          type="button"
          className={`btn btn--block ${side === 'buy' ? 'btn--primary' : 'btn--danger'}`}
          style={{ marginTop: 14 }}
          disabled={!qtyValid || blocking === true}
          onClick={submit}
        >
          Place paper {side} order
        </button>

        <p className="disclaimer" style={{ marginTop: 10, marginBottom: 0 }}>
          Simulated execution against {store.market.source.label.toLowerCase()} — no brokerage is
          connected and no real funds are involved.
        </p>
      </div>
    </div>
  );
}
