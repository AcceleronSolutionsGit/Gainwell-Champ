/**
 * FR-1 / architecture §3.1 — nightly employee directory sync from DarwinBox
 * (the HRMS master). The directory is read-only here: the tool never writes
 * back to DarwinBox.
 *
 * ── PRODUCTION (real integration) ─────────────────────────────────────────
 * Enabled when DARWINBOX_ENABLED=true plus DARWINBOX_BASE_URL and either
 * OAuth2 client credentials (DARWINBOX_CLIENT_ID/SECRET) or an API key
 * (DARWINBOX_API_KEY). The full client below is real, runnable code: OAuth2
 * client-credentials (or API-key) auth → paginated employee-dataset fetch →
 * field mapping → upsert by employee_code → deactivate-missing (FR-4: leavers
 * are deactivated, never deleted — history stays intact).
 * NOTE: confirm the tenant-specific endpoint path and field names against
 * your DarwinBox integration workbook before go-live; they are marked below.
 * ── LOCAL (demo fallback) — active by default ─────────────────────────────
 * With DARWINBOX_ENABLED unset the app runs on the seeded demo directory and
 * this function reports demo mode without touching the network.
 */
import { z } from 'zod'
import { Knex } from 'knex'
import { config } from '../../config'
import { getDb } from '../../db/knex'
import { nowIso } from '../../db/time'
import { Employee } from '../../types'

export interface DirectorySyncResult {
  mode: 'demo' | 'live'
  upserts: number
  deactivated: number
  message: string
}

// ── DarwinBox payload validation ─────────────────────────────────────────────
// Field names follow DarwinBox's employee master dataset conventions; adjust
// to the tenant's integration workbook if the dataset uses custom labels.

const dbxEmployeeSchema = z
  .object({
    employee_id: z.string().optional(),
    full_name: z.string().optional(),
    parent_function_name: z.string().nullish(), // legacy, kept just in case
    function_name: z.string().nullish(),
    top_department: z.string().nullish(),
    location: z.string().nullish(), // legacy, kept just in case
    office_location: z.string().nullish(),
    personal_mobile_no: z.string().nullish(),
    company_email_id: z.string().nullish(),
    employee_type: z.string().nullish(),
    job_level: z.string().nullish(),
    direct_manager_employee_id: z.string().nullish(),
    date_of_exit: z.string().nullish(),
    updated_on: z.string().nullish(),
    group_company_code: z.string().nullish(),
  })
  .passthrough()

const dbxPageSchema = z
  .object({
    employee_data: z.array(dbxEmployeeSchema).optional().default([]),
  })
  .passthrough()

const dbxTokenSchema = z.object({ access_token: z.string().min(1) }).passthrough()

type DbxEmployee = z.infer<typeof dbxEmployeeSchema>

// ── helpers ──────────────────────────────────────────────────────────────────

/** Normalize an HRMS mobile to E.164. Indian 10-digit numbers get +91. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned
  const bare = cleaned.replace(/^\+/, '').replace(/^0+/, '')
  if (/^91\d{10}$/.test(bare)) return `+${bare}`
  if (/^\d{10}$/.test(bare)) return `+91${bare}`
  return null // unusable — WhatsApp identification needs a real E.164 number
}

function isDbxActive(rec: DbxEmployee): boolean {
  const dateOfExit = (rec.date_of_exit ?? '').trim()
  return dateOfExit === '' // Empty means active, filled means exited.
}

/** Map a DarwinBox record onto our employees columns (sync-owned fields only). */
function mapFields(rec: DbxEmployee, mobile: string): Partial<Employee> {
  const grade = (rec.job_level ?? '').trim().toUpperCase()
  const rawName = (rec.full_name ?? 'Employee').trim()
  const rawDept = (rec.function_name ?? rec.parent_function_name ?? 'Unassigned').trim()
  const rawSubTeam = (rec.top_department ?? '').trim()
  const rawSite = (rec.office_location ?? rec.location ?? 'Unassigned').trim()
  const rawEmail = (rec.company_email_id ?? '').trim().toLowerCase()
  const hrmsUpdatedOn = (rec.updated_on ?? '').trim()

  return {
    name: rawName || 'Employee',
    function: rawDept || 'Unassigned',
    sub_team: rawSubTeam || null,
    shift: 'General',
    site: rawSite || 'Unassigned',
    mobile,
    email: rawEmail || null,
    employment_type:
      (rec.employee_type ?? '').trim().toLowerCase() === 'contractual' ? 'contractual' : 'permanent',
    level_grade: /^L[1-5]$/.test(grade) ? grade : 'L2',
    active: isDbxActive(rec) ? 1 : 0,
    hrms_updated_on: hrmsUpdatedOn || null,
  }
}

/** Basic Auth headers for reportdatav2. */
async function authHeaders(): Promise<Record<string, string>> {
  const { basicAuthUser, basicAuthPass } = config.darwinbox
  if (basicAuthUser && basicAuthPass) {
    const encoded = Buffer.from(`${basicAuthUser}:${basicAuthPass}`).toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }
  throw new Error(
    'DarwinBox sync enabled but no credentials — set DARWINBOX_BASIC_AUTH_USER and DARWINBOX_BASIC_AUTH_PASS',
  )
}

