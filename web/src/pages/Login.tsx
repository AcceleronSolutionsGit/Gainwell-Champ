/**
 * /login — Password-based login & mandatory initial password change.
 * Default password: 123456
 * First sign-in prompts immediate password change before proceeding.
 */
import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { Button } from '../components/ui'

export default function Login(): React.ReactElement {
  const { user, mustChangePassword, setUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const locState = location.state as { from?: string; changePassword?: boolean } | null
  const from = locState?.from ?? '/'

  // If already logged in and required to change password, start at change-password step
  const [step, setStep] = useState<'login' | 'change-password'>(
    user && mustChangePassword ? 'change-password' : 'login',
  )
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Change password fields
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.login(email.trim().toLowerCase(), password)
      if (res.mustChangePassword) {
        setUser(res.user, true)
        setStep('change-password')
        setError(null)
      } else {
        setUser(res.user, false)
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in — check your credentials')
    } finally {
      setBusy(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long')
      return
    }

    if (newPassword === '123456') {
      setError('New password cannot be the default password (123456). Please choose a new password.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setBusy(true)
    try {
      const res = await api.changePassword(newPassword)
      setUser(res.user, false)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <img
            src={`${import.meta.env.BASE_URL}logo1.png`}
            alt="CHAMP"
            style={{ height: '72px', width: 'auto', objectFit: 'contain', marginBottom: '14px' }}
          />
          <h1 className="champ-brand-title">
            <span className="champ-text-animated">CHAMP</span>
          </h1>
          <p className="login-subtitle">Gainwell Spot Recognition Console</p>
        </div>

        {step === 'login' ? (
          <form onSubmit={(e) => void handleLogin(e)} className="login-form">
            <div className="field">
              <label htmlFor="login-email">Corporate Work Email</label>
              <input
                id="login-email"
                className="input input-lg"
                type="email"
                required
                autoFocus
                placeholder="name@gainwellengineering.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="login-password">Password</label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--green-700)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                id="login-password"
                className="input input-lg"
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Enter password (default: 123456)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <span style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', display: 'block' }}>
                Default password for all users is <strong>123456</strong>.
              </span>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="form-actions" style={{ marginTop: '16px' }}>
              <Button type="submit" variant="primary" busy={busy} disabled={!email.trim() || !password}>
                Sign In →
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => void handleChangePassword(e)} className="login-form">
            <div
              style={{
                background: 'var(--green-50, #f0fdf4)',
                border: '1px solid var(--green-200, #bbf7d0)',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '16px',
                fontSize: '13.5px',
                color: 'var(--green-900, #14532d)',
              }}
            >
              🔒 <strong>First-Time Sign-In:</strong> Please set a secure personal password to continue.
            </div>

            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="new-password">New Password</label>
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--green-700)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {showNewPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                id="new-password"
                className="input input-lg"
                type={showNewPassword ? 'text' : 'password'}
                required
                autoFocus
                minLength={6}
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-password">Confirm New Password</label>
              <input
                id="confirm-password"
                className="input input-lg"
                type={showNewPassword ? 'text' : 'password'}
                required
                minLength={6}
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="form-actions" style={{ marginTop: '20px' }}>
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={!newPassword || !confirmPassword || newPassword.length < 6}
              >
                Set New Password & Continue →
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
