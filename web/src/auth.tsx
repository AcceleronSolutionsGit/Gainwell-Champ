/**
 * Session context. The httpOnly cookie is the actual credential — this context
 * just mirrors GET /api/auth/me so the UI knows who is signed in and which
 * nav/route gates apply. Role ladder: employee < committee < admin
 * (`requireRole('committee')` on the server admits admin too).
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, ApiError, setUnauthorizedHandler } from './api'
import type { Role, SessionUser } from './types'

interface AuthContextValue {
  user: SessionUser | null
  /** True until the initial /me probe settles — gates render, not routes. */
  initializing: boolean
  setUser: (user: SessionUser | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function hasRole(user: SessionUser | null, need: Role): boolean {
  if (!user) return false
  if (need === 'employee') return true
  if (need === 'committee') return user.role === 'committee' || user.role === 'admin'
  return user.role === 'admin'
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.user)
      })
      .catch(() => {
        /* not signed in — expected */
      })
      .finally(() => {
        if (!cancelled) setInitializing(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Session idle/absolute expiry mid-use → drop the user so route guards
  // bounce to /login on the next render.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    return () => setUnauthorizedHandler(null)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch (err) {
      // Cookie may already be expired; clearing local state is what matters.
      if (!(err instanceof ApiError)) throw err
    }
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, initializing, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

/** Redirects to /login (remembering where we came from) when signed out. */
export function RequireAuth({ children }: { children: React.ReactElement }): React.ReactElement {
  const { user, initializing } = useAuth()
  const location = useLocation()
  if (initializing) return <div className="page-splash">Loading…</div>
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  return children
}

/** Role gate — signed-in users lacking the role land back on the feed. */
export function RequireRole({
  role,
  children,
}: {
  role: Role
  children: React.ReactElement
}): React.ReactElement {
  const { user, initializing } = useAuth()
  const location = useLocation()
  if (initializing) return <div className="page-splash">Loading…</div>
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  if (!hasRole(user, role)) return <Navigate to="/" replace />
  return children
}
