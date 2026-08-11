/**
 * Shared chart pieces (recharts) following the dataviz design brief (SPEC §6):
 *
 *  - single hue #0F6B5C for single-series bars/lines; the validated lighter
 *    step #63A296 joins it for two-series given/received bars (one hue, two
 *    shades — passes the ordinal ramp checks light-end 2.9:1);
 *  - behaviour colours appear ONLY on behaviour charts, and identity is never
 *    colour-alone there: the behaviour NAME is always printed on the axis and
 *    counts ride the bar ends (the seeded DB palette's adjacent-CVD spread is
 *    below the standalone-categorical floor, so labels are the identity channel);
 *  - light solid hairline grid #E3E9E7, thin marks with rounded data-ends,
 *    no legends where direct labels do the work, plain number formatting;
 *  - every chart card can carry a "View data" table twin so no value is
 *    gated behind hover.
 */
import React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatNum, formatPct } from '../format'

export const CHART_GREEN = '#0f6b5c'
export const CHART_GREEN_LIGHT = '#63a296'
export const CHART_GRID = '#e3e9e7'
export const CHART_TEXT = '#5f7069'

const AXIS_TICK = { fill: CHART_TEXT, fontSize: 12 }
const AXIS_LINE = { stroke: CHART_GRID }

// ── Card wrapper with optional legend + table twin ──────────────────────────

export function ChartCard({
  title,
  sub,
  legend,
  table,
  children,
  className,
}: {
  title: string
  sub?: string
  legend?: { label: string; colour: string }[]
  /** Accessible twin of the plotted values — renders as a collapsed table. */
  table?: { headers: string[]; rows: (string | number)[][] }
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <section className={`card card-pad${className ? ` ${className}` : ''}`}>
      <div className="card-title">
        <div>
          <h2>{title}</h2>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
      </div>
      {legend && legend.length > 1 && (
        <div className="chart-legend">
          {legend.map((l) => (
            <span key={l.label}>
              <span className="legend-swatch" style={{ background: l.colour }} aria-hidden />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {children}
      {table && (
        <details className="chart-data">
          <summary>View data</summary>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {table.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className={typeof cell === 'number' ? 'num' : undefined}>
                        {typeof cell === 'number' ? formatNum(cell) : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

interface TipEntry {
  name?: string | number
  value?: string | number | (string | number)[]
  color?: string
}

/** Minimal tooltip: value leads, series key is a short colour stroke. */
export function ChartTip(props: {
  active?: boolean
  label?: string | number
  payload?: TipEntry[]
}): React.ReactElement | null {
  const { active, label, payload } = props
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="chart-tip">
      {label !== undefined && label !== '' && <div className="tip-label">{String(label)}</div>}
      {payload.map((entry, i) => (
        <div className="tip-row" key={i}>
          <span className="tip-key" style={{ background: entry.color ?? CHART_GREEN }} aria-hidden />
          <span className="tip-value">{formatNum(Number(entry.value ?? 0))}</span>
          {entry.name !== undefined && <span>{String(entry.name)}</span>}
        </div>
      ))}
    </div>
  )
}

const HOVER_CURSOR = { fill: 'rgba(15, 107, 92, 0.06)' }

// ── Weekly trend line ────────────────────────────────────────────────────────

export function TrendLine({
  data,
  name = 'Recognitions',
}: {
  data: { label: string; count: number }[]
  name?: string
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<ChartTip />} cursor={{ stroke: CHART_GRID }} />
        {/* No mark animation anywhere: these charts refetch on a poll/filter
            cadence and animated marks re-draw with stale scales mid-flight. */}
        <Line
          type="monotone"
          dataKey="count"
          name={name}
          stroke={CHART_GREEN}
          strokeWidth={2}
          isAnimationActive={false}
          dot={{ r: 3, fill: CHART_GREEN, stroke: '#fff', strokeWidth: 2 }}
          activeDot={{ r: 5, fill: CHART_GREEN, stroke: '#fff', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Grouped columns: given vs received (one hue, two shades) ─────────────────

export function GivenReceivedBars({
  data,
}: {
  data: { name: string; given: number; received: number }[]
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid stroke={CHART_GRID} vertical={false} />
        <XAxis dataKey="name" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={0} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<ChartTip />} cursor={HOVER_CURSOR} />
        <Bar dataKey="given" name="Given" fill={CHART_GREEN_LIGHT} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="received" name="Received" fill={CHART_GREEN} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export const GIVEN_RECEIVED_LEGEND = [
  { label: 'Given', colour: CHART_GREEN_LIGHT },
  { label: 'Received', colour: CHART_GREEN },
]

// ── Horizontal bars in behaviour colours (names always on the axis) ─────────

export function BehaviourBars({
  data,
  showPct = false,
}: {
  data: { name: string; colour: string; count: number; pct?: number }[]
  showPct?: boolean
}): React.ReactElement {
  // Grow with the data so the axis band never gets crushed out of the card.
  const height = Math.max(120, data.length * 40 + 24)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={CHART_GRID} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={148}
          tick={{ ...AXIS_TICK, fill: '#172723' }}
          axisLine={AXIS_LINE}
          tickLine={false}
          interval={0}
        />
        <Tooltip content={<ChartTip />} cursor={HOVER_CURSOR} />
        <Bar dataKey="count" name="Recognitions" barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((row) => (
            <Cell key={row.name} fill={row.colour} />
          ))}
          <LabelList
            dataKey={showPct ? 'label' : 'count'}
            position="right"
            fill={CHART_TEXT}
            fontSize={12}
            formatter={(v: unknown) => (typeof v === 'number' ? formatNum(v) : String(v ?? ''))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Precompute "count · pct%" end-labels for BehaviourBars showPct mode. */
export function withPctLabels<T extends { count: number; pct?: number }>(
  rows: T[],
): (T & { label: string })[] {
  return rows.map((r) => ({
    ...r,
    label: r.pct !== undefined ? `${formatNum(r.count)} · ${formatPct(r.pct)}` : formatNum(r.count),
  }))
}

// ── Single-hue horizontal bars (direction mix etc.) ─────────────────────────

export function SingleHueBars({
  data,
  axisWidth = 148,
}: {
  data: { name: string; count: number; label?: string }[]
  axisWidth?: number
}): React.ReactElement {
  const height = Math.max(100, data.length * 40 + 24)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={CHART_GRID} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={axisWidth}
          tick={{ ...AXIS_TICK, fill: '#172723' }}
          axisLine={AXIS_LINE}
          tickLine={false}
          interval={0}
        />
        <Tooltip content={<ChartTip />} cursor={HOVER_CURSOR} />
        <Bar dataKey="count" name="Count" fill={CHART_GREEN} barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList
            dataKey={data.some((d) => d.label) ? 'label' : 'count'}
            position="right"
            fill={CHART_TEXT}
            fontSize={12}
            formatter={(v: unknown) => (typeof v === 'number' ? formatNum(v) : String(v ?? ''))}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}): React.ReactElement {
  return (
    <div className="stat-tile">
      <div className="stat-tile-value">{typeof value === 'number' ? formatNum(value) : value}</div>
      <div className="stat-tile-label">{label}</div>
      {sub && <div className="card-sub" style={{ marginTop: 4, fontSize: 11 }}>{sub}</div>}
    </div>
  )
}
