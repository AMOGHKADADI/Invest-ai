import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Asset, Bar, DataSource, Holding, Signal, SignalSide, Trade } from '../lib/types';
import { BENCHMARK_ASSET, DEMO_SOURCE, UNIVERSE, getDemoMarket } from '../lib/demoData';
import { parseOhlcvCsv, CsvImportError } from '../lib/csv';
import { applyFill, computeFee, valuePortfolio } from '../lib/portfolio';
import { DEFAULT_RISK_SETTINGS, drawdownFromCurve, evaluateOrder, type RiskSettings } from '../lib/risk';
import { computeFeatures, signalAt, type AssetFeatures } from '../lib/signals';
import {
  buildDemoHeadlines,
  defaultAnalyzer,
  sentimentUpTo,
  type Headline,
} from '../lib/sentiment';
import {
  DEFAULT_LSTM_CONFIG,
  deserialiseModel,
  forecastPrices,
  serialiseModel,
  trainLstm as trainLstmModel,
  type ForecastMetrics,
  type ForecastPoint,
  type LstmConfig,
  type LstmModel,
  type TrainHistory,
  type Split,
} from '../lib/lstm';
import {
  DEFAULT_DQN_CONFIG,
  deserialiseDqn,
  serialiseDqn,
  trainDqn as trainDqnAgent,
  TradingEnv,
  type DuelingQNet,
  type DqnConfig,
  type DqnTrainResult,
} from '../lib/dqn';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Settings extends RiskSettings {
  /** Each risk control can be switched off; disabled controls never block a trade. */
  stopLossEnabled: boolean;
  positionSizingEnabled: boolean;
  diversificationEnabled: boolean;
  drawdownHaltEnabled: boolean;
  lstmEnabled: boolean;
  sentimentEnabled: boolean;
  dqnEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_RISK_SETTINGS,
  stopLossEnabled: true,
  positionSizingEnabled: true,
  diversificationEnabled: true,
  drawdownHaltEnabled: true,
  lstmEnabled: true,
  sentimentEnabled: true,
  dqnEnabled: true,
};

export interface MarketData {
  dates: number[];
  bars: Record<string, Bar[]>;
  benchmark: Bar[] | null;
  assets: Asset[];
  benchmarkAsset: Asset | null;
  source: DataSource;
  disclaimer: string;
}

export type ModelStatus = 'idle' | 'training' | 'ready' | 'error';

export interface LstmMeta {
  symbol: string;
  trainedAt: number;
  config: LstmConfig;
  metrics: ForecastMetrics;
  history: TrainHistory;
  split: Split;
  bandWidth: number;
  sessions: number;
}

export interface DqnMeta {
  symbol: string;
  trainedAt: number;
  config: DqnConfig;
  trainReturn: number;
  testReturn: number;
  buyHoldReturn: number;
  episodes: number;
  gradientSteps: number;
  note: string;
}

export interface OrderOutcome {
  ok: boolean;
  message: string;
  code: string;
  appliedQty: number;
  trade?: Trade;
}

interface Persisted {
  settings: Settings;
  cash: number;
  holdings: Holding[];
  trades: Trade[];
  watchlist: string[];
  lstmJson: string | null;
  lstmMeta: LstmMeta | null;
  dqnJson: string | null;
  dqnMeta: DqnMeta | null;
}

