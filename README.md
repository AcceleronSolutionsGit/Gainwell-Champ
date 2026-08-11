# Gainwell CHAMP · Spot Recognition Tool

WhatsApp-first, **money-free** peer recognition for Gainwell Engineering.
Anyone — from the Panagarh shop floor to the Kolkata design office — can
recognise a colleague for living a CHAMP behaviour in under a minute, from
the phone already in their pocket. Recognitions land on a live feed, plant
kiosk boards and an analytics dashboard; a light-touch moderation console
keeps the programme healthy without policing it.

The six CHAMP behaviours: **Safety First · Quality · Ownership · Innovation ·
Collaboration · Customer Centricity**.

Design principles baked into the code:

- **No money, no points, no leaderboard prizes** — visibility is the reward.
- **WhatsApp is the front door** (FR-5…FR-10): a guided tap-and-type flow, in
  English, हिन्दी or বাংলা.
- **Guardrails, not gates** (BR-5/FR-14): suspicious patterns are *flagged
  for a human*, never auto-removed; nothing is hard-deleted (BR-6).
- **Runs anywhere**: zero-config local demo (SQLite + simulated WhatsApp +
  console OTP email) with the same code paths used in production
  (PostgreSQL + Meta Cloud API + SES).

---

## Quick start (local demo — no accounts, no credentials)

Requires Node 22 (`.nvmrc` is set) and npm.

```bash
nvm use 22
npm install
npm run dev
```

Then open **http://localhost:5173** (Vite dev server; API on :8080). First
boot creates `./data/champ.sqlite3`, runs migrations and seeds a demo
directory: ~60 employees across Panagarh Plant and Kolkata plus ~90 days of
recognition history, including pre-seeded flags and removals so every screen
has something to show.

### Log in to the console

Go to `/login` and use:

| Email | Role | Unlocks |
|---|---|---|
| `hr.admin@gainwellengineering.com` | admin | everything: feed, analytics, moderation, settings, behaviours, employees, export, audit |
| `rnr.committee@gainwellengineering.com` | committee | feed, analytics, moderation, export |
| any seeded employee email (see Admin → Employees) | employee | feed, people directory |

The 6-digit OTP is **printed in the server terminal** and — in local console
email mode only — **shown right on the login page**. No mail server needed.

### Give a recognition end-to-end (WhatsApp simulator)

Open **http://localhost:5173/simulator** — an in-app phone that drives the
*exact same* conversation engine production WhatsApp uses.

1. Pick any contact from the picker (that person is now "you").
2. Send `hi` → tap **Give recognition**.
3. Type part of a colleague's name → tap them in the list.
4. Tap a CHAMP behaviour.
5. Type a specific one-line reason (15+ characters), e.g.
   `Caught a missing lockout tag at handover and fixed it before restart`.

You should see: a success message, a notification bubble in the *recipient's*
transcript (switch contacts to see it, in their language), and the new card
on the live feed at `/` within ~15 seconds.

### Now try the three blocked cases

1. **Self-recognition** (BR-1): at the "who do you want to recognise?" step,
   type **your own name** — you are excluded from the search results by
   design (FR-6), and the rules engine independently rejects
   self-recognition as a second line of defence.
2. **Third-in-a-month** (BR-2): recognise the *same colleague* twice more
   (vary the reasons), then attempt a third in the same calendar month — the
   bot stops you at the cap (default 2 per pair per month) and suggests a
   CHAMP of the Month nomination instead.
3. **Vague reason** (BR-3): at the reason step, reply `congratulations` —
   rejected as a generic phrase; reply `helped me` — rejected as too short.
   (Short generic phrases like `great job` are caught by the length check
   first, so they get the "too brief" message.) Both times the conversation
   stays put and lets you try again; no entry is created.

Other things worth clicking: `/board` (kiosk mode, auto-refreshes),
`/board/print` (weekly printable), `/analytics` (as committee/admin), and in
`/admin` the flag queue seeded with a reciprocal-loop and a burst pattern.

Reset the demo data anytime: `npm run seed:reset`.

---

## Architecture summary

One Node service, one database, one React bundle — deliberately boring
(architecture doc §1):

