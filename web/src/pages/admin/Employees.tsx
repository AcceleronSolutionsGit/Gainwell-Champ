/**
 * Admin › Employees (FR-1…FR-4, FR-24; admin-only).
 * Directory management: search/filter, enrol (manual entry for workers not in
 * DarwinBox), edit/deactivate (history preserved), DPDP consent flag for
 * contractual personal numbers (FR-3), and the DarwinBox sync trigger which
 * surfaces its demo-mode message when credentials aren't configured.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../api'
import { useApi, useDebounced } from '../../hooks'
import type { EmployeeRow, SyncResult } from '../../types'
import { Button, Card, EmptyState, ErrorState, Field, Loading, Modal, Pager } from '../../components/ui'

const PAGE_SIZE = 15
const E164_RE = /^\+[1-9]\d{7,14}$/

export default function Employees(): React.ReactElement {
  const [q, setQ] = useState('')
  const [site, setSite] = useState('')
  const [fn, setFn] = useState('')
  const [active, setActive] = useState('')
  const [page, setPage] = useState(1)
  const debouncedQ = useDebounced(q, 350)

  const options = useApi(() => api.feedFilters(), [])
  const query = useMemo(
    () => ({
      q: debouncedQ || undefined,
      site: site || undefined,
      function: fn || undefined,
      active: active || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [debouncedQ, site, fn, active, page],
  )
  const employees = useApi(() => api.adminEmployees(query), [query])

  const [enrolling, setEnrolling] = useState(false)
  const [editing, setEditing] = useState<EmployeeRow | null>(null)
  const [sync, setSync] = useState<SyncResult | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const runSync = async () => {
    setSyncBusy(true)
    setSyncError(null)
    try {
      const result = await api.syncDarwinbox()
      setSync(result)
      employees.reload()
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : 'Sync failed')
    } finally {
      setSyncBusy(false)
    }
  }

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    setSelectedIds([])
  }, [query])

  const handleBulkStatus = async (activeStatus: boolean) => {
    if (selectedIds.length === 0) return
    const actionLabel = activeStatus ? 'Active' : 'Inactive'
    if (!window.confirm(`Mark ${selectedIds.length} selected employees as ${actionLabel}?`)) {
      return
    }
    setBulkBusy(true)
    try {
      await api.bulkUpdateEmployeeStatus(selectedIds, activeStatus)
      setSelectedIds([])
      employees.reload()
    } catch (err) {
      alert(err instanceof ApiError ? err.message : `Failed to mark employees as ${actionLabel}`)
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <>
      <Card
        title="Employee directory"
        sub="DarwinBox is the source of truth; manual enrolment covers workers not yet in it"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button small busy={syncBusy} onClick={() => void runSync()}>
              ⟳ Sync from DarwinBox
            </Button>
            <Button small variant="primary" onClick={() => setEnrolling(true)}>
              + Enrol employee
            </Button>
          </div>
        }
      >
        {sync && (
          <div className={`notice ${sync.mode === 'demo' ? 'notice-info' : ''}`} style={{ marginBottom: 12 }}>
            <strong>{sync.mode === 'demo' ? 'Demo mode:' : 'Sync complete:'}</strong> {sync.message}
            {sync.mode === 'live' && ` (${sync.upserts} upserted, ${sync.deactivated} deactivated)`}
          </div>
        )}
        {syncError && (
          <div className="notice notice-error" style={{ marginBottom: 12 }}>
            {syncError}
          </div>
        )}

        <div className="filter-bar" style={{ boxShadow: 'none', marginBottom: 12 }}>
          <Field label="Search" grow>
            <input
              className="input"
              placeholder="Name, code, mobile…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </Field>
          <Field label="Function">
            <select
              className="select"
              value={fn}
              onChange={(e) => {
                setFn(e.target.value)
                setPage(1)
              }}
            >
              <option value="">All</option>
              {options.data?.functions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Site">
            <select
              className="select"
              value={site}
              onChange={(e) => {
                setSite(e.target.value)
                setPage(1)
              }}
            >
              <option value="">All</option>
              {options.data?.sites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className="select"
              value={active}
              onChange={(e) => {
                setActive(e.target.value)
                setPage(1)
              }}
            >
              <option value="">All</option>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </Field>
        </div>

        {selectedIds.length > 0 && (
          <div className="notice notice-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span>
              <strong>{selectedIds.length}</strong> {selectedIds.length === 1 ? 'employee' : 'employees'} selected
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button small busy={bulkBusy} onClick={() => void handleBulkStatus(true)}>
                Mark Active
              </Button>
              <Button small busy={bulkBusy} onClick={() => void handleBulkStatus(false)}>
                Mark Inactive
              </Button>
              <Button small onClick={() => setSelectedIds([])}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {employees.loading ? (
          <Loading label="Loading employees…" />
        ) : employees.error ? (
          <ErrorState error={employees.error} retry={employees.reload} />
        ) : employees.data && employees.data.items.length === 0 ? (
          <EmptyState title="No employees match" />
        ) : (
          employees.data && (
            <div className={employees.refreshing ? 'refetch-dim' : ''}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={
                            !!employees.data &&
                            employees.data.items.length > 0 &&
                            employees.data.items.every((emp) => selectedIds.includes(emp.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked && employees.data) {
                              setSelectedIds(employees.data.items.map((emp) => emp.id))
                            } else {
                              setSelectedIds([])
                            }
                          }}
                        />
                      </th>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Function / team</th>
                      <th>Site · shift</th>
                      <th>Mobile</th>
                      <th>Email</th>
                      <th>Type</th>
                      <th>Consent</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.data.items.map((emp) => (
                      <tr key={emp.id} className={emp.active ? '' : 'row-dim'}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(emp.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds((prev) => [...prev, emp.id])
                              } else {
                                setSelectedIds((prev) => prev.filter((id) => id !== emp.id))
                              }
                            }}
                          />
                        </td>
                        <td className="mono">{emp.employee_code}</td>
                        <td>
                          <strong>{emp.name}</strong>
                          {emp.level_grade ? <div className="feed-meta">{emp.level_grade}</div> : null}
                        </td>
                        <td>
                          {emp.function}
                          {emp.sub_team ? <div className="feed-meta">{emp.sub_team}</div> : null}
                        </td>
                        <td>
                          {emp.site} · {emp.shift}
                        </td>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{emp.mobile ?? '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{emp.email ?? '—'}</td>
                        <td style={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{emp.employment_type ?? '—'}</td>
                        <td>
                          {emp.employment_type === 'contractual' ? (
                            <span className={`badge ${emp.consent_recorded ? 'badge-active' : 'badge-flagged'}`}>
                              {emp.consent_recorded ? 'recorded' : 'missing'}
                            </span>
                          ) : (
                            <span className="feed-meta">n/a</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${emp.active ? 'badge-active' : 'badge-neutral'}`}>
                            {emp.active ? 'active' : 'inactive'}
                          </span>
                        </td>
                        <td>
                          <Button small onClick={() => setEditing(emp)}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={employees.data.page} pageSize={employees.data.pageSize} total={employees.data.total} onPage={setPage} />
            </div>
          )
        )}
      </Card>

      {enrolling && (
        <EmployeeModal
          title="Enrol employee"
          functions={options.data?.functions ?? []}
          sites={options.data?.sites ?? []}
          onClose={() => setEnrolling(false)}
          onSaved={() => {
            setEnrolling(false)
            employees.reload()
          }}
        />
      )}
      {editing && (
        <EmployeeModal
          title={`Edit ${editing.name}`}
          existing={editing}
          functions={options.data?.functions ?? []}
          sites={options.data?.sites ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            employees.reload()
          }}
        />
      )}
    </>
  )
}

/** Shared enrol/edit form. Deactivation keeps history (FR-4). */
function EmployeeModal({
  title,
  existing,
  functions,
  sites,
  onClose,
  onSaved,
}: {
  title: string
  existing?: EmployeeRow
  functions: string[]
  sites: string[]
  onClose: () => void
  onSaved: () => void
}): React.ReactElement {
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    mobile: existing?.mobile ?? '',
    function: existing?.function ?? '',
    site: existing?.site ?? '',
    sub_team: existing?.sub_team ?? '',
    shift: existing?.shift ?? 'General',
    email: existing?.email ?? '',
    employment_type: existing?.employment_type ?? 'permanent',
    level_grade: existing?.level_grade ?? 'L2',
    language: existing?.language ?? 'en',
    consent_recorded: !!existing?.consent_recorded,
    active: existing ? !!existing.active : true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const mobileValid = E164_RE.test(form.mobile.trim())
  const canSubmit = form.name.trim() && mobileValid && form.function.trim() && form.site.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      mobile: form.mobile.trim(),
      function: form.function.trim(),
      site: form.site.trim(),
      sub_team: form.sub_team.trim() || null,
      shift: form.shift,
      email: form.email.trim() || null,
      employment_type: form.employment_type,
      level_grade: form.level_grade,
      language: form.language,
      consent_recorded: form.consent_recorded,
    }
    try {
      if (existing) {
        await api.updateEmployee(existing.id, { ...payload, active: form.active })
      } else {
        await api.createEmployee(payload)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed')
      setBusy(false)
    }
  }

  return (
    <Modal title={title} wide onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div>
          {/* Section 1: Basic Profile */}
          <div className="form-section-title">Personal Details</div>
          <div className="form-grid">
            <Field label="Full Name *">
              <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Rahul Sharma" />
            </Field>
            <Field label="WhatsApp Mobile (E.164) *">
              <input
                className="input"
                required
                placeholder="+919810000042"
                value={form.mobile}
                onChange={(e) => set('mobile', e.target.value)}
              />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Corporate Work Email">
                <input className="input" type="email" placeholder="rahul@gainwellengineering.com" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Section 2: Organization & Work Location */}
          <div className="form-section-title">Work & Site Location</div>
          <div className="form-grid">
            <Field label="Function / Department *">
              <input
                className="input"
                required
                list="fn-options"
                value={form.function}
                onChange={(e) => set('function', e.target.value)}
                placeholder="e.g. Manufacturing"
              />
              <datalist id="fn-options">
                {functions.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
            <Field label="Site / Plant *">
              <input
                className="input"
                required
                list="site-options"
                value={form.site}
                onChange={(e) => set('site', e.target.value)}
                placeholder="e.g. Panagarh Plant"
              />
              <datalist id="site-options">
                {sites.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Sub-team / Section">
              <input className="input" value={form.sub_team ?? ''} onChange={(e) => set('sub_team', e.target.value)} placeholder="e.g. Assembly Line 2" />
            </Field>
            <Field label="Shift">
              <select className="select" value={form.shift} onChange={(e) => set('shift', e.target.value)}>
                {['General', 'A', 'B', 'C'].map((s) => (
                  <option key={s} value={s}>
                    Shift {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Section 3: Grade & Preferences */}
          <div className="form-section-title">Grade & Preferences</div>
          <div className="form-grid">
            <Field label="Employment Type">
              <select
                className="select"
                value={form.employment_type}
                onChange={(e) => set('employment_type', e.target.value as 'permanent' | 'contractual')}
              >
                <option value="permanent">Permanent</option>
                <option value="contractual">Contractual</option>
              </select>
            </Field>
            <Field label="Level / Grade">
              <select className="select" value={form.level_grade} onChange={(e) => set('level_grade', e.target.value)}>
                {['L1', 'L2', 'L3', 'L4', 'L5'].map((l) => (
                  <option key={l} value={l}>
                    Grade {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="WhatsApp Language">
              <select
                className="select"
                value={form.language}
                onChange={(e) => set('language', e.target.value as 'en' | 'hi' | 'bn')}
              >
                <option value="en">English (en)</option>
                <option value="hi">हिन्दी (hi)</option>
                <option value="bn">বাংলা (bn)</option>
              </select>
            </Field>
          </div>

          {/* Section 4: Governance & Status */}
          <div className="form-section-title">Governance & Account Status</div>
          <div style={{ background: 'var(--grid)', padding: '16px 18px', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="checkbox-row" style={{ margin: 0, fontWeight: 600, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                style={{ marginTop: 3 }}
                checked={form.consent_recorded}
                onChange={(e) => set('consent_recorded', e.target.checked)}
              />
              <span>DPDP consent recorded for personal WhatsApp number (required for contractual staff — FR-3)</span>
            </label>
            {existing && (
              <label className="checkbox-row" style={{ margin: 0, fontWeight: 600, alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  style={{ marginTop: 3 }}
                  checked={form.active}
                  onChange={(e) => set('active', e.target.checked)}
                />
                <span>Active employee (unticking deactivates account but preserves recognition history — FR-4)</span>
              </label>
            )}
          </div>
        </div>

        {!mobileValid && form.mobile.trim() !== '' && (
          <div className="form-error" style={{ marginTop: 14 }}>
            Mobile must be in valid E.164 format, e.g. +919810000042.
          </div>
        )}
        {error && <div className="form-error" style={{ marginTop: 14 }}>{error}</div>}
        <div className="form-actions" style={{ marginTop: 24, justifyContent: 'flex-end', gap: 12 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!canSubmit}>
            {existing ? 'Save Changes' : 'Enrol Employee'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
