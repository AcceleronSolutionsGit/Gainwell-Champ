/**
 * /board — login-free plant kiosk (FR-18).
 * Dark full-screen: IST clock header, newest recognitions in large type,
 * auto-refresh every 20 s, a gentle highlight that rotates card to card,
 * WhatsApp call-to-action footer. Honours ?site= and (when the server has
 * BOARD_TOKEN set) passes ?token= straight through to the API.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useApi, useNow } from '../hooks'
import { formatIstClock, timeAgo } from '../format'
import type { FeedItem } from '../types'

const REFRESH_MS = 20_000
const HIGHLIGHT_MS = 7_000
const LIMIT = 12

export default function Board(): React.ReactElement {
  const [params] = useSearchParams()
  const site = params.get('site') ?? undefined
  const token = params.get('token') ?? undefined

  const feed = useApi(
    () => api.boardFeed({ site, token, limit: LIMIT }),
    [site, token],
    { pollMs: REFRESH_MS },
  )
  const now = useNow(1000)

  // Gentle rotation: one card at a time wears a soft glow.
  const items = useMemo(() => feed.data ?? [], [feed.data])
  const [highlight, setHighlight] = useState(0)
  useEffect(() => {
    if (items.length === 0) return
    const t = window.setInterval(() => setHighlight((h) => (h + 1) % items.length), HIGHLIGHT_MS)
    return () => window.clearInterval(t)
  }, [items.length])

  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)

  return (
    <div className="board">
      <header className="board-header">
        <div className="board-brand" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Gainwell Logo" style={{ height: '36px', width: 'auto', objectFit: 'contain' }} />
          <div>
            <div><span className="board-brand-accent">CHAMP</span> Wall of Recognition</div>
            <span className="board-brand-sub">
              Gainwell Engineering{site ? ` · ${site}` : ''}
            </span>
          </div>
        </div>
        <div className="board-clock">
          <div className="board-time">{formatIstClock(now)}</div>
          <div className="board-date">{dateLabel} · IST</div>
        </div>
      </header>

      <main className="board-main">
        {feed.error ? (
          <div className="board-empty">Can't reach the CHAMP feed right now — retrying…</div>
        ) : items.length === 0 && !feed.loading ? (
          <div className="board-empty">
            No recognitions yet — be the first! Message CHAMP on WhatsApp.
          </div>
        ) : (
          items.map((item, i) => <BoardCard key={item.id} item={item} highlight={i === highlight} />)
        )}
      </main>

      <footer className="board-footer">
        <div className="board-cta">
          Give recognition on WhatsApp — message <span className="wa">CHAMP</span>
        </div>
        <div>Spot great work. Say it in one line. It lands here.</div>
      </footer>
    </div>
  )
}

function BoardCard({ item, highlight }: { item: FeedItem; highlight: boolean }): React.ReactElement {
  return (
    <article
      className={highlight ? 'board-card highlight' : 'board-card'}
      style={{ borderLeftColor: item.behaviour.colour }}
    >
      <div className="board-who">
        {item.giver.name}
        <span className="board-arrow" aria-label="recognised">
          →
        </span>
        {item.recipient.name}
      </div>
      <p className="board-reason">“{item.reason}”</p>
      <div className="board-meta">
        <span className="board-chip">
          <span className="chip-dot" style={{ background: item.behaviour.colour }} aria-hidden />
          {item.behaviour.name}
        </span>
        <span>{timeAgo(item.createdAt)}</span>
        <span>{item.recipient.site}</span>
      </div>
    </article>
  )
}