export interface StoreValue {
  settings: Settings;
  /** Settings with disabled controls neutralised — what enforcement actually uses. */
  riskSettings: RiskSettings;
  market: MarketData;
  assets: Asset[];
  prices: Record<string, number>;
  previous: Record<string, number>;
  sectors: Record<string, string>;
  cash: number;
  holdings: Holding[];
  trades: Trade[];
  watchlist: string[];
  valuation: { total: number; invested: number; cash: number };
  /** Portfolio equity reconstructed by replaying the paper-trade history. */
  equityCurve: number[];
  drawdown: number;
  dayChangePct: number | null;
  headlines: Headline[];
  lstmStatus: ModelStatus;
  lstmProgress: number;
  lstmError: string | null;
  lstmMeta: LstmMeta | null;
  dqnStatus: ModelStatus;
  dqnProgress: number;
  dqnError: string | null;
  dqnMeta: DqnMeta | null;
  dataNotice: string | null;
  featuresFor: (symbol: string) => AssetFeatures | null;
  signalFor: (symbol: string) => Signal | null;
  sentimentAt: (symbol: string, at: number) => number | null;
  forecastFor: (symbol: string) => ForecastPoint[] | null;
  dqnActionFor: (symbol: string) => SignalSide | null;
  placeOrder: (symbol: string, side: 'buy' | 'sell', qty: number) => OrderOutcome;
  resetPortfolio: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  toggleWatch: (symbol: string) => void;
  importCsv: (text: string) => { ok: boolean; message: string };
  useDemoData: () => void;
  trainLstm: (symbol: string) => Promise<void>;
  trainDqn: (symbol: string) => Promise<void>;
  clearModels: () => void;
}

const STORAGE_KEY = 'investai.state.v1';

