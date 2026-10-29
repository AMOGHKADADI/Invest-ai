import { describe, expect, it } from 'vitest';
import { applyFill, allocationSlices, computeFee, concentration, realizedPnl, valuePortfolio } from './portfolio';
import {
  DEFAULT_RISK_SETTINGS,
  assessRisk,
  evaluateOrder,
  positionSizeByStop,
  positionSizeByVolatility,
  stoppedPositions,
} from './risk';

const settings = { ...DEFAULT_RISK_SETTINGS };

describe('fees', () => {
  it('charges basis points of traded notional and adds them to buys', () => {
    const buy = computeFee('buy', 10, 100, 10); // 0.1% of 1000 = 1
    expect(buy.gross).toBe(1000);
    expect(buy.fee).toBeCloseTo(1, 10);
    expect(buy.net).toBeCloseTo(1001, 10);

    const sell = computeFee('sell', 10, 100, 10);
    expect(sell.net).toBeCloseTo(999, 10);
  });

  it('treats a negative cost as zero instead of paying the trader', () => {
    expect(computeFee('buy', 1, 100, -5).fee).toBe(0);
  });
});

describe('applyFill', () => {
  it('averages cost on buys and realises P&L on sells', () => {
    const afterFirst = applyFill([], 'buy', 'TCS', 10, 100).holdings;
    expect(afterFirst[0]).toMatchObject({ symbol: 'TCS', qty: 10, avgCost: 100 });

    const afterSecond = applyFill(afterFirst, 'buy', 'TCS', 10, 120).holdings;
    expect(afterSecond[0].avgCost).toBeCloseTo(110, 10);

    const { holdings, outcome } = applyFill(afterSecond, 'sell', 'TCS', 5, 130);
    expect(holdings[0].qty).toBe(15);
    expect(holdings[0].avgCost).toBeCloseTo(110, 10);
    expect(outcome!.realizedPnl).toBeCloseTo(100, 10);
  });

  it('closes the position entirely when everything is sold', () => {
    const { holdings } = applyFill([{ symbol: 'TCS', qty: 5, avgCost: 100 }], 'sell', 'TCS', 5, 110);
    expect(holdings).toHaveLength(0);
  });

  it('never sells more than is held', () => {
    const { outcome, holdings } = applyFill(
      [{ symbol: 'TCS', qty: 5, avgCost: 100 }],
      'sell',
      'TCS',
      9,
      110,
    );
    expect(outcome!.qty).toBe(5);
    expect(holdings).toHaveLength(0);
  });
});

