/**
 * Demo data seed.
 *
 * Locally this stands in for the DarwinBox directory sync (which is disabled
 * without credentials — see modules/sync/darwinbox.ts): ~60 employees across
 * two sites, plus ~90 days of recognition history shaped to make every
 * analytics view meaningful — participation, function/shift equity, dark
 * spots (Paint Shop, Shift C), concentration (a few heavy givers), open
 * loop/burst flags and a couple of moderated removals.
 *
 * Deterministic PRNG ⇒ the same data every reseed.
 */
import { Knex } from 'knex'
import { config } from '../../config'
import { DEFAULT_SETTINGS } from '../../modules/settings'
import { nowIso } from '../time'

// ── deterministic randomness ─────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── demo vocabulary ──────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Arjun', 'Priya', 'Rahul', 'Sneha', 'Amit', 'Kavita', 'Suman', 'Debashish',
  'Ananya', 'Ravi', 'Meena', 'Sourav', 'Tanmoy', 'Ritika', 'Vikram', 'Pooja',
  'Sandip', 'Moumita', 'Nilesh', 'Farhan', 'Gurpreet', 'Lakshmi', 'Ajay',
  'Swati', 'Biplab', 'Rekha', 'Harish', 'Nandini', 'Imran', 'Shreya',
  'Prakash', 'Anjali', 'Koushik', 'Deepa', 'Manoj', 'Payel', 'Rajesh',
  'Sunita', 'Abhijit', 'Tulika', 'Sk Salim', 'Joydeep', 'Madhumita', 'Pranab',
]

const LAST_NAMES = [
  'Sharma', 'Banerjee', 'Ghosh', 'Das', 'Mukherjee', 'Patel', 'Singh',
  'Chatterjee', 'Roy', 'Kumar', 'Dutta', 'Sen', 'Bose', 'Mandal', 'Nair',
  'Iyer', 'Verma', 'Mishra', 'Khan', 'Sarkar', 'Chakraborty', 'Pal', 'Naskar',
  'Hazra', 'Middya', 'Oraon',
]

export const BEHAVIOUR_SEED = [
  { name: 'Safety First', description: 'Acted to keep people, machines and the site safe', colour: '#D64545', sort_order: 1 },
  { name: 'Quality', description: 'Got it right the first time and raised the bar', colour: '#3B7DD8', sort_order: 2 },
  { name: 'Ownership', description: 'Took charge beyond the role and saw it through', colour: '#7C5CBF', sort_order: 3 },
  { name: 'Innovation', description: 'Found a smarter, faster or better way', colour: '#E8A33D', sort_order: 4 },
  { name: 'Collaboration', description: 'Helped another person or team win', colour: '#2FA88C', sort_order: 5 },
  { name: 'Customer Centricity', description: 'Put the customer at the centre of a decision', colour: '#C95D8A', sort_order: 6 },
]

