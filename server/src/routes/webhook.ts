/**
 * Meta WhatsApp Cloud API webhook (SPEC §4) — mounted at /webhook/whatsapp
 * BEFORE express.json() so the raw body is available for HMAC verification.
 *
 * GET  /  — Meta verification handshake (hub.mode / hub.verify_token / hub.challenge).
 * POST /  — signed event delivery: verify X-Hub-Signature-256 over the raw
 *           body, parse messages to InboundMessage, ack 200 immediately, then
 *           run the conversation engine and send replies via the provider.
 */
import express, { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { config } from '../config'
import { InboundMessage } from '../types'
import { processInboundMessage } from '../modules/conversation/engine'
import { getWhatsAppProvider } from '../modules/whatsapp/provider'

const router = Router()

// Raw body inside this router only — the HMAC is computed over exact bytes.
router.use(express.raw({ type: '*/*' }))

// ── GET — subscription verification handshake ─────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (mode === 'subscribe' && token === config.whatsapp.meta.verifyToken && typeof challenge === 'string') {
    res.status(200).send(challenge)
    return
  }
  res.sendStatus(403)
})

// ── POST — event delivery ─────────────────────────────────────────────────────

/** Tolerant schema for the slice of the Meta payload we consume; everything
 *  else (statuses, contacts, metadata) passes through unvalidated. */
const metaMessageSchema = z
  .object({
    from: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    interactive: z
      .object({
        list_reply: z.object({ id: z.string() }).optional(),
        button_reply: z.object({ id: z.string() }).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const metaPayloadSchema = z
  .object({
    object: z.string().optional(),
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(
                z
                  .object({
                    value: z
                      .object({ messages: z.array(metaMessageSchema).optional() })
                      .passthrough(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

type MetaPayload = z.infer<typeof metaPayloadSchema>

let warnedNoAppSecret = false

router.post('/', (req: Request, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

  // Signature: reject 401 when the app secret is configured; in local dev
  // (no secret yet) warn once and continue so curl testing works.
  const appSecret = config.whatsapp.meta.appSecret
  if (appSecret) {
    if (!verifySignature(rawBody, req.header('x-hub-signature-256'), appSecret)) {
      res.sendStatus(401)
      return
    }
  } else if (!warnedNoAppSecret) {
    warnedNoAppSecret = true
    console.warn('[webhook] META_WA_APP_SECRET not set — accepting unsigned webhook payloads (dev only)')
  }

  let payload: MetaPayload | null = null
  try {
    const parsed = metaPayloadSchema.safeParse(JSON.parse(rawBody.toString('utf8')))
    if (parsed.success) payload = parsed.data
    else console.warn('[webhook] unrecognised payload shape:', parsed.error.issues[0]?.message)
  } catch {
    console.warn('[webhook] non-JSON payload ignored')
  }

  // Always ack fast — Meta retries (and eventually disables) slow webhooks.
  res.sendStatus(200)

  const messages = payload ? toInboundMessages(payload) : []
  if (messages.length === 0) return
  setImmediate(() => {
    void deliverAndReply(messages)
  })
})

/** Constant-time comparison of `sha256=<hex>` header vs our own HMAC. */
function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header) return false
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Flatten entry[].changes[].value.messages[] into our InboundMessage shape. */
function toInboundMessages(payload: MetaPayload): InboundMessage[] {
  const out: InboundMessage[] = []
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value.messages ?? []) {
        // Meta sends wa_id digits without '+'; the directory stores E.164.
        const mobile = m.from.startsWith('+') ? m.from : `+${m.from}`
        if (m.type === 'text' && m.text) {
          out.push({ mobile, text: m.text.body })
        } else if (m.type === 'interactive' && m.interactive) {
          const id = m.interactive.list_reply?.id ?? m.interactive.button_reply?.id
          if (id) out.push({ mobile, interactiveReplyId: id })
        } else {
          // Unsupported type (image, audio, …) — engine answers with help text.
          out.push({ mobile })
        }
      }
    }
  }
  return out
}

/** Run the engine per message (sequentially — keeps per-user ordering) and
 *  send replies via the configured provider. Errors are logged, never thrown:
 *  the webhook already returned 200. */
async function deliverAndReply(messages: InboundMessage[]): Promise<void> {
  for (const msg of messages) {
    try {
      const replies = await processInboundMessage(msg)
      if (replies.length > 0) {
        await getWhatsAppProvider().sendReplies(msg.mobile, replies)
      }
    } catch (err) {
      console.error(`[webhook] failed processing message from ${msg.mobile}:`, err)
    }
  }
}

export default router
