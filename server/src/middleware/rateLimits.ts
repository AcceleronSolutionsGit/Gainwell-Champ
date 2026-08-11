/**
 * Rate limits (architecture §5 abuse controls). In-memory stores — fine for
 * the single-instance deployment this tool targets; swap in a shared store
 * (rate-limit-redis) if the service is ever scaled horizontally.
 *
 * All limiters answer with the standard error envelope so the web client's
 * fetch wrapper handles 429s like any other API error.
 */
import { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'

function limitedResponse(res: Response, message: string): void {
  res.status(429).json({ error: { code: 'RATE_LIMITED', message } })
}

/**
 * OTP requests: 5 per 15 min per (IP, email) pair — throttles both a single
 * IP spraying many mailboxes and a distributed nuisance on one mailbox
 * without locking a whole office NAT out of login.
 */
export const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const email = String((req.body as { email?: unknown } | undefined)?.email ?? '')
      .trim()
      .toLowerCase()
    return `${req.ip ?? 'unknown'}|${email}`
  },
  handler: (_req, res) => limitedResponse(res, 'Too many code requests — wait a few minutes and try again'),
})

/** OTP verification: 10 per 15 min per IP — caps online guessing across emails. */
export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => limitedResponse(res, 'Too many attempts — wait a few minutes and try again'),
})

/**
 * General API ceiling: 600 requests per 5 min per IP. Applied inside the
 * feature routers (not in index.ts) so the webhook and health check are
 * never throttled. Generous enough for the 15-second feed poll plus a busy
 * admin console; tight enough to blunt scraping/runaway clients.
 */
export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => limitedResponse(res, 'Too many requests — slow down a little'),
})
