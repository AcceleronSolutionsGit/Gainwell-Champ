/**
 * Conversation engine — the WhatsApp state machine (SPEC §2, FR-5…FR-10).
 *
 * Three capture steps: recipient → behaviour → reason, plus a menu with
 * "my count" (FR-16) and language switching. State is persisted per mobile in
 * the conversation_state table as JSON and expires after 30 minutes (FR-10:
 * resume within the window, greet fresh after it).
 *
 * The engine only RETURNS replies — the transport (webhook or simulator
 * route) is responsible for delivering them. Recipient notification (FR-19)
 * is triggered here right after a successful create.
 */
import { getDb } from '../../db/knex'
import { nowIso } from '../../db/time'
import { Behaviour, BotReply, CreateRecognitionResult, Employee, InboundMessage } from '../../types'
import { AppSettings, getSettings } from '../settings'
import { createRecognition } from '../rules/recognitionService'
import { notifyRecipient } from '../notifications'
import { Lang, normalizeLang, t } from './i18n'

// ── persisted state ───────────────────────────────────────────────────────────

type Step = 'menu' | 'recipient_query' | 'behaviour' | 'reason'

interface ConvState {
  step: Step
  lang: Lang
  data: {
    /** Employee ids offered in the last recipient list (FR-6 disambiguation). */
    candidates?: number[]
    recipientId?: number
    behaviourId?: number
  }
  updatedAt: string
}

/** FR-10 — an unfinished flow can be resumed for 30 minutes, then we greet fresh. */
const STATE_TTL_MS = 30 * 60 * 1000

/** WhatsApp allows at most 10 list rows; we show 8 and ask to narrow beyond that. */
const MAX_LIST_ROWS = 8

// WhatsApp interactive limits (also enforced by metaCloud.ts defensively).
const ROW_TITLE_MAX = 24
const ROW_DESC_MAX = 72

const GREETING_RE = /^(hi|hello|menu|champ|start|recognize|recognise)$/
const CANCEL_RE = /^(cancel|stop)$/
const COUNT_RE = /^(my ?count|count)$/

// ── public entry point ────────────────────────────────────────────────────────

export async function processInboundMessage(msg: InboundMessage): Promise<BotReply[]> {
  const db = getDb()
  const mobile = msg.mobile
  const giver = (await db('employees').where({ mobile }).first()) as Employee | undefined

  if (!giver || !giver.active) {
    // FR-2 — unknown or deactivated numbers get a LOCALIZED refusal +
    // enrolment pointer and never acquire state. A deactivated employee's
    // row still carries their language preference; only truly unknown
    // numbers fall back to English.
    const refusalLang: Lang = giver ? normalizeLang(giver.language) : 'en'
    return [text(t(refusalLang, 'not_registered'))]
  }

  const state = await loadState(mobile)
  const lang: Lang = state?.lang ?? normalizeLang(giver.language)
  const rawText = msg.text?.trim()
  const command = rawText ? normalizeCommand(rawText) : ''

  // ── global text commands (work from any step) ──────────────────────────────
  if (command && CANCEL_RE.test(command)) {
    await clearState(mobile)
    return [text(t(lang, 'cancelled'))]
  }
  if (command && GREETING_RE.test(command)) {
    return showMenu(mobile, lang)
  }
  if (command && COUNT_RE.test(command)) {
    return countSummary(giver, lang) // FR-16 shortcut; leaves any flow resumable
  }

  // ── interactive taps (old messages stay tappable — validate, never crash) ──
  if (msg.interactiveReplyId) {
    return handleTap(mobile, giver, lang, state, msg.interactiveReplyId)
  }

  // ── free text, routed by step ───────────────────────────────────────────────
  if (!rawText) {
    // Media/sticker/location etc. — we only speak text and taps.
    return [text(t(lang, 'help_fallback'))]
  }
  if (!state) {
    // Any text while idle ⇒ welcome menu (FR-5).
    return showMenu(mobile, lang)
  }
  switch (state.step) {
    case 'menu':
      return showMenu(mobile, lang)
    case 'recipient_query':
      return searchRecipients(mobile, giver, lang, rawText)
    case 'behaviour':
      // Gentle nudge: repeat the behaviour list for the chosen recipient.
      return resendBehaviourList(mobile, lang, state)
    case 'reason':
      return submitReason(mobile, giver, lang, state, rawText)
  }
}

