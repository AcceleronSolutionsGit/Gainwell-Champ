/**
 * Analytics aggregations (FR-26…FR-31), one function per /api/analytics
 * endpoint.
 *
 * Implementation note (SPEC §5): at this scale (≤ a few thousand rows in any
 * 90-day window) each endpoint loads the date-range rows ONCE with a single
 * joined query and aggregates in JS — identical behaviour on SQLite and
 * PostgreSQL, no dialect-specific SQL.
 *
 * All functions exclude status='removed' (BR-6: removed entries keep their
 * row but lose all credit/visibility). Flagged entries still count — they are
 * genuine until a moderator says otherwise.
 */
import { getDb } from '../../db/knex'
import { formatIst, istWeekStartIso } from '../../db/time'
import { Behaviour } from '../../types'

export interface AnalyticsRange {
  /** Inclusive UTC ISO bounds (already converted from IST dates by the route). */
  fromIso: string
  toIso: string
}

interface RecRow {
  id: number
  created_at: string
  behaviour_id: number
  giver_id: number
  recipient_id: number
  giver_name: string
  giver_function: string
  giver_site: string
  giver_shift: string
  giver_level: string
  recipient_name: string
  recipient_function: string
  recipient_site: string
  recipient_shift: string
  recipient_level: string
}

interface ActiveEmployee {
  id: number
  function: string
  sub_team: string | null
  shift: string
  site: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0
}

/** The one date-range query all endpoints share. */
async function loadRecognitions(range: AnalyticsRange): Promise<RecRow[]> {
  return (await getDb()('recognitions as rec')
    .join('employees as g', 'g.id', 'rec.giver_id')
    .join('employees as r', 'r.id', 'rec.recipient_id')
    .whereNot('rec.status', 'removed')
    .andWhere('rec.created_at', '>=', range.fromIso)
    .andWhere('rec.created_at', '<=', range.toIso)
    .select(
      'rec.id as id',
      'rec.created_at as created_at',
      'rec.behaviour_id as behaviour_id',
      'rec.giver_id as giver_id',
      'rec.recipient_id as recipient_id',
      'g.name as giver_name',
      'g.function as giver_function',
      'g.site as giver_site',
      'g.shift as giver_shift',
      'g.level_grade as giver_level',
      'r.name as recipient_name',
      'r.function as recipient_function',
      'r.site as recipient_site',
      'r.shift as recipient_shift',
      'r.level_grade as recipient_level',
    )) as RecRow[]
}

async function loadActiveEmployees(): Promise<ActiveEmployee[]> {
  return (await getDb()('employees')
    .where({ active: 1 })
    .select('id', 'function', 'sub_team', 'shift', 'site')) as ActiveEmployee[]
}

// ── GET /summary (FR-26) ─────────────────────────────────────────────────────

export async function getSummary(range: AnalyticsRange): Promise<{
  recognitions: number
  activeEmployees: number
  givers: number
  receivers: number
  pctGivers: number
  pctReceivers: number
  weekly: { weekStartIst: string; count: number }[]
}> {
  const [rows, employees] = await Promise.all([loadRecognitions(range), loadActiveEmployees()])
  // Participation counts people, and headcount counts ACTIVE people — so a
  // giver/receiver who has since been deactivated (attrition + DarwinBox
  // sync, FR-4) must not inflate the numerator past 100%.
  const activeIds = new Set(employees.map((e) => e.id))
  const givers = new Set(rows.map((r) => r.giver_id).filter((id) => activeIds.has(id))).size
  const receivers = new Set(rows.map((r) => r.recipient_id).filter((id) => activeIds.has(id))).size

  // Bucket by IST Monday-start week, zero-filling quiet weeks so the trend
  // line has a continuous x-axis.
  const countByWeek = new Map<string, number>()
  for (const r of rows) {
    const week = istWeekStartIso(r.created_at)
    countByWeek.set(week, (countByWeek.get(week) ?? 0) + 1)
  }
  const weekly: { weekStartIst: string; count: number }[] = []
  const endMs = new Date(range.toIso).getTime()
  // Stepping 7 exact days is safe: IST has no DST, so week starts stay aligned.
  for (let ms = new Date(istWeekStartIso(range.fromIso)).getTime(); ms <= endMs; ms += WEEK_MS) {
    const weekIso = new Date(ms).toISOString()
    weekly.push({ weekStartIst: formatIst(weekIso, 'YYYY-MM-DD'), count: countByWeek.get(weekIso) ?? 0 })
  }

  return {
    recognitions: rows.length,
    activeEmployees: employees.length,
    givers,
    receivers,
    pctGivers: pct(givers, employees.length),
    pctReceivers: pct(receivers, employees.length),
    weekly,
  }
}

// ── GET /function-shift (FR-27 floor-vs-office equity) ──────────────────────

interface GroupStat {
  name: string
  headcount: number
  given: number
  received: number
  giverParticipationPct: number
}

