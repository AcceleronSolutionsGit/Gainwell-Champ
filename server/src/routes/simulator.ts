/**
 * Dev WhatsApp simulator API (SPEC §4) — backs the /simulator web page.
 * Exercises the exact same conversation engine as the production webhook;
 * only the transport differs (in-memory transcripts instead of the Graph API).
 *
 * Mounted at /api/dev/simulator only when config.simulatorEnabled — and every
 * handler additionally 404s when disabled, in case of a stale mount.
 */
import { NextFunction, Request, Response, Router } from 'express'
import { z } from 'zod'
import { config } from '../config'
import { getDb } from '../db/knex'
import { nowIso } from '../db/time'
import { apiError } from '../middleware/errorHandler'
import { processInboundMessage } from '../modules/conversation/engine'
import {
  appendSimulatorEntry,
  clearSimulatorHistory,
  getSimulatorHistory,
} from '../modules/whatsapp/simulatorStore'

const router = Router()

/** Express 4 doesn't catch async rejections — funnel them to errorHandler. */
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next)
  }

router.use((_req: Request, _res: Response, next: NextFunction) => {
  if (!config.simulatorEnabled) return next(apiError(404, 'NOT_FOUND', 'Simulator is disabled'))
  next()
})

const mobileSchema = z.string().min(5).max(20)

const messageBodySchema = z
  .object({
    mobile: mobileSchema,
    text: z.string().min(1).max(4096).optional(),
    interactiveReplyId: z.string().min(1).max(256).optional(),
    /** Display-only: the tapped chip's visible title, mirroring how real
     *  WhatsApp echoes the button text (never fed to the engine). */
    label: z.string().min(1).max(256).optional(),
  })
  .refine((b) => b.text !== undefined || b.interactiveReplyId !== undefined, {
    message: 'Provide text or interactiveReplyId',
  })

// GET /contacts — the phone's contact picker: all employees, active first.
router.get(
  '/contacts',
  wrap(async (_req, res) => {
    const rows = (await getDb()('employees')
      .select('id', 'name', 'mobile', 'function', 'site', 'language', 'active')
      .orderBy([
        { column: 'active', order: 'desc' },
        { column: 'name', order: 'asc' },
      ])) as {
      id: number
      name: string
      mobile: string
      function: string
      site: string
      language: string
      active: number
    }[]
    res.json({
      contacts: rows.map((r) => ({
        id: r.id,
        name: r.name,
        mobile: r.mobile,
        function: r.function,
        site: r.site,
        language: r.language,
        active: !!r.active,
      })),
    })
  }),
)

// GET /history?mobile= — the current transcript for one phone.
router.get(
  '/history',
  wrap(async (req, res) => {
    const parsed = mobileSchema.safeParse(req.query.mobile)
    if (!parsed.success) throw apiError(400, 'BAD_INPUT', 'mobile query parameter is required')
    res.json({ history: getSimulatorHistory(parsed.data) })
  }),
)

// POST /message — inbound "user" message: append, run the engine, append the
// replies, return the fresh full transcript.
router.post(
  '/message',
  wrap(async (req, res) => {
    const parsed = messageBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw apiError(400, 'BAD_INPUT', parsed.error.issues[0]?.message ?? 'Invalid body')
    }
    const { mobile, text, interactiveReplyId, label } = parsed.data

    appendSimulatorEntry(mobile, {
      dir: 'in',
      at: nowIso(),
      // Taps echo the chip's visible label (like real WhatsApp); the raw
      // reply id is only a fallback when no label was provided.
      text: text ?? label ?? interactiveReplyId,
      kind: 'message',
    })

    const replies = await processInboundMessage({ mobile, text, interactiveReplyId })
    for (const reply of replies) {
      appendSimulatorEntry(mobile, { dir: 'out', at: nowIso(), reply, kind: 'message' })
    }
    // Note: a recipient notification (FR-19) triggered by this message lands
    // in the RECIPIENT's transcript via the simulator outbox, not this one.
    res.json({ history: getSimulatorHistory(mobile) })
  }),
)

// POST /reset — wipe one phone: transcript + persisted conversation state.
router.post(
  '/reset',
  wrap(async (req, res) => {
    const parsed = z.object({ mobile: mobileSchema }).safeParse(req.body)
    if (!parsed.success) throw apiError(400, 'BAD_INPUT', 'mobile is required')
    clearSimulatorHistory(parsed.data.mobile)
    await getDb()('conversation_state').where({ mobile: parsed.data.mobile }).del()
    res.json({ ok: true })
  }),
)

export default router
