import { useMemo } from 'react';
import { useStore } from '../app/store';
import {
  Card,
  ErrorBox,
  Icon,
  MetricTile,
  Note,
  PageHead,
  Progress,
  Section,
  SourceTag,
  Toggle,
} from '../components/ui';
import { assessRisk } from '../lib/risk';
import { summarizeEquity } from '../lib/metrics';
import { pct, ratio } from '../lib/format';

export default function Risk() {
  const store = useStore();
  const { settings, riskSettings, equityCurve, prices, holdings, cash, sectors, updateSettings } = store;

  const summary = useMemo(() => summarizeEquity(equityCurve, { riskFreeRate: 0 }), [equityCurve]);

  const assessment = useMemo(
    () =>
      assessRisk({
        equityCurve,
        account: { cash, holdings },
        prices,
        sectors,
        settings: riskSettings,
        sharpe: summary.sharpe,
        sortino: summary.sortino,
        volatilityAnnual: summary.volatility,
      }),
    [cash, equityCurve, holdings, prices, riskSettings, sectors, summary],
  );

  const disabledCount = [
    settings.stopLossEnabled,
    settings.positionSizingEnabled,
    settings.diversificationEnabled,
    settings.drawdownHaltEnabled,
  ].filter((enabled) => !enabled).length;

  return (
    <>
      <PageHead
        title="Risk Management"
        sub="Live limits, controls and portfolio-level assessment"
        actions={<SourceTag source={store.market.source} />}
      />

      <div className="stack">
        <div className="grid grid-main-aside">
          <div className="stack">
            <Card>
              <div className="spread">
                <div>
                  <div className="card-label">Risk level</div>
                  <div
                    className="card-value"
                    style={{
                      color:
                        assessment.level === 'high'
                          ? '#FF2D3D'
                          : assessment.level === 'medium'
                            ? '#FF8A3D'
                            : '#37D67A',
                      textTransform: 'capitalize',
                    }}
                  >
                    {assessment.level}
                  </div>
                  <div className="card-label" style={{ marginTop: 4 }}>
                    Composite of limit utilisation and realised risk
                  </div>
                </div>
                <div style={{ width: 'min(280px, 45%)' }}>
                  <Progress value={assessment.score} label="Breach severity" />
                  <div className="kv" style={{ marginTop: 10 }}>
                    <span className="k">Current drawdown</span>
                    <span className="v neg">{pct(-assessment.drawdown)}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Halt threshold</span>
                    <span className="v">-{(settings.drawdownHaltPct * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid grid-4 grid-metrics">
              <MetricTile label="Sharpe ratio" value={ratio(summary.sharpe)} note="rf 0%, 252 sessions" />
              <MetricTile label="Sortino ratio" value={ratio(summary.sortino)} note="downside deviation" />
              <MetricTile
                label="Max drawdown"
                value={summary.maxDrawdown ? pct(-summary.maxDrawdown.pct) : '—'}
                tone="neg"
                note={summary.maxDrawdown?.recoveryIndex ? 'recovered' : 'peak-to-trough'}
              />
              <MetricTile
                label="Volatility"
                value={summary.volatility === null ? '—' : pct(summary.volatility)}
                note="annualised"
              />
            </div>

            <Card>
              <div className="section-title" style={{ marginBottom: 4 }}>
                Live checks
              </div>
              <div className="stack stack--sm" style={{ marginTop: 8 }}>
                {assessment.items.map((item) => (
                  <div className="control-row" key={item.key}>
                    <div className="inline" style={{ gap: 10, alignItems: 'flex-start' }}>
                      <span
                        className={`status-dot${
                          item.status === 'breach'
                            ? ' status-dot--breach'
                            : item.status === 'warn'
                              ? ' status-dot--warn'
                              : ''
                        }`}
                        style={{ marginTop: 6 }}
                      />
                      <div>
                        <div className="setting-name">{item.label}</div>
                        <div className="setting-desc">{item.detail}</div>
                      </div>
                    </div>
                    <span
                      className={`badge ${
                        item.status === 'breach'
                          ? 'badge--sell'
                          : item.status === 'warn'
                            ? 'badge--warn'
                            : 'badge--buy'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="stack">
            <Card>
              <div className="section-title" style={{ marginBottom: 6 }}>
                Risk controls
              </div>
              {disabledCount > 0 ? (
                <div style={{ margin: '8px 0' }}>
                  <ErrorBox>
                    {disabledCount} control{disabledCount > 1 ? 's' : ''} disabled — the risk layer will not
                    enforce the related limits on new orders.
                  </ErrorBox>
                </div>
              ) : null}

              <Toggle
                label="Stop loss"
                hint={`Auto-flag positions below -${(settings.stopLossPct * 100).toFixed(0)}%`}
                checked={settings.stopLossEnabled}
                onChange={(next) => updateSettings({ stopLossEnabled: next })}
              />
              <NumberField
                label="Stop-loss threshold"
                value={settings.stopLossPct * 100}
                min={1}
                max={50}
                suffix="%"
                disabled={!settings.stopLossEnabled}
                onChange={(v) => updateSettings({ stopLossPct: v / 100 })}
              />

              <Toggle
                label="Position sizing"
                hint={`Max ${(
                  settings.maxPositionPct * 100
                ).toFixed(0)}% of equity in a single stock`}
                checked={settings.positionSizingEnabled}
                onChange={(next) => updateSettings({ positionSizingEnabled: next })}
              />
              <NumberField
                label="Single-position cap"
                value={settings.maxPositionPct * 100}
                min={1}
                max={100}
                suffix="%"
                disabled={!settings.positionSizingEnabled}
                onChange={(v) => updateSettings({ maxPositionPct: v / 100 })}
              />

              <Toggle
                label="Diversification"
                hint={`Max ${(
                  settings.maxSectorPct * 100
                ).toFixed(0)}% of equity in a single sector`}
                checked={settings.diversificationEnabled}
                onChange={(next) => updateSettings({ diversificationEnabled: next })}
              />
              <NumberField
                label="Sector cap"
                value={settings.maxSectorPct * 100}
                min={1}
                max={100}
                suffix="%"
                disabled={!settings.diversificationEnabled}
                onChange={(v) => updateSettings({ maxSectorPct: v / 100 })}
              />

              <Toggle
                label="Max drawdown limit"
                hint={`Halt new buys at -${(settings.drawdownHaltPct * 100).toFixed(0)}% from the peak`}
                checked={settings.drawdownHaltEnabled}
                onChange={(next) => updateSettings({ drawdownHaltEnabled: next })}
              />
              <NumberField
                label="Drawdown halt"
                value={settings.drawdownHaltPct * 100}
                min={2}
                max={90}
                suffix="%"
                disabled={!settings.drawdownHaltEnabled}
                onChange={(v) => updateSettings({ drawdownHaltPct: v / 100 })}
              />
            </Card>

            <Note>
              <Icon name="info" className="ico" />
              <span>
                <strong>Assumptions.</strong> Ratios are computed from the replayed equity curve with a
                0% risk-free rate and 252 sessions per year; Sharpe and volatility use the sample
                standard deviation, Sortino uses downside deviation only. A ratio returns “—” when the
                history is too short or has zero variance.
              </span>
            </Note>

            <Section title="Execution rule">
              <Card tone="flat">
                <p className="disclaimer" style={{ lineHeight: 1.7 }}>
                  Every proposed order passes through <code className="mono">evaluateOrder</code>: quantity
                  validation, affordability including fees, the single-position cap, the sector cap and the
                  drawdown halt, in that order. Orders are trimmed when a limit would be exceeded and
                  rejected when no compliant quantity exists. Disabled controls are neutralised before the
                  check, and the reason for every trim or block is shown on the order ticket.
                </p>
              </Card>
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="setting-row">
      <div className="setting-name" style={{ fontSize: 13, fontWeight: 500, color: '#b4b4ae' }}>
        {label}
      </div>
      <div className="setting-control">
        <input
          className="input"
          style={{ width: 92, padding: '6px 10px', textAlign: 'right' }}
          type="number"
          min={min}
          max={max}
          step={1}
          value={Number(value.toFixed(1))}
          disabled={disabled}
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