```
WhatsApp user ──► Meta Cloud API ──► POST /webhook/whatsapp ─┐
   (or the /simulator page in dev ──► /api/dev/simulator) ───┤
                                                             ▼
                    ┌─────────────────────────────────────────────────┐
                    │  Node 22 / Express / TypeScript (server/)       │
                    │  conversation engine (en·hi·bn) → rules engine  │
                    │  (self / cap / reason-quality) → flags scanner  │
                    │  feed·people·board·analytics·admin API + OTP    │
                    │  auth + audit log + CSV/XLSX export             │
                    │  node-cron (IST): HRIS sync · flag sweep ·      │
                    │  weekly digest                                  │
                    └───────┬──────────────────────────┬──────────────┘
                            ▼                          ▼
                 SQLite (local, default)      React 18 + Vite console (web/)
                 PostgreSQL/RDS (production)  feed · people · analytics ·
                                              admin · plant board · simulator
```

- **Provider seams** make demo↔production a config flip: WhatsApp
  (`simulator`/`meta`), email (`console`/`smtp`/`ses`), directory (seeded
  demo / DarwinBox sync), database (SQLite / PostgreSQL).
- **Time convention**: stored timestamps are ISO-8601 UTC; every calendar
  decision (monthly cap reset, weekly digest, display) is IST.
- **Production layout** (deploy/): one container on AWS App Runner in
  ap-south-1, RDS PostgreSQL in private subnets, secrets in AWS Secrets
  Manager, mail via SES — DPDP data residency throughout (arch §6).

## Feature ↔ requirement map

| Feature | Requirement(s) | Where in the code |
|---|---|---|
| Employee directory synced from DarwinBox (demo seed as fallback) | FR-1 | `server/src/modules/sync/darwinbox.ts`, `db/seed/demo.ts` |
| Sender identified by WhatsApp number; polite enrolment nudge for strangers | FR-2 | `modules/conversation/engine.ts` |
| DPDP consent flag for contractual employees' personal numbers | FR-3 | employees table + Admin → Employees enrol form |
| Deactivation keeps a leaver's recognition history | FR-4 | `routes/admin.ts` (PATCH employee), sync deactivation |
| Guided give-recognition chat: menu → person search → behaviour → reason | FR-5…FR-9 | `modules/conversation/engine.ts` |
| Giver never appears in their own recipient search | FR-6 (+BR-1) | recipient search in the engine + `modules/rules/rules.ts` |
| Conversation resumes for 30 min, then greets fresh | FR-10 | `conversation_state` handling in the engine |
| Cap message with "CHAMP of the Month" nudge | FR-12 (+BR-2) | `rules.ts` `checkCap` + engine copy |
| Suspicious patterns flagged for humans — never auto-removed | FR-14, BR-5 | `modules/flags/flagScan.ts` (burst + loop, nightly sweep) |
| Live recognition feed with filters | FR-15, FR-17 | `routes/feed.ts`, web `/` |
| "My count" over WhatsApp + profile pages with breakdowns | FR-16 | engine `menu_count`, `routes/employees.ts`, web `/people/:id` |
| Plant kiosk board + weekly printable | FR-18 | `routes/board.ts`, web `/board`, `/board/print` |
| Recipient notified on WhatsApp, in their language | FR-19 | `modules/notifications.ts` |
| Monday weekly digest (text preview locally) | FR-20 | `modules/digest/digest.ts`, admin digest preview |
| Approved templates for messages outside the 24-h window | FR-21 | `modules/whatsapp/metaCloud.ts` `sendTemplate` |
| Moderation: all recognitions, flag queue, remove-with-reason | FR-22 | `routes/admin.ts`, web `/admin` Moderation tab |
| Programme settings + behaviour labels editable at runtime | FR-23 | `modules/settings.ts`, `routes/admin.ts`, Settings/Behaviours tabs |
| Employee enrol / edit / deactivate / manual HRIS sync | FR-24 | `routes/admin.ts`, Employees tab |
| CSV / Excel export of filtered recognitions | FR-25 | `modules/exporter.ts` |
| Participation summary + weekly trend | FR-26 | `modules/analytics/queries.ts`, web `/analytics` |
| Function & shift equity split (floor vs office) | FR-27 | analytics `function-shift` |
| Behaviour breakdown | FR-28 | analytics `behaviours` |
| Direction mix: junior→senior / senior→junior / peer, cross-function | FR-29 | analytics `direction` (level_grade ordering) |
| Dark spots: teams/shifts/sites with zero or bottom-decile activity | FR-30 | analytics `dark-spots` |
| Concentration: top givers/recipients, top-10% giver share | FR-31 | analytics `concentration` |
| No self-recognition | BR-1 | `rules.ts` `checkSelf` |
| Max 2 per giver→recipient per IST month (configurable 1–10) | BR-2 | `rules.ts` `checkCap` |
| Reason quality gate: min length + generic-phrase blocklist | BR-3 | `rules.ts` `checkReason` |
| Soft delete only; removed items keep their audit trail | BR-6 | `routes/admin.ts` remove flow |
| Every admin mutation & export audited | FRD §7 | `modules/audit.ts`, Audit tab |
| Company-email OTP login, roles, rate limits, idle/absolute session expiry | arch §3.4 | `modules/auth/**`, `middleware/**` |

