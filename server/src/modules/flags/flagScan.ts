/**
 * BR-5 / FR-14 — gaming detection. Suspicious patterns are FLAGGED for the
 * moderation queue, never auto-removed; a flagged recognition stays publicly
 * visible until an admin removes it.
 *
 * Two patterns, thresholds live in runtime settings (FR-23):
 *   burst — one giver posting `flagBurstCount`+ recognitions inside
 *           `flagBurstWindowMinutes`;
 *   loop  — A→B and B→A both present within `flagLoopWindowHours` with a
 *           combined total ≥ `flagLoopMinTotal`.
 *
 * Dedupe policy: one pattern ⇒ one flag. The incremental check skips when an
 * OPEN flag of that type already covers the giver/pair inside the window (so
 * a 7-recognition burst yields a single queue entry, attached to the
 * recognition that crossed the threshold). The nightly sweep also honours
 * RESOLVED flags in that coverage check — once a committee member has
 * dismissed a pattern, re-scanning the same window must not resurrect it.
 */
import { Knex } from 'knex'
import { getDb } from '../../db/knex'
import { daysAgoIso, nowIso } from '../../db/time'
import { AppSettings, getSettings } from '../settings'
import { Flag, Recognition } from '../../types'

// ── window helpers (ISO strings compare lexicographically = chronologically) ─

function minusMinutesIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) - minutes * 60_000).toISOString()
}

function minusHoursIso(iso: string, hours: number): string {
  return minusMinutesIso(iso, hours * 60)
}

// ── shared primitives ────────────────────────────────────────────────────────

async function employeeName(db: Knex, id: number): Promise<string> {
  const row = await db('employees').where({ id }).first('name')
  return row?.name ?? `#${id}`
}

/** Insert the flag and mark the recognition 'flagged' (active rows only —
 *  removed rows stay removed, already-flagged rows are left alone). */
async function raiseFlag(
  db: Knex,
  rec: Recognition,
  type: Flag['type'],
  details: Record<string, unknown>,
): Promise<void> {
  await db('flags').insert({
    recognition_id: rec.id,
    type,
    details: JSON.stringify(details),
    status: 'open',
    created_at: nowIso(),
  })
  await db('recognitions').where({ id: rec.id, status: 'active' }).update({ status: 'flagged' })
}

/** Does a flag of this type already sit on this exact recognition? (Sweep
 *  idempotency — open OR resolved counts; a dismissed flag must stay dismissed.) */
async function recHasFlagOfType(db: Knex, recognitionId: number, type: Flag['type']): Promise<boolean> {
  const hit = await db('flags').where({ recognition_id: recognitionId, type }).first('id')
  return !!hit
}

/** Is there already a burst flag covering this giver within the window? */
async function burstFlagCovers(
  db: Knex,
  giverId: number,
  windowStartIso: string,
  includeResolved: boolean,
): Promise<boolean> {
  const q = db('flags')
    .join('recognitions as r', 'r.id', 'flags.recognition_id')
    .where('flags.type', 'burst')
    .where('r.giver_id', giverId)
    .where('r.created_at', '>=', windowStartIso)
  if (!includeResolved) q.where('flags.status', 'open')
  return !!(await q.first('flags.id'))
}

/** Is there already a loop flag covering this pair (either direction) within the window? */
async function loopFlagCovers(
  db: Knex,
  aId: number,
  bId: number,
  windowStartIso: string,
  includeResolved: boolean,
): Promise<boolean> {
  const q = db('flags')
    .join('recognitions as r', 'r.id', 'flags.recognition_id')
    .where('flags.type', 'loop')
    .where('r.created_at', '>=', windowStartIso)
    .where(function pairEitherDirection() {
      this.where(function () {
        this.where('r.giver_id', aId).andWhere('r.recipient_id', bId)
      }).orWhere(function () {
        this.where('r.giver_id', bId).andWhere('r.recipient_id', aId)
      })
    })
  if (!includeResolved) q.where('flags.status', 'open')
  return !!(await q.first('flags.id'))
}

