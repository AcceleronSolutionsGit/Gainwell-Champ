/**
 * Typed fetch wrapper + one function per server endpoint (SPEC.md §5).
 *
 * Conventions:
 *  - every call sends credentials (httpOnly session cookie);
 *  - error responses use the `{ error: { code, message } }` envelope and are
 *    re-thrown as ApiError;
 *  - a 401 on any authenticated route notifies the auth context (session
 *    idle/absolute expiry) so the app can bounce to /login.
 */
import type {
  AdminRecognition,
  AnalyticsSummary,
  AppSettings,
  AuditEntry,
  Behaviour,
  BehaviourBreakdownRow,
  BoardWeekly,
  Concentration,
  DarkSpotRow,
  DigestPreview,
  DirectionMix,
  DirectoryPerson,
  EmployeeRow,
  EmployeeSearchHit,
  FeedFilterOptions,
  FeedItem,
  FlagItem,
  FunctionShiftSplit,
  Paged,
  ProfileResponse,
  SessionUser,
  SimContact,
  SimEntry,
  SyncResult,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>

function qs(params?: QueryParams): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

/** Registered by AuthProvider — fired when a session expires mid-use. */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  params?: QueryParams,
): Promise<T> {
  const res = await fetch(path + qs(params), {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let json: unknown = null
  const text = await res.text()
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      // non-JSON error body (proxy error page etc.) — fall through to status handling
    }
  }

  if (!res.ok) {
    const envelope = (json as { error?: { code?: string; message?: string } } | null)?.error
    const code = envelope?.code ?? `HTTP_${res.status}`
    const message = envelope?.message ?? `Request failed (${res.status})`
    // /api/auth/* handles its own 401s (bad OTP, not logged in yet).
    if (res.status === 401 && !path.startsWith('/api/auth/') && onUnauthorized) onUnauthorized()
    throw new ApiError(res.status, code, message)
  }
  return json as T
}

// ── tolerant list unwrapping ─────────────────────────────────────────────────
// A couple of list endpoints don't have their envelope pinned in the SPEC;
// accept both a bare array and the common `{ items | results | … }` wrappers
// so the console keeps working whatever key the API team chose.

function asArray<T>(raw: unknown, ...keys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>
    for (const key of [...keys, 'items', 'results']) {
      if (Array.isArray(rec[key])) return rec[key] as T[]
    }
  }
  return []
}

function asPaged<T>(raw: unknown, page: number, pageSize: number): Paged<T> {
  const items = asArray<T>(raw)
  const rec = (raw ?? {}) as Record<string, unknown>
  return {
    items,
    total: typeof rec.total === 'number' ? rec.total : items.length,
    page: typeof rec.page === 'number' ? rec.page : page,
    pageSize: typeof rec.pageSize === 'number' ? rec.pageSize : pageSize,
  }
}

/** snake_case tolerance for row extras whose casing isn't pinned by the SPEC. */
function alt<T>(rec: Record<string, unknown>, camel: string, snake: string): T | undefined {
  return (rec[camel] ?? rec[snake]) as T | undefined
}

function normalizeAdminRecognition(raw: unknown): AdminRecognition {
  const rec = raw as Record<string, unknown>
  const base = raw as AdminRecognition
  return {
    ...base,
    createdAt: (alt<string>(rec, 'createdAt', 'created_at') ?? '') as string,
    reason: (alt<string>(rec, 'reason', 'reason_text') ?? base.reason ?? '') as string,
    removalReason: alt<string | null>(rec, 'removalReason', 'removal_reason') ?? null,
    removedBy: alt<string | null>(rec, 'removedBy', 'removed_by') ?? null,
    removedAt: alt<string | null>(rec, 'removedAt', 'removed_at') ?? null,
    openFlag: alt<AdminRecognition['openFlag']>(rec, 'openFlag', 'open_flag') ?? null,
  }
}