## What's stubbed, and how to turn it on

Every integration ships with **real production code** plus a local/demo
default. Flipping each one is configuration (and, where an AWS SDK is
involved, one `npm i` + un-comment).

### 1. WhatsApp — Meta Cloud API (or a BSP)

Local default `WHATSAPP_PROVIDER=simulator` (in-app phone). For real
WhatsApp:

```env
WHATSAPP_PROVIDER=meta
META_WA_API_VERSION=v20.0
META_WA_PHONE_NUMBER_ID=<from Meta developer console>
META_WA_TOKEN=<system-user permanent access token>
META_WA_APP_SECRET=<app secret — verifies webhook signatures>
META_WA_VERIFY_TOKEN=<any random string; paste the same into Meta>
```

The full Cloud API client already exists (`modules/whatsapp/metaCloud.ts`)
and the webhook (`routes/webhook.ts`) handles Meta's GET handshake and
signature verification — no code changes. You still need Meta business
verification, a webhook subscription and **approved message templates**
(`recognition_received`, `weekly_digest`) — lead times and steps in
`deploy/README-deploy.md` §2a/§8. Using a BSP (Gupshup/Wati/Twilio) instead
only replaces the transport in `modules/whatsapp/`.

### 2. DarwinBox HRIS sync

Local default `DARWINBOX_ENABLED=false` (seeded demo directory; the admin
"Sync from DarwinBox" button reports demo mode). For real sync:

```env
DARWINBOX_ENABLED=true
DARWINBOX_BASE_URL=https://<tenant>.darwinbox.in
DARWINBOX_API_KEY=<api key>
DARWINBOX_CLIENT_ID=<oauth client id>
DARWINBOX_CLIENT_SECRET=<oauth client secret>
DARWINBOX_DATASET_ID=<employee dataset id>
```

The client (`modules/sync/darwinbox.ts`) upserts by employee code and
deactivates leavers while keeping their history (FR-4). Runs nightly
(`SYNC_CRON`, 02:30 IST default) and on demand from the console. DarwinBox
must allowlist your egress IP — see `deploy/README-deploy.md` §9.

### 3. Email — SMTP or Amazon SES

