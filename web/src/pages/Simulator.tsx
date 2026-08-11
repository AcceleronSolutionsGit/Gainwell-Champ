/**
 * /simulator — Realistic WhatsApp phone simulator in a SINGLE unified view.
 * Contact picker is a searchable dropdown in the header — no side panel.
 * Exercises the REAL conversation engine end-to-end.
 *
 * Features:
 * - Single phone view with inline contact selector
 * - Typing indicator while bot is responding
 * - Guided journey tooltips for first-time users
 * - WhatsApp-style interactive message cards
 * - Bubble entrance animations, delivery ticks, E2E badge
 * - Fully mobile responsive
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useApi, useDebounced } from '../hooks'
import type { BotReply, SimContact, SimEntry } from '../types'
import { ErrorState, Loading } from '../components/ui'

// ── Avatar gradient palette ──────────────────────────────────────────────────

const AVATAR_COLORS = [
  ['#128c7e', '#075e54'],
  ['#25d366', '#128c7e'],
  ['#34b7f1', '#0088cc'],
  ['#7c3aed', '#5b21b6'],
  ['#e11d48', '#be123c'],
  ['#ea580c', '#c2410c'],
  ['#0891b2', '#0e7490'],
  ['#4f46e5', '#4338ca'],
]

function avatarGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  const idx = Math.abs(hash) % AVATAR_COLORS.length
  return `linear-gradient(135deg, ${AVATAR_COLORS[idx][0]}, ${AVATAR_COLORS[idx][1]})`
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// ── Guided Journey ───────────────────────────────────────────────────────────

type JourneyStep =
  | 'pick-contact'
  | 'say-hi'
  | 'tap-give'
  | 'pick-person'
  | 'pick-behaviour'
  | 'type-reason'
  | 'done'
  | 'dismissed'

const JOURNEY_MESSAGES: Record<Exclude<JourneyStep, 'done' | 'dismissed'>, { step: string; text: string }> = {
  'pick-contact': { step: 'Step 1 of 6', text: '👆 Tap the contact name in the header to pick who you\'ll chat as.' },
  'say-hi': { step: 'Step 2 of 6', text: '💬 Type "hi" and send it to start the CHAMP conversation.' },
  'tap-give': { step: 'Step 3 of 6', text: '🎯 Tap "Give recognition" to start recognising a colleague.' },
  'pick-person': { step: 'Step 4 of 6', text: '👤 Pick the person you want to recognise from the list.' },
  'pick-behaviour': { step: 'Step 5 of 6', text: '⭐ Choose which CHAMP behaviour they demonstrated.' },
  'type-reason': { step: 'Step 6 of 6', text: '✍️ Describe what they did — be specific! Then hit send.' },
}

function useJourney() {
  const [step, setStep] = useState<JourneyStep>(() => {
    try {
      const saved = sessionStorage.getItem('sim-journey')
      return (saved as JourneyStep) || 'pick-contact'
    } catch {
      return 'pick-contact'
    }
  })

  const advance = useCallback((to: JourneyStep) => {
    setStep(to)
    try { sessionStorage.setItem('sim-journey', to) } catch { /* noop */ }
  }, [])

  const dismiss = useCallback(() => {
    advance('dismissed')
  }, [advance])

  return { step, advance, dismiss }
}

function JourneyTooltip({ step, onDismiss }: { step: JourneyStep; onDismiss: () => void }) {
  if (step === 'done' || step === 'dismissed') return null
  const msg = JOURNEY_MESSAGES[step]
  if (!msg) return null

  return (
    <div className="sim-journey-tooltip arrow-top">
      <div className="sim-journey-step">{msg.step}</div>
      <div className="sim-journey-text">{msg.text}</div>
      <div className="sim-journey-actions">
        <button type="button" className="sim-journey-skip" onClick={onDismiss}>
          Skip tour
        </button>
      </div>
    </div>
  )
}

// ── Contact Picker Dropdown ──────────────────────────────────────────────────

