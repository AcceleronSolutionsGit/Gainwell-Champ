/**
 * Route guards. Each guard authenticates from the champ_session cookie,
 * attaches `req.user` and slides the idle-expiry window (touchSession).
 *
 * Role model (SPEC §5): requireRole('committee') admits committee AND admin
 * (admin is a superset); requireRole('admin') is admin only.
 */
import { NextFunction, Request, RequestHandler, Response } from 'express'
import { readSession, touchSession } from '../modules/auth/session'
import { SessionUser } from '../types'
import { apiError } from './errorHandler'

// Make `req.user` available (typed) on every Express request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

/** Authenticate; 401 UNAUTHENTICATED when there is no valid session. */
function authenticate(req: Request, res: Response): SessionUser {
  const session = readSession(req)
  if (!session) throw apiError(401, 'UNAUTHENTICATED', 'Sign in to continue')
  req.user = session.user
  touchSession(res, session) // sliding idle expiry on every authenticated hit
  return session.user
}

export const requireAuth: RequestHandler = (req, res, next) => {
  try {
    authenticate(req, res)
    next()
  } catch (err) {
    next(err)
  }
}

/** committee ⇒ committee|admin; admin ⇒ admin only. 403 FORBIDDEN otherwise. */
export function requireRole(role: 'committee' | 'admin'): RequestHandler {
  return (req, res, next) => {
    try {
      const user = authenticate(req, res)
      const allowed = role === 'admin' ? user.role === 'admin' : user.role === 'admin' || user.role === 'committee'
      if (!allowed) throw apiError(403, 'FORBIDDEN', 'You do not have access to this')
      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Express 4 does not forward rejected promises to the error handler — wrap
 * every async route handler so thrown apiError()s reach the JSON envelope.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
