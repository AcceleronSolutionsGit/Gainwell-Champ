# CHAMP Spot Recognition Tool — Build Specification

Internal contract document. Source requirements: `GEPL CHAMP Spot Tool Requirements.docx` (FR-1…FR-31, BR-1…BR-6) and `GEPL_CHAMP_Spot_Tool_Architecture.docx`. This file is the single source of truth for module interfaces, API shapes and file ownership during the build.

## 0. Ground rules (all agents)

- **Stack**: Node 22 / TypeScript strict / Express 4 / Knex (better-sqlite3 locally, pg in prod) / React 18 + Vite + recharts. CommonJS on the server (`esModuleInterop` on — use `import express from 'express'`).
- **Do not edit**: `package.json` files, tsconfigs, `vite.config.ts`, `server/src/{config.ts,types.ts,index.ts}`, `server/src/db/**`, `server/src/modules/settings.ts`, `server/src/middleware/errorHandler.ts`, or another agent's files (§10). If blocked, note it in your report instead.
- **No new dependencies.** Only what's already in the two package.json files. Node 22 global `fetch` is available.
- **Timestamps**: store ISO-8601 UTC strings via `nowIso()` from `db/time.ts`. Never rely on DB-side defaults for timestamps. Calendar logic (cap months, digests, display) is IST — use the helpers in `db/time.ts`.
- **Booleans in DB**: integer 0/1 columns. Write `1`/`0`, read with `!!row.active`.
- **Errors**: routes throw `apiError(status, code, message)` (from `middleware/errorHandler.ts`) or return typed results; envelope is `{ error: { code, message } }`.
- **Validation**: zod for all request bodies/queries on the server.
- **Commented real integrations** (user has no credentials yet): write the REAL production code, fully, then either (a) gate it behind config so the local mode runs instead, or (b) where the code cannot compile/run without SDKs we don't ship (AWS SDK), keep the real code present but commented, with a small stub that throws + a README pointer. Pattern:

```ts
// ── PRODUCTION (real integration) ─────────────────────────────
// Enabled when WHATSAPP_PROVIDER=meta + credentials in env/Secrets Manager.
// ...real, complete code...
// ── LOCAL (demo fallback) — active by default ─────────────────
```

- **Audit** (FRD §7): every admin mutation and export writes to `audit_log` via `logAudit()` (§5, Agent C owns the helper).

## 1. Existing foundation (read before coding)

- `server/src/config.ts` — all env config; `config.whatsapp.provider` = `'simulator' | 'meta'`, `config.email.provider` = `'console' | 'smtp' | 'ses'`, `config.darwinbox.enabled`, `config.simulatorEnabled`, `config.boardToken`, `config.cron.*`, `config.auth.*`, `config.session.*`.
- `server/src/types.ts` — all shared domain types (`Employee`, `Recognition`, `BotReply`, `CreateRecognitionResult`, `FeedItem`, …). Use these; don't redefine.
- `server/src/db/knex.ts` — `initDb()/getDb()/closeDb()`.
- `server/src/db/migrations/001_init.ts` — the full schema (read it).
- `server/src/db/seed/demo.ts` — demo directory + history. Behaviour names: Safety First, Quality, Ownership, Innovation, Collaboration, Customer Centricity.
- `server/src/modules/settings.ts` — `getSettings()/updateSettings()` + `AppSettings` (cap, reason gate, flag thresholds, digest).
- `server/src/index.ts` — mounts routers exactly as named in §10; webhook mounted before `express.json()` (raw body available to it).

## 2. Conversation engine (Agent A)

`server/src/modules/conversation/engine.ts`:

```ts
export async function processInboundMessage(msg: InboundMessage): Promise<BotReply[]>
```

State persisted in `conversation_state` (key = mobile) as JSON: `{ step, lang, data: { candidates?: number[], recipientId?: number, behaviourId?: number }, updatedAt }`. State older than 30 min ⇒ expired: greet fresh (FR-10 resume within 30 min).

Identification (FR-2): look up sender by `employees.mobile`. Unknown or `active=0` ⇒ localized refusal + enrolment instructions (contact HR / Plant HR), no state.