describe('valuation and allocation', () => {
  const account = {
    cash: 10_000,
    holdings: [
      { symbol: 'RELIANCE', qty: 10, avgCost: 2000 },
      { symbol: 'TCS', qty: 5, avgCost: 3000 },
    ],
  };
  const prices = { RELIANCE: 2200, TCS: 3000 };

  it('values cash and positions', () => {
    expect(valuePortfolio(account, prices)).toEqual({
      total: 10_000 + 22_000 + 15_000,
      invested: 37_000,
      cash: 10_000,
    });
  });

  it('allocation slices always sum to one and include cash', () => {
    const { total } = valuePortfolio(account, prices);
    const slices = allocationSlices(account, prices, [], total);
    const sum = slices.reduce((acc, s) => acc + s.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(slices.some((s) => s.key === 'CASH')).toBe(true);
  });

  it('concentration is 1 for a single position', () => {
    expect(concentration([1])).toBe(1);
    expect(concentration([0.5, 0.5])).toBe(0.5);
  });

  it('realised P&L is tracked across round trips', () => {
    const trades = [
      { id: '1', symbol: 'TCS', side: 'buy' as const, qty: 10, price: 100, fee: 1, at: 1, reason: '', mode: 'paper' as const },
      { id: '2', symbol: 'TCS', side: 'sell' as const, qty: 10, price: 120, fee: 1, at: 2, reason: '', mode: 'paper' as const },
    ];
    // 10 * (120 - 100) - 2 fees = 198
    expect(realizedPnl(trades)).toBeCloseTo(198, 10);
  });
});

describe('evaluateOrder', () => {
  const account = { cash: 50_000, holdings: [{ symbol: 'RELIANCE', qty: 10, avgCost: 2000 }] };
  const prices = { RELIANCE: 2200, TCS: 3000, ITC: 500 };
  const sectors = {
    RELIANCE: 'Energy',
    TCS: 'Information Technology',
    ITC: 'Consumer Goods',
  };

  const base = {
    side: 'buy' as const,
    symbol: 'ITC',
    sector: 'Consumer Goods',
    sectors,
    qty: 2,
    price: 500,
    account,
    prices,
    settings,
    currentDrawdown: 0,
  };

  it('allows a compliant buy', () => {
    const verdict = evaluateOrder(base);
    expect(verdict.allowed).toBe(true);
    expect(verdict.qty).toBe(2);
  });

  it('rejects a non-integer or non-positive quantity', () => {
    expect(evaluateOrder({ ...base, qty: 0 }).notes[0].code).toBe('BAD_QTY');
    expect(evaluateOrder({ ...base, qty: 2.5 }).notes[0].code).toBe('BAD_QTY');
  });

  it('rejects a buy with insufficient cash', () => {
    const verdict = evaluateOrder({ ...base, qty: 100, account: { ...account, cash: 100 } });
    expect(verdict.allowed).toBe(false);
    expect(verdict.notes[0].code).toBe('NO_CASH');
  });

  it('trims a buy that would breach the single-position cap', () => {
    // Portfolio value = 10*2200 + 50000 = 72000; 10% cap = 7200 → 2 shares at ~3000.
    const verdict = evaluateOrder({
      ...base,
      symbol: 'TCS',
      sector: 'Information Technology',
      price: 3000,
      qty: 10,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.qty).toBe(2);
    expect(verdict.notes[0].code).toBe('TRIM_TO_POSITION_LIMIT');
  });

  it('blocks a buy that would exceed the sector limit', () => {
    const verdict = evaluateOrder({
      ...base,
      symbol: 'TCS',
      sector: 'Information Technology',
      price: 3000,
      qty: 10,
      // IT already holds ~28% of the portfolio (limit 20%), while no single
      // position is near its individual cap, so the sector rule must fire.
      account: {
        cash: 30_000,
        holdings: [
          { symbol: 'INFY', qty: 20, avgCost: 1462 },
          { symbol: 'RELIANCE', qty: 20, avgCost: 2200 },
        ],
      },
      prices: { RELIANCE: 2200, INFY: 1462, TCS: 3000, ITC: 500 },
      sectors: {
        RELIANCE: 'Energy',
        TCS: 'Information Technology',
        ITC: 'Consumer Goods',
        INFY: 'Information Technology',
      },
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.notes[0].code).toBe('SECTOR_LIMIT');
  });

  it('blocks a sell when nothing is held', () => {
    const verdict = evaluateOrder({
      ...base,
      side: 'sell',
      account: { ...account, holdings: [] },
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.notes[0].code).toBe('NO_POSITION');
  });

  it('trims a sell to the held quantity', () => {
    const verdict = evaluateOrder({
      ...base,
      side: 'sell',
      symbol: 'RELIANCE',
      sector: 'Energy',
      qty: 999,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.qty).toBe(10);
  });

  it('halts new buys once the drawdown limit is reached', () => {
    const verdict = evaluateOrder({ ...base, currentDrawdown: 0.16 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.notes[0].code).toBe('DRAWDOWN_HALT');
  });
});

describe('position sizing', () => {
  it('sizes by the distance to the stop', () => {
    // Risk 1% of 100k = 1000; stop is 5% of a 500 price = 25 → 40 shares.
    expect(positionSizeByStop({ equity: 100_000, price: 500, annualVolatility: 0.2, riskPerTrade: 0.01, stopLossPct: 0.05 })).toBe(40);
  });

  it('scales exposure down when realised volatility exceeds the target', () => {
    const highVol = positionSizeByVolatility({ equity: 100_000, price: 1000, annualVolatility: 0.3, targetVolatility: 0.15 });
    const lowVol = positionSizeByVolatility({ equity: 100_000, price: 1000, annualVolatility: 0.1, targetVolatility: 0.15 });
    expect(highVol).toBe(50); // half of 100 shares
    expect(lowVol).toBe(100); // capped at full equity
  });
});

describe('assessRisk', () => {
  const account = {
    cash: 200_000,
    holdings: [
      { symbol: 'RELIANCE', qty: 5, avgCost: 2000 },
      { symbol: 'TCS', qty: 5, avgCost: 3000 },
    ],
  };
  const prices = { RELIANCE: 2200, TCS: 3000 };
  const sectors = { RELIANCE: 'Energy', TCS: 'Information Technology' };

  it('grades a healthy portfolio as low risk', () => {
    const result = assessRisk({
      equityCurve: [224_000, 226_000, 225_500, 227_000],
      account,
      prices,
      sectors,
      settings,
      sharpe: 1.2,
      sortino: 1.5,
      volatilityAnnual: 0.14,
    });
    expect(result.level).toBe('low');
    expect(result.items.every((i) => i.status === 'ok')).toBe(true);
  });

  it('flags positions that are below their stop level', () => {
    expect(stoppedPositions(account, { RELIANCE: 1800 }, 0.05)).toEqual(['RELIANCE']);
    expect(stoppedPositions(account, { RELIANCE: 2200 }, 0.05)).toEqual([]);
  });

  it('escalates to high risk when a limit is breached', () => {
    const result = assessRisk({
      equityCurve: [100_000, 84_000],
      account,
      prices,
      sectors,
      settings,
      sharpe: null,
      sortino: null,
      volatilityAnnual: null,
    });
    expect(result.level).toBe('high');
    expect(result.drawdown).toBeGreaterThan(settings.drawdownHaltPct);
  });
});
