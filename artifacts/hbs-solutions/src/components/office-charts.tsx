import { useId, type ReactNode } from 'react';
import { chartSeries, color } from '@/design/tokens';
import { formatNumber } from '@/lib/format';

// Inline SVG charts for the office screens (no chart library). The rules
// follow the dataviz skill: thin marks with a rounded data end, a 2 px surface
// gap between touching marks, hairline gridlines, text in text tokens (never
// the series colour), direct labels only where they help, a legend from two
// series up, hover/focus tooltips on every mark, and a table view beside each
// chart so nothing depends on colour or hovering.

export type ChartRow = { key: string; label: string; value: number; href?: string };
export type ChartSeries = { key: string; label: string; color?: string };

const series = (index: number) => chartSeries[index % chartSeries.length];

/* ------------------------------------------------------------------ BarList */
// Horizontal single-hue bars, one row per category: label | bar | value.
// `format` renders the value; `max` fixes the scale across sibling charts.
export function BarList({ rows, max, format = formatNumber, label, emphasis, className = '' }: { rows: ChartRow[]; max?: number; format?: (value: number) => string; label: string; emphasis?: string; className?: string }) {
  const top = Math.max(1, max ?? Math.max(0, ...rows.map(r => r.value)));
  if (!rows.length) return <p className="oc-empty">لا توجد بيانات في هذه المدة.</p>;
  return <div className={`oc-bars ${className}`} role="img" aria-label={label}>
    {rows.map((row, index) => {
      const width = Math.max(row.value > 0 ? 1.5 : 0, (row.value / top) * 100);
      const fill = emphasis ? (row.key === emphasis ? chartSeries[0] : color.lineStrong) : chartSeries[0];
      return <div key={row.key} className="oc-bar-row">
        <span className="oc-bar-label">{row.label}</span>
        <svg className="oc-bar-svg" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <rect x="0" y="0" width="100" height="12" fill={color.sunk} />
          {row.value > 0 && <rect className="oc-mark" x="0" y="0" width={width} height="12" rx="0" fill={fill} style={{ animationDelay: `${index * 40}ms` }}>
            <title>{`${row.label}: ${format(row.value)}`}</title>
          </rect>}
        </svg>
        <span className="oc-bar-value nums" title={`${row.label}: ${format(row.value)}`}>{format(row.value)}</span>
      </div>;
    })}
  </div>;
}

/* --------------------------------------------------------------- StackedBar */
// One horizontal part-to-whole bar: segments in fixed series order with a 2 px
// surface gap between them, a legend with counts under it, and a tooltip per
// segment. Segments with a zero value stay in the legend (so the stage list is
// complete) but draw nothing.
export function StackedBar({ segments, label, format = formatNumber, height = 18, className = '' }: { segments: ChartRow[]; label: string; format?: (value: number) => string; height?: number; className?: string }) {
  const id = useId();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const width = 600;
  const gap = 2;
  const drawn = segments.filter(s => s.value > 0);
  const available = width - gap * Math.max(0, drawn.length - 1);
  let x = 0;
  return <div className={`oc-stack ${className}`}>
    <svg className="oc-stack-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-labelledby={`${id}-title`} style={{ height }}>
      <title id={`${id}-title`}>{`${label}: ${format(total)}`}</title>
      <rect x="0" y="0" width={width} height={height} rx="4" fill={color.sunk} />
      {total > 0 && drawn.map((segment) => {
        const index = segments.indexOf(segment);
        const w = Math.max(3, (segment.value / total) * available);
        const rect = <rect key={segment.key} className="oc-mark" x={x} y="0" width={w} height={height} fill={series(index)} tabIndex={0} role="img" aria-label={`${segment.label}: ${format(segment.value)}`}>
          <title>{`${segment.label}: ${format(segment.value)} (${Math.round((segment.value / total) * 100)}٪)`}</title>
        </rect>;
        x += w + gap;
        return rect;
      })}
    </svg>
    <ul className="oc-legend" aria-label={`مفتاح ${label}`}>{segments.map((segment, index) => <li key={segment.key} className={segment.value === 0 ? 'is-zero' : ''}>
      <span className="oc-swatch" style={{ background: series(index) }} aria-hidden="true" />
      <span className="oc-legend-label">{segment.label}</span>
      <span className="oc-legend-value nums">{format(segment.value)}</span>
    </li>)}</ul>
  </div>;
}

