/**
 * The single write-path for recognitions (FR-11): every channel — WhatsApp
 * webhook, dev simulator — funnels through createRecognition(), so BR-1/2/3
 * and the BR-5 flag check are enforced exactly once, in one place.
 *
 * Rule violations come back as { ok: false, error } and NEVER throw — the
 * conversation engine turns them into localized bot copy (FR-8, FR-12).
 */
import { z } from 'zod'
import { getDb } from '../../db/knex'
import { istMonthStartIso, nowIso } from '../../db/time'
import { getSettings } from '../settings'
import { CreateRecognitionResult, Employee, Recognition } from '../../types'
import { checkCap, checkReason, checkSelf } from './rules'
import { checkAfterCreate } from '../flags/flagScan'

export interface CreateRecognitionInput {
  giverId: number
  recipientId: number
  behaviourId: number
  reasonText: string
  channel?: string // 'whatsapp' (default) | 'simulator'
}

// Defensive validation of the internal contract. A failure here is a caller
// bug (the conversation engine only ever passes ids it just looked up), so —
// unlike rule violations — it throws.
const inputSchema = z.object({
  giverId: z.number().int().positive(),
  recipientId: z.number().int().positive(),
  behaviourId: z.number().int().positive(),
  reasonText: z.string().max(2000),
  channel: z.enum(['whatsapp', 'simulator', 'web']).optional(),
})

/**
 * Validates BR-1 (self), BR-2 (per-pair monthly cap, IST calendar month),
 * BR-3 (reason gate) and active-employee checks; inserts the recognition;
 * runs the incremental BR-5 flag check (burst/loop). Never throws for rule
 * violations — returns { ok: false, error } instead.
 */
export async function createRecognition(input: CreateRecognitionInput): Promise<CreateRecognitionResult> {
  const parsed = inputSchema.parse(input)
  const db = getDb()

  // ── active-employee checks ──────────────────────────────────────────────
  const giver = (await db('employees').where({ id: parsed.giverId }).first()) as Employee | undefined
  if (!giver || !giver.active) {
    return { ok: false, error: { code: 'GIVER_INACTIVE' } }
  }
  const recipient = (await db('employees').where({ id: parsed.recipientId }).first()) as
    | Employee
    | undefined
  if (!recipient || !recipient.active) {
    return { ok: false, error: { code: 'RECIPIENT_INACTIVE' } }
  }

  // The engine only offers the six active behaviours (FR-7); anything else is
  // a programming error, not a user-facing rule violation.
  const behaviour = await db('behaviours').where({ id: parsed.behaviourId }).first()
  if (!behaviour || !behaviour.active) {
    throw new Error(`createRecognition: unknown or inactive behaviour id ${parsed.behaviourId}`)
  }

  // ── the three business rules (BR-1, BR-2, BR-3) ─────────────────────────
  const settings = await getSettings()
  const ruleError =
    checkSelf(parsed.giverId, parsed.recipientId) ??
    (await checkCap(parsed.giverId, parsed.recipientId, settings)) ??
    checkReason(parsed.reasonText, settings)
  if (ruleError) return { ok: false, error: ruleError }

  // ── insert ──────────────────────────────────────────────────────────────
  const insertRes = await db('recognitions')
    .insert({
      giver_id: parsed.giverId,
      recipient_id: parsed.recipientId,
      behaviour_id: parsed.behaviourId,
      reason_text: parsed.reasonText.trim(),
      channel: parsed.channel ?? 'whatsapp',
      status: 'active',
      created_at: nowIso(),
    })
    .returning('id')
  // better-sqlite3 returns [id] / [{id}], pg returns [{id}] — normalize.
  const first = Array.isArray(insertRes) ? insertRes[0] : insertRes
  const id =
    typeof first === 'object' && first !== null ? (first as { id: number }).id : (first as number)

  // ── BR-2 under concurrency ──────────────────────────────────────────────
  // checkCap() above ran before the insert with no lock, so two simultaneous
  // submissions (webhook redelivery, parallel simulator posts) could both
  // pass it. Re-count including our own row — restricted to rows inserted no
  // later than ours (id <= ours), so under a burst exactly `cap` earliest
  // rows survive deterministically — and roll our insert back on overshoot.
  const recheck = await db('recognitions')
    .where({ giver_id: parsed.giverId, recipient_id: parsed.recipientId })
    .whereNot('status', 'removed')
    .where('created_at', '>=', istMonthStartIso())
    .where('id', '<=', id)
    .count({ n: '*' })
    .first()
  if (Number(recheck?.n ?? 0) > settings.capPerPairPerMonth) {
    // Not a BR-6 soft delete: this row should never have existed — it is a
    // rollback of our own insert milliseconds ago, before any flag ran.
    await db('recognitions').where({ id }).del()
    return { ok: false, error: { code: 'CAP_EXCEEDED', params: { cap: settings.capPerPairPerMonth } } }
  }

  const inserted = (await db('recognitions').where({ id }).first()) as Recognition

  // ── incremental BR-5 flag check (may set status 'flagged') ──────────────
  await checkAfterCreate(inserted)

  // Return the fresh row — status reflects any flag the check just raised.
  const recognition = (await db('recognitions').where({ id }).first()) as Recognition
  return { ok: true, recognition }
}