/** Fetch the complete employee dataset using reportdatav2. */
async function fetchAllEmployees(headers: Record<string, string>): Promise<DbxEmployee[]> {
  const { baseUrl, datasetKey, apiKey } = config.darwinbox
  // ← PRODUCTION HTTP call site.
  const url = new URL(`${baseUrl}/masterapi/employee`)
  const body = {
    api_key: apiKey,
    datasetKey: datasetKey,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`DarwinBox employee fetch failed: HTTP ${res.status}`)
  }
  const rawJson = await res.json()
  const parsed = dbxPageSchema.parse(rawJson)
  
  const allEmployees = parsed.employee_data ?? []
  return allEmployees.filter(emp => {
    const code = (emp.group_company_code ?? '').trim().toUpperCase()
    return code === '3000' || code === 'GEPL'
  })
}

// ── the sync itself ──────────────────────────────────────────────────────────

async function liveSync(db: Knex): Promise<DirectorySyncResult> {
  const headers = await authHeaders()
  const fetched = await fetchAllEmployees(headers)
  const now = nowIso()

  const existing = (await db('employees').select(
    'id',
    'employee_code',
    'active',
    'hrms_updated_on',
  )) as Pick<Employee, 'id' | 'employee_code' | 'active' | 'hrms_updated_on'>[]
  const existingByCode = new Map(existing.map((e) => [e.employee_code, e]))

  let upserts = 0
  let skipped = 0
  const seenCodes = new Set<string>()
  const managerCodeByCode = new Map<string, string>() // for the second pass

  for (const rec of fetched) {
    const rawCode = (rec.employee_id ?? '').trim()
    if (!rawCode) {
      skipped += 1
      continue
    }
    const code = rawCode
    if (seenCodes.has(code)) continue // dataset duplicate — first record wins
    const mobile = toE164(rec.personal_mobile_no)
    if (!mobile) {
      // The mobile is the WhatsApp identity (FR-2) and a NOT NULL UNIQUE
      // column — records without a usable number cannot be enrolled.
      skipped += 1
      continue
    }
    seenCodes.add(code)
    const managerCode = (rec.direct_manager_employee_id ?? '').trim()
    if (managerCode) managerCodeByCode.set(code, managerCode)

    const fields = mapFields(rec, mobile)
    try {
      const current = existingByCode.get(code)
      if (current) {
        // Compare "Updated On" date from Darwinbox with our stored value to skip redundant writes
        const newUpdatedOn = (rec.updated_on ?? '').trim()
        const oldUpdatedOn = (current.hrms_updated_on ?? '').trim()

        if (newUpdatedOn && newUpdatedOn === oldUpdatedOn) {
          // No change since last sync — skip update
          continue
        }

        // Update sync-owned fields only. `language` (chosen on WhatsApp) and
        // `consent_recorded` (DPDP consent captured by HR) are ours, not HRMS's.
        await db('employees').where({ id: current.id }).update({ ...fields, updated_at: now })
      } else {
        await db('employees').insert({
          employee_code: code,
          ...fields,
          manager_id: null, // resolved in the second pass below
          language: 'en',
          consent_recorded: 0,
          created_at: now,
          updated_at: now,
        })
      }
      upserts += 1
    } catch (err) {
      // Most likely a mobile-uniqueness collision between two HRMS records —
      // log and keep going; one bad row must not abort the nightly sync.
      skipped += 1
      console.error(`[darwinbox] upsert failed for ${code}:`, err)
    }
  }

  // Second pass — resolve manager references now that every row exists.
  const idByCode = new Map<string, number>(
    ((await db('employees').select('id', 'employee_code')) as Pick<
      Employee,
      'id' | 'employee_code'
    >[]).map((e) => [e.employee_code, e.id]),
  )
  for (const [code, managerCode] of managerCodeByCode) {
    const id = idByCode.get(code)
    const managerId = idByCode.get(managerCode) ?? null
    if (id !== undefined) await db('employees').where({ id }).update({ manager_id: managerId })
  }

  // Deactivate actives that vanished from the HRMS extract (FR-4: keep
  // history — recognitions given/received remain on the feed and in analytics).
  // Note: Admin & committee emails are protected so dev/admin test accounts remain active.
  const protectedEmails = new Set(
    [...config.auth.adminEmails, ...config.auth.committeeEmails].map((e) => e.trim().toLowerCase()),
  )
  let deactivated = 0
  for (const e of existing) {
    if (e.active && !seenCodes.has(e.employee_code)) {
      const emp = (await db('employees').where({ id: e.id }).select('email').first()) as
        | { email: string | null }
        | undefined
      if (emp?.email && protectedEmails.has(emp.email.trim().toLowerCase())) {
        continue
      }
      await db('employees').where({ id: e.id }).update({ active: 0, updated_at: now })
      deactivated += 1
    }
  }

  const skippedNote = skipped ? `, ${skipped} skipped (no usable mobile / conflict)` : ''
  return {
    mode: 'live',
    upserts,
    deactivated,
    message: `DarwinBox sync complete: ${upserts} upserted, ${deactivated} deactivated${skippedNote}.`,
  }
}

/**
 * Run the directory sync. Called nightly by the scheduler and on demand from
 * the admin console ("Sync from DarwinBox", FR-24).
 */
export async function runDirectorySync(): Promise<DirectorySyncResult> {
  if (!config.darwinbox.enabled) {
    // ── LOCAL (demo fallback) — active by default ──────────────────────────
    return {
      mode: 'demo',
      upserts: 0,
      deactivated: 0,
      message:
        'DarwinBox sync disabled — running on the seeded demo directory. Set DARWINBOX_* env to enable.',
    }
  }
  // ── PRODUCTION (real integration) ────────────────────────────────────────
  return liveSync(getDb())
}
