/**
 * Runtime-configurable programme settings (FR-23): the per-recipient cap,
 * the reason quality gate, flag-scan thresholds and the weekly digest —
 * all editable from the admin console without code changes.
 */
import { getDb } from '../db/knex'

export interface AppSettings {
  /** BR-2 — max recognitions per (giver, recipient) pair per IST calendar month. */
  capPerPairPerMonth: number
  /** BR-3 — minimum trimmed reason length. */
  reasonMinLength: number
  /** BR-3 — generic phrases rejected as the entire reason (case/punct-insensitive). */
  reasonBlocklist: string[]
  /** BR-5 — burst: this many by one giver within the window ⇒ flag. */
  flagBurstCount: number
  flagBurstWindowMinutes: number
  /** BR-5 — loop: A→B and B→A both present and total ≥ this within the window ⇒ flag. */
  flagLoopWindowHours: number
  flagLoopMinTotal: number
  /** FR-20 — weekly digest. */
  weeklyDigestEnabled: boolean
  digestAudience: 'all' | 'leadership'
}

export const DEFAULT_SETTINGS: AppSettings = {
  capPerPairPerMonth: 2,
  reasonMinLength: 15,
  reasonBlocklist: [
    'great job',
    'well done',
    'good work',
    'good job',
    'nice',
    'nice work',
    'thanks',
    'thank you',
    'keep it up',
    'awesome',
    'superb',
    'excellent',
    'excellent work',
    'congrats',
    'congratulations',
  ],
  flagBurstCount: 5,
  flagBurstWindowMinutes: 60,
  flagLoopWindowHours: 48,
  flagLoopMinTotal: 3,
  weeklyDigestEnabled: true,
  digestAudience: 'all',
}

let cache: AppSettings | null = null

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache
  const rows: { key: string; value: string }[] = await getDb()('settings').select('key', 'value')
  const stored: Record<string, unknown> = {}
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value)
    } catch {
      // ignore malformed rows; defaults win
    }
  }
  cache = { ...DEFAULT_SETTINGS, ...stored } as AppSettings
  return cache
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = getDb()
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue
    const encoded = JSON.stringify(value)
    const existing = await db('settings').where({ key }).first()
    if (existing) await db('settings').where({ key }).update({ value: encoded })
    else await db('settings').insert({ key, value: encoded })
  }
  cache = null
  return getSettings()
}

export function invalidateSettingsCache(): void {
  cache = null
}