Steps (FR-5…FR-10):
1. **Greeting/menu** — on `hi|hello|menu|champ|start|recognize|recognise` (case-insensitive) or any text when idle: welcome + `buttons` [Give recognition `menu_give`, My count `menu_count`, Language `menu_lang`]. `cancel|stop` anywhere ⇒ clear state, confirm.
2. **menu_give** ⇒ ask for recipient name (step `recipient_query`).
3. Free text in `recipient_query` ⇒ search active employees (`name LIKE %q%` case-insensitive, or employee_code exact), excluding the giver (FR-6). 0 hits ⇒ re-prompt. 1–8 hits ⇒ `list` reply, rows `id=pick_<employeeId>`, title=name, description=`function · site`. >8 ⇒ top 8 + "reply with more of the name to narrow".
4. `pick_<id>` ⇒ `list` of the 6 active behaviours (FR-7), rows `id=beh_<behaviourId>`, title=name, description from behaviours table.
5. `beh_<id>` ⇒ prompt for one-line reason (mention the minimum length from settings).
6. Free text in `reason` ⇒ call `createRecognition()` (§3). On `ok` ⇒ localized success text (recipient name + behaviour), clear state, `await notifyRecipient(recognition)`. On error:
   - `REASON_TOO_SHORT` / `REASON_GENERIC` ⇒ explain (include min length / "be specific about what they did") and STAY in reason step (FR-8).
   - `CAP_EXCEEDED` ⇒ FR-12 message: cap reached for that person this month + "consider nominating them for CHAMP of the Month"; clear state.
   - `SELF_RECOGNITION` / inactive ⇒ localized message; clear state.
7. **menu_count** (FR-16 over WhatsApp) ⇒ received total + top behaviours breakdown + given total; text reply.
8. **menu_lang** ⇒ `buttons` en/hi/bn (English / हिन्दी / বাংলা) `lang_<code>`; persist to `employees.language`; confirm in the new language.
9. Anything unparseable ⇒ gentle localized help text for the current step.

i18n: `server/src/modules/conversation/i18n.ts` + `i18n/{en,hi,bn}.json` (same key set; parameterised with `{name}`-style placeholders). `t(lang, key, params)` helper. All giver-facing strings localized; the recipient notification uses the RECIPIENT's language. Reason free text accepts any script (no validation beyond BR-3).

## 3. Rules engine & recognitionService (Agent B)

`server/src/modules/rules/rules.ts` — pure checks, each returning `RuleError | null`:
- `checkSelf(giverId, recipientId)` (BR-1)
- `checkCap(giverId, recipientId, settings)` (BR-2): count recognitions with `status != 'removed'` for the pair where `created_at >= istMonthStartIso()`; `>= capPerPairPerMonth` ⇒ `CAP_EXCEEDED` with params `{ cap }`. No other volume limits.
- `checkReason(text, settings)` (BR-3): trim; length < `reasonMinLength` ⇒ `REASON_TOO_SHORT { min }`. Normalize (lowercase, strip punctuation/extra spaces) and compare against blocklist entries — exact match after normalization ⇒ `REASON_GENERIC`.

`recognitionService.ts` — replace stub, keep the exported signature:
`createRecognition(input)` ⇒ giver/recipient exist & active checks, the three rules, insert (`status 'active'`, `channel` default `'whatsapp'`, `created_at: nowIso()`), then `await checkAfterCreate(recognition)` (flags may set status `flagged`), then return the fresh row. Rule violations ⇒ `{ ok:false, error }`, never throw.

`server/src/modules/flags/flagScan.ts` (BR-5, FR-14 — flag, never auto-remove):
- `checkAfterCreate(rec)`: **burst** — giver's recognitions (not removed) in last `flagBurstWindowMinutes` ≥ `flagBurstCount` ⇒ flag `burst` on `rec` (details JSON `{count, windowMinutes}`), set `rec.status='flagged'`, unless an open burst flag already covers this giver within the window (no duplicate spam). **loop** — within `flagLoopWindowHours`, both A→B and B→A exist and total ≥ `flagLoopMinTotal` ⇒ flag `loop` (details `{pair, countInWindow, windowHours}`), status flagged, same dedupe idea.
- `nightlySweep()`: same checks over the last 7 days for anything missed; idempotent (skip recognitions that already have an open/resolved flag of that type).

