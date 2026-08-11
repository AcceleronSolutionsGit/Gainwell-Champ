/**
 * Admin › Export (FR-25): filtered CSV / Excel download of recognitions.
 * The download itself is a plain same-origin navigation (session cookie rides
 * along); every export is audited server-side including the filters used.
 */
import React, { useState } from 'react'
import { api, exportUrl } from '../../api'
import { useApi } from '../../hooks'
import { istDaysAgo, istToday } from '../../format'
import { Button, Card, Field } from '../../components/ui'

export default function ExportTab(): React.ReactElement {
  const options = useApi(() => api.feedFilters(), [])
  const [from, setFrom] = useState(istDaysAgo(90))
  const [to, setTo] = useState(istToday())
  const [fn, setFn] = useState('')
  const [site, setSite] = useState('')
  const [behaviourId, setBehaviourId] = useState('')
  const [status, setStatus] = useState('')

  const download = (format: 'csv' | 'xlsx') => {
    const url = exportUrl({
      from,
      to,
      function: fn || undefined,
      site: site || undefined,
      behaviourId: behaviourId || undefined,
      status: status || undefined,
      format,
    })
    // Anchor click (not window.open) so pop-up blockers stay quiet.
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <Card
      title="Export recognitions"
      sub="Full detail per row: giver, recipient, behaviour, reason, channel, status and moderation trail. Every export is audited."
    >
      <div className="filter-bar" style={{ boxShadow: 'none' }}>
        <Field label="From">
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Function">
          <select className="select" value={fn} onChange={(e) => setFn(e.target.value)}>
            <option value="">All</option>
            {options.data?.functions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Site">
          <select className="select" value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">All</option>
            {options.data?.sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Behaviour">
          <select className="select" value={behaviourId} onChange={(e) => setBehaviourId(e.target.value)}>
            <option value="">All</option>
            {options.data?.behaviours.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="flagged">Flagged</option>
            <option value="removed">Removed</option>
          </select>
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <Button variant="primary" onClick={() => download('csv')}>
          📄 Download CSV Report
        </Button>
        <Button variant="ghost" onClick={() => download('xlsx')}>
          📊 Download Excel Workbook (.xlsx)
        </Button>
      </div>
    </Card>
  )
}
