import React, { useState } from 'react'
import { api, ApiError } from '../api'
import { Button } from './ui'

export default function ChangePasswordModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess?: () => void
}): React.ReactElement {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long')
      return
    }

    if (newPassword === '123456') {
      setError('New password cannot be the default password (123456)')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }

    setBusy(true)
    try {
      await api.changePassword(newPassword, oldPassword || undefined)
      setSuccess(true)
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 20 }}>Change Password</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {success ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
            <h3 style={{ margin: 0, color: 'var(--green-700)' }}>Password Updated!</h3>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>Your password has been changed successfully.</p>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} style={{ padding: '20px 24px' }}>
            <div className="field" style={{ marginBottom: 16 }}>
              <label htmlFor="modal-old-password">Current Password</label>
              <input
                id="modal-old-password"
                className="input"
                type="password"
                placeholder="Enter current password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: 16 }}>
              <label htmlFor="modal-new-password">New Password</label>
              <input
                id="modal-new-password"
                className="input"
                type="password"
                required
                minLength={6}
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: 16 }}>
              <label htmlFor="modal-confirm-password">Confirm New Password</label>
              <input
                id="modal-confirm-password"
                className="input"
                type="password"
                required
                minLength={6}
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                Update Password
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