const REASONS: Record<string, string[]> = {
  'Safety First': [
    'Stopped the line when a sling on Bay 3 looked frayed and had it swapped before the next lift',
    'Caught a missing lockout tag at shift handover and fixed the isolation before work resumed',
    'Walked a new fitter through the correct PPE for the grinding bay instead of letting it slide',
    'Flagged an oil patch near the CNC aisle and stayed until it was cleaned and cordoned off',
    'Refused to rush the hydraulic test under time pressure and insisted on the full checklist',
  ],
  Quality: [
    'Re-measured the full weldment batch after one part came off-spec and saved a customer escape',
    'Caught a wrong torque spec in the router before assembly started on Line 2',
    'Reworked the fixture alignment until first-pass yield came back above target',
    'Documented the paint defect pattern so the night shift could avoid the same rework',
    'Held the dispatch until the inspection report matched the latest drawing revision',
  ],
  Ownership: [
    'Stayed back after shift to close the ERP work orders so month-end did not slip',
    'Took over the vendor escalation nobody owned and drove it to a fix in two days',
    'Volunteered to cover the stores counter during the audit week without being asked',
    'Tracked the missing fasteners consignment personally and kept Line 1 running',
    'Owned the 5S corner for the bay and had it audit-ready a week early',
  ],
  Innovation: [
    'Built a simple jig from scrap that cut the panel drilling time nearly in half',
    'Set up a shared tracker that replaced the whiteboard and stopped double bookings of the crane',
    'Suggested reversing the assembly sequence which removed two forklift moves per unit',
    'Wrote a small macro that auto-fills the daily production report from the shift log',
    'Prototyped a guard modification that ended the recurring sensor false trips',
  ],
  Collaboration: [
    'Jumped in to help Fabrication clear the backlog even though the request came at 6 pm',
    'Shared the test rig slots so both teams could hit the same deadline',
    'Coached two new joiners on the CMM so Quality was not a bottleneck during trials',
    'Coordinated with Stores and Maintenance to turn the breakdown around inside one shift',
    'Translated the work instructions for the new contractual crew so nobody was left behind',
  ],
  'Customer Centricity': [
    'Turned around the customer drawing clarification the same evening to protect the delivery date',
    'Called out that the packaging spec would fail monsoon transit and got it changed in time',
    'Prepared the extra inspection photos the customer asked for without being chased',
    'Rescheduled the trial run so the customer team could witness it during their visit',
    'Pushed for the field failure analysis to be shared with the customer within 48 hours',
  ],
}

// ── org structure ────────────────────────────────────────────────────────────

interface TeamSpec {
  site: string
  fn: string
  subTeam: string
  shifts: string[]
  size: number // includes the L4 lead as the first member
  langs: Array<'en' | 'hi' | 'bn'>
}

const TEAMS: TeamSpec[] = [
  // Panagarh Plant — manufacturing heavy, shift-based
  { site: 'Panagarh Plant', fn: 'Manufacturing', subTeam: 'Assembly Line 1', shifts: ['A', 'B'], size: 5, langs: ['bn', 'bn', 'hi'] },
  { site: 'Panagarh Plant', fn: 'Manufacturing', subTeam: 'Assembly Line 2', shifts: ['B', 'C'], size: 4, langs: ['bn', 'hi'] },
  { site: 'Panagarh Plant', fn: 'Manufacturing', subTeam: 'Fabrication', shifts: ['A', 'B'], size: 5, langs: ['bn', 'hi'] },
  { site: 'Panagarh Plant', fn: 'Manufacturing', subTeam: 'Paint Shop', shifts: ['A'], size: 3, langs: ['bn'] }, // dark spot — zero activity
  { site: 'Panagarh Plant', fn: 'Manufacturing', subTeam: 'Quality Control', shifts: ['A', 'B'], size: 4, langs: ['bn', 'en'] },
  { site: 'Panagarh Plant', fn: 'Manufacturing', subTeam: 'Maintenance', shifts: ['A', 'B', 'C'], size: 4, langs: ['hi', 'bn'] },
  { site: 'Panagarh Plant', fn: 'Manufacturing', subTeam: 'Stores & Logistics', shifts: ['General'], size: 3, langs: ['bn', 'hi'] },
  { site: 'Panagarh Plant', fn: 'Engineering', subTeam: 'Manufacturing Engineering', shifts: ['General'], size: 4, langs: ['en', 'bn'] },
  { site: 'Panagarh Plant', fn: 'Support', subTeam: 'Plant HR', shifts: ['General'], size: 2, langs: ['en', 'bn'] },
  { site: 'Panagarh Plant', fn: 'Support', subTeam: 'EHS', shifts: ['General'], size: 2, langs: ['en', 'hi'] },
  // Kolkata — engineering & support, general shift
  { site: 'Kolkata', fn: 'Engineering', subTeam: 'Design – Structures', shifts: ['General'], size: 5, langs: ['en', 'bn'] },
  { site: 'Kolkata', fn: 'Engineering', subTeam: 'Design – Powertrain', shifts: ['General'], size: 4, langs: ['en'] },
  { site: 'Kolkata', fn: 'Engineering', subTeam: 'Embedded & Controls', shifts: ['General'], size: 4, langs: ['en'] },
  { site: 'Kolkata', fn: 'Engineering', subTeam: 'Testing & Validation', shifts: ['General'], size: 4, langs: ['en', 'bn'] },
  { site: 'Kolkata', fn: 'Support', subTeam: 'Finance', shifts: ['General'], size: 2, langs: ['en'] },
  { site: 'Kolkata', fn: 'Support', subTeam: 'IT', shifts: ['General'], size: 2, langs: ['en'] },
  { site: 'Kolkata', fn: 'Support', subTeam: 'Procurement', shifts: ['General'], size: 2, langs: ['en', 'hi'] },
]