`server/src/modules/sync/darwinbox.ts` (FR-1, architecture §3.1):
`runDirectorySync(): Promise<{ mode: 'demo'|'live', upserts: number, deactivated: number, message: string }>`.
Real client: full code — OAuth2/apiKey auth, paginated employee dataset fetch, field mapping to our schema, upsert by `employee_code`, deactivate missing actives (keep history, FR-4). Gate: `config.darwinbox.enabled`; when false return `{ mode:'demo', … message: 'DarwinBox sync disabled — running on the seeded demo directory. Set DARWINBOX_* env to enable.' }`. Real HTTP call site clearly commented as production path.

`server/src/modules/digest/digest.ts` (FR-20):
`buildWeeklyDigest(): Promise<{ text: string; stats: { total: number; byBehaviour: {name:string;count:number}[]; topSite: string|null; participationPct: number } }>` over the last 7 days. `sendWeeklyDigest()`: if `weeklyDigestEnabled` — production path sends the approved `weekly_digest` template via the WhatsApp provider to the audience (real code, commented with FR-21 note about templates); local mode logs the digest text.

`server/src/scheduler.ts` — replace stub: node-cron with IST timezone — `config.cron.darwinboxSync` → `runDirectorySync()`, `config.cron.flagScan` → `nightlySweep()`, `config.cron.weeklyDigest` → `sendWeeklyDigest()`. Each job try/catch + console log. Guard against double-start.

## 4. WhatsApp transport (Agent A)

`modules/whatsapp/provider.ts` — replace stub; keep the `WhatsAppProvider` interface exactly. `getWhatsAppProvider()` singleton by `config.whatsapp.provider`:
- `SimulatorProvider` (local default): appends outbound messages to the simulator store.
- `MetaCloudProvider`: REAL, complete Cloud API code in `metaCloud.ts` — `POST https://graph.facebook.com/{ver}/{phoneNumberId}/messages` with bearer token; maps `BotReply` → `text` / `interactive.button` / `interactive.list` payloads; `sendTemplate` → `type:'template'` with body params (FR-21: templates outside the 24-h window). Constructor throws a clear error if credentials are missing.

`modules/whatsapp/simulatorStore.ts`: in-memory per-mobile transcript `{ dir: 'in'|'out', at: string, text?: string, reply?: BotReply, kind?: 'message'|'notification' }[]` (cap ~200/mobile), `append/get/clear`.

`routes/webhook.ts` — replace stub. Mounted at `/webhook/whatsapp`, receives the RAW body (mounted before `express.json()`): use `express.raw({ type: '*/*' })` inside the router, verify `X-Hub-Signature-256` HMAC-SHA256 with `config.whatsapp.meta.appSecret` (reject 401 when set; log warning and continue when unset — dev). `GET /` = Meta verification handshake (`hub.mode/hub.verify_token/hub.challenge`). `POST /` = parse Meta payload (messages[].type `text` | `interactive` with `list_reply.id`/`button_reply.id`), map to `InboundMessage`, run `processInboundMessage`, send replies via provider, always 200 fast.

`modules/notifications.ts` — replace stub: FR-19 — load recipient; compose in recipient's language (giver name, behaviour, reason); production = `sendTemplate('recognition_received', […])`; simulator = outbox `kind:'notification'`. Recipient inactive ⇒ skip silently.

`routes/simulator.ts` — replace stub. All handlers 404 unless `config.simulatorEnabled` (index only mounts it when enabled anyway):
- `GET /contacts` → `{ contacts: [{ id, name, mobile, function, site, language, active }] }` (all employees, active first, alphabetical)
- `GET /history?mobile=` → `{ history: [...] }` from the store
- `POST /message` `{ mobile, text?, interactiveReplyId? }` → append inbound to store, `processInboundMessage`, append each reply as outbound, → `{ history }` (fresh full transcript)
- `POST /reset` `{ mobile }` → clear store + `conversation_state` row → `{ ok: true }`

