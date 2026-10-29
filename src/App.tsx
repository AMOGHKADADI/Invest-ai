import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import Dashboard from './pages/Dashboard';
import Markets from './pages/Markets';
import AssetDetail from './pages/AssetDetail';
import Signals from './pages/Signals';
import Portfolio from './pages/Portfolio';
import Risk from './pages/Risk';
import Forecast from './pages/Forecast';
import Sentiment from './pages/Sentiment';
import Backtest from './pages/Backtest';
import Trades from './pages/Trades';
import Settings from './pages/Settings';
import More from './pages/More';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="markets" element={<Markets />} />
        <Route path="markets/:symbol" element={<AssetDetail />} />
        <Route path="signals" element={<Signals />} />
        <Route path="portfolio" element={<Portfolio />} />
        <Route path="risk" element={<Risk />} />
        <Route path="forecast" element={<Forecast />} />
        <Route path="sentiment" element={<Sentiment />} />
        <Route path="backtest" element={<Backtest />} />
        <Route path="trades" element={<Trades />} />
        <Route path="settings" element={<Settings />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