const StoreContext = createContext<StoreValue | null>(null);

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadPersisted(), []);

  const [settings, setSettings] = useState<Settings>(initial.settings ?? DEFAULT_SETTINGS);
  const [account, setAccount] = useState<{ cash: number; holdings: Holding[]; trades: Trade[] }>(() => ({
    cash: initial.cash ?? DEFAULT_SETTINGS.initialCapital,
    holdings: initial.holdings ?? [],
    trades: initial.trades ?? [],
  }));
  const [watchlist, setWatchlist] = useState<string[]>(
    initial.watchlist ?? ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY'],
  );
  const [imported, setImported] = useState<MarketData | null>(null);
  const [dataNotice, setDataNotice] = useState<string | null>(null);

  const [lstmJson, setLstmJson] = useState<string | null>(initial.lstmJson ?? null);
  const [lstmMeta, setLstmMeta] = useState<LstmMeta | null>(initial.lstmMeta ?? null);
  const [lstmModel, setLstmModel] = useState<LstmModel | null>(() => {
    if (!initial.lstmJson) return null;
    try {
      return deserialiseModel(initial.lstmJson);
    } catch {
      return null;
    }
  });
  const [lstmStatus, setLstmStatus] = useState<ModelStatus>(initial.lstmJson ? 'ready' : 'idle');
  const [lstmProgress, setLstmProgress] = useState(0);
  const [lstmError, setLstmError] = useState<string | null>(null);

  const [dqnJson, setDqnJson] = useState<string | null>(initial.dqnJson ?? null);
  const [dqnMeta, setDqnMeta] = useState<DqnMeta | null>(initial.dqnMeta ?? null);
  const [dqnNet, setDqnNet] = useState<DuelingQNet | null>(() => {
    if (!initial.dqnJson) return null;
    try {
      return deserialiseDqn(initial.dqnJson).net;
    } catch {
      return null;
    }
  });
  const [dqnStatus, setDqnStatus] = useState<ModelStatus>(initial.dqnJson ? 'ready' : 'idle');
  const [dqnProgress, setDqnProgress] = useState(0);
  const [dqnError, setDqnError] = useState<string | null>(null);

  /* ---------------- market data ---------------- */

  const market: MarketData = useMemo(() => {
    if (imported) return imported;
    const demo = getDemoMarket();
    return {
      dates: demo.dates,
      bars: demo.bars,
      benchmark: demo.benchmark,
      assets: UNIVERSE,
      benchmarkAsset: BENCHMARK_ASSET,
      source: DEMO_SOURCE,
      disclaimer: demo.disclaimer,
    };
  }, [imported]);

  const prices = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [symbol, bars] of Object.entries(market.bars)) {
      if (bars.length > 0) out[symbol] = bars[bars.length - 1].c;
    }
    return out;
  }, [market]);

  const previous = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [symbol, bars] of Object.entries(market.bars)) {
      if (bars.length > 1) out[symbol] = bars[bars.length - 2].c;
    }
    return out;
  }, [market]);

  const sectors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const asset of market.assets) out[asset.symbol] = asset.sector;
    return out;
  }, [market]);

  const riskSettings = useMemo<RiskSettings>(
    () => ({
      ...settings,
      maxPositionPct: settings.positionSizingEnabled ? settings.maxPositionPct : 1,
      maxSectorPct: settings.diversificationEnabled ? settings.maxSectorPct : 1,
      drawdownHaltPct: settings.drawdownHaltEnabled ? settings.drawdownHaltPct : 1,
      stopLossPct: settings.stopLossEnabled ? settings.stopLossPct : 1,
    }),
    [settings],
  );

  const headlines = useMemo(
    () => (market.dates.length > 0 ? buildDemoHeadlines(market.dates) : []),
    [market],
  );

  const featuresFor = useCallback(
    (symbol: string): AssetFeatures | null => {
      const bars = market.bars[symbol];
      if (!bars || bars.length < 60) return null;
      return computeFeatures(bars, symbol);
    },
    [market],
  );

  const sentimentAt = useCallback(
    (symbol: string, at: number): number | null => {
      if (!settings.sentimentEnabled) return null;
      const relevant = headlines.filter((h) => h.symbol === symbol || h.symbol === null);
      const result = sentimentUpTo(relevant, defaultAnalyzer, at);
      return result.count > 0 ? result.score : null;
    },
    [headlines, settings.sentimentEnabled],
  );

  const forecastFor = useCallback(
    (symbol: string): ForecastPoint[] | null => {
      if (!settings.lstmEnabled || !lstmModel || lstmMeta?.symbol !== symbol) return null;
      const bars = market.bars[symbol];
      if (!bars || bars.length < lstmModel.config.seqLen) return null;
      try {
        return forecastPrices(
          lstmModel,
          bars.map((b) => b.c),
          7,
          bars.map((b) => b.t),
        );
      } catch {
        return null;
      }
    },
    [lstmModel, lstmMeta, market, settings.lstmEnabled],
  );

  const dqnActionFor = useCallback(
    (symbol: string): SignalSide | null => {
      if (!settings.dqnEnabled || !dqnNet || dqnMeta?.symbol !== symbol) return null;
      const bars = market.bars[symbol];
      const features = featuresFor(symbol);
      if (!bars || !features || bars.length < 70) return null;
      try {
        const env = new TradingEnv(bars, features, DEFAULT_DQN_CONFIG, {
          start: bars.length - 1,
          end: bars.length - 1,
        });
        const state = env.reset();
        const q = dqnNet.qValues(state);
        let best = 0;
        for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i;
        return best === 0 ? 'hold' : best === 1 ? 'buy' : 'sell';
      } catch {
        return null;
      }
    },
    [dqnNet, dqnMeta, featuresFor, market, settings.dqnEnabled],
  );

  const signalFor = useCallback(
    (symbol: string): Signal | null => {
      const features = featuresFor(symbol);
      if (!features || features.bars.length === 0) return null;
      const index = features.bars.length - 1;
      const holding = account.holdings.find((h) => h.symbol === symbol) ?? null;
      return signalAt(features, index, {
        sentiment: sentimentAt(symbol, features.bars[index].t),
        forecastReturn: (() => {
          const points = forecastFor(symbol);
          if (!points || points.length === 0 || !features.close.length) return null;
          return (points[0].predicted - features.close[features.close.length - 1]) / features.close[features.close.length - 1];
        })(),
        dqnAction: dqnActionFor(symbol),
        position: holding ? { qty: holding.qty, avgCost: holding.avgCost } : null,
        stopLossPct: riskSettings.stopLossPct,
      });
    },
    [account.holdings, dqnActionFor, featuresFor, forecastFor, riskSettings.stopLossPct, sentimentAt],
  );

  /* ---------------- portfolio ---------------- */

  const valuation = useMemo(
    () => valuePortfolio(account, prices),
    [account, prices],
  );

  const equityCurve = useMemo(() => replayEquity(account.trades, market.dates, market.bars, settings.initialCapital), [
    account.trades,
    market,
    settings.initialCapital,
  ]);

  const drawdown = useMemo(() => drawdownFromCurve(equityCurve), [equityCurve]);

  const dayChangePct = useMemo(() => {
    if (account.trades.length === 0 && account.holdings.length === 0) return null;
    const valueAt = (map: Record<string, number>): number =>
      account.cash +
      account.holdings.reduce((acc, h) => {
        const price = map[h.symbol];
        return acc + h.qty * (Number.isFinite(price) && price > 0 ? price : h.avgCost);
      }, 0);
    const today = valueAt(prices);
    const yesterday = valueAt(previous);
    if (yesterday <= 0) return null;
    return (today - yesterday) / yesterday;
  }, [account, previous, prices]);

  /* ---------------- actions ---------------- */

  const placeOrder = useCallback(
    (symbol: string, side: 'buy' | 'sell', qty: number): OrderOutcome => {
      const price = prices[symbol];
      if (!Number.isFinite(price) || price <= 0) {
        return { ok: false, message: `No price available for ${symbol}.`, code: 'NO_PRICE', appliedQty: 0 };
      }
      const verdict = evaluateOrder({
        side,
        symbol,
        sector: sectors[symbol] ?? 'Other',
        sectors,
        qty,
        price,
        account: { cash: account.cash, holdings: account.holdings },
        prices,
        settings: riskSettings,
        currentDrawdown: drawdown,
      });
      if (!verdict.allowed) {
        const reason = verdict.notes[0]?.message ?? 'Order blocked by risk limits.';
        return { ok: false, message: reason, code: verdict.notes[0]?.code ?? 'BLOCKED', appliedQty: 0 };
      }

      const fee = computeFee(side, verdict.qty, price, settings.costBps);
      const { holdings: nextHoldings } = applyFill(account.holdings, side, symbol, verdict.qty, price);
      const trade: Trade = {
        id: `${Date.now()}-${symbol}-${side}`,
        symbol,
        side,
        qty: verdict.qty,
        price,
        fee: fee.fee,
        at: market.dates.length > 0 ? market.dates[market.dates.length - 1] : Date.now(),
        reason: side === 'buy' ? 'Manual paper buy' : 'Manual paper sell',
        mode: 'paper',
      };
      setAccount((prev) => ({
        cash: side === 'buy' ? prev.cash - fee.gross - fee.fee : prev.cash + fee.gross - fee.fee,
        holdings: nextHoldings,
        trades: [...prev.trades, trade],
      }));

      const trimmed = verdict.notes.length > 0;
      return {
        ok: true,
        code: 'OK',
        appliedQty: verdict.qty,
        trade,
        message: trimmed
          ? verdict.notes[0].message
          : `${side === 'buy' ? 'Bought' : 'Sold'} ${verdict.qty} ${symbol} at ₹${price.toFixed(2)}.`,
      };
    },
    [account, drawdown, market.dates, prices, riskSettings, sectors],
  );

  const resetPortfolio = useCallback(() => {
    setAccount({ cash: settings.initialCapital, holdings: [], trades: [] });
    setDataNotice('Paper portfolio reset to the configured initial capital.');
  }, [settings.initialCapital]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setAccount((acct) => {
        const untouched = acct.trades.length === 0 && acct.holdings.length === 0;
        if (untouched && patch.initialCapital !== undefined && patch.initialCapital !== prev.initialCapital) {
          return { ...acct, cash: patch.initialCapital };
        }
        return acct;
      });
      return next;
    });
  }, []);

  const toggleWatch = useCallback((symbol: string) => {
    setWatchlist((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );
  }, []);

  const importCsv = useCallback((text: string): { ok: boolean; message: string } => {
    try {
      const parsed = parseOhlcvCsv(text);
      const data: MarketData = {
        dates: parsed.bars.map((b) => b.t),
        bars: { [parsed.asset.symbol]: parsed.bars },
        benchmark: null,
        assets: [parsed.asset],
        benchmarkAsset: null,
        source: parsed.source,
        disclaimer: `${parsed.source.note} Imported files are used exactly as supplied.`,
      };
      setImported(data);
      setDataNotice(
        `Imported ${parsed.bars.length} sessions for ${parsed.asset.symbol}.` +
          (parsed.warnings.length > 0 ? ` ${parsed.warnings.join(' ')}` : ''),
      );
      return { ok: true, message: `Imported ${parsed.bars.length} sessions for ${parsed.asset.symbol}.` };
    } catch (error) {
      const message =
        error instanceof CsvImportError
          ? `Row ${error.row}: ${error.message}`
          : error instanceof Error
            ? error.message
            : 'The file could not be parsed.';
      return { ok: false, message };
    }
  }, []);

  const useDemoData = useCallback(() => {
    setImported(null);
    setDataNotice('Switched back to the deterministic demo dataset.');
  }, []);

  const trainLstm = useCallback(
    async (symbol: string) => {
      const bars = market.bars[symbol];
      if (!bars || bars.length < DEFAULT_LSTM_CONFIG.seqLen + 20) {
        setLstmError(`Not enough sessions for ${symbol} to train.`);
        setLstmStatus('error');
        return;
      }
      setLstmStatus('training');
      setLstmError(null);
      setLstmProgress(0);
      try {
        const config: LstmConfig = { ...DEFAULT_LSTM_CONFIG };
        const result = await trainLstmModel(
          bars.map((b) => b.c),
          config,
          {
            timestamps: bars.map((b) => b.t),
            onProgress: (p) => setLstmProgress(Math.min(1, (p.epoch + 1) / p.epochs)),
          },
        );
        const meta: LstmMeta = {
          symbol,
          trainedAt: Date.now(),
          config,
          metrics: result.metrics,
          history: result.history,
          split: result.split,
          bandWidth: result.bandWidth,
          sessions: bars.length,
        };
        const json = serialiseModel(result.model);
        setLstmModel(result.model);
        setLstmMeta(meta);
        setLstmJson(json);
        setLstmProgress(1);
        setLstmStatus('ready');
      } catch (error) {
        setLstmStatus('error');
        setLstmError(error instanceof Error ? error.message : 'LSTM training failed.');
      }
    },
    [market.bars],
  );

  const trainDqn = useCallback(
    async (symbol: string) => {
      const bars = market.bars[symbol];
      const features = featuresFor(symbol);
      if (!bars || !features) {
        setDqnError(`Not enough sessions for ${symbol} to train.`);
        setDqnStatus('error');
        return;
      }
      setDqnStatus('training');
      setDqnError(null);
      setDqnProgress(0);
      try {
        const config: Partial<DqnConfig> = { costBps: settings.costBps };
        const warmup = 55;
        const split = Math.floor(bars.length * 0.7);
        const result: DqnTrainResult = await trainDqnAgent({
          bars,
          features,
          config,
          train: { start: warmup, end: split },
          test: { start: split, end: bars.length - 1 },
          onProgress: (p) => setDqnProgress((p.episode + 1) / p.episodes),
        });
        const meta: DqnMeta = {
          symbol,
          trainedAt: Date.now(),
          config: result.config,
          trainReturn: result.train.totalReturn,
          testReturn: result.test.totalReturn,
          buyHoldReturn: result.test.buyHoldReturn,
          episodes: result.config.episodes,
          gradientSteps: result.gradientSteps,
          note: result.note,
        };
        const json = serialiseDqn(result.net, result.config, {
          episodes: result.config.episodes,
          gradientSteps: result.gradientSteps,
          trainReturn: result.train.totalReturn,
          testReturn: result.test.totalReturn,
          trainedAt: Date.now(),
        });
        setDqnNet(result.net);
        setDqnJson(json);
        setDqnMeta(meta);
        setDqnProgress(1);
        setDqnStatus('ready');
      } catch (error) {
        setDqnStatus('error');
        setDqnError(error instanceof Error ? error.message : 'DQN training failed.');
      }
    },
    [featuresFor, market.bars, settings.costBps],
  );

  const clearModels = useCallback(() => {
    setLstmModel(null);
    setLstmMeta(null);
    setLstmJson(null);
    setLstmStatus('idle');
    setLstmProgress(0);
    setLstmError(null);
    setDqnNet(null);
    setDqnMeta(null);
    setDqnJson(null);
    setDqnStatus('idle');
    setDqnProgress(0);
    setDqnError(null);
  }, []);

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    const payload: Persisted = {
      settings,
      cash: account.cash,
      holdings: account.holdings,
      trades: account.trades,
      watchlist,
      lstmJson,
      lstmMeta,
      dqnJson,
      dqnMeta,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage may be full or disabled; the app keeps working in memory.
    }
  }, [settings, account, watchlist, lstmJson, lstmMeta, dqnJson, dqnMeta]);

  const value: StoreValue = {
    settings,
    riskSettings,
    market,
    assets: market.assets,
    prices,
    previous,
    sectors,
    cash: account.cash,
    holdings: account.holdings,
    trades: account.trades,
    watchlist,
    valuation,
    equityCurve,
    drawdown,
    dayChangePct,
    headlines,
    lstmStatus,
    lstmProgress,
    lstmError,
    lstmMeta,
    dqnStatus,
    dqnProgress,
    dqnError,
    dqnMeta,
    dataNotice,
    featuresFor,
    signalFor,
    sentimentAt,
    forecastFor,
    dqnActionFor,
    placeOrder,
    resetPortfolio,
    updateSettings,
    toggleWatch,
    importCsv,
    useDemoData,
    trainLstm,
    trainDqn,
    clearModels,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Rebuild the portfolio equity curve by replaying paper trades over the
 * session history from the configured initial capital. Trades executed on a
 * session are marked at that session's close.
 */
export function replayEquity(
  trades: readonly Trade[],
  dates: readonly number[],
  bars: Record<string, Bar[]>,
  initialCapital: number,
): number[] {
  if (dates.length === 0) return [];
  const byDate = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = String(t.at);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(t);
    else byDate.set(key, [t]);
  }

  const holds = new Map<string, { qty: number }>();
  const closes = new Map<string, number[]>();
  const index = new Map<string, number>();
  for (const [symbol, series] of Object.entries(bars)) {
    closes.set(symbol, series.map((b) => b.c));
    index.set(symbol, -1);
  }

  let cash = initialCapital;
  const curve: number[] = [];

  for (const date of dates) {
    for (const t of byDate.get(String(date)) ?? []) {
      const series = closes.get(t.symbol);
      if (!series) continue;
      const i = index.get(t.symbol) ?? -1;
      const price = i >= 0 ? series[i] : t.price;
      const held = holds.get(t.symbol) ?? { qty: 0 };
      if (t.side === 'buy') {
        cash -= t.qty * price + t.fee;
        held.qty += t.qty;
      } else {
        cash += t.qty * price - t.fee;
        held.qty -= t.qty;
      }
      holds.set(t.symbol, held);
    }

    let value = cash;
    for (const [symbol, held] of holds) {
      if (held.qty <= 0) continue;
      const series = closes.get(symbol);
      const i = index.get(symbol) ?? -1;
      const price = series && i >= 0 ? series[i] : undefined;
      if (price !== undefined) value += held.qty * price;
    }
    curve.push(value);

    for (const [symbol, series] of closes) {
      const i = index.get(symbol) ?? -1;
      if (i + 1 < series.length && bars[symbol][i + 1].t <= date) index.set(symbol, i + 1);
    }
  }

  return curve;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