Local default `EMAIL_PROVIDER=console` (OTP printed to terminal + login
page). Company SMTP — works immediately, real nodemailer code:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gainwellengineering.com
SMTP_PORT=587
SMTP_USER=no-reply@gainwellengineering.com
SMTP_PASS=<password>
SMTP_SECURE=false
```

Amazon SES (production on AWS, sends via the runtime IAM role):

```env
EMAIL_PROVIDER=ses
AWS_REGION=ap-south-1
```

plus `npm i @aws-sdk/client-ses -w server` and activate the commented SES
block in `server/src/modules/auth/mailer.ts`. Outside console mode the OTP
is **never** echoed to the login page.

### 4. PostgreSQL (instead of SQLite)

```env
DATABASE_CLIENT=pg
DATABASE_URL=postgres://champ:<password>@<host>:5432/champ
```

Migrations run automatically at boot on either engine. For a local
PostgreSQL, `deploy/docker-compose.yml` has a ready `--profile postgres`
service.

### 5. AWS Secrets Manager (production secrets)

```env
AWS_SECRETS_ENABLED=true
AWS_SECRETS_ID=champ-spot-tool/production
AWS_REGION=ap-south-1
```

plus `npm i @aws-sdk/client-secrets-manager -w server`, swap the stub for
the commented production implementation in
`server/src/aws/secretsManager.ts`, and uncomment the
`loadAwsSecretsIntoEnv()` / `rebuildConfig()` call at the top of
`server/src/index.ts`. The app then pulls every secret from one JSON secret
at boot — nothing sensitive in `.env` or the image (arch §3.5). Terraform
for the whole stack: `deploy/aws/`.

## Configuration reference

All settings, with their zero-config defaults (mirrors `.env.example` — the
app runs with no `.env` at all):

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables strict secret check, disables simulator by default |
| `PORT` | `8080` | API/server port |
| `SESSION_SECRET` | dev placeholder | Cookie signing secret — **required in production** (boot refuses the default) |
| `SESSION_IDLE_MINUTES` | `60` | Console session idle timeout |
| `SESSION_ABSOLUTE_HOURS` | `12` | Console session absolute lifetime |
| `DISPLAY_TIMEZONE` | `Asia/Kolkata` | Calendar/display timezone (IST) |
| `DATABASE_CLIENT` | `better-sqlite3` | `better-sqlite3` or `pg` |
| `SQLITE_FILE` | `./data/champ.sqlite3` | SQLite path (relative to repo root) |
| `DATABASE_URL` | — | PostgreSQL connection string (required when client is `pg`) |
| `ALLOWED_EMAIL_DOMAIN` | `gainwellengineering.com` | Only this domain may request a console OTP |
| `ADMIN_EMAILS` | `hr.admin@gainwellengineering.com` | Comma-separated admin allowlist (upserted at boot) |
| `COMMITTEE_EMAILS` | `rnr.committee@gainwellengineering.com` | Comma-separated committee allowlist |
| `OTP_TTL_MINUTES` | `10` | OTP validity window |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong-code attempts before the OTP dies |
| `EMAIL_PROVIDER` | `console` | `console` \| `smtp` \| `ses` |
| `EMAIL_FROM` | `no-reply@gainwellengineering.com` | From address for OTP/digest mail |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | — / `587` / — / — / `false` | SMTP settings (provider `smtp`) |
| `WHATSAPP_PROVIDER` | `simulator` | `simulator` \| `meta` |
| `META_WA_API_VERSION` | `v20.0` | Graph API version |
| `META_WA_PHONE_NUMBER_ID` | — | WhatsApp business phone number id |
| `META_WA_TOKEN` | — | Permanent system-user access token |
| `META_WA_APP_SECRET` | — | Verifies `X-Hub-Signature-256` on the webhook |
| `META_WA_VERIFY_TOKEN` | `champ-verify-token` | Webhook GET-handshake token |
| `DARWINBOX_ENABLED` | `false` | Enable the real HRIS sync |
| `DARWINBOX_BASE_URL` / `DARWINBOX_API_KEY` / `DARWINBOX_CLIENT_ID` / `DARWINBOX_CLIENT_SECRET` / `DARWINBOX_DATASET_ID` | — | DarwinBox tenant + credentials |
| `BOARD_TOKEN` | unset (open) | If set, `/board` requires `?token=<value>` (kiosk lockdown) |
| `ENABLE_SIMULATOR` | on outside production | Force the simulator API/page on or off |
| `SYNC_CRON` | `30 2 * * *` | DarwinBox sync schedule (IST) |
| `FLAGSCAN_CRON` | `15 3 * * *` | Nightly flag sweep schedule (IST) |
| `DIGEST_CRON` | `0 9 * * 1` | Weekly digest schedule (IST, Monday 09:00) |
| `AWS_REGION` | — | AWS region for SES / Secrets Manager (`ap-south-1`) |
| `AWS_SECRETS_ENABLED` | `false` | Load secrets from AWS Secrets Manager at boot |
| `AWS_SECRETS_ID` | — | Name/ARN of the JSON secret to load |

Programme rules (cap, reason minimum length, generic-phrase blocklist, flag
thresholds, digest toggle) are **runtime settings**, editable in Admin →
Settings (FR-23) — not environment variables.

## Project structure

```
champ-spot-tool/
├─ package.json                 # npm workspaces: server + web; dev/build/typecheck scripts
├─ .env.example                 # every setting documented; safe defaults for all
├─ SPEC.md                      # internal build contract (module interfaces, API shapes)
├─ server/
│  └─ src/
│     ├─ index.ts               # Express bootstrap: webhook → json → api routes → static web
│     ├─ config.ts              # env → typed config (rebuildable after secrets load)
│     ├─ types.ts               # shared domain types
│     ├─ scheduler.ts           # node-cron (IST): HRIS sync · flag sweep · weekly digest
│     ├─ aws/secretsManager.ts  # Secrets Manager loader (real impl commented, stub active)
│     ├─ db/                    # knex init, IST time helpers, migrations, demo seed
│     ├─ middleware/            # error envelope, requireAuth/requireRole, rate limits
│     ├─ modules/
│     │  ├─ conversation/       # WhatsApp state machine + i18n (en/hi/bn)
│     │  ├─ whatsapp/           # provider seam: simulator store + real Meta Cloud client
│     │  ├─ rules/              # BR-1/2/3 checks + createRecognition service
│     │  ├─ flags/              # burst/loop detection + nightly sweep (BR-5)
│     │  ├─ sync/               # DarwinBox directory sync (FR-1)
│     │  ├─ digest/             # weekly digest builder/sender (FR-20)
│     │  ├─ auth/               # OTP, mailer (console/smtp/ses), JWT session
│     │  ├─ analytics/          # FR-26…31 aggregation queries
│     │  └─ …                   # audit, exporter, notifications, settings
│     └─ routes/                # auth, feed, employees, admin, analytics, board,
│                               # webhook (raw-body HMAC), simulator (dev only)
├─ web/                         # React 18 + Vite console
│  └─ src/                      # login, feed, people, analytics, admin, board,
│                               # board/print, simulator phone
└─ deploy/
   ├─ Dockerfile                # multi-stage build → lean non-root runtime image
   ├─ docker-compose.yml        # app + optional postgres profile
   ├─ aws/                      # reference Terraform (ap-south-1): ECR, App Runner,
   │                            # RDS, Secrets Manager, IAM — REVIEW BEFORE APPLYING
   └─ README-deploy.md          # AWS runbook (incl. WhatsApp template lead times)
