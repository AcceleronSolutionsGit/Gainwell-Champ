/**
 * /api/auth — Password-based login & session endpoints.
 *
 *   POST /login            {email, password}      → sets champ_session cookie, { ok, user, mustChangePassword }
 *   POST /change-password  {newPassword, oldPassword?} → { ok, user }
 *   GET  /me                                      → { user, mustChangePassword } or 401
 *   POST /logout                                  → clears cookie, { ok }
 *   POST /request-otp & /verify-otp               → fallback / backward compatibility
 */
import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config'
import { apiError } from '../middleware/errorHandler'
import { asyncHandler } from '../middleware/requireAuth'
import { otpRequestLimiter, otpVerifyLimiter } from '../middleware/rateLimits'
import { logAudit } from '../modules/audit'
import {
  changeUserPassword,
  DEFAULT_PASSWORD,
  ensureUserCredentials,
  getUserCredentials,
  verifyPassword,
} from '../modules/auth/credentials'
import { resolveIdentity } from '../modules/auth/identity'
import { requestOtp, verifyOtp } from '../modules/auth/otp'
import { clearSession, issueSession, readSession, touchSession } from '../modules/auth/session'

const router = Router()

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw apiError(400, 'BAD_INPUT', result.error.issues[0]?.message ?? 'Invalid input')
  }
  return result.data
}

const emailField = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')

const loginBody = z.object({
  email: emailField,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
})

const changePasswordBody = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters long'),
  oldPassword: z.string().optional(),
})

const requestOtpBody = z.object({ email: emailField })

const verifyOtpBody = z.object({
  email: emailField,
  code: z
    .string({ required_error: 'Code is required' })
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
})

// ── Password-based Login ───────────────────────────────────────────────────────
router.post(
  '/login',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(loginBody, req.body)

    const domain = email.split('@')[1] ?? ''
    if (!config.auth.allowedEmailDomains.includes(domain)) {
      throw apiError(
        400,
        'DOMAIN_NOT_ALLOWED',
        `Please use an authorized company email address (@${config.auth.allowedEmailDomains.join(', @')})`,
      )
    }

    const identity = await resolveIdentity(email)
    if (!identity) {
      throw apiError(403, 'NOT_ENROLLED', 'This email is not enrolled for CHAMP. Please contact HR / Plant HR.')
    }

    // Ensure credentials exist (default to 123456 with must_change_password: 1)
    const cred = await ensureUserCredentials(email)

    const valid = verifyPassword(password, cred.password_hash, cred.salt)
    if (!valid) {
      throw apiError(
        401,
        'INVALID_CREDENTIALS',
        'Invalid email or password. (Default password for new users is 123456)',
      )
    }

    issueSession(res, identity)
    await logAudit(identity.email, 'login', 'session', undefined, {
      role: identity.role,
      employeeId: identity.employeeId,
      mustChangePassword: Boolean(cred.must_change_password),
    })

    res.json({
      ok: true,
      user: identity,
      mustChangePassword: Boolean(cred.must_change_password),
    })
  }),
)

// ── Change Password ───────────────────────────────────────────────────────────
router.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    const session = readSession(req)
    if (!session) {
      throw apiError(401, 'UNAUTHENTICATED', 'Not signed in')
    }

    const { newPassword, oldPassword } = parse(changePasswordBody, req.body)

    if (newPassword === DEFAULT_PASSWORD) {
      throw apiError(400, 'CANNOT_USE_DEFAULT_PASSWORD', 'You must choose a new password different from the default password.')
    }

    const cred = await getUserCredentials(session.user.email)
    // If user has already changed password before and supplies oldPassword, check it
    if (cred && cred.must_change_password === 0 && oldPassword) {
      const match = verifyPassword(oldPassword, cred.password_hash, cred.salt)
      if (!match) {
        throw apiError(400, 'INCORRECT_OLD_PASSWORD', 'Current password is incorrect.')
      }
    }

    await changeUserPassword(session.user.email, newPassword)
    await logAudit(session.user.email, 'change_password', 'user', undefined, {
      email: session.user.email,
    })

    touchSession(res, session)
    res.json({ ok: true, user: session.user })
  }),
)

// ── Fallback OTP Endpoints (preserved for backwards compatibility) ────────────
router.post(
  '/request-otp',
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const { email } = parse(requestOtpBody, req.body)
    const { devCode } = await requestOtp(email)
    res.json(devCode ? { ok: true, devCode } : { ok: true })
  }),
)

router.post(
  '/verify-otp',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = parse(verifyOtpBody, req.body)
    const user = await verifyOtp(email, code)
    const cred = await ensureUserCredentials(email)
    issueSession(res, user)
    await logAudit(user.email, 'login', 'session', undefined, { role: user.role, employeeId: user.employeeId })
    res.json({ ok: true, user, mustChangePassword: Boolean(cred.must_change_password) })
  }),
)

// ── Current Session & Logout ──────────────────────────────────────────────────
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const session = readSession(req)
    if (!session) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } })
      return
    }
    touchSession(res, session)
    const cred = await getUserCredentials(session.user.email)
    res.json({
      user: session.user,
      mustChangePassword: cred ? Boolean(cred.must_change_password) : false,
    })
  }),
)

router.post('/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

export default router
