# InvestAI

**AI-Driven Autonomous Investment and Risk Management using Reinforcement Learning**

A research-grade, self-contained web application that implements the architecture proposed in the
Phase 1 project report: an LSTM forecasting module, financial-news sentiment analysis, a
Deep Q-Network trading agent, a layered risk-management system, portfolio accounting, chronological
backtesting, and an interactive dashboard — all running locally in the browser on deterministic data.

> **Research and education only.** InvestAI never connects to a brokerage, never places a real order,
> and never moves real funds. Nothing in this repository is investment advice, a guarantee of
> returns, or a claim that any model "beats the market".

---

## 1. Academic context and problem statement

This repository accompanies the Visvesvaraya Technological University (VTU) Bachelor of Engineering
Phase 1 project *"AI-driven autonomous Investment and Risk Management using Reinforcement Learning"*
(Department of Computer Science and Engineering, Brindavan College of Engineering, 2025–26).

The report observes that traditional portfolio management depends on human expertise, manual
analysis and rule-based decisions, which are impaired by emotional bias, delayed responses, limited
analytical capacity and inadequate risk management — especially during volatile markets. It
proposes a self-learning trading agent that autonomously performs **Buy / Sell / Hold** operations
by combining:

- a **Deep Q-Network (DQN)** reinforcement-learning agent as the decision engine,
- an **LSTM** time-series model for short-term price prediction,
- **NLP sentiment analysis** of financial text (FinBERT in the report's design),
- a **risk-management layer** (stop-loss, position sizing, diversification, drawdown control),
- a **portfolio optimization** and **performance evaluation** framework, and
- an **interactive dashboard** for oversight.

### What the report proposes vs. what this repository implements

| Report component | Status in this repository |
| --- | --- |
| Data pipeline, cleaning, feature engineering | **Implemented** — causal technical-indicator pipeline (`src/lib/indicators.ts`, `src/lib/signals.ts`) over an OHLCV dataset with CSV import |
| DQN agent (dueling, prioritised replay, Double-DQN) | **Implemented** — trained in-browser with reproducible seeds (`src/lib/dqn.ts`); weights persist in local storage |
| LSTM price forecasting | **Implemented** — full train/validation/test split, early stopping, held-out metrics (`src/lib/lstm.ts`) |
| Sentiment analysis | **Partially implemented** — a transparent financial lexicon runs in the browser; a **FinBERT adapter** (`HttpSentiment`) is implemented and activates only when a hosted endpoint is configured. Model weights are *not* shipped or downloaded by this static app |
| Risk-management constraint layer | **Implemented** — order evaluation with position/sector caps, stop-loss flagging and drawdown halt (`src/lib/risk.ts`) |
| Portfolio accounting & optimization | **Implemented** — cash, holdings, fees, allocation and risk-adjusted metrics; full MPT optimizer remains future work |
| Backtesting & evaluation vs. index | **Implemented** — chronological engine with costs, no look-ahead, benchmark comparison (`src/lib/backtest.ts`) |
| Dashboard & reporting | **Implemented** — responsive React dashboard |
| Real-time market APIs (Yahoo Finance, Alpha Vantage), news feeds, PostgreSQL, Dash backend | **Not implemented** — a static GitHub Pages deployment cannot host them or hold API keys securely. The app runs on clearly-labelled **demo data** plus **CSV import**, with a documented path to a hosted backend |
| Live trading, authentication/user roles, notifications | **Future work** (report Phase 2 scope) |

No experimental results, benchmarks or model accuracies are claimed beyond what the application
itself computes live in your browser. The demo dataset is synthetic and labelled as such in the UI.

---

## 2. Features

- **Dashboard** — portfolio value, day change, drawdown, latest signals, risk summary, performance
  chart, all with data timestamps and provenance tags.
- **Markets** — searchable instrument universe, asset detail with candle/price chart, technical
  indicators (SMA/EMA, RSI, MACD, Bollinger, ATR, volatility), watchlist.
- **AI signals** — Buy/Sell/Hold with the contributing factors, score, sentiment, forecast and DQN
  action where available, plus explicit "not trained" states when a model is absent.
- **LSTM forecasting** — in-browser training with a fixed seed, training/validation curves, held-out
  RMSE/MAE, skill vs. a persistence baseline, and a 7-session forecast with a residual band.
- **Sentiment** — headline classification with engine and provenance shown honestly (lexicon vs.
  FinBERT), causal aggregation for historical scoring, per-label filtering.
- **Portfolio** — holdings, allocation donut (asset and sector), P&L, replayed equity curve.
- **Risk management** — Sharpe/Sortino/drawdown/volatility tiles, live limit checks, and toggles for
  stop-loss, position sizing, diversification and drawdown halt.
- **Backtesting** — strategy vs. index over 3M/6M/1Y/All windows with transaction costs, cash and
  position constraints, and engine guarantees documented in the UI.
- **Trade history** — every simulated fill with quantity, price, fee and reason.
- **Settings** — capital, transaction cost, model switches, CSV import/restore, model and data
  status, portfolio reset.

Every interactive control either performs a real action or is explicitly marked unavailable
(e.g. the theme switch, dark-only in this release).

---

## 3. Architecture

```
src/
├── lib/                  # Framework-free domain logic (all unit tests live here)
│   ├── indicators.ts     # SMA, EMA, RSI, MACD, Bollinger, ATR, volatility
│   ├── signals.ts        # Feature computation + Buy/Sell/Hold signal engine
│   ├── sentiment.ts      # Lexicon analyzer, causal aggregation, FinBERT HTTP adapter
│   ├── lstm.ts           # LSTM forward/backward, Adam training, eval, forecasting
│   ├── dqn.ts            # Dueling Double-DQN, prioritised replay, trading environment
│   ├── optim.ts          # Shared Adam optimiser + gradient clipping
│   ├── risk.ts           # Order evaluation: caps, stop-loss, drawdown halt, assessment
│   ├── portfolio.ts      # Fees, fills, valuation, allocation, equity replay
│   ├── metrics.ts        # Return, CAGR, volatility, Sharpe, Sortino, drawdown, Calmar
│   ├── backtest.ts       # Chronological backtesting engine + benchmark
│   ├── strategies.ts     # InvestAI ensemble, SMA crossover, buy & hold
│   ├── csv.ts            # Validated OHLCV import
│   ├── demoData.ts       # Deterministic synthetic dataset (clearly labelled)
│   └── format.ts         # Number/date formatting (INR, %, ratios)
├── app/store.tsx         # Application state, persistence (localStorage), model training
├── components/           # App shell, charts (pure SVG), reusable UI primitives
├── pages/                # Dashboard, Markets, Asset detail, Signals, Portfolio, Risk,
│                         # Forecast, Sentiment, Backtest, Trades, Settings, More
└── styles/               # Design tokens + responsive CSS
```

**Design system:** deep black `#0B0B0B`, warm white `#F7F7F4`, signal yellow `#FFDC16`, alert red
`#FF2D3D`; disciplined spacing scale, restrained borders, accessible contrast, mobile → desktop
responsive layouts. Charts are hand-rolled SVG — no charting dependency.

**Data flow:** `demoData` / CSV import → `market` → causal `features` → signal engine (± sentiment,
LSTM forecast, DQN action) → risk layer (`evaluateOrder`) → paper fills → portfolio/metrics →
dashboard. Model outputs feed signals only when a model has actually been trained.

### Causality and integrity rules enforced in code

- Indicators and signals at session *t* use only bars up to *t − 1*.
- Backtest signals are computed from the previous session and filled at the next open.
- Sentiment aggregation only reads headlines published at or before the queried timestamp.
- LSTM normalisation statistics come from the training segment only; test segments are held out.
- The LSTM/DQN are **excluded** from backtest inputs because their weights are trained on the full
  series — feeding them into past sessions would leak future information (explained in the UI).
- Demo data is synthetic and tagged "Demo" everywhere it appears.

---

## 4. Technology stack

- **TypeScript** (strict) · **React 18** · **Vite 6** · **React Router 6**
- **Vitest** for unit tests · **ESLint 9** (flat config) for linting
- No runtime UI/chart/ML dependencies: models, charts and indicators are implemented in-repo.

---

## 5. Getting started

```bash
npm ci          # reproducible install from package-lock.json
npm run dev     # dev server at http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over the whole repo |
| `npm run test` | Unit tests (107 tests) |
| `npm run ci` | Lint + typecheck + test + build (what CI runs) |

---

## 6. Environment variables

No secrets are required or accepted by the application. Optional build-time variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_BASE_PATH` | No (default `/`) | Asset base path; the Pages workflow sets `/Invest-ai/` |
| `VITE_SENTIMENT_API_URL` | No | Hosted FinBERT endpoint. When set, sentiment classification is routed to it; it **fails closed** with a visible error rather than silently falling back to the lexicon |

`.env` files are git-ignored (`.env.example` would be the place to document new variables). Never
commit API keys; a browser bundle is public by definition.

---

## 7. Testing

```bash
npm run test
```

The suite focuses on financial correctness and model integrity:

- **Indicators** — known-value checks for SMA/EMA/RSI/MACD/Bollinger/ATR.
- **Metrics** — Sharpe/Sortino/drawdown/CAGR on hand-computed fixtures.
- **Portfolio** — fills, fees, average cost, realised/unrealised P&L, allocation.
- **Risk** — cap trimming, blocking, stop-loss and drawdown-halt behaviour.
- **Signals** — side selection and factor reporting across crafted market shapes.
- **Backtest** — chronological execution, cost application, and a no-look-ahead test
  (running on a truncated series yields identical trades for that window).
- **LSTM & DQN** — finite-difference gradient checks against the analytical backward passes,
  reproducibility from a fixed seed, forecast-shape and action-space validation.
- **Sentiment / CSV** — classification boundaries, causal aggregation, parser validation.

---

## 8. CI/CD and deployment

| Workflow | File | Trigger | What it does |
| --- | --- | --- | --- |
| **CI** | `.github/workflows/ci.yml` | push + PR to `main` | `npm ci` → lint → typecheck → test → build |
| **Deploy** | `.github/workflows/deploy.yml` | push to `main` (manual dispatch supported) | tests → build with `VITE_BASE_PATH=/Invest-ai/` → publish `dist/` to **GitHub Pages** |

Both workflows use least-privilege permissions (`contents: read`; the deploy job additionally gets
`pages: write` + `id-token: write` for the OIDC Pages deployment).

**Deploying:**
1. Repository → *Settings → Pages → Source: **GitHub Actions***.
2. Push to `main` (or run the Deploy workflow manually).
3. The site is served at `https://amoghkadadi.github.io/Invest-ai/`.

If Pages is disabled or the account plan blocks it, the CI workflow still validates every push and
the `dist/` output can be hosted anywhere static.

---

## 9. Model training and inference

All training happens **client-side**, deterministically:

- **LSTM** (`Forecast` page): 30-session windows, hidden size 16, Adam (lr 0.006), 60/20/20
  train/validation/test split, early stopping with patience 8, seed 7. Reports test RMSE/MAE and
  skill vs. a persistence baseline. The forecast band is `1.96 ×` residual std (× √horizon) — a
  documented heuristic, not a calibrated interval.
- **DQN** (trained from the Signals flow): dueling architecture, prioritised experience replay,
  Double-DQN targets, epsilon-greedy exploration over Buy/Sell/Hold, transaction costs in the
  reward, 70/30 train/test split with buy & hold comparison for the test segment.
- Trained weights persist in `localStorage` only. "Clear trained models" removes them.

Honest limits: these are small models trained on a short demo series in a browser tab. They
demonstrate the report's architecture end-to-end; they are not evidence of predictive power on real
markets.

---

## 10. Backtesting assumptions

- Signals from session *t* execute at session *t+1*'s **open** — no same-bar or look-ahead fills.
- Transaction cost is a fixed **basis points** fee on traded notional (default 10 bps).
- One position per symbol; budget per entry is `min(position cap × equity, cash)`.
- Equity is marked to market at each session's close; exposure and turnover are reported.
- Ratios use 252 sessions/year and a 0% risk-free rate; Sharpe/volatility use sample standard
  deviation, Sortino uses downside deviation. Short or zero-variance histories return "—".
- The benchmark is buy-and-hold of the index series with the same entry cost.
- Not modelled: slippage beyond the flat fee, liquidity, dividends, taxes, survivorship bias.

---

## 11. Data sources and limitations

- The default dataset is **deterministic synthetic data** generated in `src/lib/demoData.ts` and
  labelled *Demo* in the UI. It is not real market data.
- **CSV import** (`date,open,high,low,close,volume`[`,symbol`]) replaces the dataset until the demo
  is restored. Imported files are used exactly as supplied.
- Live market/news APIs from the report (Yahoo Finance, Alpha Vantage, NewsAPI) are **not**
  integrated: a static GitHub Pages app cannot hold those credentials securely. The report's
  proposed Python/TensorFlow backend is the natural home for them (see §1).
- Headlines are a synthetic corpus. FinBERT requires a hosted endpoint via `VITE_SENTIMENT_API_URL`;
  the lexicon analyzer is never presented as FinBERT.

---

## 12. Security considerations

- No API keys, tokens or credentials exist in the codebase or the bundle.
- `.env*` is git-ignored; GitHub Actions uses only built-in secrets and needs none of ours.
- No network calls are made unless a sentiment endpoint is explicitly configured.
- All user state stays in browser `localStorage`; nothing is transmitted.
- Workflows run with read-only repository permissions except the Pages deploy job.

---

## 13. Limitations and future work

**Current limitations**

- Static, client-side only: no backend, database, authentication or multi-user support.
- Demo/imported data only — no live prices, news or brokerage integration.
- Single-instrument models trained on demand; no pre-trained weights are distributed.
- The portfolio module computes allocation and risk metrics but does not yet run a full
  mean-variance optimiser (report objective 6).
- Browser training caps the dataset size and model capacity.

**Future work (aligned with the report's Phase 2)**

- Hosted Python backend (TensorFlow/Keras DQN + LSTM, FinBERT via Hugging Face) with the proposed
  API and database layers.
- Real market-data and news ingestion behind server-side credentials.
- Mean-variance portfolio optimization and rebalancing.
- Backtest walk-forward cross-validation and parameter-hygiene tooling.
- APK/Android client — **not included**; no APK has been built or verified for this repository.

---

## 14. Repository layout

```
.
├── .github/workflows/     # ci.yml, deploy.yml
├── public/                # favicon
├── src/
│   ├── app/               # store (state + persistence + training)
│   ├── components/        # shell, charts, UI primitives, signal card
│   ├── lib/               # domain logic + all tests
│   ├── pages/             # route screens
│   └── styles/            # tokens + app CSS
├── eslint.config.js
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```
