import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { CHART_COLORS, LineChart, type LineSeries } from '../components/charts';
import {
  Card,
  EmptyState,
  ErrorBox,
  MetricTile,
  Note,
  PageHead,
  Progress,
  Section,
  SourceTag,
} from '../components/ui';
import { formatDate, formatShortDate, inr, pct, ratio } from '../lib/format';
import { DEFAULT_LSTM_CONFIG } from '../lib/lstm';

export default function Forecast() {
  const store = useStore();
  const { market, assets, lstmStatus, lstmProgress, lstmError, lstmMeta, trainLstm, forecastFor } = store;

  const [symbol, setSymbol] = useState<string>(lstmMeta?.symbol ?? assets[0]?.symbol ?? '');
  const [touched, setTouched] = useState(false);

  const bars = useMemo(() => market.bars[symbol] ?? [], [market.bars, symbol]);
  const trainedHere = lstmMeta !== null && lstmMeta.symbol === symbol;
  const forecast = trainedHere ? forecastFor(symbol) : null;
  const training = lstmStatus === 'training';

  const recent = useMemo(() => bars.slice(-60), [bars]);

  const priceSeries = useMemo<LineSeries[]>(() => {
    const actual: LineSeries = {
      id: 'actual',
      label: 'Actual close',
      color: CHART_COLORS.grey,
      points: recent.map((b) => ({ x: b.t, y: b.c })),
    };
    if (!forecast || forecast.length === 0 || recent.length === 0) return [actual];
    const last = recent[recent.length - 1];
    const predicted: LineSeries = {
      id: 'predicted',
      label: 'LSTM forecast',
      color: CHART_COLORS.signal,
      points: [{ x: last.t, y: last.c }, ...forecast.map((p) => ({ x: p.t, y: p.predicted }))],
    };
    return [actual, predicted];
  }, [forecast, recent]);

  const band = useMemo(() => {
    if (!forecast || forecast.length === 0 || recent.length === 0) return undefined;
    const last = recent[recent.length - 1];
    return {
      seriesId: 'predicted',
      color: 'rgba(255, 45, 61, 0.18)',
      lower: [last.c, ...forecast.map((p) => p.lower)],
      upper: [last.c, ...forecast.map((p) => p.upper)],
    };
  }, [forecast, recent]);

  const lossSeries = useMemo<LineSeries[]>(() => {
    if (!lstmMeta) return [];
    const { trainLoss, valLoss } = lstmMeta.history;
    return [
      {
        id: 'train',
        label: 'Train loss',
        color: CHART_COLORS.signal,
        points: trainLoss.map((v, i) => ({ x: i, y: v })),
      },
      {
        id: 'val',
        label: 'Validation loss',
        color: CHART_COLORS.orange,
        points: valLoss.map((v, i) => ({ x: i, y: v })),
      },
    ];
  }, [lstmMeta]);

  const lastClose = recent.length > 0 ? recent[recent.length - 1].c : null;
  const horizon =
    forecast && forecast.length > 0 && lastClose !== null
      ? (forecast[forecast.length - 1].predicted - lastClose) / lastClose
      : null;

  const enough = bars.length >= 50;

  return (
    <>
      <PageHead
        title="LSTM Price Prediction"
        sub="Train, evaluate and forecast — trained in your browser, deterministically"
        actions={<SourceTag source={market.source} at={market.dates[market.dates.length - 1]} withTime />}
      />

      <div className="stack">
        <Card>
          <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="field">
              <label className="field-label" htmlFor="forecast-symbol">
                Instrument
              </label>
              <select
                id="forecast-symbol"
                className="select"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setTouched(true);
                }}
              >
                {assets.map((asset) => (
                  <option key={asset.symbol} value={asset.symbol}>
                    {asset.symbol} — {asset.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={training || !enough}
                onClick={() => {
                  setTouched(false);
                  void trainLstm(symbol);
                }}
              >
                {training ? 'Training…' : trainedHere ? 'Retrain model' : 'Train model'}
              </button>
            </div>
          </div>

          {training ? (
            <div style={{ marginTop: 14 }}>
              <Progress value={lstmProgress} label={`Training ${symbol}`} />
            </div>
          ) : null}

          {lstmStatus === 'error' && lstmError ? (
            <div style={{ marginTop: 14 }}>
              <ErrorBox>{lstmError}</ErrorBox>
            </div>
          ) : null}

          {!enough ? (
            <div style={{ marginTop: 14 }}>
              <ErrorBox>
                {symbol} has only {bars.length} sessions in the active dataset — the model needs at least
                50. Import a longer history or switch instrument.
              </ErrorBox>
            </div>
          ) : null}
        </Card>

        {trainedHere && lstmMeta ? (
          <>
            <div className="grid grid-4 grid-metrics">
              <MetricTile
                label="Test RMSE"
                value={`₹${lstmMeta.metrics.testRmse.toFixed(2)}`}
                note="held-out segment"
              />
              <MetricTile label="Test MAE" value={`₹${lstmMeta.metrics.testMae.toFixed(2)}`} note="held-out segment" />
              <MetricTile
                label="Skill vs naive"
                value={ratio(lstmMeta.metrics.skill)}
                tone={lstmMeta.metrics.skill > 0 ? 'pos' : 'neg'}
                note="1 − RMSE / persistence"
              />
              <MetricTile
                label="Validation RMSE"
                value={`₹${lstmMeta.metrics.valRmse.toFixed(2)}`}
                note={`best epoch ${lstmMeta.history.bestEpoch + 1}`}
              />
            </div>

            <Section
              title="7-session forecast"
              note={`Model trained on ${lstmMeta.symbol} · ${formatDate(lstmMeta.trainedAt)}`}
            >
              <Card>
                <div className="chart-legend" style={{ marginBottom: 8 }}>
                  <span className="legend-key">
                    <span className="legend-swatch legend-swatch--grey" /> Actual close
                  </span>
                  <span className="legend-key">
                    <span className="legend-swatch" style={{ background: CHART_COLORS.signal }} /> Forecast
                  </span>
                  <span className="legend-key">
                    <span className="legend-swatch legend-swatch--band" /> 95% residual band
                  </span>
                </div>
                <LineChart
                  series={priceSeries}
                  band={band}
                  height={280}
                  formatY={(v) => v.toFixed(0)}
                  formatX={(v) => formatShortDate(v)}
                />
                <div className="grid grid-3" style={{ marginTop: 14 }}>
                  <MetricTile label="Last close" value={lastClose === null ? '—' : inr(lastClose, 2)} />
                  <MetricTile
                    label="7-session forecast"
                    value={
                      forecast && forecast.length > 0 ? inr(forecast[forecast.length - 1].predicted, 2) : '—'
                    }
                    note={forecast ? `± band ₹${lstmMeta.bandWidth.toFixed(2)} × √step` : undefined}
                  />
                  <MetricTile
                    label="Implied change"
                    value={horizon === null ? '—' : pct(horizon)}
                    tone={horizon === null ? 'flat' : horizon >= 0 ? 'pos' : 'neg'}
                  />
                </div>
              </Card>
            </Section>

            <div className="grid grid-main-aside">
              <Section title="Training curve" note={`${lstmMeta.history.trainLoss.length} epochs`}>
                <Card>
                  <div className="chart-legend" style={{ marginBottom: 8 }}>
                    <span className="legend-key">
                      <span className="legend-swatch" style={{ background: CHART_COLORS.signal }} /> Train
                      loss (MSE)
                    </span>
                    <span className="legend-key">
                      <span className="legend-swatch" style={{ background: CHART_COLORS.orange }} /> Validation
                      loss
                    </span>
                  </div>
                  <LineChart
                    series={lossSeries}
                    height={220}
                    formatY={(v) => v.toFixed(3)}
                    formatX={(v) => `ep ${Math.round(v) + 1}`}
                  />
                  {lstmMeta.history.stoppedEarly ? (
                    <p className="disclaimer" style={{ marginTop: 10 }}>
                      Early stopping triggered at epoch {lstmMeta.history.bestEpoch + 1} — the weights with
                      the lowest validation loss were kept.
                    </p>
                  ) : null}
                </Card>
              </Section>

              <Section title="Configuration">
                <Card>
                  <div className="kv">
                    <span className="k">Sequence length</span>
                    <span className="v mono">{lstmMeta.config.seqLen}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Hidden units</span>
                    <span className="v mono">{lstmMeta.config.hidden}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Learning rate</span>
                    <span className="v mono">{lstmMeta.config.lr}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Seed</span>
                    <span className="v mono">{lstmMeta.config.seed}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Train / val / test</span>
                    <span className="v mono">
                      {lstmMeta.split.trainEnd} / {lstmMeta.split.valEnd - lstmMeta.split.trainEnd} /{' '}
                      {lstmMeta.split.total - lstmMeta.split.valEnd}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="k">Sessions used</span>
                    <span className="v mono">{lstmMeta.sessions}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Naive RMSE</span>
                    <span className="v mono">₹{lstmMeta.metrics.naiveTestRmse.toFixed(2)}</span>
                  </div>
                </Card>
              </Section>
            </div>

            {touched && !trainedHere ? (
              <Note tone="alert">
                <span>
                  The trained model belongs to <strong>{lstmMeta.symbol}</strong>. Retrain for{' '}
                  <strong>{symbol}</strong> to see its forecast — the app never applies one instrument's
                  weights to another.
                </span>
              </Note>
            ) : null}
          </>
        ) : !training ? (
          <EmptyState title="No model trained yet">
            Training runs entirely in your browser: an LSTM with Adam optimisation, normalisation fitted
            on the training segment only, and a train / validation / test split of{' '}
            {Math.round(DEFAULT_LSTM_CONFIG.trainFraction * 100)}% /{' '}
            {Math.round(DEFAULT_LSTM_CONFIG.valFraction * 100)}% /{' '}
            {Math.round((1 - DEFAULT_LSTM_CONFIG.trainFraction - DEFAULT_LSTM_CONFIG.valFraction) * 100)}%
            with early stopping. Results are reproducible from the fixed seed ({DEFAULT_LSTM_CONFIG.seed}).
          </EmptyState>
        ) : null}

        <Note>
          <span>
            <strong>How to read this.</strong> “Actual” is the historical fit on sessions the model has
            seen; the forecast extends past the last close with a residual band that widens with √step —
            a documented heuristic, not a calibrated confidence interval. Skill compares test RMSE against
            a persistence (yesterday’s close) baseline on the same held-out segment. A positive number
            means the model beat the naive forecast on this data; it does not predict future returns.
          </span>
        </Note>

        <p className="disclaimer">
          Model output is research, not investment advice. Nothing here is a guarantee of returns, and no
          order is ever sent to a real broker by this application.
        </p>
      </div>
    </>
  );
}