// ── interactive tap routing ───────────────────────────────────────────────────

async function handleTap(
  mobile: string,
  giver: Employee,
  lang: Lang,
  state: ConvState | null,
  tapId: string,
): Promise<BotReply[]> {
  if (tapId === 'menu_give') {
    await saveState(mobile, { step: 'recipient_query', lang, data: {} })
    return [text(t(lang, 'ask_recipient'))]
  }
  if (tapId === 'menu_count') {
    return countSummary(giver, lang)
  }
  if (tapId === 'menu_lang') {
    return [languageButtons(lang)]
  }
  if (tapId.startsWith('lang_')) {
    return setLanguage(mobile, giver, lang, tapId.slice('lang_'.length))
  }
  if (tapId.startsWith('pick_')) {
    return handleRecipientPick(mobile, giver, lang, state, tapId.slice('pick_'.length))
  }
  if (tapId.startsWith('beh_')) {
    return handleBehaviourPick(mobile, lang, state, tapId.slice('beh_'.length))
  }
  return [text(t(lang, 'help_fallback'))]
}

async function setLanguage(
  mobile: string,
  giver: Employee,
  lang: Lang,
  code: string,
): Promise<BotReply[]> {
  if (code !== 'en' && code !== 'hi' && code !== 'bn') {
    return [text(t(lang, 'help_fallback'))]
  }
  await getDb()('employees').where({ id: giver.id }).update({ language: code, updated_at: nowIso() })
  await clearState(mobile) // copy says "say hi to continue" — start clean
  return [text(t(code, 'lang_set'))] // confirm in the NEW language
}

async function handleRecipientPick(
  mobile: string,
  giver: Employee,
  lang: Lang,
  state: ConvState | null,
  rawId: string,
): Promise<BotReply[]> {
  // Accept re-picks from the behaviour step too (user tapped the old list again).
  if (!state || (state.step !== 'recipient_query' && state.step !== 'behaviour')) {
    return [text(t(lang, 'help_fallback'))]
  }
  const recipientId = Number(rawId)
  if (!Number.isInteger(recipientId)) return [text(t(lang, 'help_fallback'))]
  if (recipientId === giver.id) return [text(t(lang, 'err_self'))] // BR-1, crafted tap
  const recipient = (await getDb()('employees').where({ id: recipientId, active: 1 }).first()) as
    | Employee
    | undefined
  if (!recipient) {
    // Deactivated between search and tap — restart the recipient step.
    await saveState(mobile, { step: 'recipient_query', lang, data: {} })
    return [text(t(lang, 'recipient_inactive')), text(t(lang, 'ask_recipient'))]
  }
  const list = await behaviourListReply(lang, recipient.name)
  if (!list) return [text(t(lang, 'help_fallback'))] // no active behaviours (admin edge case)
  await saveState(mobile, { step: 'behaviour', lang, data: { recipientId } })
  return [list]
}

async function handleBehaviourPick(
  mobile: string,
  lang: Lang,
  state: ConvState | null,
  rawId: string,
): Promise<BotReply[]> {
  // Accept re-picks from the reason step (user changed their mind on the list).
  if (
    !state ||
    (state.step !== 'behaviour' && state.step !== 'reason') ||
    !state.data.recipientId
  ) {
    return [text(t(lang, 'help_fallback'))]
  }
  const db = getDb()
  const recipient = (await db('employees').where({ id: state.data.recipientId }).first()) as
    | Employee
    | undefined
  if (!recipient) return showMenu(mobile, lang) // corrupt state — start over
  const behaviourId = Number(rawId)
  const behaviour = Number.isInteger(behaviourId)
    ? ((await db('behaviours').where({ id: behaviourId, active: 1 }).first()) as Behaviour | undefined)
    : undefined
  if (!behaviour) {
    // Behaviour deactivated mid-flow (FR-23) — offer the current list again.
    return resendBehaviourList(mobile, lang, state)
  }
  const settings = await getSettings()
  await saveState(mobile, {
    step: 'reason',
    lang,
    data: { recipientId: recipient.id, behaviourId },
  })
  return [text(t(lang, 'ask_reason', { name: recipient.name, min: settings.reasonMinLength }))]
}

