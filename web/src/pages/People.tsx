/**
 * /people — directory with given/received counts (FR-16).
 */
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApi, useDebounced } from '../hooks'
import { Card, EmptyState, ErrorState, Field, Loading, Pager } from '../components/ui'

const PAGE_SIZE = 20

export default function People(): React.ReactElement {
  const [q, setQ] = useState('')
  const [fn, setFn] = useState('')
  const [site, setSite] = useState('')
  const [page, setPage] = useState(1)
  const debouncedQ = useDebounced(q, 350)

  const options = useApi(() => api.feedFilters(), [])
  const dir = useApi(
    () =>
      api.directory({
        q: debouncedQ || undefined,
        function: fn || undefined,
        site: site || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [debouncedQ, fn, site, page],
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <div className="page-sub">Everyone in the CHAMP directory, with what they've given and received</div>
        </div>
      </div>

      <div className="filter-bar">
        <Field label="Search" grow>
          <input
            className="input"
            placeholder="Name…"
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
      </div>

      {dir.loading ? (
        <Loading label="Loading the directory…" />
      ) : dir.error ? (
        <ErrorState error={dir.error} retry={dir.reload} />
      ) : dir.data && dir.data.items.length === 0 ? (
        <EmptyState title="No one matches" hint="Try a different name or clear the filters." />
      ) : (
        dir.data && (
          <Card className={dir.refreshing ? 'refetch-dim' : ''}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Function</th>
                    <th>Site</th>
                    <th>Shift</th>
                    <th className="num">Given</th>
                    <th className="num">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {dir.data.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/people/${p.id}`}>
                          <strong>{p.name}</strong>
                        </Link>
                        {p.subTeam ? <div className="feed-meta">{p.subTeam}</div> : null}
                      </td>
                      <td>{p.function}</td>
                      <td>{p.site}</td>
                      <td>{p.shift ?? '—'}</td>
                      <td className="num">{p.givenCount}</td>
                      <td className="num">{p.receivedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={dir.data.page} pageSize={dir.data.pageSize} total={dir.data.total} onPage={setPage} />
          </Card>
        )
      )}
    </>
  )
}
