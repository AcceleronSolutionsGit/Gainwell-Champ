/**
 * /api/feed — the live recognition feed (FR-15, FR-17).
 *
 * Public (any signed-in employee) view: status IN ('active','flagged') —
 * flagged entries stay visible until a moderator actually removes them
 * (BR-5: flag, never auto-remove). 'removed' rows never appear here.
 *
 * Also exports the recognition⋈employees⋈behaviours join and the row →
 * FeedItem mapper reused by the board, profile and admin routes.
 */
import { Router } from 'express'
import { Knex } from 'knex'
import { z } from 'zod'
import { getDb } from '../db/knex'
import { istDayEndIso, istDayStartIso } from '../db/time'
import { apiError } from '../middleware/errorHandler'
import { asyncHandler, requireAuth } from '../middleware/requireAuth'
import { apiLimiter } from '../middleware/rateLimits'
import { FeedItem, RecognitionStatus } from '../types'

// ── shared feed query helpers (used by board.ts, employees.ts, admin.ts) ────

/** Flat row shape produced by FEED_SELECT below. */
export interface FeedRow {
  id: number
  createdAt: string
  reason: string
  status: RecognitionStatus
  giverId: number
  giverName: string
  giverFunction: string
  giverSite: string
  giverShift: string
  recipientId: number
  recipientName: string
  recipientFunction: string
  recipientSite: string
  recipientShift: string
  behaviourId: number
  behaviourName: string
  behaviourColour: string
}

export const FEED_SELECT = [
  'rec.id as id',
  'rec.created_at as createdAt',
  'rec.reason_text as reason',
  'rec.status as status',
  'g.id as giverId',
  'g.name as giverName',
  'g.function as giverFunction',
  'g.site as giverSite',
  'g.shift as giverShift',
  'r.id as recipientId',
  'r.name as recipientName',
  'r.function as recipientFunction',
  'r.site as recipientSite',
  'r.shift as recipientShift',
  'b.id as behaviourId',
  'b.name as behaviourName',
  'b.colour as behaviourColour',
]

/** recognitions ⋈ giver ⋈ recipient ⋈ behaviour — no status filter applied. */
export function feedJoin(db: Knex): Knex.QueryBuilder {
  return db('recognitions as rec')
    .join('employees as g', 'g.id', 'rec.giver_id')
    .join('employees as r', 'r.id', 'rec.recipient_id')
    .join('behaviours as b', 'b.id', 'rec.behaviour_id')
}

/** Map a FeedRow to the public FeedItem shape. Status included only on request
 *  (admin/moderation views) — the public feed doesn't expose moderation state. */
export function toFeedItem(row: FeedRow, opts: { withStatus?: boolean } = {}): FeedItem {
  const item: FeedItem = {
    id: row.id,
    createdAt: row.createdAt,
    reason: row.reason,
    giver: {
      id: row.giverId,
      name: row.giverName,
      function: row.giverFunction,
      site: row.giverSite,
      shift: row.giverShift,
    },
    recipient: {
      id: row.recipientId,
      name: row.recipientName,
      function: row.recipientFunction,
      site: row.recipientSite,
      shift: row.recipientShift,
    },
    behaviour: { id: row.behaviourId, name: row.behaviourName, colour: row.behaviourColour },
  }
  if (opts.withStatus) item.status = row.status
  return item
}

/** COUNT(*) over an already-filtered builder (portable number across sqlite/pg). */
export async function countRows(query: Knex.QueryBuilder): Promise<number> {
  const row = (await query.clone().count({ c: '*' }).first()) as { c?: number | string } | undefined
  return Number(row?.c ?? 0)
}

// ── route ────────────────────────────────────────────────────────────────────

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

/** Query-string params arrive as '' when a filter is cleared — treat as absent. */
function cleanQuery(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(q)) if (v !== '' && v !== undefined) out[k] = v
  return out
}

const istDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD (IST)')

const feedQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  function: z.string().trim().optional(),
  site: z.string().trim().optional(),
  behaviourId: z.coerce.number().int().positive().optional(),
  personId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().optional(),
  from: istDate.optional(),
  to: istDate.optional(),
})

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(feedQuery, cleanQuery(req.query as Record<string, unknown>))
    const db = getDb()

    const filtered = feedJoin(db).whereIn('rec.status', ['active', 'flagged'])
    // function/site match either side of the recognition — a plant's feed
    // should include cross-site recognitions its people gave or received.
    if (q.function) {
      filtered.andWhere((w) => w.where('g.function', q.function!).orWhere('r.function', q.function!))
    }
    if (q.site) {
      filtered.andWhere((w) => w.where('g.site', q.site!).orWhere('r.site', q.site!))
    }
    if (q.behaviourId) filtered.andWhere('rec.behaviour_id', q.behaviourId)
    if (q.personId) {
      filtered.andWhere((w) => w.where('rec.giver_id', q.personId!).orWhere('rec.recipient_id', q.personId!))
    }
    if (q.q) {
      const like = `%${q.q.toLowerCase()}%`
      filtered.andWhere((w) =>
        w
          .whereRaw('lower(rec.reason_text) like ?', [like])
          .orWhereRaw('lower(g.name) like ?', [like])
          .orWhereRaw('lower(r.name) like ?', [like]),
      )
    }
    if (q.from) filtered.andWhere('rec.created_at', '>=', istDayStartIso(q.from))
    if (q.to) filtered.andWhere('rec.created_at', '<=', istDayEndIso(q.to))

    const total = await countRows(filtered)
    const rows = (await filtered
      .clone()
      .select(FEED_SELECT)
      .orderBy('rec.created_at', 'desc')
      .orderBy('rec.id', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)) as FeedRow[]

    res.json({
      items: rows.map((r) => toFeedItem(r)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    })
  }),
)

/** Filter-bar options: distinct functions/sites of active people + active behaviours. */
router.get(
  '/filters',
  asyncHandler(async (_req, res) => {
    const db = getDb()
    const functionRows = (await db('employees')
      .where({ active: 1 })
      .distinct('function')
      .orderBy('function')) as { function: string }[]
    const siteRows = (await db('employees').where({ active: 1 }).distinct('site').orderBy('site')) as {
      site: string
    }[]
    const behaviourRows = (await db('behaviours')
      .where({ active: 1 })
      .orderBy('sort_order')
      .select('id', 'name', 'colour')) as { id: number; name: string; colour: string }[]

    res.json({
      functions: functionRows.map((r) => r.function),
      sites: siteRows.map((r) => r.site),
      behaviours: behaviourRows,
    })
  }),
)

// ── POST /recognize — create a recognition from the web application ─────────

const createRecognitionSchema = z.object({
  recipientId: z.coerce.number().int().positive(),
  behaviourId: z.coerce.number().int().positive(),
  reasonText: z
    .string()
    .trim()
    .min(15, 'Reason must be at least 15 characters long.')
    .max(50, 'Reason cannot exceed 50 characters.'),
  giverId: z.coerce.number().int().positive().optional(),
})

router.post(
  '/recognize',
  asyncHandler(async (req, res) => {
    const body = parse(createRecognitionSchema, req.body)

    // Determine giverId: explicit giverId or logged-in user's employeeId
    const giverId = body.giverId ?? req.user?.employeeId ?? undefined
    if (!giverId) {
      throw apiError(400, 'GIVER_REQUIRED', 'Please select a valid giver for this recognition.')
    }

    const { createRecognition } = await import('../modules/rules/recognitionService')
    const { notifyRecipient } = await import('../modules/notifications')

    const result = await createRecognition({
      giverId,
      recipientId: body.recipientId,
      behaviourId: body.behaviourId,
      reasonText: body.reasonText,
      channel: 'web',
    })

    if (!result.ok) {
      const err = result.error
      let message = 'Could not create recognition'
      if (err.code === 'SELF_RECOGNITION') {
        message = 'You cannot recognize yourself!'
      } else if (err.code === 'CAP_EXCEEDED') {
        message = `Monthly recognition limit (${err.params?.cap ?? 3} per person) reached for this recipient.`
      } else if (err.code === 'REASON_TOO_SHORT') {
        message = `The reason description is too brief (at least 15 characters required).`
      } else if (err.code === 'REASON_GENERIC') {
        message = `Please be more specific — generic phrases like "${err.params?.phrase}" are not allowed.`
      } else if (err.code === 'GIVER_INACTIVE') {
        message = 'The selected giver account is inactive.'
      } else if (err.code === 'RECIPIENT_INACTIVE') {
        message = 'The selected recipient account is inactive.'
      }
      throw apiError(400, err.code, message)
    }

    // Deliver notification to recipient on WhatsApp
    await notifyRecipient(result.recognition)

    // Fetch joined row for immediate FeedItem response
    const db = getDb()
    const row = (await feedJoin(db)
      .where('rec.id', result.recognition.id)
      .select(FEED_SELECT)
      .first()) as FeedRow

    res.json({
      ok: true,
      item: toFeedItem(row),
    })
  }),
)

export default router
