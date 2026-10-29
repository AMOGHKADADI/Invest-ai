/**
 * Backtest strategies.
 *
 * Every strategy only ever reads the causal context handed to it by the engine,
 * which is what makes the results reproducible and free of look-ahead bias.
 */

import type { SignalSide } from './types';
import { sma } from './indicators';
import { computeFeatures, signalAt } from './signals';
import type { Strategy, StrategyContext, StrategyDecision } from './backtest';

/** Always in the market: buy the first session, never sell. */
export const buyAndHoldStrategy: Strategy = {
  id: 'buy-and-hold',
  name: 'Buy & hold',
  description:
    'Buys an equal-weight position on the first session of the window and holds it. Used as the internal baseline.',
  decide(_ctx: StrategyContext, _symbol: string): StrategyDecision {
    return { side: 'buy', score: 1 };
  },
};

/** Classic fast/slow simple-moving-average crossover. */
export function smaCrossoverStrategy(fastPeriod = 20, slowPeriod = 50): Strategy {
  const cache = new WeakMap<readonly number[], { fast: (number | null)[]; slow: (number | null)[] }>();
  return {
    id: `sma-${fastPeriod}-${slowPeriod}`,
    name: `SMA ${fastPeriod}/${slowPeriod} crossover`,
    description: `Buys when the ${fastPeriod}-session average crosses above the ${slowPeriod}-session average and sells when it crosses back below.`,
    decide(ctx: StrategyContext, symbol: string): StrategyDecision {
      const features = ctx.features.get(symbol);
      if (!features) return { side: 'hold', score: 0 };
      const idx = ctx.previousIndex.get(symbol) ?? -1;
      if (idx < slowPeriod) return { side: 'hold', score: 0 };

      let series = cache.get(features.close);
      if (!series) {
        series = { fast: sma(features.close, fastPeriod), slow: sma(features.close, slowPeriod) };
        cache.set(features.close, series);
      }
      const f = series.fast[idx];
      const s = series.slow[idx];
      const fPrev = idx > 0 ? series.fast[idx - 1] : null;
      const sPrev = idx > 0 ? series.slow[idx - 1] : null;
      if (f === null || s === null || fPrev === null || sPrev === null) return { side: 'hold', score: 0 };

      const above = f > s;
      const wasAbove = fPrev > sPrev;
      if (above && !wasAbove) return { side: 'buy', score: 1 };
      if (!above && wasAbove) return { side: 'sell', score: -1 };
      return { side: 'hold', score: above ? 0.3 : -0.3 };
    },
  };
}

/**
 * The InvestAI ensemble: technical features combined with optional sentiment,
 * LSTM forecast and DQN outputs supplied by the caller.
 */
export function investaiStrategy(options?: {
  useSentiment?: boolean;
  useForecast?: boolean;
  useDqn?: boolean;
  dqnAction?: (symbol: string, date: number) => SignalSide | null;
}): Strategy {
  const useSentiment = options?.useSentiment ?? true;
  const useForecast = options?.useForecast ?? true;
  const useDqn = options?.useDqn ?? false;
  return {
    id: 'investai-ensemble',
    name: 'InvestAI ensemble',
    description:
      'Combines trend, RSI, MACD, Bollinger and momentum features with news sentiment, the LSTM forecast direction and (when trained) the DQN agent action.',
    decide(ctx: StrategyContext, symbol: string): StrategyDecision {
      const features = ctx.features.get(symbol);
      if (!features) return { side: 'hold', score: 0 };
      const idx = ctx.previousIndex.get(symbol) ?? -1;
      if (idx < 30) return { side: 'hold', score: 0 };
      const signal = signalAt(features, idx, {
        sentiment: useSentiment ? ctx.sentiment(symbol, ctx.date) : null,
        forecastReturn: useForecast ? ctx.forecast(symbol, ctx.date) : null,
        dqnAction: useDqn ? (options?.dqnAction?.(symbol, ctx.date) ?? null) : null,
      });
      return { side: signal.side, score: signal.score };
    },
  };
}

export const ALL_STRATEGIES: Strategy[] = [
  investaiStrategy(),
  smaCrossoverStrategy(20, 50),
  buyAndHoldStrategy,
];

export function strategyById(id: string): Strategy {
  return ALL_STRATEGIES.find((s) => s.id === id) ?? ALL_STRATEGIES[0];
}

/** Re-exported so callers can build features without importing two modules. */
export { computeFeatures };