// ── recipient search (FR-6) ───────────────────────────────────────────────────

async function searchRecipients(
  mobile: string,
  giver: Employee,
  lang: Lang,
  query: string,
): Promise<BotReply[]> {
  const db = getDb()
  const lowered = query.toLowerCase()
  // Escape LIKE wildcards so "100%" searches literally; ESCAPE works on
  // SQLite, PostgreSQL, and MariaDB/MySQL when passed as a parameter binding.
  const needle = `%${lowered.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
  const matches = (await db('employees')
    .where('active', 1)
    .whereNot('id', giver.id) // never offer the giver themself (BR-1)
    .andWhere((b) => {
      b.whereRaw("LOWER(name) LIKE ? ESCAPE ?", [needle, '\\']).orWhereRaw(
        'LOWER(employee_code) = ?',
        [lowered],
      )
    })
    .orderBy('name', 'asc')
    .limit(MAX_LIST_ROWS + 1)) as Employee[] // +1 detects "more than 8"

  if (matches.length === 0) {
    await touchState(mobile, lang) // stay in recipient_query
    return [text(t(lang, 'no_match', { q: clip(query, 40) }))]
  }

  const overflow = matches.length > MAX_LIST_ROWS
  const shown = matches.slice(0, MAX_LIST_ROWS)
  await saveState(mobile, {
    step: 'recipient_query',
    lang,
    data: { candidates: shown.map((e) => e.id) },
  })
  return [
    {
      type: 'list',
      text: overflow ? t(lang, 'too_many') : t(lang, 'pick_recipient'),
      buttonLabel: t(lang, 'list_button'),
      sections: [
        {
          title: t(lang, 'section_people'),
          rows: shown.map((e) => ({
            id: `pick_${e.id}`,
            title: clip(e.name, ROW_TITLE_MAX),
            description: clip(`${e.function} · ${e.site}`, ROW_DESC_MAX),
          })),
        },
      ],
    },
  ]
}

// ── behaviour list (FR-7, FR-23: labels/colours live in the DB) ───────────────

async function behaviourListReply(lang: Lang, recipientName: string): Promise<BotReply | null> {
  const behaviours = (await getDb()('behaviours')
    .where({ active: 1 })
    .orderBy('sort_order', 'asc')) as Behaviour[]
  if (behaviours.length === 0) return null
  return {
    type: 'list',
    text: t(lang, 'pick_behaviour', { name: recipientName }),
    buttonLabel: t(lang, 'list_button'),
    sections: [
      {
        title: t(lang, 'section_behaviours'),
        rows: behaviours.map((b) => ({
          id: `beh_${b.id}`,
          title: clip(b.name, ROW_TITLE_MAX),
          ...(b.description ? { description: clip(b.description, ROW_DESC_MAX) } : {}),
        })),
      },
    ],
  }
}

async function resendBehaviourList(
  mobile: string,
  lang: Lang,
  state: ConvState,
): Promise<BotReply[]> {
  if (!state.data.recipientId) return showMenu(mobile, lang)
  const recipient = (await getDb()('employees').where({ id: state.data.recipientId }).first()) as
    | Employee
    | undefined
  if (!recipient) return showMenu(mobile, lang)
  const list = await behaviourListReply(lang, recipient.name)
  await touchState(mobile, lang)
  return list ? [list] : [text(t(lang, 'help_fallback'))]
}

// ── reason submission → createRecognition (§3) ────────────────────────────────

async function submitReason(
  mobile: string,
  giver: Employee,
  lang: Lang,
  state: ConvState,
  reasonText: string,
): Promise<BotReply[]> {
  const { recipientId, behaviourId } = state.data
  if (!recipientId || !behaviourId) return showMenu(mobile, lang) // corrupt state

  const db = getDb()
  const settings = await getSettings()
  let result: CreateRecognitionResult
  try {
    result = await createRecognition({
      giverId: giver.id,
      recipientId,
      behaviourId,
      reasonText,
      channel: 'whatsapp',
    })
  } catch (err) {
    // createRecognition() throws for an unknown/inactive behaviour — which is
    // legitimately reachable here when an admin deactivates the behaviour
    // (FR-23) while the user sits in the reason step. Handle it like a stale
    // beh_ tap (handleBehaviourPick): step back and re-offer the current list
    // instead of crashing the webhook/simulator with a 500.
    const behaviourStillActive = await db('behaviours').where({ id: behaviourId, active: 1 }).first()
    if (!behaviourStillActive) {
      const backOneStep: ConvState = {
        step: 'behaviour',
        lang,
        data: { recipientId },
        updatedAt: nowIso(),
      }
      await saveState(mobile, backOneStep)
      return resendBehaviourList(mobile, lang, backOneStep)
    }
    // Anything else is a real programming/DB error — log it, reset the
    // conversation so the user isn't stuck retrying into the same failure.
    console.error('[champ] createRecognition failed in submitReason:', err)
    await clearState(mobile)
    return [text(t(lang, 'help_fallback'))]
  }

  if (result.ok) {
    await clearState(mobile)
    const recipient = (await db('employees').where({ id: recipientId }).first()) as
      | Employee
      | undefined
    const behaviour = (await db('behaviours').where({ id: behaviourId }).first()) as
      | Behaviour
      | undefined
    const replies = [
      text(
        t(lang, 'success', {
          name: recipient?.name ?? '',
          behaviour: behaviour?.name ?? '',
        }),
      ),
    ]
    await notifyRecipient(result.recognition) // FR-19, in the recipient's language
    return replies
  }

  return mapRuleError(mobile, lang, state, reasonText, settings, result.error)
}

/** Map every RuleErrorCode to the right localized message + state transition (§2.6). */
async function mapRuleError(
  mobile: string,
  lang: Lang,
  state: ConvState,
  reasonText: string,
  settings: AppSettings,
  error: { code: string; params?: Record<string, string | number> },
): Promise<BotReply[]> {
  switch (error.code) {
    case 'REASON_TOO_SHORT':
      // FR-8 — stay in the reason step so they can just retype.
      await touchState(mobile, lang, state)
      return [text(t(lang, 'err_reason_short', { min: error.params?.min ?? settings.reasonMinLength }))]
    case 'REASON_GENERIC':
      await touchState(mobile, lang, state)
      return [
        text(t(lang, 'err_reason_generic', { phrase: String(error.params?.phrase ?? clip(reasonText, 40)) })),
      ]
    case 'CAP_EXCEEDED': {
      // FR-12 — cap reached for this person this month; end the flow.
      const recipient = (await getDb()('employees').where({ id: state.data.recipientId }).first()) as
        | Employee
        | undefined
      await clearState(mobile)
      return [
        text(
          t(lang, 'err_cap', {
            name: recipient?.name ?? '',
            cap: error.params?.cap ?? settings.capPerPairPerMonth,
          }),
        ),
      ]
    }
    case 'SELF_RECOGNITION':
      await clearState(mobile)
      return [text(t(lang, 'err_self'))]
    case 'RECIPIENT_INACTIVE':
      await clearState(mobile)
      return [text(t(lang, 'recipient_inactive'))]
    case 'GIVER_INACTIVE':
      await clearState(mobile)
      return [text(t(lang, 'not_registered'))]
    default:
      await clearState(mobile)
      return [text(t(lang, 'help_fallback'))]
  }
}

// ── menu / count / language ───────────────────────────────────────────────────

async function showMenu(mobile: string, lang: Lang): Promise<BotReply[]> {
  await saveState(mobile, { step: 'menu', lang, data: {} })
  return [
    {
      type: 'buttons',
      text: t(lang, 'welcome'),
      buttons: [
        { id: 'menu_give', title: t(lang, 'btn_give') },
        { id: 'menu_count', title: t(lang, 'btn_count') },
        { id: 'menu_lang', title: t(lang, 'btn_lang') },
      ],
    },
  ]
}

function languageButtons(lang: Lang): BotReply {
  return {
    type: 'buttons',
    text: t(lang, 'lang_prompt'),
    // Each language is shown in its own script on purpose — a reader who can't
    // read the current language must still find their own.
    buttons: [
      { id: 'lang_en', title: 'English' },
      { id: 'lang_hi', title: 'हिन्दी' },
      { id: 'lang_bn', title: 'বাংলা' },
    ],
  }
}

/** FR-16 over WhatsApp: received total + top-behaviour breakdown + given total. */
async function countSummary(giver: Employee, lang: Lang): Promise<BotReply[]> {
  const db = getDb()
  const receivedRows = (await db('recognitions as r')
    .join('behaviours as b', 'b.id', 'r.behaviour_id')
    .where('r.recipient_id', giver.id)
    .whereNot('r.status', 'removed')
    .groupBy('b.name')
    .orderBy('c', 'desc')
    .select('b.name')
    .count({ c: '*' })) as unknown as { name: string; c: number | string }[]
  const received = receivedRows.reduce((sum, r) => sum + Number(r.c), 0)
  const breakdown =
    receivedRows
      .slice(0, 3)
      .map((r) => `${r.name} ×${Number(r.c)}`)
      .join(', ') || '—'
  const givenRow = (await db('recognitions')
    .where('giver_id', giver.id)
    .whereNot('status', 'removed')
    .count({ c: '*' })
    .first()) as { c: number | string } | undefined
  const given = Number(givenRow?.c ?? 0)
  return [text(t(lang, 'count_summary', { received, breakdown, given }))]
}

// ── state persistence (conversation_state, keyed by mobile) ───────────────────

async function loadState(mobile: string): Promise<ConvState | null> {
  const db = getDb()
  const row = (await db('conversation_state').where({ mobile }).first()) as
    | { state: string; updated_at: string }
    | undefined
  if (!row) return null
  let parsed: ConvState
  try {
    parsed = JSON.parse(row.state) as ConvState
  } catch {
    await clearState(mobile)
    return null
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.step !== 'string') {
    await clearState(mobile)
    return null
  }
  const updatedMs = Date.parse(parsed.updatedAt ?? row.updated_at)
  if (!Number.isFinite(updatedMs) || Date.now() - updatedMs > STATE_TTL_MS) {
    await clearState(mobile) // FR-10 — expired: next contact greets fresh
    return null
  }
  parsed.lang = normalizeLang(parsed.lang)
  parsed.data = parsed.data ?? {}
  return parsed
}

async function saveState(mobile: string, state: Omit<ConvState, 'updatedAt'>): Promise<void> {
  const full: ConvState = { ...state, updatedAt: nowIso() }
  await getDb()('conversation_state')
    .insert({ mobile, state: JSON.stringify(full), updated_at: full.updatedAt })
    .onConflict('mobile')
    .merge()
}

/** Re-save the current state to refresh the 30-min resume window. */
async function touchState(mobile: string, lang: Lang, state?: ConvState): Promise<void> {
  if (state) {
    await saveState(mobile, { step: state.step, lang, data: state.data })
    return
  }
  const existing = await loadState(mobile)
  if (existing) await saveState(mobile, { step: existing.step, lang, data: existing.data })
}

async function clearState(mobile: string): Promise<void> {
  await getDb()('conversation_state').where({ mobile }).del()
}

// ── small helpers ─────────────────────────────────────────────────────────────

function text(body: string): BotReply {
  return { type: 'text', text: body }
}

/** Lowercase, trim, collapse whitespace and strip surrounding punctuation so
 *  "Hi!", " MENU " and "cancel." all match their commands. */
function normalizeCommand(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s!.,;:?'"“”‘’()-]+|[\s!.,;:?'"“”‘’()-]+$/g, '')
}

/** Truncate to `max` characters (codepoint-safe), ellipsised — WhatsApp list
 *  row titles allow 24 chars, descriptions 72. */
function clip(value: string, max: number): string {
  const chars = Array.from(value)
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`
}
