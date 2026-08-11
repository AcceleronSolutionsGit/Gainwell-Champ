/**
 * Admin › Moderation (FR-14, FR-22, BR-5/BR-6).
 * Flag queue: open loop/burst flags with pattern details; dismiss keeps the
 * recognition, or remove it with a reason (soft delete). Below it, the
 * all-recognitions table across every status with a remove-with-reason modal.
 */
import React, { useMemo, useState } from 'react'
import { api, ApiError } from '../../api'
import { useApi } from '../../hooks'
import type { AdminRecognition, FlagItem } from '../../types'
import { formatIstDateTime, timeAgo } from '../../format'
import {
  BehaviourChip,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  Pager,
  StatusBadge,
} from '../../components/ui'

const PAGE_SIZE = 15

export default function Moderation(): React.ReactElement {
  const [flagStatus, setFlagStatus] = useState<'open' | 'resolved' | 'all'>('open')
  const flags = useApi(() => api.flags(flagStatus), [flagStatus])

  const [recStatus, setRecStatus] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const recQuery = useMemo(
    () => ({ status: recStatus || undefined, q: q || undefined, page, pageSize: PAGE_SIZE }),
    [recStatus, q, page],
  )
  const recs = useApi(() => api.adminRecognitions(recQuery), [recQuery])

  const [removing, setRemoving] = useState<{ id: number; label: string } | null>(null)

  const afterMutation = () => {
    flags.reload()
    recs.reload()
  }

  return (
    <>
      <Card
        title="Flag queue"
        sub="Burst and reciprocal-loop patterns caught by the rules engine — flagged, never auto-removed"
        actions={
          <select
            className="select"
            style={{ width: 'auto' }}
            value={flagStatus}
            onChange={(e) => setFlagStatus(e.target.value as typeof flagStatus)}
            aria-label="Flag status filter"
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        }
      >
        {flags.loading ? (
          <Loading label="Loading flags…" />
        ) : flags.error ? (
          <ErrorState error={flags.error} retry={flags.reload} />
        ) : flags.data && flags.data.length === 0 ? (
          <EmptyState
            icon="✅"
            title={flagStatus === 'open' ? 'No open flags' : 'No flags here'}
            hint="The nightly sweep and per-recognition checks will queue anything suspicious."
          />
        ) : (
          flags.data?.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              onDismiss={async () => {
                await api.resolveFlag(flag.id)
                afterMutation()
              }}
              onRemove={() =>
                setRemoving({
                  id: flag.recognition.id,
                  label: `${flag.recognition.giver.name} → ${flag.recognition.recipient.name}`,
                })
              }
            />
          ))
        )}
      </Card>

      <div style={{ height: 16 }} />

      <Card title="All recognitions" sub="Every status, including removed — filter and moderate">
        <div className="filter-bar" style={{ boxShadow: 'none', marginBottom: 12 }}>
          <Field label="Search" grow>
            <input
              className="input"
              placeholder="Reason or name…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label="Status">
            <select
              className="select"
              value={recStatus}
              onChange={(e) => {
                setRecStatus(e.target.value)
                setPage(1)
              }}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="flagged">Flagged</option>
              <option value="removed">Removed</option>
            </select>
          </Field>
        </div>

        {recs.loading ? (
          <Loading label="Loading recognitions…" />
        ) : recs.error ? (
          <ErrorState error={recs.error} retry={recs.reload} />
        ) : recs.data && recs.data.items.length === 0 ? (
          <EmptyState title="Nothing matches" />
        ) : (
          recs.data && (
            <div className={recs.refreshing ? 'refetch-dim' : ''}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When (IST)</th>
                      <th>Giver → Recipient</th>
                      <th>Behaviour</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recs.data.items.map((r) => (
                      <RecognitionRow key={r.id} rec={r} onRemove={() => setRemoving({ id: r.id, label: `${r.giver.name} → ${r.recipient.name}` })} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={recs.data.page} pageSize={recs.data.pageSize} total={recs.data.total} onPage={setPage} />
            </div>
          )
        )}
      </Card>

      {removing && (
        <RemoveModal
          target={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null)
            afterMutation()
          }}
        />
      )}
    </>
  )
}

