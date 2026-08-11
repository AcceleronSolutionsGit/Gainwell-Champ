import { NextFunction, Request, Response } from 'express'

/** Uniform error envelope: { error: { code, message } }. Throw objects with
 *  { status, code, message } (or use http-errors style) anywhere in a route. */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  const status = typeof err?.status === 'number' ? err.status : 500
  const code = typeof err?.code === 'string' ? err.code : 'INTERNAL'
  const message = status < 500 ? String(err?.message ?? 'Request failed') : 'Internal server error'
  if (status >= 500) console.error('[error]', err)
  res.status(status).json({ error: { code, message } })
}

/** Convenience for throwing API errors: `throw apiError(400, 'BAD_INPUT', '…')` */
export function apiError(status: number, code: string, message: string): Error & { status: number; code: string } {
  const e = new Error(message) as Error & { status: number; code: string }
  e.status = status
  e.code = code
  return e
}
