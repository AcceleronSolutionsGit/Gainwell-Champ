/**
 * / — live recognition feed (FR-15, FR-17).
 * Filter bar (function / site / behaviour / person / free text / IST date
 * range) driven by GET /api/feed/filters; results poll every 15 s holding the
 * previous render (no skeleton flash). Flagged items appear like any other
 * (BR-5 — they stay public until removed).
 */
import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApi, useDebounced } from '../hooks'
import type { EmployeeSearchHit } from '../types'
import FeedCard from '../components/FeedCard'
import GiveRecognitionModal from '../components/GiveRecognitionModal'
import { Button, EmptyState, ErrorState, Field, Loading, Pager } from '../components/ui'
import { formatNum } from '../format'

const PAGE_SIZE = 20
const POLL_MS = 15_000

interface Filters {
  function: string
  site: string
  behaviourId: string
  q: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { function: '', site: '', behaviourId: '', q: '', from: '', to: '' }

export default function Feed(): React.ReactElement {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [person, setPerson] = useState<EmployeeSearchHit | null>(null)
  const [page, setPage] = useState(1)
  const [giveModalOpen, setGiveModalOpen] = useState(false)
  const debouncedQ = useDebounced(filters.q, 350)

  const options = useApi(() => api.feedFilters(), [])

  const query = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      function: filters.function || undefined,
      site: filters.site || undefined,
      behaviourId: filters.behaviourId || undefined,
      personId: person?.id,
      q: debouncedQ || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    [page, filters.function, filters.site, filters.behaviourId, person, debouncedQ, filters.from, filters.to],
  )

  const feed = useApi(() => api.feed(query), [query], { pollMs: POLL_MS })

