/**
 * WhatsApp transport selection (SPEC §4).
 *
 * ── PRODUCTION (real integration) ─────────────────────────────
 * Enabled when WHATSAPP_PROVIDER=meta + META_WA_* credentials in env/Secrets
 * Manager: MetaCloudProvider (metaCloud.ts) talks to the Graph API directly.
 * ── LOCAL (demo fallback) — active by default ─────────────────
 * SimulatorProvider appends outbound messages to the in-memory transcript
 * store that backs the /simulator dev page — same engine, no network.
 */
import { BotReply } from '../../types'
import { config } from '../../config'
import { nowIso } from '../../db/time'
import { MetaCloudProvider } from './metaCloud'
import { GallaboxProvider } from './gallabox'
import { appendSimulatorEntry } from './simulatorStore'

export interface WhatsAppProvider {
  /** Send in-session replies (the giver's confirmation is a normal reply). */
  sendReplies(mobile: string, replies: BotReply[]): Promise<void>
  /** Send an approved template message — required outside the 24-hour window
   *  (FR-21), e.g. the recipient notification. */
  sendTemplate(
    mobile: string,
    template: 'recognition_received' | 'weekly_digest',
    params: string[],
  ): Promise<void>
}

class SimulatorProvider implements WhatsAppProvider {
  async sendReplies(mobile: string, replies: BotReply[]): Promise<void> {
    for (const reply of replies) {
      appendSimulatorEntry(mobile, { dir: 'out', at: nowIso(), reply, kind: 'message' })
    }
  }

  async sendTemplate(
    mobile: string,
    template: 'recognition_received' | 'weekly_digest',
    params: string[],
  ): Promise<void> {
    // Local stand-in for an approved template: render the body params as a
    // plain text "notification" so the simulator shows what production sends.
    appendSimulatorEntry(mobile, {
      dir: 'out',
      at: nowIso(),
      reply: { type: 'text', text: params.join('\n') || `[template: ${template}]` },
      kind: 'notification',
    })
  }
}

let singleton: WhatsAppProvider | null = null

/** Singleton by config.whatsapp.provider — created lazily so AWS Secrets
 *  Manager can populate credentials before the first message is sent. */
export function getWhatsAppProvider(): WhatsAppProvider {
  if (!singleton) {
    if (config.whatsapp.provider === 'meta') {
      singleton = new MetaCloudProvider()
    } else if (config.whatsapp.provider === 'gallabox') {
      singleton = new GallaboxProvider()
    } else {
      singleton = new SimulatorProvider()
    }
  }
  return singleton
}
