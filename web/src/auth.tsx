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
  mustChangePassword: boolean
  /** True until the initial /me probe settles — gates render, not routes. */
  initializing: boolean
  setUser: (user: SessionUser | null, mustChangePassword?: boolean) => void
  setMustChangePassword: (must: boolean) => void
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
  const [user, setUserState] = useState<SessionUser | null>(null)
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [initializing, setInitializing] = useState(true)

  const setUser = useCallback((newUser: SessionUser | null, mustChange?: boolean) => {
    setUserState(newUser)
    if (mustChange !== undefined) {
      setMustChangePassword(mustChange)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((res) => {
        if (!cancelled) {
          setUserState(res.user)
          setMustChangePassword(Boolean(res.mustChangePassword))
        }
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
    setUnauthorizedHandler(() => {
      setUserState(null)
      setMustChangePassword(false)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch (err) {
      // Cookie may already be expired; clearing local state is what matters.
      if (!(err instanceof ApiError)) throw err
    }
    setUserState(null)
    setMustChangePassword(false)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        mustChangePassword,
        initializing,
        setUser,
        setMustChangePassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

/** Redirects to /login (remembering where we came from) when signed out or must change password. */
export function RequireAuth({ children }: { children: React.ReactElement }): React.ReactElement {
  const { user, mustChangePassword, initializing } = useAuth()
  const location = useLocation()
  if (initializing) return <div className="page-splash">Loading…</div>
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  if (mustChangePassword) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search, changePassword: true }} replace />
  }
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
  const { user, mustChangePassword, initializing } = useAuth()
  const location = useLocation()
  if (initializing) return <div className="page-splash">Loading…</div>
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  if (mustChangePassword) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search, changePassword: true }} replace />
  }
  if (!hasRole(user, role)) return <Navigate to="/" replace />
  return children
}
