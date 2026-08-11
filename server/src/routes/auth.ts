/**
 * /api/auth — email OTP login for the web console (architecture §3.4).
 *
 *   POST /request-otp {email}        → { ok, devCode? }   (devCode: console mail mode only)
 *   POST /verify-otp  {email, code}  → sets champ_session cookie, { ok, user }
 *   GET  /me                         → { user } or 401
 *   POST /logout                     → clears cookie, { ok }
 */
import { Router } from 'express'
import { z } from 'zod'
import { apiError } from '../middleware/errorHandler'
import { asyncHandler } from '../middleware/requireAuth'
import { otpRequestLimiter, otpVerifyLimiter } from '../middleware/rateLimits'
import { logAudit } from '../modules/audit'
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

const requestOtpBody = z.object({ email: emailField })

const verifyOtpBody = z.object({
  email: emailField,
  code: z
    .string({ required_error: 'Code is required' })
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
})

router.post(
  '/request-otp',
  otpRequestLimiter,
  asyncHandler(async (req, res) => {
    const { email } = parse(requestOtpBody, req.body)
    const { devCode } = await requestOtp(email)
    // devCode is only ever present when config.email.provider === 'console'.
    res.json(devCode ? { ok: true, devCode } : { ok: true })
  }),
)

router.post(
  '/verify-otp',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = parse(verifyOtpBody, req.body)
    const user = await verifyOtp(email, code)
    issueSession(res, user)
    await logAudit(user.email, 'login', 'session', undefined, { role: user.role, employeeId: user.employeeId })
    res.json({ ok: true, user })
  }),
)

router.get('/me', (req, res) => {
  const session = readSession(req)
  if (!session) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } })
    return
  }
  touchSession(res, session)
  res.json({ user: session.user })
})

router.post('/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

export default router