function ContactPicker({
  contacts,
  selected,
  onSelect,
  onClose,
}: {
  contacts: SimContact[]
  selected: SimContact | null
  onSelect: (c: SimContact) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    if (!q) return contacts
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.mobile.includes(q) ||
        c.function.toLowerCase().includes(q) ||
        c.site.toLowerCase().includes(q),
    )
  }, [contacts, q])

  return (
    <div className="sim-picker-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sim-picker">
        <div className="sim-picker-head">
          <button type="button" className="sim-picker-close" onClick={onClose} aria-label="Close">
            ←
          </button>
          <input
            ref={inputRef}
            className="sim-picker-search"
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search contacts"
          />
        </div>
        <div className="sim-picker-list">
          {filtered.length === 0 ? (
            <div className="sim-picker-empty">No matching contacts</div>
          ) : (
            filtered.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`sim-picker-item${selected?.mobile === c.mobile ? ' selected' : ''}${c.active ? '' : ' inactive'}`}
                onClick={() => { onSelect(c); onClose() }}
              >
                <div
                  className="sim-contact-avatar"
                  style={{ background: avatarGradient(c.name) }}
                  aria-hidden
                >
                  {getInitials(c.name)}
                </div>
                <div className="sim-picker-item-info">
                  <div className="sim-picker-item-name">
                    {c.name}
                    <span className="sim-lang">{c.language}</span>
                    {!c.active && (
                      <span className="sim-lang" style={{ background: '#fef2f2', color: '#dc2626' }}>
                        inactive
                      </span>
                    )}
                  </div>
                  <div className="sim-picker-item-meta">
                    {c.function} · {c.site} · {c.mobile}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Simulator Component ─────────────────────────────────────────────────

const HISTORY_POLL_MS = 4_000

export default function Simulator(): React.ReactElement {
  const contacts = useApi(() => api.simContacts(), [])
  const [selected, setSelected] = useState<SimContact | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [history, setHistory] = useState<SimEntry[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const journey = useJourney()

  // Load history when contact changes
  useEffect(() => {
    if (!selected) { setHistory([]); return }
    let cancelled = false
    const load = async () => {
      try {
        const h = await api.simHistory(selected.mobile)
        if (!cancelled) setHistory(h)
      } catch { /* transient */ }
    }
    void load()
    const t = window.setInterval(() => {
      if (!document.hidden) void load()
    }, HISTORY_POLL_MS)
    return () => { cancelled = true; window.clearInterval(t) }
  }, [selected])

  // Auto-scroll
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history.length, sending])

  const handleSelectContact = useCallback(
    (c: SimContact) => {
      setSelected(c)
      setError(null)
      if (journey.step === 'pick-contact') journey.advance('say-hi')
    },
    [journey],
  )

  const send = async (payload: { text?: string; interactiveReplyId?: string; label?: string }) => {
    if (sending || !selected) return
    setSending(true)
    setError(null)
    try {
      const h = await api.simSend(selected.mobile, payload)
      setHistory(h)

      // Advance journey
      if (journey.step !== 'done' && journey.step !== 'dismissed') {
        const id = payload.interactiveReplyId ?? ''
        const text = payload.text?.toLowerCase().trim() ?? ''
        if (journey.step === 'say-hi' && /^(hi|hello|start|menu)$/.test(text)) {
          journey.advance('tap-give')
        } else if (journey.step === 'tap-give' && id === 'menu_give') {
          journey.advance('pick-person')
        } else if (journey.step === 'pick-person' && id.startsWith('pick_')) {
          journey.advance('pick-behaviour')
        } else if (journey.step === 'pick-behaviour' && id.startsWith('beh_')) {
          journey.advance('type-reason')
        } else if (journey.step === 'type-reason' && text) {
          const last = h[h.length - 1]
          if (last?.dir === 'out' && last?.reply?.type === 'text' && last.reply.text.includes('✅')) {
            journey.advance('done')
          }
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const sendText = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await send({ text })
  }

  const reset = async () => {
    if (!selected) return
    try {
      await api.simReset(selected.mobile)
      setHistory(await api.simHistory(selected.mobile))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed')
    }
  }

  if (contacts.loading) {
    return (
      <div className="sim">
        <Loading label="Loading contacts…" />
      </div>
    )
  }

  if (contacts.error) {
    return (
      <div className="sim">
        <div className="page page-narrow">
          <ErrorState error={contacts.error} retry={contacts.reload} />
          {contacts.error.status === 404 && (
            <p className="notice" style={{ marginTop: 12 }}>
              The simulator API is disabled. Start the server with{' '}
              <code>ENABLE_SIMULATOR=true</code> (on by default outside production).
            </p>
          )}
        </div>
      </div>
    )
  }

  const initials = selected ? getInitials(selected.name) : ''

  return (
    <div className="sim">
      {/* Banner */}
      <div className="sim-banner">
        <span className="sim-banner-dot" aria-hidden />
        Dev simulator — same engine as production WhatsApp
        <span style={{ margin: '0 2px' }}>·</span>
        <Link to="/">Back to console</Link>
      </div>

      {/* Single phone view */}
      <div className="sim-phone-wrap">
        <div className="sim-phone">
          {/* Header */}
          <div className="sim-phone-head">
            {selected ? (
              <>
                <div
                  className="sim-avatar"
                  style={{ background: avatarGradient(selected.name) }}
                  aria-hidden
                >
                  {initials}
                </div>
                <button
                  type="button"
                  className="sim-head-info"
                  onClick={() => setPickerOpen(true)}
                  title="Change contact"
                >
                  <div className="sim-head-name">
                    {selected.name}
                    <span className="sim-head-change">▾</span>
                  </div>
                  <div className="sim-head-sub">
                    {selected.mobile} · {selected.language.toUpperCase()} · {selected.site}
                  </div>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="sim-head-info"
                onClick={() => setPickerOpen(true)}
              >
                <div className="sim-head-name">
                  Select a contact to begin
                  <span className="sim-head-change">▾</span>
                </div>
                <div className="sim-head-sub">Tap here to pick who you'll chat as</div>
              </button>
            )}
            <div className="sim-head-actions">
              {selected && (
                <button type="button" className="sim-reset" onClick={() => void reset()}>
                  ↺ Reset
                </button>
              )}
            </div>
          </div>

          {/* Chat area */}
          <div className="sim-chat" ref={chatRef}>
            {/* E2E badge */}
            <div className="sim-e2e-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Messages to CHAMP bot are processed by the conversation engine
            </div>

            {!selected && (
              <div className="sim-empty">
                <div className="sim-empty-inner">
                  <div className="sim-empty-icon">💬</div>
                  <div className="sim-empty-title">CHAMP WhatsApp Simulator</div>
                  <div className="sim-empty-hint">
                    Tap the header above to pick a contact.<br />
                    Then say <strong>hi</strong> to start recognising colleagues.
                  </div>
                </div>
              </div>
            )}

            {selected && history.length === 0 && !sending && (
              <div className="sim-empty">
                <div className="sim-empty-inner">
                  <div className="sim-empty-icon">👋</div>
                  <div className="sim-empty-title">Start the conversation</div>
                  <div className="sim-empty-hint">
                    Say <strong>hi</strong> to begin — CHAMP will reply with the menu.
                  </div>
                </div>
              </div>
            )}

            {history.length > 0 && <div className="sim-date-divider">TODAY</div>}

            {history.map((entry, i) => (
              <Bubble
                key={`${entry.at}-${i}`}
                entry={entry}
                onTap={(id, label) => void send({ interactiveReplyId: id, label })}
                isLast={i === history.length - 1}
              />
            ))}

            {/* Typing indicator */}
            {sending && (
              <div className="sim-typing" style={{ position: 'relative' }}>
                <div className="sim-typing-dot" />
                <div className="sim-typing-dot" />
                <div className="sim-typing-dot" />
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="notice notice-error" style={{ margin: '0 14px 8px' }}>
              {error}
            </div>
          )}

          {/* Composer */}
          <form className="sim-composer" onSubmit={(e) => void sendText(e)}>
            <input
              placeholder={selected ? 'Type a message' : 'Select a contact first…'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={sending || !selected}
              aria-label="Message"
            />
            <button
              type="submit"
              className="sim-send"
              disabled={sending || !draft.trim() || !selected}
              aria-label="Send"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* Contact picker overlay */}
      {pickerOpen && contacts.data && (
        <ContactPicker
          contacts={contacts.data}
          selected={selected}
          onSelect={handleSelectContact}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Journey tooltip */}
      <JourneyTooltip step={journey.step} onDismiss={journey.dismiss} />
    </div>
  )
}

// ── Bubble Component ─────────────────────────────────────────────────────────

function Bubble({
  entry,
  onTap,
  isLast,
}: {
  entry: SimEntry
  onTap: (id: string, label: string) => void
  isLast: boolean
}): React.ReactElement {
  const time = new Date(entry.at).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  if (entry.dir === 'in') {
    return (
      <div className="sim-bubble sim-in">
        <div className="sim-bubble-text">{entry.text ?? ''}</div>
        <div className="sim-meta">
          <span className="sim-time">{time}</span>
          <span className="sim-ticks">✓✓</span>
        </div>
      </div>
    )
  }

  if (entry.kind === 'notification') {
    return (
      <div className="sim-bubble sim-notification">
        <span className="sim-notif-tag">🎉 Notification</span>
        <div className="sim-bubble-text">
          {entry.reply?.type === 'text' ? entry.reply.text : entry.text ?? ''}
        </div>
        <div className="sim-meta">
          <span className="sim-time">{time}</span>
        </div>
      </div>
    )
  }

  const reply = entry.reply
  if (!reply) {
    return (
      <div className="sim-bubble sim-out">
        <div className="sim-bubble-text">{entry.text ?? ''}</div>
        <div className="sim-meta">
          <span className="sim-time">{time}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="sim-bubble sim-out">
        <div className="sim-bubble-text">{reply.text}</div>
        <div className="sim-meta">
          <span className="sim-time">{time}</span>
        </div>
      </div>
      {reply.type === 'buttons' && isLast && (
        <div className="sim-choices">
          {reply.buttons.map((b) => (
            <button type="button" key={b.id} className="sim-choice" onClick={() => onTap(b.id, b.title)}>
              {b.title}
            </button>
          ))}
        </div>
      )}
      {reply.type === 'list' && isLast && <ListChoices reply={reply} onTap={onTap} />}
    </>
  )
}

// ── List Choices ─────────────────────────────────────────────────────────────

function ListChoices({
  reply,
  onTap,
}: {
  reply: Extract<BotReply, { type: 'list' }>
  onTap: (id: string, label: string) => void
}): React.ReactElement {
  return (
    <div className="sim-choices">
      {reply.sections.map((section, si) => (
        <React.Fragment key={si}>
          {section.title && <div className="sim-section-title">{section.title}</div>}
          {section.rows.map((row) => (
            <button
              type="button"
              key={row.id}
              className="sim-list-choice"
              onClick={() => onTap(row.id, row.title)}
            >
              <div className="sim-list-choice-radio" aria-hidden />
              <div className="sim-list-choice-content">
                <div className="sim-list-choice-title">{row.title}</div>
                {row.description && (
                  <div className="sim-list-choice-desc">{row.description}</div>
                )}
              </div>
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}
