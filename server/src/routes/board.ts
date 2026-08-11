/**
 * /api/board — plant TV / kiosk endpoints (FR-18) + weekly printable (FRD §3).
 *
 * NO login: kiosks are unattended devices. If BOARD_TOKEN is set every call
 * must carry ?token=<BOARD_TOKEN>; when unset (local dev) the board is open.
 * Only public feed fields are exposed — no contact details, no moderation
 * state.
 */
import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config'
import { getDb } from '../db/knex'
import { formatIst, istDayEndIso, istDayStartIso } from '../db/time'
import { apiError } from '../middleware/errorHandler'
import { asyncHandler } from '../middleware/requireAuth'
import { apiLimiter } from '../middleware/rateLimits'
import { FEED_SELECT, feedJoin, FeedRow, toFeedItem } from './feed'

const DAY_MS = 24 * 60 * 60 * 1000

const router = Router()
router.use(apiLimiter)

// Kiosk token gate (only when configured).
router.use((req, _res, next) => {
  if (config.boardToken && req.query.token !== config.boardToken) {
    next(apiError(401, 'UNAUTHENTICATED', 'This board requires a valid token'))
    return
  }
  next()
})

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

function siteFilter(query: import('knex').Knex.QueryBuilder, site?: string): void {
  // Either side of the recognition keeps cross-site pairs on both boards.
  if (site) query.andWhere((w) => w.where('g.site', site).orWhere('r.site', site))
}

// ── GET /feed?site&limit — rolling board feed ────────────────────────────────

const boardFeedQuery = z.object({
  site: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  token: z.string().optional(), // consumed by the gate above
})

router.get(
  '/feed',
  asyncHandler(async (req, res) => {
    const q = parse(boardFeedQuery, cleanQuery(req.query as Record<string, unknown>))
    const query = feedJoin(getDb()).whereIn('rec.status', ['active', 'flagged'])
    siteFilter(query, q.site)
    const rows = (await query
      .select(FEED_SELECT)
      .orderBy('rec.created_at', 'desc')
      .orderBy('rec.id', 'desc')
      .limit(q.limit)) as FeedRow[]
    res.json({ items: rows.map((r) => toFeedItem(r)) })
  }),
)

// ── GET /weekly?site — last-7-IST-days summary for the printable ────────────

const boardWeeklyQuery = z.object({
  site: z.string().trim().optional(),
  token: z.string().optional(),
})

router.get(
  '/weekly',
  asyncHandler(async (req, res) => {
    const q = parse(boardWeeklyQuery, cleanQuery(req.query as Record<string, unknown>))
    // Rolling window: today plus the 6 previous IST days.
    const fromIso = istDayStartIso(new Date(Date.now() - 6 * DAY_MS))
    const toIso = istDayEndIso(new Date())

    const query = feedJoin(getDb())
      .whereIn('rec.status', ['active', 'flagged'])
      .andWhere('rec.created_at', '>=', fromIso)
      .andWhere('rec.created_at', '<=', toIso)
    siteFilter(query, q.site)
    const rows = (await query
      .select(FEED_SELECT)
      .orderBy('rec.created_at', 'desc')
      .orderBy('rec.id', 'desc')) as FeedRow[]

    // Behaviour totals (sorted busiest first).
    const byBehaviourMap = new Map<number, { name: string; colour: string; count: number }>()
    for (const r of rows) {
      const entry = byBehaviourMap.get(r.behaviourId) ?? { name: r.behaviourName, colour: r.behaviourColour, count: 0 }
      entry.count += 1
      byBehaviourMap.set(r.behaviourId, entry)
    }
    const byBehaviour = [...byBehaviourMap.values()].sort((a, b) => b.count - a.count)

    // Most-recognised people of the week.
    const recipientMap = new Map<number, { name: string; site: string; count: number }>()
    for (const r of rows) {
      const entry = recipientMap.get(r.recipientId) ?? { name: r.recipientName, site: r.recipientSite, count: 0 }
      entry.count += 1
      recipientMap.set(r.recipientId, entry)
    }
    const topRecipients = [...recipientMap.values()].sort((a, b) => b.count - a.count).slice(0, 5)

    res.json({
      weekStartIst: formatIst(fromIso, 'YYYY-MM-DD'),
      weekEndIst: formatIst(toIso, 'YYYY-MM-DD'),
      total: rows.length,
      byBehaviour,
      topRecipients,
      items: rows.map((r) => toFeedItem(r)),
    })
  }),
)

export default router
