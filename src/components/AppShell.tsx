import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon, type IconName } from './ui';
import { useStore } from '../app/store';
import { formatShortDate } from '../lib/format';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'home', end: true },
  { to: '/markets', label: 'Markets', icon: 'markets' },
  { to: '/signals', label: 'AI Signals', icon: 'trade' },
  { to: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
];

export const RESEARCH_NAV: NavItem[] = [
  { to: '/forecast', label: 'LSTM Forecast', icon: 'forecast' },
  { to: '/sentiment', label: 'Sentiment', icon: 'sentiment' },
  { to: '/backtest', label: 'Backtest', icon: 'backtest' },
  { to: '/risk', label: 'Risk Management', icon: 'risk' },
];

export const ACTIVITY_NAV: NavItem[] = [
  { to: '/trades', label: 'Trade History', icon: 'trades' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...RESEARCH_NAV, ...ACTIVITY_NAV];

const BOTTOM_NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/markets', label: 'Markets', icon: 'markets' },
  { to: '/signals', label: 'Trade', icon: 'trade' },
  { to: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { to: '/more', label: 'More', icon: 'more' },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  '/': { title: 'Dashboard', sub: 'Portfolio overview and latest AI output' },
  '/markets': { title: 'Markets', sub: 'Prices, indicators and asset detail' },
  '/signals': { title: 'AI Signals', sub: 'Buy / Sell / Hold with reasoning' },
  '/portfolio': { title: 'Portfolio', sub: 'Holdings, allocation and performance' },
  '/risk': { title: 'Risk Management', sub: 'Limits, controls and live assessment' },
  '/forecast': { title: 'LSTM Price Prediction', sub: 'Training, evaluation and 7-day forecast' },
  '/sentiment': { title: 'News Sentiment', sub: 'Financial text classification' },
  '/backtest': { title: 'Backtesting', sub: 'Strategy vs benchmark on historical sessions' },
  '/trades': { title: 'Trade History', sub: 'Paper-trading records' },
  '/settings': { title: 'Settings', sub: 'Trading preferences, models and data' },
  '/more': { title: 'More', sub: 'All sections' },
};

export function AppShell() {
  const { market, dataNotice } = useStore();
  const location = useLocation();
  const base = `/${location.pathname.split('/')[1] ?? ''}`;
  const meta = TITLES[base] ?? TITLES['/'];
  const lastSession = market.dates.length > 0 ? market.dates[market.dates.length - 1] : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#131313" />
            <rect x="14" y="34" width="7" height="16" rx="2" fill="#F7F7F4" />
            <rect x="26" y="26" width="7" height="24" rx="2" fill="#FFDC16" />
            <rect x="38" y="18" width="7" height="32" rx="2" fill="#FFDC16" />
            <path
              d="M12 26 L26 18 L38 22 L52 10"
              fill="none"
              stroke="#FF2D3D"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M44 10 H52 V18" fill="none" stroke="#FF2D3D" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <div>
            <div className="brand-name">
              Invest<span>AI</span>
            </div>
            <div className="brand-tag">Research terminal</div>
          </div>
        </div>

        <nav className="nav" aria-label="Primary">
          {PRIMARY_NAV.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
          <div className="nav-group-label">Research</div>
          {RESEARCH_NAV.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
          <div className="nav-group-label">Activity</div>
          {ACTIVITY_NAV.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </nav>

        <div className="sidebar-foot">
          <div>
            Data: <strong style={{ color: '#b4b4ae' }}>{market.source.label}</strong>
          </div>
          {lastSession ? <div>Last session: {formatShortDate(lastSession)}</div> : null}
          <div style={{ marginTop: 6 }}>Paper trading only · no real orders</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="topbar-title">{meta.title}</div>
            <div className="topbar-sub">{meta.sub}</div>
          </div>
          <div className="inline" style={{ justifyContent: 'flex-end' }}>
            <span className="tag" title={market.disclaimer}>
              <span className="tag-dot" />
              {market.source.kind === 'demo' ? 'Demo data' : 'Imported CSV'}
            </span>
            {lastSession ? <span className="tag">As of {formatShortDate(lastSession)}</span> : null}
          </div>
        </header>

        <main className="content">
          {dataNotice ? (
            <div className="note note--ok" style={{ marginBottom: 16 }}>
              {dataNotice}
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Mobile">
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'active' : undefined)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function NavRow({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </NavLink>
  );
}
