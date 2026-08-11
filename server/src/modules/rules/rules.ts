/**
 * Business-rule checks BR-1 / BR-2 / BR-3 (FRD §4).
 *
 * Each check returns a `RuleError` when the rule is violated, or `null` when
 * the recognition may proceed. The conversation engine maps the error codes
 * onto localized bot copy (SPEC §8), so codes and params here are contract.
 */
import { getDb } from '../../db/knex'
import { istMonthStartIso } from '../../db/time'
import { AppSettings } from '../settings'
import { RuleError } from '../../types'

/** BR-1 — no self-recognition. */
export function checkSelf(giverId: number, recipientId: number): RuleError | null {
  if (giverId === recipientId) return { code: 'SELF_RECOGNITION' }
  return null
}

/**
 * BR-2 — per-pair monthly cap. Counts non-removed recognitions from this
 * giver to this recipient since the start of the current IST calendar month
 * (the cap resets on the 1st, IST). There are no other volume limits.
 */
export async function checkCap(
  giverId: number,
  recipientId: number,
  settings: AppSettings,
): Promise<RuleError | null> {
  const row = await getDb()('recognitions')
    .where({ giver_id: giverId, recipient_id: recipientId })
    .whereNot('status', 'removed')
    .where('created_at', '>=', istMonthStartIso())
    .count({ n: '*' })
    .first()
  const count = Number(row?.n ?? 0)
  if (count >= settings.capPerPairPerMonth) {
    return { code: 'CAP_EXCEEDED', params: { cap: settings.capPerPairPerMonth } }
  }
  return null
}

/**
 * Normalize a reason for the BR-3 generic-phrase comparison: lowercase,
 * punctuation stripped, whitespace collapsed. Unicode-aware so Hindi/Bengali
 * reasons pass through unharmed (only symbols/punctuation are stripped).
 */
export function normalizeReason(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * BR-3 — reason quality gate. Trimmed length must reach the configured
 * minimum; then the normalized text must not be an exact match for any
 * blocklisted generic phrase ("great job" etc. — case/punctuation-insensitive,
 * whole-reason match only, so "great job on the fixture rework" passes).
 */
export function checkReason(text: string, settings: AppSettings): RuleError | null {
  const trimmed = text.trim()
  if (trimmed.length < settings.reasonMinLength) {
    return { code: 'REASON_TOO_SHORT', params: { min: settings.reasonMinLength } }
  }
  const normalized = normalizeReason(trimmed)
  for (const phrase of settings.reasonBlocklist) {
    if (normalized === normalizeReason(phrase)) {
      // `phrase` feeds the {phrase} placeholder in the err_reason_generic copy.
      return { code: 'REASON_GENERIC', params: { phrase } }
    }
  }
  return null
}
