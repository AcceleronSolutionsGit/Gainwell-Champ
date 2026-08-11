/**
 * Display formatting helpers. All absolute times render in IST (Asia/Kolkata)
 * regardless of the viewer's machine timezone — the programme's calendar is IST.
 */

const IST = 'Asia/Kolkata'

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const shortDateFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
})

const clockFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "22 Jul 2026, 14:05" in IST. */
export function formatIstDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d).replace(' at ', ', ')
}

/** "22 Jul 2026" in IST. Accepts ISO instants or YYYY-MM-DD dates. */
export function formatIstDate(iso: string): string {
  // Bare dates get a noon-UTC anchor so the IST calendar day never shifts.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d)
}

/** "22 Jul" in IST — compact axis/meta labels. */
export function formatIstShortDate(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : shortDateFmt.format(d)
}

/** "14:05" IST — the board clock. */
export function formatIstClock(date: Date): string {
  return clockFmt.format(date)
}

/** Relative "time-ago" for feed meta lines; falls back to an IST date when old. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return formatIstDate(iso)
}

/** Today's date in IST as YYYY-MM-DD (for <input type="date"> defaults). */
export function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date())
}

/** IST date N days back as YYYY-MM-DD. */
export function istDaysAgo(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(
    new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  )
}

/** Plain thousands-separated integer — chart labels & stat tiles. */
export function formatNum(n: number): string {
  return n.toLocaleString('en-IN')
}

/** One-decimal percent, dropping the decimal when whole ("34%", "12.5%"). */
export function formatPct(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}
