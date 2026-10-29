import type { IconName } from '../components/ui';

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