// ── pattern evaluation for one recognition ───────────────────────────────────

interface EvaluateOptions {
  /** Nightly sweep mode: skip recs already carrying a flag of that type and
   *  treat resolved flags as covering the pattern (see module comment). */
  sweep: boolean
}

/** Run both pattern checks "as of" rec.created_at. Returns flags created (0–2). */
async function evaluateRecognition(
  db: Knex,
  settings: AppSettings,
  rec: Recognition,
  opts: EvaluateOptions,
): Promise<number> {
  let created = 0

  // ── burst ──
  const burstWindowStart = minusMinutesIso(rec.created_at, settings.flagBurstWindowMinutes)
  const burstSkip = opts.sweep && (await recHasFlagOfType(db, rec.id, 'burst'))
  if (!burstSkip) {
    const row = await db('recognitions')
      .where('giver_id', rec.giver_id)
      .whereNot('status', 'removed')
      .where('created_at', '>=', burstWindowStart)
      .where('created_at', '<=', rec.created_at)
      .count({ n: '*' })
      .first()
    const count = Number(row?.n ?? 0)
    if (
      count >= settings.flagBurstCount &&
      !(await burstFlagCovers(db, rec.giver_id, burstWindowStart, opts.sweep))
    ) {
      await raiseFlag(db, rec, 'burst', {
        giver: await employeeName(db, rec.giver_id),
        count,
        windowMinutes: settings.flagBurstWindowMinutes,
      })
      created += 1
    }
  }

  // ── loop ──
  const loopWindowStart = minusHoursIso(rec.created_at, settings.flagLoopWindowHours)
  const loopSkip = opts.sweep && (await recHasFlagOfType(db, rec.id, 'loop'))
  if (!loopSkip) {
    const countDirection = async (giverId: number, recipientId: number): Promise<number> => {
      const row = await db('recognitions')
        .where({ giver_id: giverId, recipient_id: recipientId })
        .whereNot('status', 'removed')
        .where('created_at', '>=', loopWindowStart)
        .where('created_at', '<=', rec.created_at)
        .count({ n: '*' })
        .first()
      return Number(row?.n ?? 0)
    }
    const ab = await countDirection(rec.giver_id, rec.recipient_id)
    const ba = await countDirection(rec.recipient_id, rec.giver_id)
    if (
      ab >= 1 &&
      ba >= 1 &&
      ab + ba >= settings.flagLoopMinTotal &&
      !(await loopFlagCovers(db, rec.giver_id, rec.recipient_id, loopWindowStart, opts.sweep))
    ) {
      await raiseFlag(db, rec, 'loop', {
        pair: [await employeeName(db, rec.giver_id), await employeeName(db, rec.recipient_id)],
        countInWindow: ab + ba,
        windowHours: settings.flagLoopWindowHours,
      })
      created += 1
    }
  }

  return created
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Incremental check, awaited right after a recognition is inserted
 * (recognitionService). May set the fresh row's status to 'flagged'.
 */
export async function checkAfterCreate(rec: Recognition): Promise<void> {
  const db = getDb()
  const settings = await getSettings()
  await evaluateRecognition(db, settings, rec, { sweep: false })
}

/**
 * Nightly re-scan of the last 7 days (scheduler) — catches anything the
 * incremental path missed (e.g. threshold settings tightened after the
 * fact). Idempotent: nothing already flagged or already reviewed is touched.
 */
export async function nightlySweep(): Promise<{ scanned: number; flagsCreated: number }> {
  const db = getDb()
  const settings = await getSettings()
  const recs = (await db('recognitions')
    .whereNot('status', 'removed')
    .where('created_at', '>=', daysAgoIso(7))
    .orderBy('created_at', 'asc')
    .select('*')) as Recognition[]

  let flagsCreated = 0
  // Chronological order means each recognition is evaluated with exactly the
  // history the incremental check would have seen at creation time.
  for (const rec of recs) {
    flagsCreated += await evaluateRecognition(db, settings, rec, { sweep: true })
  }
  return { scanned: recs.length, flagsCreated }
}