// ── helpers ──────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000

interface SeededEmployee {
  id: number
  name: string
  fn: string
  subTeam: string
  shift: string
  site: string
  level: string
  mobile: string
}

async function insertReturningId(db: Knex, table: string, row: Record<string, unknown>): Promise<number> {
  const res = await db(table).insert(row).returning('id')
  const first = Array.isArray(res) ? res[0] : res
  return typeof first === 'object' && first !== null ? (first as { id: number }).id : (first as number)
}

/** Random instant `daysBack..0` days ago, biased to weekdays and working hours IST. */
function randomWorkInstant(rnd: () => number, daysBack: number, notAfterMs?: number): string {
  for (let i = 0; i < 12; i++) {
    const t = Date.now() - rnd() * daysBack * DAY
    const d = new Date(t)
    const istHour = (d.getUTCHours() + 5.5 + 24) % 24
    const dow = d.getUTCDay()
    const isWeekend = dow === 0 || dow === 6
    if (isWeekend && rnd() < 0.7) continue
    if ((istHour < 7 || istHour > 20) && rnd() < 0.8) continue
    if (notAfterMs && t > notAfterMs) continue
    return new Date(t).toISOString()
  }
  return new Date(Date.now() - rnd() * daysBack * DAY).toISOString()
}

// ── main generator ───────────────────────────────────────────────────────────

