/**
 * Small shared primitives — one look everywhere: Card, Button, Chip, Badge,
 * Modal, Field, Pager and the loading/empty/error states.
 */
import React, { useEffect } from 'react'
import type { ApiError } from '../api'

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  title,
  sub,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode
  sub?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <section className={`card card-pad${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <div className="card-title">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'link'

export function Button({
  variant = 'ghost',
  small,
  busy,
  children,
  className,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  small?: boolean
  busy?: boolean
}): React.ReactElement {
  const cls = ['btn', `btn-${variant}`, small ? 'btn-sm' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} disabled={disabled || busy} {...rest}>
      {busy && <span className="spinner" aria-hidden />}
      {children}
    </button>
  )
}

// ── Chips & badges ───────────────────────────────────────────────────────────

/** Behaviour chip: coloured dot + name — text stays in ink (never the hue). */
export function BehaviourChip({ name, colour }: { name: string; colour: string }): React.ReactElement {
  return (
    <span className="chip">
      <span className="chip-dot" style={{ background: colour }} aria-hidden />
      {name}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }): React.ReactElement {
  const cls =
    status === 'active'
      ? 'badge-active'
      : status === 'flagged'
        ? 'badge-flagged'
        : status === 'removed'
          ? 'badge-removed'
          : 'badge-neutral'
  return <span className={`badge ${cls}`}>{status}</span>
}

// ── Forms ────────────────────────────────────────────────────────────────────

export function Field({
  label,
  children,
  grow,
}: {
  label: string
  children: React.ReactNode
  grow?: boolean
}): React.ReactElement {
  return (
    <div className={`field${grow ? ' field-grow' : ''}`}>
      <label>{label}</label>
      {children}
    </div>
  )
}

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── States ───────────────────────────────────────────────────────────────────

export function Loading({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="state">
      <span className="spinner" aria-hidden /> {label}
    </div>
  )
}

export function EmptyState({
  icon = '🌱',
  title,
  hint,
}: {
  icon?: string
  title: string
  hint?: string
}): React.ReactElement {
  return (
    <div className="state">
      <span className="state-icon" aria-hidden>
        {icon}
      </span>
      <strong>{title}</strong>
      {hint && <div>{hint}</div>}
    </div>
  )
}

export function ErrorState({ error, retry }: { error: ApiError; retry?: () => void }): React.ReactElement {
  return (
    <div className="state">
      <span className="state-icon" aria-hidden>
        ⚠️
      </span>
      <strong>Something went wrong</strong>
      <div>
        {error.message} <span className="mono">({error.code})</span>
      </div>
      {retry && (
        <div style={{ marginTop: 10 }}>
          <Button variant="ghost" small onClick={retry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Pager ────────────────────────────────────────────────────────────────────

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
}): React.ReactElement | null {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="pager">
      <span>
        Page {page} of {pages} · {total.toLocaleString('en-IN')} total
      </span>
      <Button small disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Prev
      </Button>
      <Button small disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next →
      </Button>
    </div>
  )
}