## 5. Auth, API routes, analytics, export (Agent C)

`modules/auth/otp.ts` (architecture §3.4): `requestOtp(email)` — normalize lowercase; domain must equal `config.auth.allowedEmailDomain` (`DOMAIN_NOT_ALLOWED`); must match an active employee's email OR an `admin_users` row (`NOT_ENROLLED`); generate 6-digit code, store sha256(code + SESSION_SECRET) hash, TTL `otpTtlMinutes`, invalidate older codes for the email; send via mailer. Returns `{ devCode?: string }` — devCode ONLY when `config.email.provider === 'console'` (shown on the login page for local testing; never in smtp/ses modes). `verifyOtp(email, code)` — most recent unconsumed code; expired ⇒ `OTP_EXPIRED`; `attempts >= otpMaxAttempts` ⇒ `OTP_TOO_MANY_ATTEMPTS`; mismatch increments attempts ⇒ `OTP_INVALID`; success marks consumed and returns the `SessionUser` (role: admin_users row → its role, else `employee`; employeeId/name from directory, admins without a directory row get name from email local-part).

`modules/auth/mailer.ts`: `sendOtpEmail(email, code)` + `sendMail(to, subject, text)`. Providers: `console` (pretty log incl. the code), `smtp` (real nodemailer code using config.email.smtp), `ses` — real code COMMENTED (needs `@aws-sdk/client-ses`; stub throws with README pointer). Keep OTP mail plain text (deliverability note from architecture §3.3).

`modules/auth/session.ts`: JWT (jsonwebtoken, HS256, `config.session.secret`) in httpOnly cookie `champ_session` (sameSite lax; secure in prod): payload `SessionUser` + `iat` + `la` (last-activity epoch s). `issueSession(res, user)`, `readSession(req)` → null if absent/invalid/absolute-expired (`iat` older than absoluteHours) /idle-expired (`la` older than idleMinutes), `touchSession(res, …)` re-issues with fresh `la`, `clearSession(res)`.

`middleware/requireAuth.ts`: `requireAuth` (401 `UNAUTHENTICATED`), `requireRole('committee')` = committee or admin, `requireRole('admin')` = admin only (403 `FORBIDDEN`). Attach `req.user` (extend Express.Request via declaration merging here).

`middleware/rateLimits.ts`: express-rate-limit — `otpRequestLimiter` (5/15 min per IP+email key), `otpVerifyLimiter` (10/15 min per IP), `apiLimiter` (600/5 min, applied in routers not index).

`modules/audit.ts`: `logAudit(actor, action, entityType?, entityId?, details?)` → insert audit_log.

### Routes (all under existing mounts; JSON everywhere)

`routes/auth.ts`: `POST /request-otp {email}` (limiters) → `{ ok, devCode? }`; `POST /verify-otp {email, code}` → sets cookie, `{ ok, user }`; `GET /me` → `{ user }` or 401; `POST /logout`. Audit `login` on verify success.

`routes/feed.ts` (`requireAuth`): `GET /` query `page,pageSize(≤100),function,site,behaviourId,personId,q,from,to` — status IN (active, flagged) [flagged stays publicly visible until removed, BR-5], `personId` matches giver OR recipient, `q` searches reason + both names, `from/to` are IST dates (YYYY-MM-DD) via `istDayStartIso/istDayEndIso`. → `{ items: FeedItem[], total, page, pageSize }` newest-first. Also `GET /filters` → `{ functions: string[], sites: string[], behaviours: {id,name,colour}[] }` for the filter bar.

`routes/employees.ts` (`requireAuth`): `GET /search?q=` (active, ≤20, id/name/code/function/site/shift); `GET /?q&function&site&page` directory with `givenCount/receivedCount` (status != removed); `GET /:id/profile` → `{ employee: {…public fields, no mobile/email for non-admin}, received: { total, byBehaviour: [{behaviourId,name,colour,count}] }, given: { total }, recent: FeedItem[] (10) }` (FR-16).

