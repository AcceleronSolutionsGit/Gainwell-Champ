/**
 * /board/print — weekly printable round-up (FRD §3): last-7-IST-days summary
 * (total, behaviour counts, top recipients) plus the full list, styled for A4
 * via @media print. Login-free like the board; honours ?site= and ?token=.
 */
import React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useApi } from '../hooks'
import { formatIstDate, formatIstDateTime, formatNum } from '../format'
import { BehaviourChip, Button, EmptyState, ErrorState, Loading } from '../components/ui'

export default function BoardPrint(): React.ReactElement {
  const [params] = useSearchParams()
  const site = params.get('site') ?? undefined
  const token = params.get('token') ?? undefined
  const weekly = useApi(() => api.boardWeekly({ site, token }), [site, token])

  return (
    <div className="printable">
      <div className="print-actions no-print">
        <Link to={`/board${site ? `?site=${encodeURIComponent(site)}` : ''}`}>← Back to the board</Link>
        <Button variant="primary" onClick={() => window.print()}>
          🖨 Print
        </Button>
      </div>

      {weekly.loading ? (
        <Loading label="Preparing the weekly round-up…" />
      ) : weekly.error ? (
        <ErrorState error={weekly.error} retry={weekly.reload} />
      ) : weekly.data ? (
        <>
          <div className="print-title">
            <h1>CHAMP — Weekly Recognition Round-up</h1>
            <div className="print-range">
              {formatIstDate(weekly.data.weekStartIst)} – {formatIstDate(weekly.data.weekEndIst)}
              {site ? ` · ${site}` : ' · All sites'}
            </div>
          </div>

          <div className="print-summary">
            <div>
              <div className="tile-label" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
                Total recognitions
              </div>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{formatNum(weekly.data.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>
                By behaviour
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {weekly.data.byBehaviour.map((b) => (
                  <span key={b.name} className="chip">
                    <span className="chip-dot" style={{ background: b.colour }} aria-hidden />
                    {b.name} · {b.count}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {weekly.data.topRecipients.length > 0 && (
            <>
              <h2 style={{ margin: '18px 0 8px' }}>Most recognised this week</h2>
              <table className="table" style={{ marginBottom: 18 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Site</th>
                    <th className="num">Recognitions</th>
                  </tr>
                </thead>
                <tbody>
                  {weekly.data.topRecipients.map((r, i) => (
                    <tr key={`${r.name}-${i}`}>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>{r.site}</td>
                      <td className="num">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h2 style={{ margin: '18px 0 4px' }}>All recognitions</h2>
          {weekly.data.items.length === 0 ? (
            <EmptyState title="A quiet week — no recognitions" />
          ) : (
            weekly.data.items.map((item) => (
              <div className="print-item" key={item.id}>
                <div className="print-item-head">
                  {item.giver.name} → {item.recipient.name}{' '}
                  <BehaviourChip name={item.behaviour.name} colour={item.behaviour.colour} />
                </div>
                <div>“{item.reason}”</div>
                <div className="print-item-meta">
                  {formatIstDateTime(item.createdAt)} IST · {item.recipient.site} · {item.recipient.function}
                </div>
              </div>
            ))
          )}

          <p style={{ marginTop: 24, color: 'var(--muted)', fontSize: 13 }}>
            Give recognition on WhatsApp — message CHAMP. Printed from the Gainwell CHAMP Spot Recognition Tool.
          </p>
        </>
      ) : null}
    </div>
  )
}