function groupStats(
  employees: ActiveEmployee[],
  rows: RecRow[],
  empKey: (e: ActiveEmployee) => string,
  giverKey: (r: RecRow) => string,
  recipientKey: (r: RecRow) => string,
): GroupStat[] {
  const groups = new Map<string, { headcount: number; given: number; received: number; givers: Set<number> }>()
  const ensure = (name: string) => {
    let g = groups.get(name)
    if (!g) {
      g = { headcount: 0, given: 0, received: 0, givers: new Set() }
      groups.set(name, g)
    }
    return g
  }
  const activeIds = new Set(employees.map((e) => e.id))
  for (const e of employees) ensure(empKey(e)).headcount += 1
  for (const r of rows) {
    // Row-side keys may name a group with zero ACTIVE headcount (e.g. history
    // from since-deactivated people) — still surfaced, with headcount 0.
    const given = ensure(giverKey(r))
    given.given += 1
    // Participation divides by ACTIVE headcount, so only count still-active
    // givers — a giver deactivated after the window would push past 100%.
    if (activeIds.has(r.giver_id)) given.givers.add(r.giver_id)
    ensure(recipientKey(r)).received += 1
  }
  return [...groups.entries()].map(([name, g]) => ({
    name,
    headcount: g.headcount,
    given: g.given,
    received: g.received,
    giverParticipationPct: pct(g.givers.size, g.headcount),
  }))
}

const SHIFT_ORDER = ['A', 'B', 'C', 'General']

export async function getFunctionShift(range: AnalyticsRange): Promise<{
  functions: GroupStat[]
  shifts: GroupStat[]
}> {
  const [rows, employees] = await Promise.all([loadRecognitions(range), loadActiveEmployees()])
  const functions = groupStats(
    employees,
    rows,
    (e) => e.function,
    (r) => r.giver_function,
    (r) => r.recipient_function,
  ).sort((a, b) => a.name.localeCompare(b.name))
  const shifts = groupStats(
    employees,
    rows,
    (e) => e.shift,
    (r) => r.giver_shift,
    (r) => r.recipient_shift,
  ).sort((a, b) => {
    const ia = SHIFT_ORDER.indexOf(a.name)
    const ib = SHIFT_ORDER.indexOf(b.name)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? SHIFT_ORDER.length : ia) - (ib === -1 ? SHIFT_ORDER.length : ib)
    return a.name.localeCompare(b.name)
  })
  return { functions, shifts }
}

// ── GET /behaviours (FR-28) ──────────────────────────────────────────────────

export async function getBehaviourBreakdown(range: AnalyticsRange): Promise<
  { behaviourId: number; name: string; colour: string; count: number; pct: number }[]
> {
  const [rows, behaviours] = await Promise.all([
    loadRecognitions(range),
    getDb()('behaviours').orderBy('sort_order') as Promise<Behaviour[]>,
  ])
  const counts = new Map<number, number>()
  for (const r of rows) counts.set(r.behaviour_id, (counts.get(r.behaviour_id) ?? 0) + 1)
  return behaviours
    .filter((b) => !!b.active || (counts.get(b.id) ?? 0) > 0) // inactive only when it has history
    .map((b) => ({
      behaviourId: b.id,
      name: b.name,
      colour: b.colour,
      count: counts.get(b.id) ?? 0,
      pct: pct(counts.get(b.id) ?? 0, rows.length),
    }))
    .sort((a, b) => b.count - a.count)
}

// ── GET /direction (FR-29) ───────────────────────────────────────────────────

/** 'L3' → 3. Unparseable grades → 0 (counts as most junior; demo data is always L1–L5). */
function levelNum(grade: string): number {
  const m = /(\d+)/.exec(grade)
  return m ? Number(m[1]) : 0
}

export async function getDirectionMix(range: AnalyticsRange): Promise<{
  total: number
  juniorToSenior: number
  seniorToJunior: number
  peer: number
  crossFunction: number
  sameFunction: number
}> {
  const rows = await loadRecognitions(range)
  let juniorToSenior = 0
  let seniorToJunior = 0
  let peer = 0
  let crossFunction = 0
  for (const r of rows) {
    const g = levelNum(r.giver_level)
    const rec = levelNum(r.recipient_level)
    if (g < rec) juniorToSenior += 1
    else if (g > rec) seniorToJunior += 1
    else peer += 1
    if (r.giver_function !== r.recipient_function) crossFunction += 1
  }
  return {
    total: rows.length,
    juniorToSenior,
    seniorToJunior,
    peer,
    crossFunction,
    sameFunction: rows.length - crossFunction,
  }
}

// ── GET /dark-spots (FR-30) ──────────────────────────────────────────────────

export interface DarkSpot {
  dimension: 'sub_team' | 'shift' | 'site'
  name: string
  site?: string
  headcount: number
  given: number
  received: number
}

