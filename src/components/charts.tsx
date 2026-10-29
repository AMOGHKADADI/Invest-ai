import { useId } from 'react';

/* Lightweight SVG charts — no chart dependency, full control over the design. */

export const CHART_COLORS = {
  signal: '#FFDC16',
  alert: '#FF2D3D',
  positive: '#37D67A',
  orange: '#FF8A3D',
  grey: '#7D7D78',
  paper: '#F7F7F4',
};

export const ALLOCATION_COLORS = [
  '#FFDC16',
  '#FF8A3D',
  '#37D67A',
  '#7D7D78',
  '#FF2D3D',
  '#B4B4AE',
];

export interface SeriesPoint {
  x: number;
  y: number;
}

export interface LineSeries {
  id: string;
  label: string;
  points: SeriesPoint[];
  color: string;
  dashed?: boolean;
  area?: boolean;
}

interface LineChartProps {
  series: LineSeries[];
  height?: number;
  /** Optional confidence band aligned with the series at `bandSeriesIndex`. */
  band?: { lower: number[]; upper: number[]; color: string; seriesId: string };
  formatY?: (value: number) => string;
  formatX?: (value: number) => string;
  /** Value shown on the horizontal cursor labels. */
  yTickCount?: number;
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }
  const span = max - min;
  const step = span / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

