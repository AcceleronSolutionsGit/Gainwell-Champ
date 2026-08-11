/**
 * /analytics — committee dashboard (FR-26…FR-31).
 * One IST date-range filter row scopes every widget below it. Single-hue
 * teal for magnitude charts; behaviour colours only on the behaviour
 * breakdown (names printed beside every bar); dark-spots table highlights
 * zero-activity groups; concentration shows the top-10% giver share.
 */
import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApi } from '../hooks'
import {
  BehaviourBars,
  ChartCard,
  GIVEN_RECEIVED_LEGEND,
  GivenReceivedBars,
  SingleHueBars,
  StatTile,
  TrendLine,
  withPctLabels,
} from '../components/charts'
import { Button, Card, EmptyState, ErrorState, Field, Loading } from '../components/ui'
import { formatIstShortDate, formatNum, formatPct, istDaysAgo, istToday } from '../format'
import type { DirectionMix } from '../types'

const PRESETS = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 7 days', days: 7 },
]

export default function Analytics(): React.ReactElement {
  const [from, setFrom] = useState(istDaysAgo(90))
  const [to, setTo] = useState(istToday())
  const range = useMemo(() => ({ from, to }), [from, to])

  const summary = useApi(() => api.analyticsSummary(range), [range])
  const split = useApi(() => api.analyticsFunctionShift(range), [range])
  const behaviours = useApi(() => api.analyticsBehaviours(range), [range])
  const direction = useApi(() => api.analyticsDirection(range), [range])
  const darkSpots = useApi(() => api.analyticsDarkSpots(range), [range])
  const concentration = useApi(() => api.analyticsConcentration(range), [range])

  const activePresetDays = useMemo(() => {
    if (to !== istToday()) return null
    return PRESETS.find((p) => istDaysAgo(p.days) === from)?.days ?? null
  }, [from, to])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <div className="page-sub">Programme health across sites, functions and shifts (IST calendar)</div>
        </div>
      </div>

      {/* One filter row scopes everything below — all widgets share the slice. */}
      <div className="filter-bar">
        {PRESETS.map((p) => (
          <Button
            key={p.days}
            small
            variant={activePresetDays === p.days ? 'primary' : 'ghost'}
            onClick={() => {
              setFrom(istDaysAgo(p.days))
              setTo(istToday())
            }}
          >
            {p.label}
          </Button>
        ))}
        <Field label="From">
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      {/* KPI tiles */}
      {summary.error ? (
        <ErrorState error={summary.error} retry={summary.reload} />
      ) : summary.loading || !summary.data ? (
        <Loading label="Crunching the numbers…" />
      ) : (
        <div className={summary.refreshing ? 'refetch-dim' : ''}>
          <div className="tile-row">
            <StatTile label="Recognitions" value={summary.data.recognitions} />
            <StatTile label="Active employees" value={summary.data.activeEmployees} />
            <StatTile
              label="Gave recognition"
              value={formatPct(summary.data.pctGivers)}
              sub={`${formatNum(summary.data.givers)} people`}
            />
            <StatTile
              label="Received recognition"
              value={formatPct(summary.data.pctReceivers)}
              sub={`${formatNum(summary.data.receivers)} people`}
            />
          </div>

          <div className="chart-grid" style={{ marginBottom: 16 }}>
            <ChartCard
              className="span-2"
              title="Weekly trend"
              sub="Recognitions per IST week (Monday start)"
              table={{
                headers: ['Week starting', 'Recognitions'],
                rows: summary.data.weekly.map((w) => [formatIstShortDate(w.weekStartIst), w.count]),
              }}
            >
              {summary.data.weekly.length === 0 ? (
                <EmptyState title="No activity in this range" />
              ) : (
                <TrendLine
                  data={summary.data.weekly.map((w) => ({ label: formatIstShortDate(w.weekStartIst), count: w.count }))}
                />
              )}
            </ChartCard>
          </div>
        </div>
      )}

      {/* Function & shift split (FR-27 — floor vs office equity) */}
      <div className="chart-grid" style={{ marginBottom: 16 }}>
        {split.error ? (
          <ErrorState error={split.error} retry={split.reload} />
        ) : split.data ? (
          <>
            <ChartCard
              title="By function"
              sub="Given vs received, with giver participation"
              legend={GIVEN_RECEIVED_LEGEND}
              table={{
                headers: ['Function', 'Headcount', 'Given', 'Received', 'Giver participation'],
                rows: split.data.functions.map((f) => [
                  f.name,
                  f.headcount,
                  f.given,
                  f.received,
                  formatPct(f.giverParticipationPct),
                ]),
              }}
            >
              <GivenReceivedBars data={split.data.functions} />
            </ChartCard>
            <ChartCard
              title="By shift"
              sub="Are shop-floor shifts participating like the office?"
              legend={GIVEN_RECEIVED_LEGEND}
              table={{
                headers: ['Shift', 'Headcount', 'Given', 'Received', 'Giver participation'],
                rows: split.data.shifts.map((s) => [
                  s.name,
                  s.headcount,
                  s.given,
                  s.received,
                  formatPct(s.giverParticipationPct),
                ]),
              }}
            >
              <GivenReceivedBars data={split.data.shifts} />
            </ChartCard>
          </>
        ) : split.loading ? (
          <Loading />
        ) : null}
      </div>

      {/* Behaviour breakdown (FR-28) + direction mix (FR-29) */}
      <div className="chart-grid" style={{ marginBottom: 16 }}>
        {behaviours.error ? (
          <ErrorState error={behaviours.error} retry={behaviours.reload} />
        ) : behaviours.data ? (
          <ChartCard
            title="Behaviour breakdown"
            sub="Share of recognitions per CHAMP behaviour"
            table={{
              headers: ['Behaviour', 'Count', 'Share'],
              rows: behaviours.data.map((b) => [b.name, b.count, formatPct(b.pct)]),
            }}
          >
            {behaviours.data.length === 0 ? (
              <EmptyState title="No recognitions in this range" />
            ) : (
              <BehaviourBars
                data={withPctLabels(
                  behaviours.data.map((b) => ({ name: b.name, colour: b.colour, count: b.count, pct: b.pct })),
                )}
                showPct
              />
            )}
          </ChartCard>
        ) : behaviours.loading ? (
          <Loading />
        ) : null}

        {direction.error ? (
          <ErrorState error={direction.error} retry={direction.reload} />
        ) : direction.data ? (
          <DirectionCard mix={direction.data} />
        ) : direction.loading ? (
          <Loading />
        ) : null}
      </div>

      {/* Dark spots (FR-30) */}
      <div style={{ marginBottom: 16 }}>
        {darkSpots.error ? (
          <ErrorState error={darkSpots.error} retry={darkSpots.reload} />
        ) : darkSpots.data ? (
          <Card
            title="Dark spots"
            sub="Teams, shifts and sites the programme isn't reaching — zero-activity groups highlighted"
          >
            {darkSpots.data.length === 0 ? (
              <EmptyState icon="✅" title="No dark spots" hint="Every group shows recognition activity in this range." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Type</th>
                      <th>Site</th>
                      <th className="num">Headcount</th>
                      <th className="num">Given</th>
                      <th className="num">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {darkSpots.data.map((row, i) => (
                      <tr key={`${row.dimension}-${row.name}-${i}`} className={row.given + row.received === 0 ? 'row-zero' : ''}>
                        <td>
                          <strong>{row.name}</strong>
                        </td>
                        <td>
                          <span className="badge badge-neutral">{row.dimension.replace('_', ' ')}</span>
                        </td>
                        <td>{row.site ?? '—'}</td>
                        <td className="num">{row.headcount}</td>
                        <td className="num">{row.given}</td>
                        <td className="num">{row.received}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : darkSpots.loading ? (
          <Loading />
        ) : null}
      </div>

      {/* Concentration (FR-31) */}
      {concentration.error ? (
        <ErrorState error={concentration.error} retry={concentration.reload} />
      ) : concentration.data ? (
        <>
          <div className="tile-row">
            <StatTile label="Unique givers" value={concentration.data.uniqueGivers} />
            <StatTile label="Unique recipients" value={concentration.data.uniqueRecipients} />
            <StatTile
              label="Top 10% giver share"
              value={formatPct(concentration.data.top10PctGiverShare)}
              sub="Share of all recognitions given by the most active tenth of givers"
            />
          </div>
          <div className="chart-grid">
            <ConcentrationTable title="Top givers" rows={concentration.data.topGivers} />
            <ConcentrationTable title="Top recipients" rows={concentration.data.topRecipients} />
          </div>
        </>
      ) : concentration.loading ? (
        <Loading />
      ) : null}
    </>
  )
}

/** Direction of recognition (FR-29) — nominal categories, so one hue. */
function DirectionCard({ mix }: { mix: DirectionMix }): React.ReactElement {
  const seniority = [
    { name: 'Peer to peer', count: mix.peer },
    { name: 'Junior → senior', count: mix.juniorToSenior },
    { name: 'Senior → junior', count: mix.seniorToJunior },
  ]
  const fn = [
    { name: 'Same function', count: mix.sameFunction },
    { name: 'Cross-function', count: mix.crossFunction },
  ]
  const pct = (n: number) => (mix.total > 0 ? ` (${formatPct((n / mix.total) * 100)})` : '')
  return (
    <ChartCard
      title="Direction of recognition"
      sub={`Who recognises whom, across ${formatNum(mix.total)} recognitions`}
      table={{
        headers: ['Direction', 'Count'],
        rows: [...seniority, ...fn].map((r) => [r.name, r.count]),
      }}
    >
      <SingleHueBars data={seniority.map((r) => ({ ...r, label: `${formatNum(r.count)}${pct(r.count)}` }))} />
      <div className="card-sub" style={{ margin: '8px 0 2px' }}>
        Function boundaries
      </div>
      <SingleHueBars data={fn.map((r) => ({ ...r, label: `${formatNum(r.count)}${pct(r.count)}` }))} />
    </ChartCard>
  )
}

function ConcentrationTable({
  title,
  rows,
}: {
  title: string
  rows: { id: number; name: string; function: string; site: string; count: number; pctOfTotal: number }[]
}): React.ReactElement {
  return (
    <Card title={title} sub="Top 10 in the selected range">
      {rows.length === 0 ? (
        <EmptyState title="No data in this range" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Function · site</th>
                <th className="num">Count</th>
                <th className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/people/${r.id}`}>{r.name}</Link>
                  </td>
                  <td>
                    {r.function} · {r.site}
                  </td>
                  <td className="num">{r.count}</td>
                  <td className="num">{formatPct(r.pctOfTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
