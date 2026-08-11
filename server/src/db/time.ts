/**
 * Time helpers. Convention across the whole codebase:
 *   - timestamps are STORED as ISO-8601 UTC strings (e.g. 2026-07-22T09:15:00.000Z)
 *     so SQLite and PostgreSQL behave identically and lexicographic comparison
 *     equals chronological comparison;
 *   - all CALENDAR logic (monthly cap reset on the 1st, weekly digest, display)
 *     is computed in IST (Asia/Kolkata).
 */
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

export const IST = 'Asia/Kolkata'

export function nowIso(): string {
  return new Date().toISOString()
}

/** Start of the current (or given instant's) calendar month in IST, as UTC ISO. */
export function istMonthStartIso(ref?: string | Date): string {
  return dayjs(ref).tz(IST).startOf('month').utc().toISOString()
}

/** Start of the IST day for a YYYY-MM-DD (or ISO) input, as UTC ISO. */
export function istDayStartIso(ref?: string | Date): string {
  return dayjs.tz(ref, IST).startOf('day').utc().toISOString()
}

/** End of the IST day for a YYYY-MM-DD (or ISO) input, as UTC ISO. */
export function istDayEndIso(ref?: string | Date): string {
  return dayjs.tz(ref, IST).endOf('day').utc().toISOString()
}

export function daysAgoIso(days: number): string {
  return dayjs().subtract(days, 'day').utc().toISOString()
}

/** Format a stored ISO timestamp for IST display. */
export function formatIst(iso: string, fmt = 'DD MMM YYYY, HH:mm'): string {
  return dayjs(iso).tz(IST).format(fmt)
}

/** ISO week buckets (Mon-start, IST) between two instants — for trend charts. */
export function istWeekStartIso(ref?: string | Date): string {
  const d = dayjs(ref).tz(IST)
  const dow = (d.day() + 6) % 7 // Monday = 0
  return d.subtract(dow, 'day').startOf('day').utc().toISOString()
}
