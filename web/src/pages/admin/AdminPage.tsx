/**
 * /admin — committee & admin console (FR-22…FR-25).
 * Tab visibility per SPEC §6: Moderation / Export / Audit for committee+,
 * Behaviours / Settings / Employees admin-only. The active tab persists in
 * ?tab= so refreshes and deep links land in the right place.
 */
import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { hasRole, useAuth } from '../../auth'
import Moderation from './Moderation'
import Behaviours from './Behaviours'
import SettingsTab from './SettingsTab'
import Employees from './Employees'
import ExportTab from './ExportTab'
import Audit from './Audit'

interface TabDef {
  id: string
  label: string
  adminOnly: boolean
  render: () => React.ReactElement
}

const TABS: TabDef[] = [
  { id: 'moderation', label: '🛡️ Moderation', adminOnly: false, render: () => <Moderation /> },
  { id: 'behaviours', label: '🏷️ Behaviours', adminOnly: true, render: () => <Behaviours /> },
  { id: 'settings', label: '⚙️ Settings', adminOnly: true, render: () => <SettingsTab /> },
  { id: 'employees', label: '👥 Employees', adminOnly: true, render: () => <Employees /> },
  { id: 'export', label: '📥 Export', adminOnly: false, render: () => <ExportTab /> },
  { id: 'audit', label: '📋 Audit Log', adminOnly: false, render: () => <Audit /> },
]

export default function AdminPage(): React.ReactElement {
  const { user } = useAuth()
  const isAdmin = hasRole(user, 'admin')
  const visible = TABS.filter((t) => !t.adminOnly || isAdmin)

  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') ?? 'moderation'
  const active = visible.find((t) => t.id === requested) ?? visible[0]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin Console</h1>
          <div className="page-sub">
            Moderation, programme rules, employee directory, and audit history
          </div>
        </div>
      </div>

      <div className="admin-tab-nav" role="tablist">
        {visible.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active.id}
            className={`admin-tab-btn ${t.id === active.id ? 'active' : ''}`}
            onClick={() => setParams({ tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="admin-tab-content">
        {active.render()}
      </div>
    </>
  )
}
