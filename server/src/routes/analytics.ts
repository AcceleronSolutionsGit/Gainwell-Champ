/**
 * /api/analytics — committee/admin dashboard endpoints (FR-26…FR-31).
 *
 * Every endpoint takes optional from/to as IST calendar dates (YYYY-MM-DD),
 * defaulting to the last 90 days, and excludes removed recognitions. The
 * heavy lifting lives in modules/analytics/queries.ts.
 */
import { Router } from 'express'
import { z } from 'zod'
import { istDayEndIso, istDayStartIso } from '../db/time'
import { apiError } from '../middleware/errorHandler'
import { asyncHandler, requireRole } from '../middleware/requireAuth'
import { apiLimiter } from '../middleware/rateLimits'
import {
  AnalyticsRange,
  getBehaviourBreakdown,
  getConcentration,
  getDarkSpots,
  getDirectionMix,
  getFunctionShift,
  getSummary,
} from '../modules/analytics/queries'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 90

const router = Router()
router.use(apiLimiter)
router.use(requireRole('committee')) // committee AND admin

const istDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD (IST)')
const rangeQuery = z.object({ from: istDate.optional(), to: istDate.optional() })

function parseRange(query: Record<string, unknown>): AnalyticsRange {
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(query)) if (v !== '' && v !== undefined) cleaned[k] = v
  const result = rangeQuery.safeParse(cleaned)
  if (!result.success) {
    throw apiError(400, 'BAD_INPUT', result.error.issues[0]?.message ?? 'Invalid date range')
  }
  const { from, to } = result.data
  const range: AnalyticsRange = {
    fromIso: from ? istDayStartIso(from) : istDayStartIso(new Date(Date.now() - DEFAULT_WINDOW_DAYS * DAY_MS)),
    toIso: to ? istDayEndIso(to) : istDayEndIso(new Date()),
  }
  if (range.fromIso > range.toIso) throw apiError(400, 'BAD_INPUT', "'from' must not be after 'to'")
  return range
}

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await getSummary(parseRange(req.query as Record<string, unknown>)))
  }),
)

router.get(
  '/function-shift',
  asyncHandler(async (req, res) => {
    res.json(await getFunctionShift(parseRange(req.query as Record<string, unknown>)))
  }),
)

router.get(
  '/behaviours',
  asyncHandler(async (req, res) => {
    res.json(await getBehaviourBreakdown(parseRange(req.query as Record<string, unknown>)))
  }),
)

router.get(
  '/direction',
  asyncHandler(async (req, res) => {
    res.json(await getDirectionMix(parseRange(req.query as Record<string, unknown>)))
  }),
)

router.get(
  '/dark-spots',
  asyncHandler(async (req, res) => {
    res.json(await getDarkSpots(parseRange(req.query as Record<string, unknown>)))
  }),
)

router.get(
  '/concentration',
  asyncHandler(async (req, res) => {
    res.json(await getConcentration(parseRange(req.query as Record<string, unknown>)))
  }),
)

export default router
