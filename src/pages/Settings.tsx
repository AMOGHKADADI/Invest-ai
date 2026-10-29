import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../app/store';
import {
  Card,
  ErrorBox,
  Icon,
  Note,
  PageHead,
  Section,
  SourceTag,
  Toggle,
} from '../components/ui';
import { grouped, pct } from '../lib/format';

export default function Settings() {
  const store = useStore();
  const {
    settings,
    updateSettings,
    market,
    dataNotice,
    importCsv,
    useDemoData: restoreDemoData,
    resetPortfolio,
    clearModels,
    lstmStatus,
    lstmMeta,
    dqnStatus,
    dqnMeta,
    trades,
    holdings,
  } = store;

  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null);

  const hasActivity = trades.length > 0 || holdings.length > 0;

  return (
    <>
      <PageHead
        title="Settings"
        sub="Trading preferences, model switches and data sources"
        actions={<SourceTag source={market.source} />}
      />

      <div className="stack">
        {dataNotice ? <Note tone="ok"><span>{dataNotice}</span></Note> : null}
        {importResult && !importResult.ok ? (
          <ErrorBox>{importResult.message}</ErrorBox>
        ) : null}

        <div className="grid grid-main-aside">
          <div className="stack">
            <Section title="Trading preferences">
              <Card>
                <NumberField
                  label="Initial investment"
                  hint="Paper capital used for valuation and backtests"
                  value={settings.initialCapital}
                  min={10_000}
                  max={100_000_000}
                  step={10_000}
                  suffix="₹"
                  onChange={(v) => updateSettings({ initialCapital: v })}
                />
                <NumberField
                  label="Transaction cost"
                  hint="Applied to every simulated fill"
                  value={settings.costBps}
                  min={0}
                  max={200}
                  step={1}
                  suffix="bps"
                  onChange={(v) => updateSettings({ costBps: v })}
                />
                <NumberField
                  label="Stop loss"
                  hint="Flags positions that fall this far below average cost"
                  value={settings.stopLossPct * 100}
                  min={1}
                  max={50}
                  step={0.5}
                  suffix="%"
                  onChange={(v) => updateSettings({ stopLossPct: v / 100 })}
                />
                <p className="field-hint">
                  Position, sector and drawdown limits live on the{' '}
                  <Link to="/risk">Risk Management</Link> page so they sit next to their live utilisation.
                </p>
              </Card>
            </Section>

            <Section title="Model settings">
              <Card>
                <Toggle
                  label="LSTM prediction"
                  hint={
                    lstmStatus === 'ready' && lstmMeta
                      ? `Trained on ${lstmMeta.symbol} · test RMSE ₹${lstmMeta.metrics.testRmse.toFixed(2)}`
                      : 'Feeds forecasts into signals when a model is trained'
                  }
                  checked={settings.lstmEnabled}
                  onChange={(next) => updateSettings({ lstmEnabled: next })}
                />
                <Toggle
                  label="Sentiment analysis"
                  hint="News scoring on the demo corpus; signals ignore sentiment when off"
                  checked={settings.sentimentEnabled}
                  onChange={(next) => updateSettings({ sentimentEnabled: next })}
                />
                <Toggle
                  label="DQN trading agent"
                  hint={
                    dqnStatus === 'ready' && dqnMeta
                      ? `Trained on ${dqnMeta.symbol} · ${dqnMeta.episodes} episodes`
                      : 'Contributes an action to signals once trained'
                  }
                  checked={settings.dqnEnabled}
                  onChange={(next) => updateSettings({ dqnEnabled: next })}
                />
                <p className="field-hint">
                  Turning a model off removes its contribution everywhere — signals, forecasts and
                  backtests — rather than hiding its output.
                </p>
              </Card>
            </Section>

            <Section title="App preferences">
              <Card>
                <Toggle
                  label="Dark mode"
                  hint="Dark is the only theme in this release"
                  checked
                  disabled
                  onChange={() => undefined}
                />
              </Card>
            </Section>
          </div>

          <div className="stack">
            <Section title="Data source">
              <Card>
                <div className="kv">
                  <span className="k">Active source</span>
                  <span className="v">{market.source.label}</span>
                </div>
                <div className="kv">
                  <span className="k">Kind</span>
                  <span className="v" style={{ textTransform: 'capitalize' }}>
                    {market.source.kind}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Sessions</span>
                  <span className="v mono">{market.dates.length}</span>
                </div>
                <div className="kv">
                  <span className="k">Instruments</span>
                  <span className="v mono">{market.assets.length}</span>
                </div>
                <p className="field-hint" style={{ marginTop: 8 }}>
                  {market.source.note}
                </p>

                <div className="stack stack--sm" style={{ marginTop: 12 }}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    aria-label="Import OHLCV CSV"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const text = await file.text();
                        setImportResult(importCsv(text));
                      } catch {
                        setImportResult({ ok: false, message: 'The file could not be read.' });
                      } finally {
                        e.target.value = '';
                      }
                    }}
                  />
                  <p className="field-hint">
                    CSV columns: <code className="mono">date,open,high,low,close,volume</code> with a{' '}
                    <code className="mono">symbol</code> column or filename. Imported files replace the
                    active dataset until you restore the demo.
                  </p>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      restoreDemoData();
                      setImportResult(null);
                    }}
                  >
                    Restore demo dataset
                  </button>
                </div>
              </Card>
            </Section>

            <Section title="Models">
              <Card>
                <div className="control-row">
                  <div>
                    <div className="setting-name">LSTM price model</div>
                    <div className="setting-desc">
                      {lstmStatus === 'ready' && lstmMeta
                        ? `Ready · ${lstmMeta.symbol}`
                        : lstmStatus === 'training'
                          ? 'Training…'
                          : lstmStatus === 'error'
                            ? 'Last training run failed'
                            : 'Not trained'}
                    </div>
                  </div>
                  <Link className="btn btn--ghost btn--sm" to="/forecast">
                    Manage
                  </Link>
                </div>
                <div className="control-row">
                  <div>
                    <div className="setting-name">DQN agent</div>
                    <div className="setting-desc">
                      {dqnStatus === 'ready' && dqnMeta
                        ? `Ready · ${dqnMeta.symbol}`
                        : dqnStatus === 'training'
                          ? 'Training…'
                          : dqnStatus === 'error'
                            ? 'Last training run failed'
                            : 'Not trained'}
                    </div>
                  </div>
                  <Link className="btn btn--ghost btn--sm" to="/signals">
                    Manage
                  </Link>
                </div>
                <button
                  type="button"
                  className="btn btn--danger btn--sm btn--block"
                  style={{ marginTop: 10 }}
                  disabled={lstmStatus === 'idle' && dqnStatus === 'idle'}
                  onClick={clearModels}
                >
                  Clear trained models
                </button>
                <p className="field-hint">
                  Models are stored in your browser's local storage and never uploaded.
                </p>
              </Card>
            </Section>

            <Section title="Paper portfolio">
              <Card>
                <div className="kv">
                  <span className="k">Transactions</span>
                  <span className="v mono">{trades.length}</span>
                </div>
                <div className="kv">
                  <span className="k">Open positions</span>
                  <span className="v mono">{holdings.length}</span>
                </div>
                <div className="kv">
                  <span className="k">Starting capital</span>
                  <span className="v mono">₹{grouped(settings.initialCapital)}</span>
                </div>
                <button
                  type="button"
                  className="btn btn--danger btn--sm btn--block"
                  style={{ marginTop: 10 }}
                  disabled={!hasActivity}
                  onClick={() => {
                    if (window.confirm('Reset the paper portfolio? Trades and holdings will be cleared.')) {
                      resetPortfolio();
                    }
                  }}
                >
                  Reset paper portfolio
                </button>
              </Card>
            </Section>

            <Note>
              <span>
                <Icon name="info" className="ico" />
                <span>
                  No API keys are stored in this application. All state — settings, paper trades and
                  trained weights — stays in local storage on this device.
                </span>
              </span>
            </Note>
          </div>
        </div>

        <p className="disclaimer">
          InvestAI is a research and education tool. It never connects to a brokerage, never places real
          orders and never claims guaranteed returns. Position cap{' '}
          {pct(settings.maxPositionPct, 0, false)}, sector cap {pct(settings.maxSectorPct, 0, false)} —
          managed on the Risk page.
        </p>
      </div>
    </>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-name">{label}</div>
        <div className="setting-desc">{hint}</div>
      </div>
      <div className="setting-control">
        <input
          className="input"
          style={{ width: 120, padding: '6px 10px', textAlign: 'right' }}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            onChange(Math.min(max, Math.max(min, next)));
          }}
        />
        <span className="section-note">{suffix}</span>
      </div>
    </div>
  );
}
