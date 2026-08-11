/**
 * Admin › Settings (FR-23, admin-only): the runtime programme knobs —
 * monthly pair cap (BR-2), reason quality gate (BR-3), flag-scan thresholds
 * (BR-5) and the weekly digest (FR-20) with a live preview.
 */
import React, { useEffect, useState } from 'react'
import { api, ApiError } from '../../api'
import { useApi } from '../../hooks'
import type { AppSettings, DigestPreview } from '../../types'
import { Button, Card, ErrorState, Field, Loading, Modal } from '../../components/ui'
import { formatPct } from '../../format'

export default function SettingsTab(): React.ReactElement {
  const settings = useApi(() => api.settings(), [])
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [blocklistText, setBlocklistText] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<DigestPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  // Hydrate the local draft once settings land (and after re-loads).
  useEffect(() => {
    if (settings.data) {
      setDraft(settings.data)
      setBlocklistText(settings.data.reasonBlocklist.join('\n'))
    }
  }, [settings.data])

  // Error must be checked first: on a failed load `data` never arrives, so
  // `!draft` would otherwise short-circuit into an infinite spinner.
  if (settings.error) return <ErrorState error={settings.error} retry={settings.reload} />
  if (settings.loading || !draft) return <Loading label="Loading settings…" />

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setSaved(false)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const blocklist = blocklistText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const updated = await api.updateSettings({ ...draft, reasonBlocklist: blocklist })
      setDraft(updated)
      setBlocklistText(updated.reasonBlocklist.join('\n'))
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const loadPreview = async () => {
    setPreviewBusy(true)
    try {
      setPreview(await api.digestPreview())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Preview failed')
    } finally {
      setPreviewBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      <div className="chart-grid">
        <Card title="Recognition rules" sub="BR-2 cap and the BR-3 reason quality gate">
          <div className="form-grid">
            <Field label="Cap per pair per month (1–10)">
              <input
                className="input"
                type="number"
                min={1}
                max={10}
                required
                value={draft.capPerPairPerMonth}
                onChange={(e) => set('capPerPairPerMonth', Number(e.target.value))}
              />
            </Field>
            <Field label="Minimum reason length (5–100)">
              <input
                className="input"
                type="number"
                min={5}
                max={100}
                required
                value={draft.reasonMinLength}
                onChange={(e) => set('reasonMinLength', Number(e.target.value))}
              />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Generic-phrase blocklist (one per line — rejected as the entire reason)">
              <textarea
                className="textarea"
                rows={8}
                value={blocklistText}
                onChange={(e) => {
                  setBlocklistText(e.target.value)
                  setSaved(false)
                }}
              />
            </Field>
          </div>
        </Card>

        <div>
          <Card title="Flag thresholds" sub="BR-5 patterns — flag for review, never auto-remove">
            <div className="form-grid">
              <Field label="Burst: count">
                <input
                  className="input"
                  type="number"
                  min={2}
                  required
                  value={draft.flagBurstCount}
                  onChange={(e) => set('flagBurstCount', Number(e.target.value))}
                />
              </Field>
              <Field label="Burst: window (minutes)">
                <input
                  className="input"
                  type="number"
                  min={5}
                  required
                  value={draft.flagBurstWindowMinutes}
                  onChange={(e) => set('flagBurstWindowMinutes', Number(e.target.value))}
                />
              </Field>
              <Field label="Loop: window (hours)">
                <input
                  className="input"
                  type="number"
                  min={1}
                  required
                  value={draft.flagLoopWindowHours}
                  onChange={(e) => set('flagLoopWindowHours', Number(e.target.value))}
                />
              </Field>
              <Field label="Loop: min total in window">
                <input
                  className="input"
                  type="number"
                  min={2}
                  required
                  value={draft.flagLoopMinTotal}
                  onChange={(e) => set('flagLoopMinTotal', Number(e.target.value))}
                />
              </Field>
            </div>
          </Card>

          <div style={{ height: 16 }} />

          <div style={{ height: 16 }} />

          <Card title="Weekly digest" sub="FR-20 — a WhatsApp round-up every Monday morning">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.weeklyDigestEnabled}
                onChange={(e) => set('weeklyDigestEnabled', e.target.checked)}
              />
              Send the weekly digest
            </label>
            <div style={{ marginTop: 12, maxWidth: 260 }}>
              <Field label="Audience">
                <select
                  className="select"
                  value={draft.digestAudience}
                  onChange={(e) => set('digestAudience', e.target.value as AppSettings['digestAudience'])}
                >
                  <option value="all">Everyone</option>
                  <option value="leadership">Leadership only</option>
                </select>
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Button small busy={previewBusy} onClick={() => void loadPreview()}>
                Preview this week's digest
              </Button>
            </div>
          </Card>

          <div style={{ height: 16 }} />

          <Card title="Integrations & Directory Sync" sub="Gallabox WhatsApp API & DarwinBox HRIS sync status">
            <div className="form-grid" style={{ marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase' }}>WhatsApp Transport</label>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green-800)', marginTop: 2 }}>
                  💬 Gallabox / Meta / Simulator
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: 'var(--faint)', textTransform: 'uppercase' }}>DarwinBox Sync</label>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green-800)', marginTop: 2 }}>
                  🏢 HRIS Master Dataset
                </div>
              </div>
            </div>
            <Button
              small
              variant="ghost"
              onClick={async () => {
                setBusy(true)
                try {
                  const res = await api.syncDarwinbox()
                  alert(res.message)
                } catch (err) {
                  alert(err instanceof ApiError ? err.message : 'Sync failed')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Sync Directory from DarwinBox Now 🔄
            </Button>
          </Card>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="form-actions" style={{ alignItems: 'center' }}>
        {saved && <span className="feed-meta">Saved ✓ — change recorded in the audit log</span>}
        <Button type="submit" variant="primary" busy={busy}>
          Save settings
        </Button>
      </div>

      {preview && (
        <Modal title="Weekly digest preview" wide onClose={() => setPreview(null)}>
          <div className="tile-row">
            <div className="tile">
              <div className="tile-label">Recognitions</div>
              <div className="tile-value">{preview.stats.total}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Participation</div>
              <div className="tile-value">{formatPct(preview.stats.participationPct)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Top site</div>
              <div className="tile-value" style={{ fontSize: 18 }}>
                {preview.stats.topSite ?? '—'}
              </div>
            </div>
          </div>
          <div className="digest-pre">{preview.text}</div>
        </Modal>
      )}
    </form>
  )
}