`routes/board.ts` (NO auth — kiosk; if `config.boardToken` set, require `?token=` match, else open):
`GET /feed?site&limit(≤50)` → `{ items }` active+flagged newest-first; `GET /weekly?site` → `{ weekStartIst, weekEndIst, total, byBehaviour: [{name,colour,count}], topRecipients: [{name, site, count}], items: FeedItem[] }` for the last 7 IST days (feeds the printable, FRD §3).

`routes/analytics.ts` (`requireRole('committee')`), all take `from,to` (IST dates, default last 90 days), all exclude `removed`:
- `GET /summary` → `{ recognitions, activeEmployees, givers, receivers, pctGivers, pctReceivers, weekly: [{ weekStartIst: 'YYYY-MM-DD', count }] }` (FR-26)
- `GET /function-shift` → `{ functions: [{ name, headcount, given, received, giverParticipationPct }], shifts: [same shape] }` (FR-27 — the floor-vs-office equity view)
- `GET /behaviours` → `[{ behaviourId, name, colour, count, pct }]` (FR-28)
- `GET /direction` → `{ total, juniorToSenior, seniorToJunior, peer, crossFunction, sameFunction }` — compare `level_grade` ordering L1<…<L5 (FR-29)
- `GET /dark-spots` → `[{ dimension: 'sub_team'|'shift'|'site', name, site?, headcount, given, received }]` — every group whose per-head activity is 0 or in the bottom decile, zeros first (FR-30)
- `GET /concentration` → `{ uniqueGivers, uniqueRecipients, top10PctGiverShare, topGivers: [{id,name,function,site,count,pctOfTotal}] (10), topRecipients: [same] }` (FR-31)
Implementation note: at this scale (≤ a few thousand rows) load the date-range rows once and aggregate in JS — portable across SQLite/PG. Add `modules/analytics/queries.ts` with one function per endpoint.

`routes/admin.ts` (`requireRole('committee')` for reads/moderation/export; `requireRole('admin')` for settings/behaviours/employees/sync):
- `GET /recognitions?status&from&to&q&page&pageSize` — ALL statuses incl. removed, with giver/recipient/behaviour join + open flag info (FR-22)
- `POST /recognitions/:id/remove {reason}` — soft delete (BR-6): status `removed`, `removal_reason`, `removed_by` = actor email, `removed_at`; resolve its open flags as `removed`; audit. 409 if already removed.
- `GET /flags?status=open|resolved|all` → `[{ ...flag, details: parsed, recognition: FeedItem & { status } }]`
- `POST /flags/:id/resolve { resolution: 'dismissed' }` — mark resolved; if the recognition has no other open flags and isn't removed, set status back to `active`; audit.
- `GET /settings` → AppSettings; `PUT /settings` (partial, zod-validated: cap 1-10, minLength 5-100, blocklist string[], etc.) → updated; audit with changed keys (FR-23).
- `GET /behaviours` (all incl. inactive, sort_order) ; `PATCH /behaviours/:id {name?,description?,colour?(hex),active?}` → audit (FR-23; fixed set of six — no create/delete).
- `GET /employees?q&active&site&function&page&pageSize` (admin sees mobile/email/consent); `POST /employees` (enrol: zod — name, mobile E.164, function, site, required; sub_team, shift, email, employment_type, level_grade, language, consent_recorded optional) ; `PATCH /employees/:id` (same fields + `active` — deactivation keeps history, FR-4); audit both (FR-24, FR-3 consent).
- `POST /sync-darwinbox` → `runDirectorySync()` result; audit (FR-24).
- `GET /export?from&to&function&site&behaviourId&status&format=csv|xlsx` (FR-25) — see exporter below; audit incl. filters.
- `GET /audit?page&pageSize` → audit entries newest-first.
- `GET /digest-preview` → `buildWeeklyDigest()` (FR-20 demo).

`modules/exporter.ts`: `exportRecognitions(filters, format)` → `{ filename, contentType, body: Buffer }`. Columns: ID, Date (IST `DD MMM YYYY HH:mm`), Giver Code/Name/Function/Site/Shift, Recipient Code/Name/Function/Site/Shift, Behaviour, Reason, Channel, Status, Removal Reason, Removed By. CSV hand-rolled (proper quoting); XLSX via exceljs (header bold + column widths).