function normalizeFlag(raw: unknown): FlagItem {
  const rec = raw as Record<string, unknown>
  let details = rec.details as FlagItem['details'] | string
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details) as Record<string, unknown>
    } catch {
      details = { note: details }
    }
  }
  return {
    id: rec.id as number,
    type: rec.type as FlagItem['type'],
    details: (details as Record<string, unknown> | null) ?? null,
    status: rec.status as FlagItem['status'],
    resolvedBy: alt<string | null>(rec, 'resolvedBy', 'resolved_by') ?? null,
    resolvedAt: alt<string | null>(rec, 'resolvedAt', 'resolved_at') ?? null,
    resolution: (rec.resolution as string | null) ?? null,
    createdAt: alt<string>(rec, 'createdAt', 'created_at') ?? '',
    recognition: rec.recognition as FlagItem['recognition'],
  }
}

function normalizeAudit(raw: unknown): AuditEntry {
  const rec = raw as Record<string, unknown>
  return {
    id: rec.id as number,
    actor: rec.actor as string,
    action: rec.action as string,
    entityType: alt<string | null>(rec, 'entityType', 'entity_type') ?? null,
    entityId: alt<string | null>(rec, 'entityId', 'entity_id') ?? null,
    // GET /api/admin/audit returns `details` as parsed JSON (an object), or a
    // plain string for legacy/hand-written rows — pass through untouched.
    details: rec.details ?? null,
    createdAt: alt<string>(rec, 'createdAt', 'created_at') ?? '',
  }
}

// ── endpoints ────────────────────────────────────────────────────────────────