function FlagCard({
  flag,
  onDismiss,
  onRemove,
}: {
  flag: FlagItem
  onDismiss: () => Promise<void>
  onRemove: () => void
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = flag.recognition

  return (
    <div className="flag-card">
      <div className="flag-head">
        <span className={`badge ${flag.type === 'burst' ? 'badge-flagged' : 'badge-removed'}`}>
          {flag.type === 'burst' ? '⚡ burst' : '🔁 loop'}
        </span>
        <span className="feed-meta">flagged {timeAgo(flag.createdAt)}</span>
        {flag.status === 'resolved' && (
          <span className="feed-meta">
            · resolved as “{flag.resolution ?? 'dismissed'}”{flag.resolvedBy ? ` by ${flag.resolvedBy}` : ''}
          </span>
        )}
      </div>
      <div className="flag-details">{describeFlag(flag)}</div>
      {rec && (
        <div className="flag-rec">
          <strong>
            {rec.giver.name} → {rec.recipient.name}
          </strong>{' '}
          <BehaviourChip name={rec.behaviour.name} colour={rec.behaviour.colour} />{' '}
          <StatusBadge status={rec.status} />
          <div style={{ marginTop: 4 }}>“{rec.reason}”</div>
          <div className="feed-meta" style={{ marginTop: 4 }}>
            {formatIstDateTime(rec.createdAt)} IST · {rec.recipient.site}
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      {flag.status === 'open' && (
        <div className="flag-actions">
          <Button
            small
            busy={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onDismiss()
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Failed to dismiss')
              } finally {
                setBusy(false)
              }
            }}
          >
            Dismiss — looks genuine
          </Button>
          <Button small variant="danger" onClick={onRemove}>
            Remove recognition…
          </Button>
        </div>
      )}
    </div>
  )
}

/** Human sentence from the flag's stored pattern details (JSON blob). */
function describeFlag(flag: FlagItem): string {
  const d = flag.details ?? {}
  const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : undefined)
  if (flag.type === 'burst') {
    const count = num('count') ?? num('countInWindow')
    const window = num('windowMinutes')
    if (count && window) return `${count} recognitions sent by one giver within ${window} minutes.`
  }
  if (flag.type === 'loop') {
    const count = num('countInWindow')
    const hours = num('windowHours')
    const pair = Array.isArray(d.pair) ? (d.pair as unknown[]).join(' ↔ ') : null
    if (count && hours) return `${pair ? `${pair}: ` : ''}${count} reciprocal recognitions within ${hours} hours.`
  }
  const text = Object.entries(d)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ')
  return text || 'Pattern details unavailable.'
}

function RecognitionRow({
  rec,
  onRemove,
}: {
  rec: AdminRecognition
  onRemove: () => void
}): React.ReactElement {
  return (
    <tr className={rec.status === 'removed' ? 'row-dim' : ''}>
      <td style={{ whiteSpace: 'nowrap' }}>{formatIstDateTime(rec.createdAt)}</td>
      <td>
        <strong>{rec.giver.name}</strong> → <strong>{rec.recipient.name}</strong>
      </td>
      <td>
        <BehaviourChip name={rec.behaviour.name} colour={rec.behaviour.colour} />
      </td>
      <td style={{ maxWidth: 340 }}>
        “{rec.reason}”
        {rec.status === 'removed' && rec.removalReason && (
          <div className="feed-meta">
            Removed{rec.removedBy ? ` by ${rec.removedBy}` : ''}: {rec.removalReason}
          </div>
        )}
      </td>
      <td>
        <StatusBadge status={rec.status} />
      </td>
      <td>
        {rec.status !== 'removed' && (
          <Button small variant="danger" onClick={onRemove}>
            Remove…
          </Button>
        )}
      </td>
    </tr>
  )
}

/** Soft-delete confirmation (BR-6) — a reason is mandatory and audited. */
function RemoveModal({
  target,
  onClose,
  onDone,
}: {
  target: { id: number; label: string }
  onClose: () => void
  onDone: () => void
}): React.ReactElement {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.removeRecognition(target.id, reason.trim())
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed')
      setBusy(false)
    }
  }

  return (
    <Modal title="Remove recognition" onClose={onClose}>
      <p style={{ marginTop: 0, fontSize: 13.5 }}>
        Removing <strong>{target.label}</strong> hides it from the feed and board. This is a soft delete — the
        record stays for the audit trail.
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <Field label="Reason for removal (required, audited)">
          <textarea
            className="textarea"
            required
            minLength={5}
            autoFocus
            placeholder="e.g. Duplicate entry — same event recorded twice"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" busy={busy} disabled={reason.trim().length < 5}>
            Remove recognition
          </Button>
        </div>
      </form>
    </Modal>
  )
}