  useEffect(() => {
    const handleCreated = () => {
      feed.reload()
    }
    window.addEventListener('champ:recognition-created', handleCreated)
    return () => window.removeEventListener('champ:recognition-created', handleCreated)
  }, [feed])

  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(1)
  }

  const hasFilters = person !== null || Object.values(filters).some((v) => v !== '')

  return (
    <>
      {/* Top Banner Hero & Live Ticker */}
      <div className="feed-hero-banner">
        <div className="hero-content">
          <div className="hero-tag">
            <span className="pulse-dot"></span> LIVE SPOT RECOGNITION STREAM
          </div>
          <h1>Gainwell CHAMP Feed</h1>
          <p>Instant, peer-to-peer recognition across all sites, functions, and shifts.</p>
          <div style={{ marginTop: 16 }}>
            <Button
              variant="primary"
              onClick={() => setGiveModalOpen(true)}
              style={{
                background: '#fff',
                color: 'var(--green-900)',
                fontWeight: 800,
                fontSize: 14,
                padding: '10px 20px',
                borderRadius: 'var(--radius-full)',
                boxShadow: '0 4px 14px rgba(0,0,0,.2)',
              }}
            >
              🏆 Give Recognition
            </Button>
          </div>
        </div>
        <div className="hero-stats-grid">
          <div className="hero-stat-card">
            <span className="stat-icon">🏆</span>
            <div className="stat-data">
              <span className="stat-value">{feed.data ? formatNum(feed.data.total) : '…'}</span>
              <span className="stat-label">Total Spot Recognitions</span>
            </div>
          </div>
          <div className="hero-stat-card">
            <span className="stat-icon">💬</span>
            <div className="stat-data">
              <span className="stat-value">WhatsApp</span>
              <span className="stat-label">Primary Capture Channel</span>
            </div>
          </div>
          <div className="hero-stat-card">
            <span className="stat-icon">⚡</span>
            <div className="stat-data">
              <span className="stat-value">15s</span>
              <span className="stat-label">Auto Stream Refresh</span>
            </div>
          </div>
        </div>
      </div>

      {/* Behaviour Quick Pill Filters */}
      {options.data?.behaviours && (
        <div className="behaviour-pills-bar">
          <span className="pills-label">Filter by Behaviour:</span>
          <button
            type="button"
            className={`pill-btn ${filters.behaviourId === '' ? 'active' : ''}`}
            onClick={() => set({ behaviourId: '' })}
          >
            All Behaviours
          </button>
          {options.data.behaviours.map((b) => (
            <button
              type="button"
              key={b.id}
              className={`pill-btn ${filters.behaviourId === String(b.id) ? 'active' : ''}`}
              style={{
                borderColor: b.colour,
                color: filters.behaviourId === String(b.id) ? '#fff' : b.colour,
                backgroundColor: filters.behaviourId === String(b.id) ? b.colour : 'transparent',
              }}
              onClick={() => set({ behaviourId: filters.behaviourId === String(b.id) ? '' : String(b.id) })}
            >
              <span className="pill-dot" style={{ backgroundColor: b.colour }}></span>
              {b.name}
            </button>
          ))}
        </div>
      )}

      {/* Comprehensive Filter Bar */}
      <div className="filter-bar card-pad">
        <Field label="Search" grow>
          <input
            className="input"
            placeholder="Search reasons, givers, recipients…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </Field>
        <Field label="Person" grow>
          <PersonPicker value={person} onChange={(p) => { setPerson(p); setPage(1) }} />
        </Field>
        <Field label="Function">
          <select className="select" value={filters.function} onChange={(e) => set({ function: e.target.value })}>
            <option value="">All Functions</option>
            {options.data?.functions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Site">
          <select className="select" value={filters.site} onChange={(e) => set({ site: e.target.value })}>
            <option value="">All Sites</option>
            {options.data?.sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input className="input" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </Field>
        {hasFilters && (
          <Button
            small
            variant="ghost"
            onClick={() => {
              setFilters(EMPTY_FILTERS)
              setPerson(null)
              setPage(1)
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Feed List Output */}
      {feed.loading ? (
        <Loading label="Fetching live recognition stream…" />
      ) : feed.error ? (
        <ErrorState error={feed.error} retry={feed.reload} />
      ) : feed.data && feed.data.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'No recognitions match your filters' : 'No recognitions yet'}
          hint={
            hasFilters
              ? 'Try clearing filters or selecting a wider date range.'
              : 'Say "Hi" on WhatsApp to CHAMP to post the first spot recognition!'
          }
        />
      ) : (
        feed.data && (
          <div className={feed.refreshing ? 'feed-list refetch-dim' : 'feed-list'}>
            {feed.data.items.map((item) => (
              <FeedCard key={item.id} item={item} />
            ))}
            <Pager page={feed.data.page} pageSize={feed.data.pageSize} total={feed.data.total} onPage={setPage} />
          </div>
        )
      )}
      {giveModalOpen && (
        <GiveRecognitionModal
          onClose={() => setGiveModalOpen(false)}
          onSuccess={() => {
            feed.reload()
          }}
        />
      )}
    </>
  )
}

/**
 * Person filter: type-ahead against GET /api/employees/search; matches giver
 * OR recipient on the server (personId).
 */
export function PersonPicker({
  value,
  onChange,
}: {
  value: EmployeeSearchHit | null
  onChange: (p: EmployeeSearchHit | null) => void
}): React.ReactElement {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const debounced = useDebounced(q, 250)
  const search = useApi(() => api.searchEmployees(debounced), [debounced], {
    enabled: debounced.trim().length >= 2,
  })

  if (value) {
    return (
      <span className="picker-selected">
        👤 {value.name}
        <button type="button" aria-label="Clear person" onClick={() => onChange(null)}>
          ×
        </button>
      </span>
    )
  }

  const hits = debounced.trim().length >= 2 ? (search.data ?? []) : []

  return (
    <div className="picker">
      <input
        className="input"
        placeholder="Type employee name…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && hits.length > 0 && (
        <div className="picker-menu">
          {hits.map((hit) => (
            <button
              type="button"
              key={hit.id}
              className="picker-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(hit)
                setQ('')
                setOpen(false)
              }}
            >
              <div className="picker-item-main">
                <span className="picker-name">{hit.name}</span>
                <span className="picker-code">{hit.employeeCode}</span>
              </div>
              <div className="picker-sub">
                {hit.function} · {hit.site} ({hit.shift} Shift)
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
