/**
 * Gallabox WhatsApp Business API client — PRODUCTION transport option.
 *
 * Endpoint: POST https://server.gallabox.com/devapi/messages/whatsapp
 * Headers: apiKey, apiSecret, Content-Type: application/json
 */
import { config } from '../../config'
import { getDb } from '../../db/knex'
import { BotReply } from '../../types'
import type { WhatsAppProvider } from './provider'

const BUTTON_TITLE_MAX = 20
const ROW_TITLE_MAX = 24
const ROW_DESC_MAX = 72
const SECTION_TITLE_MAX = 24
const BODY_MAX = 1024
const TEXT_MAX = 4096
const MAX_BUTTONS = 3
const MAX_ROWS_PER_LIST = 10

function clip(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`
}

/** E.164 phone string (+91...) or bare digits. */
function toFormattedMobile(mobile: string): string {
  return mobile.startsWith('+') ? mobile : `+${mobile.replace(/[^\d]/g, '')}`
}

/** Map BotReply onto Gallabox WhatsApp message payload */
export function toGallaboxMessagePayload(
  channelId: string,
  mobile: string,
  reply: BotReply,
): Record<string, unknown> {
  const formattedMobile = toFormattedMobile(mobile)
  const base = {
    channelId,
    recipient: {
      phone: formattedMobile,
    },
  }

  switch (reply.type) {
    case 'text':
      return {
        ...base,
        whatsapp: {
          type: 'text',
          text: {
            body: clip(reply.text, TEXT_MAX),
          },
        },
      }
    case 'buttons':
      return {
        ...base,
        whatsapp: {
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
        },
      }
    case 'list':
      return {
        ...base,
        whatsapp: {
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
        },
      }
  }
}

export class GallaboxProvider implements WhatsAppProvider {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly apiSecret: string
  private readonly channelId: string

  constructor() {
    const { baseUrl, apiKey, apiSecret, channelId } = config.whatsapp.gallabox
    if (!apiKey || !apiSecret || !channelId) {
      throw new Error(
        'WHATSAPP_PROVIDER=gallabox requires GALLABOX_API_KEY, GALLABOX_API_SECRET, and GALLABOX_CHANNEL_ID in environment variables.',
      )
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.channelId = channelId
  }

  async sendReplies(mobile: string, replies: BotReply[]): Promise<void> {
    for (const reply of replies) {
      await this.post(toGallaboxMessagePayload(this.channelId, mobile, reply))
    }
  }

  async sendTemplate(
    mobile: string,
    template: 'recognition_received' | 'weekly_digest',
    params: string[],
  ): Promise<void> {
    const language = await this.templateLanguage(mobile)
    const formattedMobile = toFormattedMobile(mobile)

    const payload = {
      channelId: this.channelId,
      recipient: {
        phone: formattedMobile,
      },
      whatsapp: {
        type: 'template',
        template: {
          name: template,
          language: { code: language },
          components: params.length
            ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
            : [],
        },
      },
    }

    await this.post(payload)
  }

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
    const url = `${this.baseUrl}/devapi/messages/whatsapp`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable body>')
      console.error(`[whatsapp:gallabox] send failed ${res.status} ${res.statusText}: ${body}`)
      throw new Error(`Gallabox API error ${res.status}: ${body}`)
    }
  }
}
