import React, { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { useApi, useDebounced } from '../hooks'
import type { BehaviourRef, EmployeeSearchHit, FeedItem } from '../types'
import { Button, Modal } from './ui'

interface GiveRecognitionModalProps {
  onClose: () => void
  onSuccess?: (item: FeedItem) => void
  initialRecipient?: EmployeeSearchHit | null
}

const DEFAULT_BEHAVIOURS: BehaviourRef[] = [
  { id: 1, name: 'Safety First', colour: '#059669' },
  { id: 2, name: 'Quality', colour: '#2563eb' },
  { id: 3, name: 'Ownership', colour: '#7c3aed' },
  { id: 4, name: 'Innovation', colour: '#d97706' },
  { id: 5, name: 'Collaboration', colour: '#0891b2' },
  { id: 6, name: 'Customer Centricity', colour: '#e11d48' },
]

export default function GiveRecognitionModal({
  onClose,
  onSuccess,
  initialRecipient = null,
}: GiveRecognitionModalProps): React.ReactElement {
  const { user } = useAuth()
  const filterOpts = useApi(() => api.feedFilters(), [])
  const behaviours = filterOpts.data?.behaviours?.length ? filterOpts.data.behaviours : DEFAULT_BEHAVIOURS

  // Recipient search & selection
  const [recipient, setRecipient] = useState<EmployeeSearchHit | null>(initialRecipient)
  const [recipientQ, setRecipientQ] = useState('')
  const debouncedRecipientQ = useDebounced(recipientQ, 250).trim()
  const [recipientResults, setRecipientResults] = useState<EmployeeSearchHit[]>([])
  const [loadingRecipients, setLoadingRecipients] = useState(false)

  // Giver selection (if admin/committee or user without employeeId)
  const [giver, setGiver] = useState<EmployeeSearchHit | null>(null)
  const [giverQ, setGiverQ] = useState('')
  const debouncedGiverQ = useDebounced(giverQ, 250).trim()
  const [giverResults, setGiverResults] = useState<EmployeeSearchHit[]>([])
  const [loadingGivers, setLoadingGivers] = useState(false)

  // Form state
  const [behaviourId, setBehaviourId] = useState<number | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Search recipients
  useEffect(() => {
    if (!debouncedRecipientQ) {
      setRecipientResults([])
      return
    }
    let cancelled = false
    setLoadingRecipients(true)
    api
      .searchEmployees(debouncedRecipientQ)
      .then((res) => {
        if (!cancelled) setRecipientResults(res)
      })
      .catch(() => {
        if (!cancelled) setRecipientResults([])
      })
      .finally(() => {
        if (!cancelled) setLoadingRecipients(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedRecipientQ])

  // Search givers
  useEffect(() => {
    if (!debouncedGiverQ) {
      setGiverResults([])
      return
    }
    let cancelled = false
    setLoadingGivers(true)
    api
      .searchEmployees(debouncedGiverQ)
      .then((res) => {
        if (!cancelled) setGiverResults(res)
      })
      .catch(() => {
        if (!cancelled) setGiverResults([])
      })
      .finally(() => {
        if (!cancelled) setLoadingGivers(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedGiverQ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!recipient) {
      setError('Please select a recipient to recognize.')
      return
    }
    if (!behaviourId) {
      setError('Please select a CHAMP behaviour.')
      return
    }
    if (!reasonText.trim() || reasonText.trim().length < 15) {
      setError('Please describe what they did (at least 15 characters required).')
      return
    }
    if (reasonText.trim().length > 50) {
      setError('Reason description cannot exceed 50 characters.')
      return
    }

    setSubmitting(true)
    try {
      const res = await api.createRecognition({
        recipientId: recipient.id,
        behaviourId,
        reasonText: reasonText.trim(),
        giverId: giver?.id ?? (user?.employeeId ? undefined : undefined),
      })

      setSuccess(true)
      if (onSuccess && res.item) {
        onSuccess(res.item)
      }
      setTimeout(() => {
        onClose()
      }, 1200)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit recognition. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const needGiverSelector = !user?.employeeId || user.role === 'admin'
  const isReasonValid = reasonText.trim().length >= 15 && reasonText.trim().length <= 50

  return (
    <Modal title="🏆 Give Spot Recognition" onClose={onClose} wide>
      {success ? (
        <div style={{ textAlign: 'center', padding: '32px 16px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--green-700)', marginBottom: 8 }}>
            Recognition Submitted!
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {recipient?.name} has been recognized on the CHAMP feed and notified on WhatsApp.
          </p>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="give-rec-form">
          {error && (
            <div className="notice notice-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          <div className="give-rec-grid">
            {/* Left Column: People & Behaviour */}
            <div className="give-rec-col">
              {/* Giver Field (if admin or missing employeeId) */}
              {needGiverSelector && (
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Recognising As (Giver):</label>
                  {giver ? (
                    <div className="selected-person-chip">
                      <span className="person-icon">👤</span>
                      <div>
                        <strong>{giver.name}</strong> · {giver.function} ({giver.site})
                      </div>
                      <button type="button" className="chip-remove" onClick={() => setGiver(null)}>
                        ×
                      </button>
                    </div>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="input"
                        placeholder="Search your name or employee code..."
                        value={giverQ}
                        onChange={(e) => setGiverQ(e.target.value)}
                      />
                      {loadingGivers && <div className="picker-loading">Searching…</div>}
                      {giverResults.length > 0 && (
                        <div className="search-dropdown-menu">
                          {giverResults.map((g) => (
                            <div
                              key={g.id}
                              className="dropdown-item"
                              onClick={() => {
                                setGiver(g)
                                setGiverQ('')
                                setGiverResults([])
                              }}
                            >
                              <strong>{g.name}</strong> · {g.function} · {g.site}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Recipient Selection */}
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">Who would you like to recognise? *</label>
                {recipient ? (
                  <div className="selected-person-chip highlight-chip">
                    <span className="person-icon">🌟</span>
                    <div>
                      <strong>{recipient.name}</strong> · {recipient.function} ({recipient.site})
                    </div>
                    <button type="button" className="chip-remove" onClick={() => setRecipient(null)}>
                      ×
                    </button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="Type colleague's name or employee code..."
                      value={recipientQ}
                      onChange={(e) => setRecipientQ(e.target.value)}
                      autoFocus
                    />
                    {loadingRecipients && <div className="picker-loading">Searching colleagues…</div>}
                    {recipientResults.length > 0 && (
                      <div className="search-dropdown-menu">
                        {recipientResults.map((r) => (
                          <div
                            key={r.id}
                            className="dropdown-item"
                            onClick={() => {
                              setRecipient(r)
                              setRecipientQ('')
                              setRecipientResults([])
                            }}
                          >
                            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{r.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                              {r.function} · {r.site} {r.shift ? `· ${r.shift}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Behaviour Selection Grid */}
              <div className="form-group">
                <label className="form-label">CHAMP Behaviour Demonstrated *</label>
                <div className="behaviour-select-grid">
                  {behaviours.map((b) => {
                    const selected = behaviourId === b.id
                    return (
                      <button
                        type="button"
                        key={b.id}
                        className={`behaviour-card-option ${selected ? 'selected' : ''}`}
                        style={{
                          borderColor: selected ? b.colour : 'var(--line)',
                          backgroundColor: selected ? `${b.colour}15` : 'var(--surface)',
                        }}
                        onClick={() => setBehaviourId(b.id)}
                      >
                        <span className="card-dot" style={{ background: b.colour }} />
                        <span className="card-title-text" style={{ color: selected ? b.colour : 'var(--ink)' }}>
                          {b.name}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Reason Description, Guidelines Disclaimer & Submit */}
            <div className="give-rec-col" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="form-group" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label className="form-label">What did they do? (Specific reason) *</label>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: !isReasonValid ? 'var(--warn)' : 'var(--green-700)',
                    }}
                  >
                    {reasonText.length} / 50 chars (min 15, max 50)
                  </span>
                </div>
                <textarea
                  className="input"
                  rows={4}
                  maxLength={50}
                  placeholder="e.g. Ensured strict plant safety protocols & timely delivery..."
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  style={{ resize: 'none', minHeight: '90px' }}
                />
              </div>

              {/* Guidelines & Policy Disclaimer Box */}
              <div className="recognition-disclaimer-box" style={{ marginBottom: 16 }}>
                <div className="disclaimer-header">
                  <span className="disclaimer-icon">💡</span>
                  <strong>CHAMP Recognition Guidelines</strong>
                </div>
                <ul className="disclaimer-list">
                  <li>
                    <strong>Length constraint:</strong> 15 to 50 characters.
                  </li>
                  <li>
                    <strong>Be Specific:</strong> Generic terms like <em>"good job"</em> or <em>"nice work"</em> are blocked.
                  </li>
                  <li>
                    <strong>Policy:</strong> Max 3 recognitions per recipient monthly. Self-recognition is disallowed.
                  </li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 'auto' }}>
                <Button variant="ghost" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" busy={submitting} disabled={!recipient || !behaviourId || !isReasonValid}>
                  ✨ Submit Recognition
                </Button>
              </div>
            </div>
          </div>
        </form>
      )}
    </Modal>
  )
}