```

## Acceptance criteria checklist (FRD §9)

How to verify each, on the local demo unless noted:

- [x] **Give in under a minute** — enrolled employee sends `hi` and completes
  a recognition through menu → person → behaviour → reason (simulator
  walkthrough above). Unknown numbers get a courteous enrolment message, no
  crash, no state.
- [x] **Self-recognition impossible** — giver excluded from search; rules
  engine rejects it regardless of channel.
- [x] **Monthly pair cap enforced** — third recognition of the same person in
  an IST calendar month is blocked with the CHAMP-of-the-Month nudge; cap
  editable 1–10 in Settings.
- [x] **Reason quality gate** — too-short and blocklisted-generic reasons are
  re-prompted in place; no row is written; minimum length and blocklist
  editable in Settings.
- [x] **Recipient notified** — notification composed in the recipient's own
  language (en/hi/bn); visible as a distinct bubble in the simulator, sent
  as an approved template in production.
- [x] **Live feed** — new recognition appears on `/` within the 15 s poll;
  filters by function, site, behaviour, person and date range; flagged items
  remain visible until a human removes them.
- [x] **Profiles & my count** — `/people/:id` shows received/given totals and
  behaviour breakdown; “My count” works over WhatsApp.
- [x] **Plant board** — `/board` runs full-screen on a kiosk, auto-refreshes
  every 20 s, optional `BOARD_TOKEN` lockdown; `/board/print` produces the
  weekly printable.
- [x] **Console access control** — OTP to company-domain email only; employee
  vs committee vs admin capabilities enforced server-side; sessions expire
  idle (60 min) and absolutely (12 h); OTP requests rate-limited.
- [x] **Moderation** — burst and loop patterns arrive in the flag queue with
  details (seeded examples included); dismissing restores status; removal
  requires a reason, is soft (history + audit preserved) and hides the card
  from feed/board/analytics.
- [x] **Runtime settings** — cap, reason gate, blocklist, flag thresholds and
  digest toggle change behaviour immediately, no redeploy.
- [x] **Directory lifecycle** — enrol (with DPDP consent flag), edit,
  deactivate (history retained); manual + nightly DarwinBox sync (demo mode
  reports itself honestly when disabled).
- [x] **Export** — filtered CSV and Excel downloads with full giver/recipient/
  behaviour/status detail; every export audited.
- [x] **Analytics FR-26…31** — participation KPIs and weekly trend,
  function/shift equity, behaviour mix, direction mix, dark spots (zeros
  first) and concentration all render on the seeded data.
- [x] **Weekly digest** — Monday 09:00 IST via cron; previewable on demand
  from the admin console.
- [x] **Auditability** — every admin mutation, moderation action, export and
  login lands in the audit log with actor and timestamp.
- [x] **Data residency & privacy posture** — production reference deploys
  entirely in ap-south-1; secrets in a vault; mobile numbers visible only to
  admins; consent tracked for personal numbers.

## Development commands

```bash
npm run dev         # server (tsx watch, :8080) + web (vite, :5173) together
npm run build       # server tsc → server/dist, web vite → web/dist
npm start           # NODE_ENV=production node server/dist/index.js (serves web/dist)
npm run typecheck   # both workspaces, no emit
npm run seed:reset  # wipe + reseed the demo database
```

## Deployment

- **Docker (any host)**: `deploy/Dockerfile` + `deploy/docker-compose.yml`
  (SQLite volume by default, optional postgres profile).
- **AWS (production reference)**: Terraform in `deploy/aws/` — App Runner +
  RDS + Secrets Manager in ap-south-1 — with the full runbook, including SES
  DNS records and the WhatsApp template-approval lead-time warning, in
  [`deploy/README-deploy.md`](deploy/README-deploy.md).
