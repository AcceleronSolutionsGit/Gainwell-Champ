/**
 * FR-19 — notify the recipient on WhatsApp the moment a recognition lands,
 * composed in the RECIPIENT's preferred language (which may differ from the
 * giver's conversation language).
 *
 * ── PRODUCTION (real integration) ─────────────────────────────
 * The recipient usually hasn't messaged the bot in the last 24 hours, so a
 * free-form message would be rejected — WhatsApp only delivers pre-approved
 * TEMPLATE messages outside the customer-service window (FR-21). The
 * 'recognition_received' template must be approved in en/hi/bn with body
 * params {{1}}=giver, {{2}}=behaviour, {{3}}=reason; the provider picks the
 * language code from the recipient's directory preference.
 * ── LOCAL (demo fallback) — active by default ─────────────────
 * The fully localized text lands in the simulator outbox with
 * kind:'notification' so the dev phone renders it distinctly.
 */
import { config } from '../config'
import { getDb } from '../db/knex'
import { nowIso } from '../db/time'
import { Behaviour, Employee, Recognition } from '../types'
import { normalizeLang, t } from './conversation/i18n'
import { getWhatsAppProvider } from './whatsapp/provider'
import { appendSimulatorEntry } from './whatsapp/simulatorStore'

export async function notifyRecipient(recognition: Recognition): Promise<void> {
  const db = getDb()
  const recipient = (await db('employees').where({ id: recognition.recipient_id }).first()) as
    | Employee
    | undefined
  // Deactivated or vanished recipients are skipped silently (FR-4 keeps their
  // history; we just never message a number that left the programme).
  if (!recipient || !recipient.active) return

  const giver = (await db('employees').where({ id: recognition.giver_id }).first()) as
    | Employee
    | undefined
  const behaviour = (await db('behaviours').where({ id: recognition.behaviour_id }).first()) as
    | Behaviour
    | undefined
  if (!giver || !behaviour) return

  const lang = normalizeLang(recipient.language)

  // ── Simulator store (always, when enabled) ──────────────────────────────
  // Populate the in-memory transcript so the /simulator page shows the
  // notification bubble regardless of which WhatsApp provider is active.
  if (config.simulatorEnabled) {
    appendSimulatorEntry(recipient.mobile, {
      dir: 'out',
      at: nowIso(),
      reply: {
        type: 'text',
        text: t(lang, 'notify_received', {
          giver: giver.name,
          behaviour: behaviour.name,
          reason: recognition.reason_text,
        }),
      },
      kind: 'notification',
    })
  }

  // ── Meta Cloud API (real WhatsApp delivery) ─────────────────────────────
  if (config.whatsapp.provider === 'meta') {
    try {
      // TODO: Revert to 'recognition_received' once the custom template is
      // approved in Meta Business Manager. Using 'hello_world' for now so we
      // can verify the Meta Cloud API integration end-to-end.
      // Original:
      // await getWhatsAppProvider().sendTemplate(recipient.mobile, 'recognition_received', [
      //   giver.name,
      //   behaviour.name,
      //   recognition.reason_text,
      // ])
      await getWhatsAppProvider().sendTemplate(recipient.mobile, 'hello_world' as any, [])
    } catch (err) {
      // The recognition itself already succeeded — never fail the giver's
      // conversation because the notification could not be delivered.
      console.error(`[notify] recognition_received template to ${recipient.mobile} failed:`, err)
    }
  }
}
