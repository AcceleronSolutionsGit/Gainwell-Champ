/**
 * Scheduled jobs (architecture §3.1) — all cron expressions come from
 * config.cron (env-overridable) and are evaluated in IST, matching the
 * programme's calendar logic:
 *   darwinboxSync  (default 02:30 IST daily)   → directory sync (FR-1)
 *   flagScan       (default 03:15 IST daily)   → BR-5 nightly sweep
 *   weeklyDigest   (default Mon 09:00 IST)     → FR-20 weekly digest
 */
import { schedule, validate } from 'node-cron'
import { config } from './config'
import { IST } from './db/time'
import { runDirectorySync } from './modules/sync/darwinbox'
import { nightlySweep } from './modules/flags/flagScan'
import { sendWeeklyDigest } from './modules/digest/digest'

let started = false

/** One-line result summary for the run log. */
function summarize(result: unknown): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'object') {
    const message = (result as { message?: unknown }).message
    if (typeof message === 'string') return ` — ${message}`
    return ` — ${JSON.stringify(result)}`
  }
  return ` — ${String(result)}`
}

function scheduleJob(name: string, expression: string, run: () => Promise<unknown>): void {
  if (!validate(expression)) {
    // A bad env override must not crash boot — log loudly and skip the job.
    console.error(`[scheduler] invalid cron expression for ${name}: "${expression}" — job NOT scheduled`)
    return
  }
  schedule(
    expression,
    async () => {
      const startedAt = Date.now()
      try {
        const result = await run()
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
        console.log(`[scheduler] ${name} completed in ${secs}s${summarize(result)}`)
      } catch (err) {
        console.error(`[scheduler] ${name} failed:`, err)
      }
    },
    { timezone: IST },
  )
  console.log(`[scheduler] ${name} scheduled: "${expression}" (${IST})`)
}

/** Start all cron jobs. Safe to call once per process — repeats are ignored. */
export function startScheduler(): void {
  if (started) {
    console.warn('[scheduler] already started — ignoring duplicate start')
    return
  }
  started = true
  scheduleJob('darwinbox-sync', config.cron.darwinboxSync, runDirectorySync)
  scheduleJob('flag-scan', config.cron.flagScan, nightlySweep)
  scheduleJob('weekly-digest', config.cron.weeklyDigest, sendWeeklyDigest)
}