export const api = {
  // auth
  me: () => request<{ user: SessionUser }>('GET', '/api/auth/me'),
  requestOtp: (email: string) =>
    request<{ ok: boolean; devCode?: string }>('POST', '/api/auth/request-otp', { email }),
  verifyOtp: (email: string, code: string) =>
    request<{ ok: boolean; user: SessionUser }>('POST', '/api/auth/verify-otp', { email, code }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout'),

  // feed
  feed: (params: QueryParams) =>
    request<Paged<FeedItem>>('GET', '/api/feed', undefined, params),
  feedFilters: () => request<FeedFilterOptions>('GET', '/api/feed/filters'),
  createRecognition: (payload: { recipientId: number; behaviourId: number; reasonText: string; giverId?: number }) =>
    request<{ ok: boolean; item: FeedItem }>('POST', '/api/feed/recognize', payload),

  // employees / directory
  searchEmployees: async (q: string) =>
    asArray<EmployeeSearchHit>(await request<unknown>('GET', '/api/employees/search', undefined, { q }), 'employees'),
  directory: async (params: QueryParams) =>
    asPaged<DirectoryPerson>(
      await request<unknown>('GET', '/api/employees', undefined, params),
      Number(params.page ?? 1),
      Number(params.pageSize ?? 20),
    ),
  profile: (id: number | string) => request<ProfileResponse>('GET', `/api/employees/${id}/profile`),

  // analytics (committee/admin)
  analyticsSummary: (params: QueryParams) =>
    request<AnalyticsSummary>('GET', '/api/analytics/summary', undefined, params),
  analyticsFunctionShift: (params: QueryParams) =>
    request<FunctionShiftSplit>('GET', '/api/analytics/function-shift', undefined, params),
  analyticsBehaviours: async (params: QueryParams) =>
    asArray<BehaviourBreakdownRow>(
      await request<unknown>('GET', '/api/analytics/behaviours', undefined, params),
      'behaviours',
    ),
  analyticsDirection: (params: QueryParams) =>
    request<DirectionMix>('GET', '/api/analytics/direction', undefined, params),
  analyticsDarkSpots: async (params: QueryParams) =>
    asArray<DarkSpotRow>(await request<unknown>('GET', '/api/analytics/dark-spots', undefined, params), 'darkSpots'),
  analyticsConcentration: (params: QueryParams) =>
    request<Concentration>('GET', '/api/analytics/concentration', undefined, params),

  // admin — moderation
  adminRecognitions: async (params: QueryParams) => {
    const raw = await request<unknown>('GET', '/api/admin/recognitions', undefined, params)
    const paged = asPaged<unknown>(raw, Number(params.page ?? 1), Number(params.pageSize ?? 20))
    return { ...paged, items: paged.items.map(normalizeAdminRecognition) }
  },
  removeRecognition: (id: number, reason: string) =>
    request<{ ok: boolean }>('POST', `/api/admin/recognitions/${id}/remove`, { reason }),
  flags: async (status: 'open' | 'resolved' | 'all') =>
    asArray<unknown>(await request<unknown>('GET', '/api/admin/flags', undefined, { status }), 'flags').map(
      normalizeFlag,
    ),
  resolveFlag: (id: number) =>
    request<{ ok: boolean }>('POST', `/api/admin/flags/${id}/resolve`, { resolution: 'dismissed' }),

  // admin — configuration
  settings: () => request<AppSettings>('GET', '/api/admin/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('PUT', '/api/admin/settings', patch),
  behaviours: async () =>
    asArray<Behaviour>(await request<unknown>('GET', '/api/admin/behaviours'), 'behaviours'),
  updateBehaviour: (id: number, patch: Partial<Pick<Behaviour, 'name' | 'description' | 'colour'>> & { active?: boolean }) =>
    request<Behaviour>('PATCH', `/api/admin/behaviours/${id}`, patch),

  // admin — employees
  adminEmployees: async (params: QueryParams) =>
    asPaged<EmployeeRow>(
      await request<unknown>('GET', '/api/admin/employees', undefined, params),
      Number(params.page ?? 1),
      Number(params.pageSize ?? 20),
    ),
  createEmployee: (payload: Record<string, unknown>) =>
    request<EmployeeRow>('POST', '/api/admin/employees', payload),
  updateEmployee: (id: number, payload: Record<string, unknown>) =>
    request<EmployeeRow>('PATCH', `/api/admin/employees/${id}`, payload),
  syncDarwinbox: () => request<SyncResult>('POST', '/api/admin/sync-darwinbox'),
  bulkUpdateEmployeeStatus: (ids: number[], active: boolean) =>
    request<{ ok: boolean }>('POST', '/api/admin/employees/bulk-status', { ids, active }),

  // admin — audit & digest
  audit: async (params: QueryParams) => {
    const raw = await request<unknown>('GET', '/api/admin/audit', undefined, params)
    const paged = asPaged<unknown>(raw, Number(params.page ?? 1), Number(params.pageSize ?? 25))
    return { ...paged, items: paged.items.map(normalizeAudit) }
  },
  digestPreview: () => request<DigestPreview>('GET', '/api/admin/digest-preview'),

  // board (kiosk — no auth; optional ?token=)
  boardFeed: async (params: QueryParams) =>
    asArray<FeedItem>(await request<unknown>('GET', '/api/board/feed', undefined, params)),
  boardWeekly: (params: QueryParams) =>
    request<BoardWeekly>('GET', '/api/board/weekly', undefined, params),

  // dev WhatsApp simulator
  simContacts: async () =>
    asArray<SimContact>(await request<unknown>('GET', '/api/dev/simulator/contacts'), 'contacts'),
  simHistory: async (mobile: string) =>
    asArray<SimEntry>(await request<unknown>('GET', '/api/dev/simulator/history', undefined, { mobile }), 'history'),
  simSend: async (mobile: string, payload: { text?: string; interactiveReplyId?: string; label?: string }) =>
    asArray<SimEntry>(await request<unknown>('POST', '/api/dev/simulator/message', { mobile, ...payload }), 'history'),
  simReset: (mobile: string) => request<{ ok: boolean }>('POST', '/api/dev/simulator/reset', { mobile }),
}

/**
 * Export download URL (FR-25). Rendered into an <a download> — the browser
 * sends the session cookie itself on this same-origin navigation.
 */
export function exportUrl(params: QueryParams): string {
  return '/api/admin/export' + qs(params)
}
