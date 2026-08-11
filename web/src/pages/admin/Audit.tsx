/**
 * Admin › Audit (FRD §7): every admin mutation, export and login, newest
 * first. Details render as collapsible JSON so the table stays scannable.
 */
import React, { useState } from 'react'
import { api } from '../../api'
import { useApi } from '../../hooks'
import { formatIstDateTime } from '../../format'
import { Card, EmptyState, ErrorState, Loading, Pager } from '../../components/ui'

const PAGE_SIZE = 25

export default function Audit(): React.ReactElement {
  const [page, setPage] = useState(1)
  const audit = useApi(() => api.audit({ page, pageSize: PAGE_SIZE }), [page])

  return (
    <Card title="Audit log" sub="Who did what, when — moderation, settings, directory changes, exports and logins">
      {audit.loading ? (
        <Loading label="Loading audit log…" />
      ) : audit.error ? (
        <ErrorState error={audit.error} retry={audit.reload} />
      ) : audit.data && audit.data.items.length === 0 ? (
        <EmptyState title="No audit entries yet" />
      ) : (
        audit.data && (
          <div className={audit.refreshing ? 'refetch-dim' : ''}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When (IST)</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.items.map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatIstDateTime(entry.createdAt)}</td>
                      <td>{entry.actor}</td>
                      <td>
                        <span className="badge badge-neutral">{entry.action}</span>
                      </td>
                      <td>
                        {entry.entityType ? (
                          <>
                            {entry.entityType}
                            {entry.entityId ? <span className="mono"> #{entry.entityId}</span> : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ maxWidth: 380 }}>
                        <AuditDetails details={entry.details} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={audit.data.page} pageSize={audit.data.pageSize} total={audit.data.total} onPage={setPage} />
          </div>
        )
      )}
    </Card>
  )
}

function AuditDetails({ details }: { details?: unknown }): React.ReactElement {
  if (details === null || details === undefined || details === '') {
    return <span className="feed-meta">—</span>
  }
  // The API returns `details` as parsed JSON (usually an object); older or
  // hand-written rows may surface as plain strings. Normalize to a string
  // before any length/slice logic.
  let pretty: string
  if (typeof details === 'string') {
    pretty = details
    try {
      pretty = JSON.stringify(JSON.parse(details), null, 2)
    } catch {
      // plain-text details — show as-is
    }
  } else {
    pretty = JSON.stringify(details, null, 2) ?? String(details)
  }
  if (pretty.length <= 80) return <span className="mono">{pretty}</span>
  return (
    <details>
      <summary className="feed-meta" style={{ cursor: 'pointer' }}>
        {pretty.slice(0, 60).replace(/\s+/g, ' ')}…
      </summary>
      <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
        {pretty}
      </pre>
    </details>
  )
}