## 6. Web console (Agent D) — `web/src/**`

Entry `web/src/main.tsx` (index.html already references it), React Router:

| Route | Access | Content |
|---|---|---|
| `/login` | public | email → OTP → code; shows devCode helper when returned |
| `/` | employee login | live feed: filter bar (function/site/behaviour/person search/date range from `/api/feed/filters`), poll 15 s, cards (FR-15, FR-17) |
| `/people`, `/people/:id` | employee | directory with given/received counts; profile: counts + behaviour breakdown bar chart + recent (FR-16) |
| `/analytics` | committee/admin | dashboard (§FR-26…31): KPI tiles (participation %), weekly trend line, function & shift split bars, behaviour breakdown (behaviour colours), direction mix, dark spots table (zeros highlighted), concentration (top givers/recipients + top-10% share) |
| `/admin` | committee/admin (settings/behaviours/employees tabs admin-only) | tabs: Moderation (flag queue w/ details + dismiss/remove, all-recognitions table w/ status filter + remove-with-reason modal), Behaviours (edit label/description/colour/active), Settings (cap, reason gate, blocklist editor, flag thresholds, digest toggle), Employees (list/search + enrol + edit/deactivate + consent flag + “Sync from DarwinBox” button surfacing the demo-mode message), Export (date range + filters → CSV/Excel download), Audit log |
| `/board` | public (kiosk) | dark full-screen: header clock + CHAMP branding, newest cards large type, auto-refresh 20 s, gentle highlight rotation; footer “Give recognition on WhatsApp — message CHAMP” (FR-18) |
| `/board/print` | public | weekly printable (FRD §3): last-7-days summary + list, print CSS, “Print” button |
| `/simulator` | public, dev | in-app WhatsApp phone: contact picker (searchable), chat transcript (bubbles; interactive lists/buttons rendered as tappable chips), text input, reset; notifications render distinctly; banner “Dev simulator — same engine as production WhatsApp” |

Shared: `api.ts` fetch wrapper (credentials include, JSON, throws `{code,message}`); auth context from `/api/auth/me`; nav shows links per role; `RequireAuth`/`RequireRole` wrappers redirecting to `/login`.

Design: clean light theme; deep teal-green primary `#0F6B5C`, bg `#F4F7F6`, surface white, text `#172723`, radius 10px, system font stack. Behaviour chips/borders use each behaviour's colour. Feed card: left border in behaviour colour, "Giver → Recipient", chip, reason, meta line (time-ago IST · site · function). Board: near-black green `#0B1512`, large type. Charts (recharts): minimal — single hue `#0F6B5C` for single-series bars/lines, behaviour colours only on the behaviour chart, light grid `#E3E9E7`, no 3D/legends where direct labels work, numbers formatted plainly. Empty/loading/error states everywhere. No external assets (plant kiosks may be offline-ish) — system fonts, inline SVG icons only.

TypeScript strict; mirror server response types in `web/src/types.ts`.

## 7. Deployment & docs (Agent E)

- `deploy/Dockerfile` — multi-stage (node:22-bookworm-slim): install workspaces, build server+web, runtime image with only production deps + dist + web/dist; non-root user; `EXPOSE 8080`; healthcheck `/api/health`. Must build with better-sqlite3 native module.
- `deploy/docker-compose.yml` — app (sqlite volume) + OPTIONAL `postgres` service under `profiles: ["postgres"]` with the env pair to switch, commented notes.
- `deploy/aws/*.tf` — REFERENCE Terraform, clearly headed "review before applying": ap-south-1 (DPDP residency); ECR repo; App Runner service (or note the ECS alternative) with VPC connector; RDS PostgreSQL (db.t4g.micro, encrypted, private); Secrets Manager secret (DB URL, WhatsApp, SMTP); IAM roles (App Runner ECR access + runtime role with secret read + SES send); variables.tf + outputs.tf. Comments map each resource to architecture §3.5/§6.
- `server/src/aws/secretsManager.ts` — `loadAwsSecretsIntoEnv()`: full real implementation COMMENTED (needs `@aws-sdk/client-secrets-manager`), active stub throws with pointer to deploy/README-deploy.md. Compiles clean.
- `deploy/README-deploy.md` — AWS runbook: ECR push, terraform apply, secrets population, SES + SPF/DKIM/DMARC, WhatsApp template approval lead-time warning, DarwinBox IP allowlisting, dev/staging/prod note (architecture §7).
- Root `README.md` — the main doc: what/why, feature ↔ FR map, quick start (`nvm use && npm install && npm run dev`, URLs, demo logins `hr.admin@gainwellengineering.com` / OTP from terminal or login page, simulator walkthrough incl. testing the three blocks), switching each integration from demo → real (WhatsApp Meta/BSP, DarwinBox, SMTP/SES, Postgres, Secrets Manager), config reference table, project layout, acceptance-criteria checklist (FRD §9).

