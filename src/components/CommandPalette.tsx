import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOverlay } from '../app/overlay';
import { ALL_NAV } from '../app/nav';
import { useStore } from '../app/store';
import { downloadCsv } from '../lib/download';
import { Icon, type IconName } from './ui';

interface PaletteItem {
  id: string;
  label: string;
  sub: string;
  group: string;
  icon: IconName;
  run: () => void;
}

/**
 * ⌘K / Ctrl+K palette: jump to any screen, open any instrument, run the
 * handful of actions that are useful from anywhere. Keyboard-first,
 * minimal chrome.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const store = useStore();
  const { toast } = useOverlay();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = ALL_NAV.map((n) => ({
      id: `page:${n.to}`,
      label: n.label,
      sub: n.to === '/' ? 'Dashboard' : `Go to ${n.to.slice(1)}`,
      group: 'Pages',
      icon: n.icon,
      run: () => navigate(n.to),
    }));

    const assets: PaletteItem[] = store.assets.map((a) => ({
      id: `asset:${a.symbol}`,
      label: a.symbol,
      sub: `${a.name} · ${a.sector}`,
      group: 'Instruments',
      icon: 'markets',
      run: () => navigate(`/markets/${a.symbol}`),
    }));

    const actions: PaletteItem[] = [
      {
        id: 'act:lstm',
        label: 'Train LSTM model',
        sub: 'Forecast · trains in this browser',
        group: 'Actions',
        icon: 'forecast',
        run: () => navigate('/forecast'),
      },
      {
        id: 'act:dqn',
        label: 'Train DQN agent',
        sub: 'AI Signals · trains in this browser',
        group: 'Actions',
        icon: 'spark',
        run: () => navigate('/signals'),
      },
      {
        id: 'act:export',
        label: 'Export trades CSV',
        sub: `Download ${store.trades.length} paper trades`,
        group: 'Actions',
        icon: 'trades',
        run: () => {
          if (store.trades.length === 0) {
            toast('No trades to export yet.', 'warn');
            return;
          }
          downloadCsv('investai-trades.csv', [
            ['timestamp', 'date', 'symbol', 'side', 'quantity', 'price', 'fee', 'mode', 'reason'],
            ...store.trades.map((t) => [
              t.at,
              new Date(t.at).toISOString(),
              t.symbol,
              t.side,
              t.qty,
              t.price,
              t.fee,
              t.mode,
              t.reason,
            ]),
          ]);
          toast(`Exported ${store.trades.length} trades to CSV.`, 'ok');
        },
      },
    ];

    const all = [...assets, ...pages, ...actions];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.sub.toLowerCase().includes(q),
    );
  }, [navigate, query, store, toast]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[active];
        if (item) {
          onClose();
          item.run();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, items, onClose, open]);

  if (!open) return null;

  let lastGroup = '';

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            aria-label="Search instruments, pages and actions"
            placeholder="Search instruments, pages, actions…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>esc</kbd>
        </div>

        {items.length === 0 ? (
          <div className="palette-empty">No matches for “{query}”.</div>
        ) : (
          <ul className="palette-list" role="listbox" aria-label="Results">
            {items.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <li key={item.id}>
                  {header ? <div className="palette-group">{header}</div> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={`palette-item${i === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      onClose();
                      item.run();
                    }}
                  >
                    <Icon name={item.icon} />
                    <span className="palette-label">{item.label}</span>
                    <span className="palette-sub">{item.sub}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>⏎ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
