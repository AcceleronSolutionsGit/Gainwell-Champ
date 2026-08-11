/**
 * /api/employees — people search, directory and profiles (FR-16).
 *
 * Privacy: mobile/email never leave this API for non-admin viewers; admins
 * get them on the profile (the admin console has its own directory endpoint
 * under /api/admin/employees for management).
 */
import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/knex'
import { apiError } from '../middleware/errorHandler'
import { asyncHandler, requireAuth } from '../middleware/requireAuth'
import { apiLimiter } from '../middleware/rateLimits'
import { Behaviour, Employee } from '../types'
import { countRows, FEED_SELECT, feedJoin, FeedRow, toFeedItem } from './feed'

const router = Router()
router.use(apiLimiter)
router.use(requireAuth)

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw apiError(400, 'BAD_INPUT', result.error.issues[0]?.message ?? 'Invalid input')
  }
  return result.data
}

function cleanQuery(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(q)) if (v !== '' && v !== undefined) out[k] = v
  return out
}

/** name LIKE %q% (case-insensitive) OR exact employee code. */
function applyNameQuery(query: import('knex').Knex.QueryBuilder, q: string): void {
  const like = `%${q.toLowerCase()}%`
  query.andWhere((w) =>
    w.whereRaw('lower(name) like ?', [like]).orWhereRaw('upper(employee_code) = ?', [q.toUpperCase()]),
  )
}

/** given/received counts (status != 'removed') for a set of employee ids. */
async function recognitionCounts(ids: number[]): Promise<Map<number, { given: number; received: number }>> {
  const counts = new Map<number, { given: number; received: number }>()
  if (ids.length === 0) return counts
  const db = getDb()
  const given = (await db('recognitions')
    .whereIn('giver_id', ids)
    .whereNot('status', 'removed')
    .groupBy('giver_id')
    .select('giver_id as id')
    .count({ c: '*' })) as { id: number; c: number | string }[]
  const received = (await db('recognitions')
    .whereIn('recipient_id', ids)
    .whereNot('status', 'removed')
    .groupBy('recipient_id')
    .select('recipient_id as id')
    .count({ c: '*' })) as { id: number; c: number | string }[]
  for (const id of ids) counts.set(id, { given: 0, received: 0 })
  for (const row of given) counts.get(row.id)!.given = Number(row.c)
  for (const row of received) counts.get(row.id)!.received = Number(row.c)
  return counts
}

// ── GET /search?q= — quick person picker (active only, ≤20) ─────────────────

const searchQuery = z.object({ q: z.string().trim().default('') })

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { q } = parse(searchQuery, cleanQuery(req.query as Record<string, unknown>))
    if (!q) {
      res.json({ results: [] })
      return
    }
    const query = getDb()('employees').where({ active: 1 })
    applyNameQuery(query, q)
    const rows = (await query
      .orderBy('name')
      .limit(20)
      .select('id', 'name', 'employee_code', 'function', 'site', 'shift')) as Pick<
      Employee,
      'id' | 'name' | 'employee_code' | 'function' | 'site' | 'shift'
    >[]
    res.json({
      results: rows.map((r) => ({
        id: r.id,
        name: r.name,
        employeeCode: r.employee_code,
        function: r.function,
        site: r.site,
        shift: r.shift,
      })),
    })
  }),
)

// ── GET / — directory with given/received counts ────────────────────────────

const directoryQuery = z.object({
  q: z.string().trim().optional(),
  function: z.string().trim().optional(),
  site: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(directoryQuery, cleanQuery(req.query as Record<string, unknown>))
    const db = getDb()

    const filtered = db('employees').where({ active: 1 })
    if (q.q) applyNameQuery(filtered, q.q)
    if (q.function) filtered.andWhere('function', q.function)
    if (q.site) filtered.andWhere('site', q.site)

    const total = await countRows(filtered)
    const rows = (await filtered
      .clone()
      .orderBy('name')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .select('id', 'employee_code', 'name', 'function', 'sub_team', 'shift', 'site')) as Pick<
      Employee,
      'id' | 'employee_code' | 'name' | 'function' | 'sub_team' | 'shift' | 'site'
    >[]

    const counts = await recognitionCounts(rows.map((r) => r.id))
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        employeeCode: r.employee_code,
        name: r.name,
        function: r.function,
        subTeam: r.sub_team,
        shift: r.shift,
        site: r.site,
        givenCount: counts.get(r.id)?.given ?? 0,
        receivedCount: counts.get(r.id)?.received ?? 0,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    })
  }),
)

// ── GET /:id/profile — counts, behaviour breakdown, recent items (FR-16) ────

router.get(
  '/:id/profile',
  asyncHandler(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id)
    const db = getDb()
    const employee = (await db('employees').where({ id }).first()) as Employee | undefined
    if (!employee) throw apiError(404, 'NOT_FOUND', 'Employee not found')

    // Counts exclude removed entries (BR-6 soft delete keeps rows, not credit).
    const behaviours = (await db('behaviours').orderBy('sort_order')) as Behaviour[]
    const receivedByBehaviour = (await db('recognitions')
      .where({ recipient_id: id })
      .whereNot('status', 'removed')
      .groupBy('behaviour_id')
      .select('behaviour_id')
      .count({ c: '*' })) as { behaviour_id: number; c: number | string }[]
    const receivedCountMap = new Map(receivedByBehaviour.map((r) => [r.behaviour_id, Number(r.c)]))

    // Zero-fill active behaviours (stable chart axes); include inactive ones
    // only when the person actually has history on them.
    const byBehaviour = behaviours
      .filter((b) => !!b.active || (receivedCountMap.get(b.id) ?? 0) > 0)
      .map((b) => ({
        behaviourId: b.id,
        name: b.name,
        colour: b.colour,
        count: receivedCountMap.get(b.id) ?? 0,
      }))
    const receivedTotal = byBehaviour.reduce((s, b) => s + b.count, 0)

    const givenTotal = await countRows(db('recognitions').where({ giver_id: id }).whereNot('status', 'removed'))

    const recentRows = (await feedJoin(db)
      .whereIn('rec.status', ['active', 'flagged'])
      .andWhere((w) => w.where('rec.giver_id', id).orWhere('rec.recipient_id', id))
      .select(FEED_SELECT)
      .orderBy('rec.created_at', 'desc')
      .orderBy('rec.id', 'desc')
      .limit(10)) as FeedRow[]

    const isAdmin = req.user?.role === 'admin'
    res.json({
      employee: {
        id: employee.id,
        employeeCode: employee.employee_code,
        name: employee.name,
        function: employee.function,
        subTeam: employee.sub_team,
        shift: employee.shift,
        site: employee.site,
        levelGrade: employee.level_grade,
        active: !!employee.active,
        // Contact details are admin-only (DPDP data minimisation, FR-3).
        ...(isAdmin ? { mobile: employee.mobile, email: employee.email } : {}),
      },
      received: { total: receivedTotal, byBehaviour },
      given: { total: givenTotal },
      recent: recentRows.map((r) => toFeedItem(r)),
    })
  }),
)

export default router
