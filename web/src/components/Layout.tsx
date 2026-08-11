/**
 * Signed-in app shell: sticky top nav + routed page body.
 * Link visibility per SPEC §6 — Feed/People always, Analytics/Admin per role,
 * Board opens in a new tab (kiosk), Simulator link only in dev builds.
 */
import React, { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { hasRole, useAuth } from '../auth'
import { Button } from './ui'
import GiveRecognitionModal from './GiveRecognitionModal'

export default function Layout(): React.ReactElement {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [giveModalOpen, setGiveModalOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  const onLogout = async () => {
    setUserMenuOpen(false)
    await logout()
    navigate('/login')
  }

  // Click outside to close user menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [userMenuOpen])

  return (
    <>
      <header className="topnav">
        <div className="topnav-inner">
          <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <img src="/logo.png" alt="Gainwell" style={{ height: '38px', width: 'auto', objectFit: 'contain' }} />
            <div className="brand-text">
              <span className="brand-title">CHAMP</span>
              <span className="brand-sub">Gainwell Spot Recognition</span>
            </div>
          </div>

          <nav className="nav-links" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              📡 Live Feed
            </NavLink>
            <NavLink to="/people" className={({ isActive }) => (isActive ? 'active' : '')}>
              👥 Directory
            </NavLink>
            {hasRole(user, 'committee') && (
              <NavLink to="/analytics" className={({ isActive }) => (isActive ? 'active' : '')}>
                📊 Analytics
              </NavLink>
            )}
            {hasRole(user, 'committee') && (
              <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
                ⚙️ Console
              </NavLink>
            )}
            <a href="/board" target="_blank" rel="noreferrer" className="kiosk-link">
              📺 Kiosk Board ↗
            </a>
            {import.meta.env.DEV && (
              <NavLink to="/simulator" className={({ isActive }) => (isActive ? 'active' : '')}>
                💬 WhatsApp Simulator
              </NavLink>
            )}
          </nav>

          <div className="nav-right">
            <Button
              small
              variant="primary"
              onClick={() => setGiveModalOpen(true)}
              style={{
                background: 'linear-gradient(135deg, var(--green-600), var(--green-800))',
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(5,150,105,.3)',
              }}
            >
              🏆 Give Recognition
            </Button>

            {user && (
              <div className="nav-user-wrapper" ref={userMenuRef}>
                <div
                  className="nav-user-badge"
                  onClick={() => setUserMenuOpen((open) => !open)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={userMenuOpen}
                  title="Click for options"
                >
                  <div className="user-avatar-small">{user.name.charAt(0).toUpperCase()}</div>
                  <div className="nav-user-details">
                    <div className="nav-user-name">{user.name}</div>
                    <div className={`nav-user-role role-${user.role}`}>{user.role}</div>
                  </div>
                  <span className="nav-user-dropdown-arrow">▾</span>
                </div>

                {userMenuOpen && (
                  <div className="nav-user-menu">
                    <div className="user-menu-header">
                      <div className="user-menu-name">{user.name}</div>
                      <div className="user-menu-email">{user.email}</div>
                      <span className="user-menu-role">{user.role}</span>
                    </div>
                    <button type="button" className="user-menu-signout" onClick={() => void onLogout()}>
                      🚪 Sign Out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>

      {giveModalOpen && (
        <GiveRecognitionModal
          onClose={() => setGiveModalOpen(false)}
          onSuccess={() => {
            // Trigger custom event so feed or active pages refresh instantly
            window.dispatchEvent(new CustomEvent('champ:recognition-created'))
          }}
        />
      )}
    </>
  )
}
