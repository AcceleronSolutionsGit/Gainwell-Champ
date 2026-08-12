/**
 * /login — two-step OTP flow (architecture §3.4).
 * Step 1: work email → POST /api/auth/request-otp.
 * Step 2: 6-digit code → POST /api/auth/verify-otp → session cookie.
 * When the server runs with EMAIL_PROVIDER=console it returns `devCode`,
 * shown here as a local-testing helper (never returned in smtp/ses modes).
 */
import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { Button } from '../components/ui'

export default function Login(): React.ReactElement {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.requestOtp(email.trim().toLowerCase())
      setDevCode(res.devCode ?? null)
      setStep('code')
      setCode('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.verifyOtp(email.trim().toLowerCase(), code.trim())
      setUser(res.user)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="CHAMP" style={{ height: '54px', width: 'auto', objectFit: 'contain', marginBottom: '12px' }} />
          <h1 className="champ-brand-title">
            <span className="champ-text-animated">CHAMP</span>
          </h1>
          <p className="login-subtitle">Spot Recognition Console</p>
        </div>

        {step === 'email' ? (
          <form onSubmit={(e) => void requestCode(e)} className="login-form">
            <div className="field">
              <label htmlFor="login-email">Corporate Work Email</label>
              <input
                id="login-email"
                className="input input-lg"
                type="email"
                required
                autoFocus
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <div className="form-error">{error}</div>}
            <div className="form-actions">
              <Button type="submit" variant="primary" busy={busy} disabled={!email.trim()}>
                Send Verification Code →
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => void verify(e)} className="login-form">
            <p style={{ marginTop: 0, fontSize: 14, color: 'var(--muted)', textAlign: 'center' }}>
              We sent a 6-digit verification code to<br />
              <strong style={{ color: 'var(--ink)' }}>{email}</strong>
            </p>
            <div className="field">
              <label htmlFor="login-code">6-Digit Code</label>
              <input
                id="login-code"
                className="input input-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {devCode && (
              <div className="devcode-banner">
                <span className="devcode-tag">DEV MODE OTP</span>
                <span className="devcode-val">{devCode}</span>
                <Button type="button" variant="link" small onClick={() => setCode(devCode)}>
                  Autofill Code
                </Button>
              </div>
            )}
            {error && <div className="form-error">{error}</div>}
            <div className="form-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <Button
                type="button"
                variant="ghost"
                style={{ flex: '1' }}
                onClick={() => {
                  setStep('email')
                  setError(null)
                  setDevCode(null)
                }}
              >
                ← Back
              </Button>
              <Button type="submit" variant="primary" style={{ flex: '1.5' }} busy={busy} disabled={code.length !== 6}>
                Verify
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
