/**
 * Meta WhatsApp Cloud API client — the PRODUCTION transport (SPEC §4).
 *
 * Real, complete integration code. It is selected (not commented out) when
 * WHATSAPP_PROVIDER=meta and META_WA_PHONE_NUMBER_ID / META_WA_TOKEN are set;
 * locally the simulator provider runs instead (see provider.ts).
 *
 * Endpoint: POST https://graph.facebook.com/{version}/{phoneNumberId}/messages
 * with a Bearer access token. BotReply maps 1:1 onto the Cloud API message
 * types: text / interactive.button / interactive.list. Template messages
 * (type 'template') are required outside the 24-hour customer-service window
 * (FR-21) — e.g. the recipient notification and the weekly digest.
 */
import { config } from '../../config'
import { getDb } from '../../db/knex'
import { BotReply } from '../../types'
import type { WhatsAppProvider } from './provider'

const GRAPH_BASE = 'https://graph.facebook.com'

// WhatsApp interactive-message hard limits (Cloud API rejects anything over).
const BUTTON_TITLE_MAX = 20
const ROW_TITLE_MAX = 24
const ROW_DESC_MAX = 72
const SECTION_TITLE_MAX = 24
const BODY_MAX = 1024
const TEXT_MAX = 4096
const MAX_BUTTONS = 3
const MAX_ROWS_PER_LIST = 10

/** Truncate to `max` characters (codepoint-safe), ellipsised. */
function clip(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`
}

/** Cloud API wants plain digits (E.164 without the '+'). */
function toWaId(mobile: string): string {
  return mobile.replace(/[^\d]/g, '')
}

/** Map our canonical BotReply onto a Cloud API /messages payload. */
export function toMetaMessagePayload(mobile: string, reply: BotReply): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: toWaId(mobile) }
  switch (reply.type) {
    case 'text':
      return { ...base, type: 'text', text: { preview_url: false, body: clip(reply.text, TEXT_MAX) } }
    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: clip(reply.text, BODY_MAX) },
          action: {
            buttons: reply.buttons.slice(0, MAX_BUTTONS).map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: clip(b.title, BUTTON_TITLE_MAX) },
            })),
          },
        },
      }
    case 'list':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: clip(reply.text, BODY_MAX) },
          action: {
            button: clip(reply.buttonLabel, BUTTON_TITLE_MAX),
            sections: reply.sections.map((s) => ({
              title: clip(s.title, SECTION_TITLE_MAX),
              rows: s.rows.slice(0, MAX_ROWS_PER_LIST).map((r) => ({
                id: r.id,
                title: clip(r.title, ROW_TITLE_MAX),
                ...(r.description ? { description: clip(r.description, ROW_DESC_MAX) } : {}),
              })),
            })),
          },
        },
      }
  }
}

export class MetaCloudProvider implements WhatsAppProvider {
  private readonly apiVersion: string
  private readonly phoneNumberId: string
  private readonly accessToken: string

  constructor() {
    const { apiVersion, phoneNumberId, accessToken } = config.whatsapp.meta
    if (!phoneNumberId || !accessToken) {
      throw new Error(
        'WHATSAPP_PROVIDER=meta requires META_WA_PHONE_NUMBER_ID and META_WA_TOKEN ' +
          '(plus META_WA_APP_SECRET / META_WA_VERIFY_TOKEN for the webhook). ' +
          'See README — “Switching WhatsApp from demo to real”.',
      )
    }
    this.apiVersion = apiVersion
    this.phoneNumberId = phoneNumberId
    this.accessToken = accessToken
  }

  async sendReplies(mobile: string, replies: BotReply[]): Promise<void> {
    // Sequential on purpose — preserves message order in the chat.
    for (const reply of replies) {
      await this.post(toMetaMessagePayload(mobile, reply))
    }
  }

  async sendTemplate(
    mobile: string,
    template: 'recognition_received' | 'weekly_digest',
    params: string[],
  ): Promise<void> {
    const language = await this.templateLanguage(mobile)
    await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWaId(mobile),
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: params.length
          ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    })
  }

  /**
   * Templates are approved per language in WhatsApp Manager (same template
   * name, one approval per locale — FR-21). We pick the recipient's stored
   * preference from the directory; unknown numbers fall back to English.
   */
  private async templateLanguage(mobile: string): Promise<'en' | 'hi' | 'bn'> {
    try {
      const row = (await getDb()('employees').where({ mobile }).first()) as
        | { language?: string }
        | undefined
      return row?.language === 'hi' || row?.language === 'bn' ? row.language : 'en'
    } catch {
      return 'en'
    }
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    const url = `${GRAPH_BASE}/${this.apiVersion}/${this.phoneNumberId}/messages`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      // Cloud API errors carry a JSON body with error.code / error.message —
      // log it verbatim for supportability, then surface a typed failure.
      const body = await res.text().catch(() => '<unreadable body>')
      console.error(`[whatsapp:meta] send failed ${res.status} ${res.statusText}: ${body}`)
      throw new Error(`Meta Cloud API error ${res.status}`)
    }
  }
}
