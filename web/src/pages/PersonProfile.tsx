/**
 * /people/:id — recognition profile (FR-16): received/given totals, behaviour
 * breakdown in behaviour colours (names on the axis carry identity), and the
 * ten most recent recognitions involving this person.
 */
import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useApi } from '../hooks'
import FeedCard from '../components/FeedCard'
import GiveRecognitionModal from '../components/GiveRecognitionModal'
import { BehaviourBars, ChartCard, StatTile } from '../components/charts'
import { Button, Card, EmptyState, ErrorState, Loading } from '../components/ui'

export default function PersonProfile(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const profile = useApi(() => api.profile(id ?? ''), [id], { enabled: !!id })
  const [giveModalOpen, setGiveModalOpen] = useState(false)

  if (profile.loading) return <Loading label="Loading profile…" />
  if (profile.error) return <ErrorState error={profile.error} retry={profile.reload} />
  if (!profile.data) return <EmptyState title="Profile not found" />

  const { employee, received, given, recent } = profile.data
  const behaviourRows = received.byBehaviour
    .filter((b) => b.count > 0)
    .map((b) => ({ name: b.name, colour: b.colour, count: b.count }))

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ marginBottom: 4 }}>
            <Link to="/people">← People</Link>
          </div>
          <h1>
            {employee.name}
            {employee.active === false && (
              <span className="badge badge-neutral" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                inactive
              </span>
            )}
          </h1>
          <div className="page-sub">
            {employee.function}
            {employee.subTeam ? ` · ${employee.subTeam}` : ''} · {employee.site}
            {employee.shift ? ` · Shift ${employee.shift}` : ''}
            {employee.employeeCode ? ` · ${employee.employeeCode}` : ''}
          </div>
        </div>
        <div>
          {employee.active !== false && (
            <Button
              variant="primary"
              onClick={() => setGiveModalOpen(true)}
              style={{
                background: 'linear-gradient(135deg, var(--green-600), var(--green-800))',
                fontWeight: 700,
              }}
            >
              🏆 Recognise {employee.name.split(' ')[0]}
            </Button>
          )}
        </div>
      </div>

      <div className="tile-row">
        <StatTile label="Recognitions received" value={received.total} />
        <StatTile label="Recognitions given" value={given.total} />
      </div>

      <div className="chart-grid">
        <ChartCard
          title="Received by behaviour"
          sub="Which CHAMP behaviours colleagues noticed"
          table={{
            headers: ['Behaviour', 'Count'],
            rows: behaviourRows.map((b) => [b.name, b.count]),
          }}
        >
          {behaviourRows.length === 0 ? (
            <EmptyState title="No recognitions received yet" hint="They'll show up here the moment someone notices great work." />
          ) : (
            <BehaviourBars data={behaviourRows} />
          )}
        </ChartCard>

        <Card title="Recent activity" sub="Latest recognitions involving this person">
          {recent.length === 0 ? (
            <EmptyState title="Nothing yet" />
          ) : (
            <div className="feed-list">
              {recent.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {giveModalOpen && (
        <GiveRecognitionModal
          initialRecipient={{
            id: employee.id,
            name: employee.name,
            function: employee.function,
            site: employee.site,
            employeeCode: employee.employeeCode,
            shift: employee.shift,
          }}
          onClose={() => setGiveModalOpen(false)}
          onSuccess={() => {
            profile.reload()
          }}
        />
      )}
    </>
  )
}