async function generate(db: Knex): Promise<Record<string, number>> {
  const rnd = mulberry32(20260722)
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
  const now = nowIso()

  // Behaviours
  const behaviourIds: Record<string, number> = {}
  for (const b of BEHAVIOUR_SEED) {
    behaviourIds[b.name] = await insertReturningId(db, 'behaviours', { ...b, active: 1 })
  }

  // Settings
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db('settings').insert({ key, value: JSON.stringify(value) })
  }

  // Employees
  const employees: SeededEmployee[] = []
  const usedNames = new Set<string>()
  const usedEmails = new Set<string>()
  let seq = 0

  const nextName = (): string => {
    for (let i = 0; i < 50; i++) {
      const n = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`
      if (!usedNames.has(n)) {
        usedNames.add(n)
        return n
      }
    }
    return `Employee ${seq}`
  }

  const defaultDomain = config.auth.allowedEmailDomains[0] ?? 'gainwellengineering.com'
  const emailFor = (name: string): string => {
    let base = name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '.')
    let email = `${base}@${defaultDomain}`
    let n = 2
    while (usedEmails.has(email)) email = `${base}${n++}@${defaultDomain}`
    usedEmails.add(email)
    return email
  }

  const addEmployee = async (e: {
    name: string
    fn: string
    subTeam: string
    shift: string
    site: string
    level: string
    managerId: number | null
    email: string | null
    employmentType?: 'permanent' | 'contractual'
    language?: 'en' | 'hi' | 'bn'
    active?: number
  }): Promise<SeededEmployee> => {
    seq += 1
    const mobile = `+91${9810000000 + seq}`
    const contractual = e.employmentType === 'contractual'
    const id = await insertReturningId(db, 'employees', {
      employee_code: `GEPL${1000 + seq}`,
      name: e.name,
      function: e.fn,
      sub_team: e.subTeam,
      shift: e.shift,
      site: e.site,
      mobile,
      email: e.email,
      employment_type: e.employmentType ?? 'permanent',
      level_grade: e.level,
      manager_id: e.managerId,
      active: e.active ?? 1,
      language: e.language ?? 'en',
      consent_recorded: contractual ? 1 : 0, // consent captured for personal numbers (FR-3)
      created_at: now,
      updated_at: now,
    })
    const emp = { id, name: e.name, fn: e.fn, subTeam: e.subTeam, shift: e.shift, site: e.site, level: e.level, mobile }
    employees.push(emp)
    return emp
  }

  // Site heads (L5)
  const plantHead = await addEmployee({
    name: nextName(), fn: 'Manufacturing', subTeam: 'Plant Leadership', shift: 'General',
    site: 'Panagarh Plant', level: 'L5', managerId: null, email: emailFor('plant.head'), language: 'en',
  })
  const engHead = await addEmployee({
    name: nextName(), fn: 'Engineering', subTeam: 'Engineering Office', shift: 'General',
    site: 'Kolkata', level: 'L5', managerId: null, email: emailFor('engineering.head'), language: 'en',
  })

  // Named console users (match default ADMIN_EMAILS / COMMITTEE_EMAILS)
  await addEmployee({
    name: 'Riya Sen', fn: 'Support', subTeam: 'HR', shift: 'General', site: 'Kolkata',
    level: 'L3', managerId: engHead.id, email: `hr.admin@${defaultDomain}`, language: 'en',
  })
  await addEmployee({
    name: 'Arindam Bose', fn: 'Support', subTeam: 'HR', shift: 'General', site: 'Kolkata',
    level: 'L4', managerId: engHead.id, email: `rnr.committee@${defaultDomain}`, language: 'en',
  })
  await addEmployee({
    name: 'Sabarnik Lahiri', fn: 'Management', subTeam: 'Executive', shift: 'General', site: 'Kolkata',
    level: 'L5', managerId: null, email: 'sabarnik.lahiri@acceleronsolutions.io', language: 'en',
  })

  for (const team of TEAMS) {
    const head = team.site === 'Panagarh Plant' ? plantHead : engHead
    let lead: SeededEmployee | null = null
    for (let i = 0; i < team.size; i++) {
      const isLead = i === 0
      const level = isLead ? 'L4' : pick(['L1', 'L2', 'L2', 'L3'])
      const isOperator = team.fn === 'Manufacturing' && !isLead
      const contractual = isOperator && rnd() < 0.3
      const hasEmail = !isOperator || rnd() < 0.4
      const name = nextName()
      const emp = await addEmployee({
        name,
        fn: team.fn,
        subTeam: team.subTeam,
        shift: isLead ? team.shifts[0] : pick(team.shifts),
        site: team.site,
        level,
        managerId: isLead ? head.id : lead!.id,
        email: hasEmail ? emailFor(name) : null,
        employmentType: contractual ? 'contractual' : 'permanent',
        language: pick(team.langs),
      })
      if (isLead) lead = emp
    }
  }

  // Two leavers with history (FR-4): deactivate after generating recognitions? —
  // simpler: mark inactive now; the generator below excludes them as new
  // givers/recipients but they may appear in crafted historical entries.
  const leavers = [employees[10], employees[25]]
  for (const l of leavers) {
    await db('employees').where({ id: l.id }).update({ active: 0, updated_at: now })
  }

  // Console roles
  await upsertAdminUsers(db)

  // ── Recognition history ────────────────────────────────────────────────────
  const behaviourNames = Object.keys(behaviourIds)
  const isDarkSpot = (e: SeededEmployee) => e.subTeam === 'Paint Shop'
  const leaverIds = new Set(leavers.map((l) => l.id))
  const pool = employees.filter((e) => !isDarkSpot(e) && !leaverIds.has(e.id))

  // concentration: three champions give a lot
  const champions = [pool[4], pool[12], pool[30]].filter(Boolean)
  const championIds = new Set(champions.map((c) => c.id))

  const weightOf = (e: SeededEmployee): number => {
    let w = 1
    if (championIds.has(e.id)) w *= 8
    if (e.shift === 'C') w *= 0.3 // shift equity dark-ish spot
    if (e.fn === 'Support') w *= 0.8
    return w
  }
  const weighted = (list: SeededEmployee[]): SeededEmployee => {
    const total = list.reduce((s, e) => s + weightOf(e), 0)
    let r = rnd() * total
    for (const e of list) {
      r -= weightOf(e)
      if (r <= 0) return e
    }
    return list[list.length - 1]
  }

  const behaviourWeights = (giver: SeededEmployee): [string, number][] =>
    giver.fn === 'Manufacturing'
      ? [['Safety First', 0.30], ['Quality', 0.20], ['Ownership', 0.15], ['Innovation', 0.07], ['Collaboration', 0.16], ['Customer Centricity', 0.12]]
      : [['Safety First', 0.08], ['Quality', 0.22], ['Ownership', 0.20], ['Innovation', 0.15], ['Collaboration', 0.22], ['Customer Centricity', 0.13]]

  const pickBehaviour = (giver: SeededEmployee): string => {
    const weights = behaviourWeights(giver)
    let r = rnd() * weights.reduce((s, [, w]) => s + w, 0)
    for (const [name, w] of weights) {
      r -= w
      if (r <= 0) return name
    }
    return behaviourNames[0]
  }

  const pairMonth = new Map<string, number>()
  const rows: {
    giver_id: number; recipient_id: number; behaviour_id: number; reason_text: string
    channel: string; status: string; created_at: string
    removal_reason?: string; removed_by?: string; removed_at?: string
  }[] = []

  const TARGET = 230
  let guard = 0
  while (rows.length < TARGET && guard++ < TARGET * 30) {
    const giver = weighted(pool)
    // 15% deliberately cross-function to feed the direction-mix analytics
    const candidates =
      rnd() < 0.15
        ? pool.filter((e) => e.fn !== giver.fn && e.id !== giver.id)
        : pool.filter((e) => e.id !== giver.id && (rnd() < 0.7 ? e.site === giver.site : true))
    if (!candidates.length) continue
    const recipient = weighted(candidates)
    if (recipient.id === giver.id) continue
    const createdAt = randomWorkInstant(rnd, 90)
    const monthKey = `${giver.id}-${recipient.id}-${createdAt.slice(0, 7)}`
    if ((pairMonth.get(monthKey) ?? 0) >= DEFAULT_SETTINGS.capPerPairPerMonth) continue // respect BR-2
    pairMonth.set(monthKey, (pairMonth.get(monthKey) ?? 0) + 1)
    const behaviour = pickBehaviour(giver)
    rows.push({
      giver_id: giver.id,
      recipient_id: recipient.id,
      behaviour_id: behaviourIds[behaviour],
      reason_text: pick(REASONS[behaviour]),
      channel: 'whatsapp',
      status: 'active',
      created_at: createdAt,
    })
  }

  // Crafted moderation demos ---------------------------------------------------
  const maintenance = pool.filter((e) => e.subTeam === 'Maintenance')
  const fabrication = pool.filter((e) => e.subTeam === 'Fabrication')
  const adminEmail = config.auth.adminEmails[0] ?? 'hr.admin@gainwellengineering.com'

  // (a) open reciprocal loop: M1↔M2, 4 recognitions inside 36 hours, ~5 days ago
  const loopBase = Date.now() - 5 * DAY
  const [m1, m2] = [maintenance[0], maintenance[1]]
  const loopRows = [0, 1, 2, 3].map((i) => ({
    giver_id: i % 2 === 0 ? m1.id : m2.id,
    recipient_id: i % 2 === 0 ? m2.id : m1.id,
    behaviour_id: behaviourIds['Collaboration'],
    reason_text: pick(REASONS['Collaboration']),
    channel: 'whatsapp',
    status: i >= 2 ? 'flagged' : 'active',
    created_at: new Date(loopBase + i * 9 * 60 * 60 * 1000).toISOString(),
  }))
  rows.push(...loopRows)

  // (b) burst: one giver, 6 recognitions in ~45 minutes, ~8 days ago
  const burstGiver = fabrication[0]
  const burstBase = Date.now() - 8 * DAY
  const burstTargets = pool.filter((e) => e.id !== burstGiver.id).slice(0, 6)
  const burstRows = burstTargets.map((t, i) => ({
    giver_id: burstGiver.id,
    recipient_id: t.id,
    behaviour_id: behaviourIds['Ownership'],
    reason_text: pick(REASONS['Ownership']),
    channel: 'whatsapp',
    status: i === 5 ? 'flagged' : 'active',
    created_at: new Date(burstBase + i * 8 * 60 * 1000).toISOString(),
  }))
  rows.push(...burstRows)

  // (c) two moderated removals, ~2–3 weeks ago (BR-6 soft delete)
  for (const daysBack of [14, 20]) {
    const giver = weighted(pool)
    const recipient = weighted(pool.filter((e) => e.id !== giver.id))
    const when = new Date(Date.now() - daysBack * DAY)
    rows.push({
      giver_id: giver.id,
      recipient_id: recipient.id,
      behaviour_id: behaviourIds['Quality'],
      reason_text: 'Duplicate of an earlier entry for the same inspection catch',
      channel: 'whatsapp',
      status: 'removed',
      removal_reason: 'Duplicate entry — same event recorded twice',
      removed_by: adminEmail,
      removed_at: new Date(when.getTime() + 2 * DAY).toISOString(),
      created_at: when.toISOString(),
    })
  }

  rows.sort((a, b) => a.created_at.localeCompare(b.created_at))
  const recognitionIds: number[] = []
  for (const row of rows) {
    recognitionIds.push(await insertReturningId(db, 'recognitions', row))
  }

  // Flags for the crafted patterns (find them back by status)
  const flagged: { id: number; giver_id: number; recipient_id: number; created_at: string }[] =
    await db('recognitions').where({ status: 'flagged' }).select('id', 'giver_id', 'recipient_id', 'created_at')
  for (const r of flagged) {
    const isLoop = (r.giver_id === m1.id && r.recipient_id === m2.id) || (r.giver_id === m2.id && r.recipient_id === m1.id)
    await db('flags').insert({
      recognition_id: r.id,
      type: isLoop ? 'loop' : 'burst',
      details: JSON.stringify(
        isLoop
          ? { pair: [m1.name, m2.name], countInWindow: 4, windowHours: DEFAULT_SETTINGS.flagLoopWindowHours }
          : { giver: burstGiver.name, countInWindow: 6, windowMinutes: DEFAULT_SETTINGS.flagBurstWindowMinutes },
      ),
      status: 'open',
      created_at: r.created_at,
    })
  }

  // One earlier, already-dismissed flag so the queue shows a resolved example
  const dismissedRec = recognitionIds[Math.floor(recognitionIds.length / 2)]
  await db('flags').insert({
    recognition_id: dismissedRec,
    type: 'burst',
    details: JSON.stringify({ note: 'Weekly town-hall day — several genuine recognitions in one hour' }),
    status: 'resolved',
    resolved_by: adminEmail,
    resolved_at: new Date(Date.now() - 10 * DAY).toISOString(),
    resolution: 'dismissed',
    created_at: new Date(Date.now() - 11 * DAY).toISOString(),
  })

  // Audit trail for the seeded removals
  const removed: { id: number }[] = await db('recognitions').where({ status: 'removed' }).select('id')
  for (const r of removed) {
    await db('audit_log').insert({
      actor: adminEmail,
      action: 'remove_recognition',
      entity_type: 'recognition',
      entity_id: String(r.id),
      details: JSON.stringify({ reason: 'Duplicate entry — same event recorded twice' }),
      created_at: nowIso(),
    })
  }
  await db('audit_log').insert({
    actor: 'system',
    action: 'seed_demo_data',
    entity_type: 'database',
    entity_id: 'seed',
    details: JSON.stringify({ employees: employees.length, recognitions: rows.length }),
    created_at: nowIso(),
  })

  return { employees: employees.length, recognitions: rows.length, flags: flagged.length + 1 }
}

/** Console roles come from env (ADMIN_EMAILS / COMMITTEE_EMAILS) — upserted every boot. */
export async function upsertAdminUsers(db: Knex): Promise<void> {
  const upsert = async (emailRaw: string, role: 'admin' | 'committee') => {
    const email = emailRaw.trim().toLowerCase()
    const existing = await db('admin_users').whereRaw('lower(email) = ?', [email]).first()
    if (existing) await db('admin_users').whereRaw('lower(email) = ?', [email]).update({ role })
    else await db('admin_users').insert({ email, role, created_at: nowIso() })
  }
  for (const email of config.auth.adminEmails) await upsert(email, 'admin')
  for (const email of config.auth.committeeEmails) await upsert(email, 'committee')
}

/** Seed demo data on first boot (empty database). Always refreshes console roles. */
export async function seedIfEmpty(db: Knex): Promise<void> {
  const [{ c }] = (await db('employees').count({ c: '*' })) as unknown as [{ c: number | string }]
  if (Number(c) > 0) {
    await upsertAdminUsers(db)
    return
  }

  if (config.darwinbox.enabled) {
    console.log('[seed] Empty database and Darwinbox sync enabled — seeding metadata and running Darwinbox sync…')
    for (const b of BEHAVIOUR_SEED) {
      await db('behaviours').insert({ ...b, active: 1 })
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await db('settings').insert({ key, value: JSON.stringify(value) })
    }
    await upsertAdminUsers(db)
    const { runDirectorySync } = await import('../../modules/sync/darwinbox')
    const syncRes = await runDirectorySync()
    console.log('[seed] Darwinbox sync completed on boot:', syncRes)
    return
  }

  console.log('[seed] Empty database — loading demo directory and recognition history…')
  const stats = await generate(db)
  console.log(`[seed] Done: ${stats.employees} employees, ${stats.recognitions} recognitions, ${stats.flags} flags.`)
}

/** Wipe and reseed (npm run seed:reset). */
export async function resetAndSeed(db: Knex): Promise<void> {
  for (const table of ['audit_log', 'settings', 'admin_users', 'otp_codes', 'conversation_state', 'flags', 'recognitions', 'behaviours', 'employees']) {
    await db(table).del()
  }

  if (config.darwinbox.enabled) {
    console.log('[seed] Wiped database and Darwinbox sync enabled — re-seeding from Darwinbox…')
    for (const b of BEHAVIOUR_SEED) {
      await db('behaviours').insert({ ...b, active: 1 })
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await db('settings').insert({ key, value: JSON.stringify(value) })
    }
    await upsertAdminUsers(db)
    const { runDirectorySync } = await import('../../modules/sync/darwinbox')
    const syncRes = await runDirectorySync()
    console.log('[seed] Reseeded from Darwinbox on reset:', syncRes)
    return
  }

  const stats = await generate(db)
  console.log(`[seed] Reseeded: ${stats.employees} employees, ${stats.recognitions} recognitions.`)
}
