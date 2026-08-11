/**
 * Email OTP login (architecture §3.4).
 *
 * Flow: requestOtp() → 6-digit code stored as sha256(code + SESSION_SECRET),
 * mailed via mailer.ts → verifyOtp() → SessionUser for session.ts to sign.
 *
 * Eligibility: the address must be on the allowed corporate domain AND either
 * belong to an active directory employee or appear in admin_users (console
 * roles seeded from ADMIN_EMAILS / COMMITTEE_EMAILS).
 */
import crypto from 'crypto'
import { config } from '../../config'
import { getDb } from '../../db/knex'
import { nowIso } from '../../db/time'
import { apiError } from '../../middleware/errorHandler'
import { Employee, SessionUser } from '../../types'
import { sendOtpEmail } from './mailer'

interface OtpRow {
  id: number
  email: string
  code_hash: string
  expires_at: string
  attempts: number
  consumed_at: string | null
  created_at: string
}

function hashCode(code: string): string {
  // Salted with the session secret so a leaked DB alone can't be brute-forced
  // offline against the tiny 10^6 code space without also having the secret.
  return crypto.createHash('sha256').update(`${code}:${config.session.secret}`).digest('hex')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** "hr.admin" → "Hr Admin" — display name for console users with no directory row. */
function nameFromLocalPart(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Resolve who this email is, or null when not enrolled.
 * Role: admin_users row wins (admin/committee); otherwise plain 'employee'.
 */
async function resolveIdentity(emailRaw: string): Promise<SessionUser | null> {
  const email = emailRaw.trim().toLowerCase()
  const db = getDb()
  const adminRow = (await db('admin_users').whereRaw('lower(email) = ?', [email]).first()) as
    | { email: string; role: 'admin' | 'committee' }
    | undefined
  const employee = (await db('employees')
    .whereRaw('lower(email) = ?', [email])
    .where({ active: 1 })
    .first()) as Employee | undefined
  if (!adminRow && !employee) return null
  return {
    email,
    employeeId: employee?.id ?? null,
    name: employee?.name ?? nameFromLocalPart(email),
    role: adminRow?.role ?? 'employee',
  }
}

/**
 * Issue a fresh OTP for the email (invalidating any previous unconsumed ones)
 * and send it via the configured mailer.
 *
 * devCode is returned ONLY in console-mail mode so the local login page can
 * display it; smtp/ses modes never leak the code in the API response.
 */
export async function requestOtp(emailRaw: string): Promise<{ devCode?: string }> {
  const email = normalizeEmail(emailRaw)
  const domain = email.split('@')[1] ?? ''
  if (!config.auth.allowedEmailDomains.includes(domain)) {
    throw apiError(400, 'DOMAIN_NOT_ALLOWED', `Please use an authorized company email address (@${config.auth.allowedEmailDomains.join(', @')})`)
  }
  const identity = await resolveIdentity(email)
  if (!identity) {
    throw apiError(403, 'NOT_ENROLLED', 'This email is not enrolled for CHAMP. Please contact HR / Plant HR.')
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  const db = getDb()
  // One live code per email: retire anything still unconsumed.
  await db('otp_codes').where({ email }).whereNull('consumed_at').update({ consumed_at: nowIso() })
  await db('otp_codes').insert({
    email,
    code_hash: hashCode(code),
    expires_at: new Date(Date.now() + config.auth.otpTtlMinutes * 60_000).toISOString(),
    attempts: 0,
    consumed_at: null,
    created_at: nowIso(),
  })
  await sendOtpEmail(email, code)

  return config.email.provider === 'console' ? { devCode: code } : {}
}

/**
 * Verify a submitted code against the most recent unconsumed OTP.
 * Throws apiError with OTP_INVALID / OTP_EXPIRED / OTP_TOO_MANY_ATTEMPTS.
 */
export async function verifyOtp(emailRaw: string, codeRaw: string): Promise<SessionUser> {
  const email = normalizeEmail(emailRaw)
  const code = codeRaw.trim()
  const db = getDb()

  const row = (await db('otp_codes')
    .where({ email })
    .whereNull('consumed_at')
    .orderBy('id', 'desc')
    .first()) as OtpRow | undefined
  if (!row) {
    throw apiError(400, 'OTP_INVALID', 'No active code for this email — request a new one')
  }
  if (row.expires_at < nowIso()) {
    throw apiError(400, 'OTP_EXPIRED', 'That code has expired — request a new one')
  }
  if (row.attempts >= config.auth.otpMaxAttempts) {
    throw apiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong attempts — request a new code')
  }
  if (hashCode(code) !== row.code_hash) {
    await db('otp_codes').where({ id: row.id }).update({ attempts: row.attempts + 1 })
    throw apiError(400, 'OTP_INVALID', 'That code is not right — check the email and try again')
  }

  await db('otp_codes').where({ id: row.id }).update({ consumed_at: nowIso() })

  const identity = await resolveIdentity(email)
  if (!identity) {
    // Enrolment revoked between request and verify (deactivated employee).
    throw apiError(403, 'NOT_ENROLLED', 'This email is not enrolled for CHAMP. Please contact HR / Plant HR.')
  }
  return identity
}
