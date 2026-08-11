/**
 * Audit trail (FRD §7): every admin mutation, login and export is recorded in
 * `audit_log`. Writes never throw into the caller's flow-of-control decisions —
 * an audit insert failure IS an error (we let it propagate) because a silent
 * audit gap would defeat the point of the trail.
 */
import { getDb } from '../db/knex'
import { nowIso } from '../db/time'

/**
 * @param actor    email of the acting user, or 'system' for scheduled jobs
 * @param action   short verb key, e.g. 'login', 'remove_recognition', 'export_recognitions'
 * @param entityType e.g. 'recognition' | 'flag' | 'employee' | 'settings'
 * @param entityId primary key of the entity acted on (stringified)
 * @param details  JSON-serialisable context (filters used, changed keys, …)
 */
export async function logAudit(
  actor: string,
  action: string,
  entityType?: string,
  entityId?: string | number,
  details?: unknown,
): Promise<void> {
  await getDb()('audit_log').insert({
    actor,
    action,
    entity_type: entityType ?? null,
    entity_id: entityId === undefined ? null : String(entityId),
    details: details === undefined ? null : JSON.stringify(details),
    created_at: nowIso(),
  })
}