export async function getDarkSpots(range: AnalyticsRange): Promise<DarkSpot[]> {
  const [rows, employees] = await Promise.all([loadRecognitions(range), loadActiveEmployees()])

  interface Group extends DarkSpot {
    perHead: number
  }
  const result: { zeros: Group[]; low: Group[] } = { zeros: [], low: [] }

  const dimensions: {
    dimension: DarkSpot['dimension']
    // key must be unique within the dimension; null = employee not in this dimension
    keyOf: (e: ActiveEmployee) => string | null
    describe: (e: ActiveEmployee) => { name: string; site?: string }
  }[] = [
    {
      dimension: 'sub_team',
      // Sub-team names could repeat across sites — key on both.
      keyOf: (e) => (e.sub_team ? `${e.site} ${e.sub_team}` : null),
      describe: (e) => ({ name: e.sub_team as string, site: e.site }),
    },
    { dimension: 'shift', keyOf: (e) => e.shift, describe: (e) => ({ name: e.shift }) },
    { dimension: 'site', keyOf: (e) => e.site, describe: (e) => ({ name: e.site }) },
  ]

  for (const dim of dimensions) {
    const groups = new Map<string, Group>()
    const memberGroup = new Map<number, string>() // employee id → group key
    for (const e of employees) {
      const key = dim.keyOf(e)
      if (key === null) continue
      let g = groups.get(key)
      if (!g) {
        g = { dimension: dim.dimension, ...dim.describe(e), headcount: 0, given: 0, received: 0, perHead: 0 }
        groups.set(key, g)
      }
      g.headcount += 1
      memberGroup.set(e.id, key)
    }
    for (const r of rows) {
      // Activity by since-deactivated people has no active group — skipped;
      // dark spots are about who is active-but-silent NOW.
      const giverKey = memberGroup.get(r.giver_id)
      if (giverKey) groups.get(giverKey)!.given += 1
      const recipientKey = memberGroup.get(r.recipient_id)
      if (recipientKey) groups.get(recipientKey)!.received += 1
    }

    const all = [...groups.values()]
    for (const g of all) g.perHead = g.headcount > 0 ? (g.given + g.received) / g.headcount : 0

    // Bottom decile threshold across this dimension's groups.
    const sorted = all.map((g) => g.perHead).sort((a, b) => a - b)
    const q10 = sorted[Math.max(0, Math.ceil(sorted.length * 0.1) - 1)] ?? 0
    const max = sorted[sorted.length - 1] ?? 0

    for (const g of all) {
      if (g.perHead === 0) result.zeros.push(g)
      // `q10 < max` guard: if every group performs identically there is no
      // meaningful "bottom" to single out.
      else if (q10 < max && g.perHead <= q10) result.low.push(g)
    }
  }

  // Zeros first (bigger silent groups are the bigger problem), then the
  // low-activity tail ascending — the worst spots top the table.
  result.zeros.sort((a, b) => b.headcount - a.headcount)
  result.low.sort((a, b) => a.perHead - b.perHead)

  return [...result.zeros, ...result.low].map(({ dimension, name, site, headcount, given, received }) => ({
    dimension,
    name,
    ...(site !== undefined ? { site } : {}),
    headcount,
    given,
    received,
  }))
}

// ── GET /concentration (FR-31) ───────────────────────────────────────────────

interface TopPerson {
  id: number
  name: string
  function: string
  site: string
  count: number
  pctOfTotal: number
}

export async function getConcentration(range: AnalyticsRange): Promise<{
  uniqueGivers: number
  uniqueRecipients: number
  top10PctGiverShare: number
  topGivers: TopPerson[]
  topRecipients: TopPerson[]
}> {
  const rows = await loadRecognitions(range)
  const total = rows.length

  const tally = (
    idOf: (r: RecRow) => number,
    infoOf: (r: RecRow) => { name: string; function: string; site: string },
  ): { id: number; name: string; function: string; site: string; count: number }[] => {
    const map = new Map<number, { id: number; name: string; function: string; site: string; count: number }>()
    for (const r of rows) {
      const id = idOf(r)
      let entry = map.get(id)
      if (!entry) {
        entry = { id, ...infoOf(r), count: 0 }
        map.set(id, entry)
      }
      entry.count += 1
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }

  const givers = tally(
    (r) => r.giver_id,
    (r) => ({ name: r.giver_name, function: r.giver_function, site: r.giver_site }),
  )
  const recipients = tally(
    (r) => r.recipient_id,
    (r) => ({ name: r.recipient_name, function: r.recipient_function, site: r.recipient_site }),
  )

  // Share of all recognitions given by the busiest 10% of givers (min 1 giver).
  let top10PctGiverShare = 0
  if (givers.length > 0) {
    const nTop = Math.max(1, Math.ceil(givers.length * 0.1))
    const topSum = givers.slice(0, nTop).reduce((s, g) => s + g.count, 0)
    top10PctGiverShare = pct(topSum, total)
  }

  const withPct = (list: typeof givers): TopPerson[] =>
    list.slice(0, 10).map((p) => ({ ...p, pctOfTotal: pct(p.count, total) }))

  return {
    uniqueGivers: givers.length,
    uniqueRecipients: recipients.length,
    top10PctGiverShare,
    topGivers: withPct(givers),
    topRecipients: withPct(recipients),
  }
}
