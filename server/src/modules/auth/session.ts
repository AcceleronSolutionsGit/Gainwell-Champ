/**
 * Session management: a signed JWT (HS256) in the httpOnly `champ_session`
 * cookie. Two independent expiries (architecture §3.4):
 *   - ABSOLUTE — `iat` older than config.session.absoluteHours ⇒ dead, even
 *     if the user was active the whole time (bounds token lifetime);
 *   - IDLE     — `la` (last-activity, epoch seconds) older than
 *     config.session.idleMinutes ⇒ dead. Every authenticated request
 *     re-issues the cookie with a fresh `la` (sliding window) while
 *     PRESERVING the original `iat`, so touching never extends the absolute
 *     limit.
 */
import { Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../../config'
import { Role, SessionUser } from '../../types'

export const SESSION_COOKIE = 'champ_session'

export interface SessionData {
  user: SessionUser
  /** Original issue instant (epoch seconds) — anchors the absolute expiry. */
  iat: number
  /** Last-activity instant (epoch seconds) — anchors the idle expiry. */
  la: number
}

const ROLES: Role[] = ['employee', 'committee', 'admin']

function epochNow(): number {
  return Math.floor(Date.now() / 1000)
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProd, // HTTPS-only in production (behind the ALB / App Runner)
    path: '/',
    // Browser-side lifetime; the real limits are enforced from the JWT claims.
    maxAge: config.session.absoluteHours * 3600 * 1000,
  }
}

function sign(user: SessionUser, iat: number, la: number): string {
  // jsonwebtoken uses a payload-supplied `iat` verbatim instead of stamping
  // its own — exactly what the preserved absolute expiry needs.
  const payload = {
    email: user.email,
    employeeId: user.employeeId,
    name: user.name,
    role: user.role,
    iat,
    la,
  }
  return jwt.sign(payload, config.session.secret, { algorithm: 'HS256' })
}

/** Start a fresh session (login): iat = la = now. */
export function issueSession(res: Response, user: SessionUser): void {
  const now = epochNow()
  res.cookie(SESSION_COOKIE, sign(user, now, now), cookieOptions())
}

/**
 * Parse + validate the session cookie. Returns null (never throws) when the
 * cookie is absent, tampered, malformed, absolute-expired or idle-expired.
 */
export function readSession(req: Request): SessionData | null {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]
  if (!token) return null

  let decoded: jwt.JwtPayload
  try {
    const verified = jwt.verify(token, config.session.secret, { algorithms: ['HS256'] })
    if (typeof verified === 'string') return null
    decoded = verified
  } catch {
    return null
  }

  const { email, employeeId, name, role, iat, la } = decoded as Record<string, unknown>
  if (typeof email !== 'string' || typeof name !== 'string') return null
  if (typeof role !== 'string' || !ROLES.includes(role as Role)) return null
  if (typeof iat !== 'number' || typeof la !== 'number') return null
  if (employeeId !== null && typeof employeeId !== 'number') return null

  const now = epochNow()
  if (now - iat > config.session.absoluteHours * 3600) return null // absolute expiry
  if (now - la > config.session.idleMinutes * 60) return null // idle expiry

  return {
    user: { email, employeeId: employeeId as number | null, name, role: role as Role },
    iat,
    la,
  }
}

/** Slide the idle window: re-issue with fresh `la`, original `iat` kept. */
export function touchSession(res: Response, session: SessionData): void {
  res.cookie(SESSION_COOKIE, sign(session.user, session.iat, epochNow()), cookieOptions())
}

export function clearSession(res: Response): void {
  const { maxAge: _drop, ...opts } = cookieOptions()
  res.clearCookie(SESSION_COOKIE, opts)
}
