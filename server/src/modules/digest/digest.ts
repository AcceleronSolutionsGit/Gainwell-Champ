/**
 * FR-20 — weekly WhatsApp digest: a short, friendly summary of the last
 * 7 days of recognition activity. Built once, then either broadcast via the
 * WhatsApp provider (production) or logged (local mode). The admin console's
 * digest-preview endpoint reuses buildWeeklyDigest() directly.
 */
import { config } from '../../config'
import { getDb } from '../../db/knex'
import { daysAgoIso, formatIst, nowIso } from '../../db/time'
import { getSettings } from '../settings'
import { getWhatsAppProvider } from '../whatsapp/provider'
import { Employee } from '../../types'

export interface DigestStats {
  total: number
  byBehaviour: { name: string; count: number }[]
  topSite: string | null
  participationPct: number
}

/**
 * Aggregate the last 7 days (excluding removed entries) into WhatsApp-ready
 * text plus the raw stats. Conventions:
 *   - topSite      = site whose people GAVE the most recognitions (giving is
 *                    the engagement signal the programme wants to celebrate);
 *   - participation = active employees who gave OR received at least once,
 *                    as a % of the active headcount.
 */
export async function buildWeeklyDigest(): Promise<{ text: string; stats: DigestStats }> {
  const db = getDb()
  const since = daysAgoIso(7)

  // Small dataset (≤ a few thousand rows) — load the window once and
  // aggregate in JS; identical behaviour on SQLite and PostgreSQL.
  const rows = (await db('recognitions as r')
    .join('behaviours as b', 'b.id', 'r.behaviour_id')
    .join('employees as g', 'g.id', 'r.giver_id')
    .whereNot('r.status', 'removed')
    .where('r.created_at', '>=', since)
    .select(
      'r.giver_id as giverId',
      'r.recipient_id as recipientId',
      'b.name as behaviour',
      'g.site as giverSite',
    )) as { giverId: number; recipientId: number; behaviour: string; giverSite: string }[]

  const behaviourCounts = new Map<string, number>()
  const siteCounts = new Map<string, number>()
  const participants = new Set<number>()
  for (const row of rows) {
    behaviourCounts.set(row.behaviour, (behaviourCounts.get(row.behaviour) ?? 0) + 1)
    siteCounts.set(row.giverSite, (siteCounts.get(row.giverSite) ?? 0) + 1)
    participants.add(row.giverId)
    participants.add(row.recipientId)
  }

  const byBehaviour = [...behaviourCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const topSite =
    [...siteCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null

  const activeRow = await db('employees').where('active', 1).count({ n: '*' }).first()
  const activeCount = Number(activeRow?.n ?? 0)
  const participationPct =
    activeCount > 0 ? Math.round((participants.size / activeCount) * 100) : 0

  const stats: DigestStats = { total: rows.length, byBehaviour, topSite, participationPct }
  return { text: composeText(stats), stats }
}

function composeText(stats: DigestStats): string {
  const weekEnd = formatIst(nowIso(), 'DD MMM')
  const lines: string[] = [`🏆 Gainwell CHAMP — weekly roundup (week ending ${weekEnd})`, '']
  if (stats.total === 0) {
    lines.push(
      'A quiet week — no recognitions in the last 7 days.',
      'Seen someone do great work? Say "hi" to CHAMP on WhatsApp and give them a shout-out! 👋',
    )
    return lines.join('\n')
  }
  lines.push(
    `${stats.total} recognition${stats.total === 1 ? '' : 's'} this week — ${stats.participationPct}% of us took part.`,
    '',
    'Top CHAMP behaviours:',
  )
  for (const b of stats.byBehaviour.slice(0, 3)) {
    lines.push(`• ${b.name} — ${b.count}`)
  }
  if (stats.topSite) {
    lines.push('', `Most active site: ${stats.topSite} 🎉`)
  }
  lines.push('', 'Keep noticing great work — say "hi" to CHAMP on WhatsApp to give a recognition. 👋')
  return lines.join('\n')
}

/**
 * Weekly scheduler entry point. Honours the runtime toggle (FR-23) and the
 * configured audience ('all' actives, or 'leadership' = L4/L5).
 */
export async function sendWeeklyDigest(): Promise<void> {
  const settings = await getSettings()
  if (!settings.weeklyDigestEnabled) {
    console.log('[digest] weekly digest disabled in settings — skipping')
    return
  }
  const { text, stats } = await buildWeeklyDigest()

  if (config.whatsapp.provider === 'meta') {
    // ── PRODUCTION (real send) ─────────────────────────────────────────────
    // FR-21: a scheduled broadcast lands OUTSIDE the 24-hour customer-service
    // window, so it MUST go out as a pre-approved template ('weekly_digest',
    // approved in Meta WhatsApp Manager). The body params below must match
    // the approved template's placeholders in order:
    //   {{1}} total recognitions · {{2}} top behaviour · {{3}} participation %
    const db = getDb()
    const audienceQuery = db('employees').where('active', 1)
    if (settings.digestAudience === 'leadership') {
      audienceQuery.whereIn('level_grade', ['L4', 'L5'])
    }
    const audience = (await audienceQuery.select('id', 'mobile', 'name')) as Pick<
      Employee,
      'id' | 'mobile' | 'name'
    >[]

    const provider = getWhatsAppProvider()
    const params = [
      String(stats.total),
      stats.byBehaviour[0]?.name ?? '—',
      `${stats.participationPct}%`,
    ]
    let sent = 0
    let failed = 0
    for (const emp of audience) {
      try {
        await provider.sendTemplate(emp.mobile, 'weekly_digest', params)
        sent += 1
      } catch (err) {
        // One undeliverable number must not abort the broadcast.
        failed += 1
        console.error(`[digest] template send failed for ${emp.name} (${emp.mobile}):`, err)
      }
    }
    console.log(
      `[digest] weekly digest sent to ${sent}/${audience.length} recipients` +
        (failed ? ` (${failed} failed)` : '') +
        ` — audience: ${settings.digestAudience}`,
    )
    return
  }

  // ── LOCAL (demo fallback) — active by default ────────────────────────────
  // No template infrastructure locally: log the digest so it is visible in
  // the dev terminal (and via the admin console's digest preview).
  console.log(`[digest] weekly digest (local mode — logged, not sent):\n${text}`)
}
