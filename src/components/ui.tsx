import type { ReactNode } from 'react';
import type { DataSource, SignalSide } from '../lib/types';
import { formatDateTime } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

export type IconName =
  | 'home'
  | 'markets'
  | 'trade'
  | 'portfolio'
  | 'more'
  | 'risk'
  | 'forecast'
  | 'sentiment'
  | 'backtest'
  | 'trades'
  | 'settings'
  | 'star'
  | 'search'
  | 'close'
  | 'info'
  | 'spark'
  | 'arrow';

const PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  markets: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="M7.5 15.5l3.5-4 3 2.5 4.5-6" />
    </>
  ),
  trade: <path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z" />,
  portfolio: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
  risk: <path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6l7-3Z" />,
  forecast: (
    <>
      <path d="M3 16.5 8 10l3.5 3.5L16 7l5 6" />
      <path d="M3 21h18" strokeDasharray="2 3" />
    </>
  ),
  sentiment: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h6M7 13h10M7 17h4" />
    </>
  ),
  backtest: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  trades: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </>
  ),
  star: (
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8L12 4Z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  spark: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2" />,
  arrow: <path d="M7 17 17 7M9 7h8v8" />,
};

export function Icon({ name, className = 'ico' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className = '',
  tone = 'default',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'flat' | 'yellow';
  as?: 'div' | 'section' | 'article';
}) {
  const toneClass = tone === 'yellow' ? ' card--yellow' : tone === 'flat' ? ' card--flat' : '';
  return <Tag className={`card${toneClass} ${className}`}>{children}</Tag>;
}

export function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <div className="inline">
          {note ? <span className="section-note">{note}</span> : null}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="inline">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

export function MetricTile({
  label,
  value,
  note,
  tone = 'flat',
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'pos' | 'neg' | 'flat';
}) {
  const toneClass = tone === 'pos' ? ' pos' : tone === 'neg' ? ' neg' : '';
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className={`tile-value${toneClass}`}>{value}</div>
      {note ? <div className="tile-note">{note}</div> : null}
    </div>
  );
}

export function SideBadge({ side }: { side: SignalSide | 'buy' | 'sell' }) {
  const cls = side === 'buy' ? 'badge--buy' : side === 'sell' ? 'badge--sell' : 'badge--hold';
  return <span className={`badge ${cls}`}>{side}</span>;
}

export function Pills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="pills" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`pill${option.value === value ? ' active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={`tab${option.value === value ? ' active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="control-row">
      <div>
        <div className="setting-name">{label}</div>
        {hint ? <div className="setting-desc">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <div>{children}</div>
      {action ? <div className="inline" style={{ justifyContent: 'center', marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="error-box" role="alert">{children}</div>;
}

export function Note({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'alert' | 'ok';
}) {
  const cls = tone === 'alert' ? ' note--alert' : tone === 'ok' ? ' note--ok' : '';
  return <div className={`note${cls}`}>{children}</div>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="stack stack--sm">
      <div className="spread">
        <span className="section-note">{label ?? 'Progress'}</span>
        <span className="section-note mono">{pct}%</span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Data provenance chip — every figure in the app is tagged with one. */
export function SourceTag({
  source,
  at,
  withTime = false,
}: {
  source: DataSource;
  at?: number;
  withTime?: boolean;
}) {
  const kindClass =
    source.kind === 'demo' ? '' : source.kind === 'imported' ? ' tag--live' : ' tag--model';
  return (
    <span className={`tag${kindClass}`} title={source.note}>
      <span className="tag-dot" />
      {source.label}
      {withTime && at ? ` · ${formatDateTime(at)}` : ''}
    </span>
  );
}

export function Avatar({ symbol }: { symbol: string }) {
  return <span className="avatar">{symbol.slice(0, 3)}</span>;
}