/** Multi-series line/area chart with an optional confidence band. */
export function LineChart({
  series,
  height = 220,
  band,
  formatY = (v) => formatCompact(v),
  formatX = (v) => shortDate(v),
  yTickCount = 4,
}: LineChartProps) {
  const clipId = useId();
  const width = 720;
  const padLeft = 56;
  const padRight = 12;
  const padTop = 10;
  const padBottom = 24;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return <div className="empty">No data to chart yet.</div>;
  }

  const xMin = Math.min(...allPoints.map((p) => p.x));
  let xMax = Math.max(...allPoints.map((p) => p.x));
  let yMin = Math.min(...allPoints.map((p) => p.y));
  let yMax = Math.max(...allPoints.map((p) => p.y));

  if (band) {
    yMin = Math.min(yMin, ...band.lower);
    yMax = Math.max(yMax, ...band.upper);
  }
  if (xMin === xMax) xMax = xMin + 1;
  const yPad = (yMax - yMin || Math.abs(yMax) || 1) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const sx = (x: number) => padLeft + ((x - xMin) / (xMax - xMin)) * plotW;
  const sy = (y: number) => padTop + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  const path = (points: SeriesPoint[]): string =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`).join(' ');

  const yTicks = niceTicks(yMin + yPad, yMax - yPad, yTickCount);
  const xTicks = niceTicks(xMin, xMax, 4);

  const bandPath = (() => {
    if (!band || band.lower.length === 0) return null;
    const bandSeries = series.find((s) => s.id === band.seriesId);
    if (!bandSeries) return null;
    const base = bandSeries.points;
    const up = base
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(2)} ${sy(band.upper[i] ?? p.y).toFixed(2)}`)
      .join(' ');
    const down = [...base]
      .reverse()
      .map((p, i) => {
        const idx = base.length - 1 - i;
        return `L${sx(p.x).toFixed(2)} ${sy(band.lower[idx] ?? p.y).toFixed(2)}`;
      })
      .join(' ');
    return `${up} ${down} Z`;
  })();

  return (
    <div>
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={series.map((s) => s.label).join(' vs ')}
        preserveAspectRatio="none"
        style={{ height }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={padLeft} y={padTop} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {yTicks.map((tick, i) => (
          <g key={`y${i}`}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={sy(tick)}
              y2={sy(tick)}
              stroke="#2a2a28"
              strokeWidth={1}
            />
            <text x={padLeft - 8} y={sy(tick) + 4} textAnchor="end" fontSize={10} fill="#7d7d78">
              {formatY(tick)}
            </text>
          </g>
        ))}

        {xTicks.map((tick, i) => (
          <text
            key={`x${i}`}
            x={sx(tick)}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            fontSize={10}
            fill="#7d7d78"
          >
            {formatX(tick)}
          </text>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {bandPath && <path d={bandPath} fill={band!.color} stroke="none" />}
          {series.map((s) =>
            s.area ? (
              <path
                key={`${s.id}-area`}
                d={`${path(s.points)} L${sx(s.points[s.points.length - 1].x)} ${sy(yMin)} L${sx(
                  s.points[0].x,
                )} ${sy(yMin)} Z`}
                fill={s.color}
                opacity={0.12}
              />
            ) : null,
          )}
          {series.map((s) => (
            <path
              key={s.id}
              d={path(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 1.75 : 2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span className="legend-key" key={s.id}>
            <span
              className={`legend-swatch${s.dashed ? ' legend-swatch--dashed' : ''}`}
              style={{ background: s.dashed ? undefined : s.color }}
            />
            {s.label}
          </span>
        ))}
        {band && (
          <span className="legend-key">
            <span className="legend-swatch legend-swatch--band" />
            Confidence range
          </span>
        )}
      </div>
    </div>
  );
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  if (abs >= 100) return value.toFixed(0);
  return value.toFixed(abs < 1 ? 2 : 1);
}

function shortDate(ts: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(ts));
}

/** Compact sparkline for cards and rows. */
export function Sparkline({
  values,
  color = CHART_COLORS.signal,
  height = 40,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  if (values.length < 2) return null;
  const width = 160;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      style={{ height }}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Small bar glyph used on the portfolio value card (as in the reference). */
export function MiniBars({ values, color = '#0B0B0B', height = 34 }: { values: number[]; color?: string; height?: number }) {
  const bars = values.slice(-8);
  const max = Math.max(...bars.map((v) => Math.abs(v)), 1);
  return (
    <svg viewBox="0 0 60 34" width={60} height={height} aria-hidden="true">
      {bars.map((v, i) => {
        const h = Math.max(3, (Math.abs(v) / max) * 30);
        return (
          <rect
            key={i}
            x={i * 7.5}
            y={32 - h}
            width={5}
            height={h}
            rx={1.5}
            fill={color}
            opacity={0.35 + (i / bars.length) * 0.65}
          />
        );
      })}
    </svg>
  );
}

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Allocation donut. */
export function Donut({ slices, size = 150 }: { slices: DonutSlice[]; size?: number }) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  const radius = 54;
  const stroke = 17;
  const circumference = 2 * Math.PI * radius;
  if (total <= 0) return <div className="empty">Nothing to allocate yet.</div>;

  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 130 130" role="img" aria-label="Asset allocation">
      <circle cx="65" cy="65" r={radius} fill="none" stroke="#1a1a1a" strokeWidth={stroke} />
      {slices.map((slice) => {
        const fraction = slice.value / total;
        const dash = Math.max(0, fraction * circumference - 2);
        const el = (
          <circle
            key={slice.key}
            cx="65"
            cy="65"
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 65 65)"
          />
        );
        offset += fraction * circumference;
        return el;
      })}
      <text
        x="65"
        y="61"
        textAnchor="middle"
        fontSize="10"
        fill="#7d7d78"
        style={{ letterSpacing: '0.06em' }}
      >
        ALLOCATION
      </text>
      <text x="65" y="77" textAnchor="middle" fontSize="14" fontWeight="700" fill="#F7F7F4">
        {slices.filter((s) => s.value > 0).length} assets
      </text>
    </svg>
  );
}

/** Circular sentiment gauge. */
export function Gauge({
  fraction,
  caption,
  size = 132,
}: {
  fraction: number;
  caption: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const color = clamped >= 0.6 ? CHART_COLORS.positive : clamped >= 0.4 ? CHART_COLORS.signal : CHART_COLORS.alert;
  return (
    <svg width={size} height={size} viewBox="0 0 130 130" role="img" aria-label={caption}>
      <circle cx="65" cy="65" r={radius} fill="none" stroke="#1a1a1a" strokeWidth="13" />
      <circle
        cx="65"
        cy="65"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray={`${clamped * circumference} ${circumference}`}
        transform="rotate(-90 65 65)"
      />
      <text x="65" y="66" textAnchor="middle" fontSize="26" fontWeight="750" fill="#F7F7F4">
        {Math.round(clamped * 100)}%
      </text>
      <text x="65" y="84" textAnchor="middle" fontSize="10" fill="#7d7d78">
        {caption}
      </text>
    </svg>
  );
}

/** Simple vertical histogram (used for drawdown / volume style displays). */
export function Bars({
  values,
  height = 70,
  color = CHART_COLORS.orange,
  baseline = 0,
}: {
  values: number[];
  height?: number;
  color?: string;
  baseline?: number;
}) {
  if (values.length === 0) return null;
  const width = 240;
  const max = Math.max(...values.map((v) => Math.abs(v - baseline)), 1e-9);
  const barW = width / values.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" style={{ height }} preserveAspectRatio="none" aria-hidden="true">
      <line
        x1={0}
        x2={width}
        y1={height - ((baseline - Math.min(...values, baseline)) / (max || 1)) * (height - 4)}
        y2={height - ((baseline - Math.min(...values, baseline)) / (max || 1)) * (height - 4)}
        stroke="#2a2a28"
      />
      {values.map((v, i) => {
        const h = (Math.abs(v - baseline) / max) * (height - 6);
        const y = v >= baseline ? height - h - 2 : 2;
        return (
          <rect
            key={i}
            x={i * barW + 1}
            y={y}
            width={Math.max(1, barW - 2)}
            height={Math.max(1, h)}
            fill={v >= baseline ? color : CHART_COLORS.alert}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