## 8. Bot copy — key set (en values; Agent A translates hi/bn)

`welcome` "👋 Welcome to Gainwell CHAMP — instant recognition for great work. What would you like to do?" · `btn_give` "Give recognition" · `btn_count` "My count" · `btn_lang` "Language" · `not_registered` "Sorry, this number isn't registered for CHAMP. Please contact HR / Plant HR to get enrolled." · `ask_recipient` "Who would you like to recognise? Reply with their name." · `no_match` "I couldn't find anyone matching “{q}”. Try again with their name or employee code." · `pick_recipient` "Select the person to recognise:" · `too_many` "Quite a few people match — here are the top 8. Reply with more of the name to narrow it down." · `pick_behaviour` "Great — which CHAMP behaviour did {name} show?" · `ask_reason` "In one line, what did {name} do? (at least {min} characters — be specific)" · `success` "✅ Done! Your recognition of {name} for {behaviour} is on the CHAMP feed, and they've been notified. Thank you for noticing great work!" · `err_reason_short` "That's a bit brief. Please describe what they actually did (at least {min} characters)." · `err_reason_generic` "Please be specific — what did they do, and why did it matter? Generic phrases like “{phrase}” don't make the feed." · `err_cap` "You've already recognised {name} {cap} times this month — that's the limit per person. Consider nominating them for CHAMP of the Month instead! 🏆" · `err_self` "You can't recognise yourself — but we admire the confidence! 😄" · `recipient_inactive` "That person can't receive recognitions right now." · `cancelled` "Cancelled. Say “hi” anytime to start again." · `count_summary` "🏆 Your CHAMP count\nReceived: {received} ({breakdown})\nGiven: {given}\nKeep noticing great work!" · `lang_prompt` "Choose your language:" · `lang_set` "Language updated. Say “hi” to continue." · `notify_received` "🎉 {giver} just recognised you on Gainwell CHAMP for {behaviour}:\n“{reason}”\nIt's on the CHAMP feed. Congratulations!" · `help_fallback` "Say “hi” for the menu, or “cancel” to start over."

## 9. Definition of done per agent

Report: files created/changed, contract deviations (should be none), anything left for integration. The integration agent then: installs, `npm run typecheck` both workspaces, `vite build`, boots the server, and runs curl smoke tests end-to-end (OTP login, feed, simulator conversation happy path + all three blocks, board, analytics, export, flags).

## 10. File ownership

| Agent | Owns (create/replace) |
|---|---|
| A — conversation & WhatsApp | `modules/conversation/**`, `modules/whatsapp/**`, `modules/notifications.ts`, `routes/webhook.ts`, `routes/simulator.ts` |
| B — rules, flags, jobs | `modules/rules/**`, `modules/flags/**`, `modules/sync/**`, `modules/digest/**`, `scheduler.ts` |
| C — auth & API | `routes/{auth,feed,employees,admin,analytics,board}.ts`, `modules/auth/**`, `modules/audit.ts`, `modules/analytics/**`, `modules/exporter.ts`, `middleware/{requireAuth,rateLimits}.ts` |
| D — web console | `web/src/**` (everything; index.html exists) |
| E — deploy & docs | `deploy/**`, `server/src/aws/**`, root `README.md` |