/* ------------------------------------------------------------------ Columns */
// Grouped columns: one group per category, one column per series. Columns are
// capped at 24 px, grow from a shared baseline with a rounded cap, and carry a
// tooltip; the end value is written only on the leading series of each group.
export function Columns({ groups, seriesList, label, format = formatNumber, height = 180, className = '' }: { groups: { key: string; label: string; values: number[] }[]; seriesList: ChartSeries[]; label: string; format?: (value: number) => string; height?: number; className?: string }) {
  const id = useId();
  if (!groups.length) return <p className="oc-empty">لا توجد بيانات في هذه المدة.</p>;
  const max = Math.max(1, ...groups.flatMap(g => g.values));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  const padStart = 36, padEnd = 8, padTop = 18, padBottom = 40;
  const slot = 72;
  const width = padStart + padEnd + groups.length * slot;
  const plotH = height - padTop - padBottom;
  const colW = Math.min(24, Math.floor((slot - 16) / seriesList.length) - 2);
  const y = (value: number) => padTop + plotH - (value / top) * plotH;
  return <div className={`oc-columns ${className}`}>
    <div className="oc-scroll scroll-thin">
      <svg className="oc-columns-svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>{label}</title>
        {ticks.map(tick => <g key={tick}>
          <line x1={padStart} x2={width - padEnd} y1={y(tick)} y2={y(tick)} stroke={color.line} strokeWidth="1" />
          <text x={padStart - 6} y={y(tick) + 4} textAnchor="end" className="oc-tick">{compact(tick)}</text>
        </g>)}
        {groups.map((group, gi) => {
          const groupX = padStart + gi * slot + (slot - (colW + 2) * seriesList.length) / 2;
          return <g key={group.key}>
            {seriesList.map((s, si) => {
              const value = group.values[si] ?? 0;
              const h = Math.max(value > 0 ? 2 : 0, (value / top) * plotH);
              const x = groupX + si * (colW + 2);
              const cy = y(value);
              const fill = s.color ?? series(si);
              return <g key={s.key} className="oc-mark" tabIndex={0} role="img" aria-label={`${group.label} · ${s.label}: ${format(value)}`}>
                <title>{`${group.label} · ${s.label}: ${format(value)}`}</title>
                <rect x={x - 4} y={padTop} width={colW + 8} height={plotH} fill="transparent" />
                {value > 0 && <path d={roundedTop(x, cy, colW, h, 4)} fill={fill} />}
                {si === 0 && value > 0 && <text x={x + colW / 2} y={cy - 5} textAnchor="middle" className="oc-value">{format(value)}</text>}
              </g>;
            })}
            <text x={groupX + ((colW + 2) * seriesList.length) / 2} y={height - padBottom + 16} textAnchor="middle" className="oc-axis">{truncate(group.label, 14)}</text>
          </g>;
        })}
        <line x1={padStart} x2={width - padEnd} y1={padTop + plotH} y2={padTop + plotH} stroke={color.lineStrong} strokeWidth="1" />
      </svg>
    </div>
    {seriesList.length > 1 && <ul className="oc-legend" aria-label={`مفتاح ${label}`}>{seriesList.map((s, si) => <li key={s.key}><span className="oc-swatch" style={{ background: s.color ?? series(si) }} aria-hidden="true" />{s.label}</li>)}</ul>}
  </div>;
}

/* ---------------------------------------------------------------- Sparkline */
// 12-point sparkline for KPI tiles (88 × 32, stroke in currentColor).
export function Sparkline({ points, className = '' }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;
  const w = 88, h = 32, pad = 3;
  const max = Math.max(1, ...points), min = Math.min(0, ...points);
  const step = (w - pad * 2) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true" focusable="false">
    <path d={`${d} L${(pad + (points.length - 1) * step).toFixed(1)} ${h - pad} L${pad} ${h - pad} Z`} fill="currentColor" opacity=".1" />
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx={pad + (points.length - 1) * step} cy={y(last)} r="4" fill="currentColor" stroke={color.surface} strokeWidth="2" />
  </svg>;
}

/* ------------------------------------------------------------- ChartTable */
// The table view that accompanies every chart (collapsed by default).
export function ChartTable({ columns, rows, summary = 'عرض الأرقام كجدول' }: { columns: string[]; rows: ReactNode[][]; summary?: string }) {
  if (!rows.length) return null;
  return <details className="oc-table">
    <summary>{summary}</summary>
    <table className="oc-table-grid">
      <thead><tr>{columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
      <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => c === 0 ? <th key={c} scope="row">{cell}</th> : <td key={c} className="nums">{cell}</td>)}</tr>)}</tbody>
    </table>
  </details>;
}

/* ------------------------------------------------------------------ helpers */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, h, w / 2);
  return `M${x} ${y + h} V${y + radius} Q${x} ${y} ${x + radius} ${y} H${x + w - radius} Q${x + w} ${y} ${x + w} ${y + radius} V${y + h} Z`;
}
function niceTicks(max: number, count: number): number[] {
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
const compact = (value: number) => value >= 1_000_000 ? `${formatNumber(Math.round(value / 100_000) / 10)}M` : value >= 1000 ? `${formatNumber(Math.round(value / 100) / 10)}K` : formatNumber(value);
const truncate = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
