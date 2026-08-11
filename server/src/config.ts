/**
 * Central configuration for the CHAMP Spot Recognition Tool.
 *
 * Every value has a safe local-development default so the app runs with no
 * .env at all (SQLite + console email + WhatsApp simulator + demo directory).
 *
 * PRODUCTION (AWS): secrets should come from AWS Secrets Manager, not .env —
 * see src/aws/secretsManager.ts and the commented block in src/index.ts.
 */
import dotenv from 'dotenv'
import path from 'path'

/** Repo root (…/champ-spot-tool) — stable from both src/ (tsx) and dist/ (build). */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') })
dotenv.config() // also honour a server-local .env and real environment variables

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === '') return dflt
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())
}

function num(v: string | undefined, dflt: number): number {
  if (v === undefined || v === '') return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

function list(v: string | undefined, dflt: string[]): string[] {
  if (!v) return dflt
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function buildConfig() {
  const env = process.env
  const nodeEnv = env.NODE_ENV ?? 'development'
  const isProd = nodeEnv === 'production'
  return {
    nodeEnv,
    isProd,
    projectRoot: PROJECT_ROOT,
    port: num(env.PORT, 8080),
    /** All calendar logic (monthly cap reset, digests, display) uses IST. */
    timezone: env.DISPLAY_TIMEZONE ?? 'Asia/Kolkata',
    session: {
      secret: env.SESSION_SECRET ?? 'dev-insecure-secret-change-me',
      idleMinutes: num(env.SESSION_IDLE_MINUTES, 60),
      absoluteHours: num(env.SESSION_ABSOLUTE_HOURS, 12),
    },
    db: {
      client: (env.DATABASE_CLIENT ?? 'better-sqlite3') as 'better-sqlite3' | 'pg' | 'mysql2' | 'mysql',
      sqliteFile: path.resolve(PROJECT_ROOT, env.SQLITE_FILE ?? './data/champ.sqlite3'),
      databaseUrl: env.DATABASE_URL ?? '',
    },
    auth: {
      allowedEmailDomains: list(env.ALLOWED_EMAIL_DOMAIN, ['gainwellengineering.com', 'acceleronsolutions.io']),
      adminEmails: list(env.ADMIN_EMAILS, ['hr.admin@gainwellengineering.com', 'sabarnik.lahiri@acceleronsolutions.io']),
      committeeEmails: list(env.COMMITTEE_EMAILS, ['rnr.committee@gainwellengineering.com']),
      otpTtlMinutes: num(env.OTP_TTL_MINUTES, 10),
      otpMaxAttempts: num(env.OTP_MAX_ATTEMPTS, 5),
    },
    email: {
      provider: (env.EMAIL_PROVIDER ?? 'console') as 'console' | 'smtp' | 'ses',
      from: env.EMAIL_FROM ?? 'no-reply@gainwellengineering.com',
      smtp: {
        host: env.SMTP_HOST ?? '',
        port: num(env.SMTP_PORT, 587),
        user: env.SMTP_USER ?? '',
        pass: env.SMTP_PASS ?? '',
        secure: bool(env.SMTP_SECURE, false),
      },
    },
    whatsapp: {
      provider: (env.WHATSAPP_PROVIDER ?? 'simulator') as 'simulator' | 'meta' | 'gallabox',
      meta: {
        apiVersion: env.META_WA_API_VERSION ?? 'v20.0',
        phoneNumberId: env.META_WA_PHONE_NUMBER_ID ?? '',
        accessToken: env.META_WA_TOKEN ?? '',
        appSecret: env.META_WA_APP_SECRET ?? '',
        verifyToken: env.META_WA_VERIFY_TOKEN ?? 'champ-verify-token',
      },
      gallabox: {
        baseUrl: env.GALLABOX_BASE_URL ?? 'https://server.gallabox.com',
        apiKey: env.GALLABOX_API_KEY ?? '',
        apiSecret: env.GALLABOX_API_SECRET ?? '',
        channelId: env.GALLABOX_CHANNEL_ID ?? '',
        webhookSecret: env.GALLABOX_WEBHOOK_SECRET ?? '',
      },
    },
    darwinbox: {
      enabled: bool(env.DARWINBOX_ENABLED, false),
      baseUrl: env.DARWINBOX_BASE_URL ?? '',
      basicAuthUser: env.DARWINBOX_BASIC_AUTH_USER ?? '',
      basicAuthPass: env.DARWINBOX_BASIC_AUTH_PASS ?? '',
      apiKey: env.DARWINBOX_API_KEY ?? '',
      reportId: env.DARWINBOX_REPORT_ID ?? '',
    },
    simulatorEnabled: bool(env.ENABLE_SIMULATOR, !isProd),
    boardToken: env.BOARD_TOKEN || null,
    cron: {
      darwinboxSync: env.SYNC_CRON ?? '30 2 * * *',
      flagScan: env.FLAGSCAN_CRON ?? '15 3 * * *',
      weeklyDigest: env.DIGEST_CRON ?? '0 9 * * 1',
    },
  }
}

export let config = buildConfig()

/**
 * Re-read the environment. Used after AWS Secrets Manager populates
 * process.env in production (see src/aws/secretsManager.ts).
 */
export function rebuildConfig(): void {
  config = buildConfig()
}

/**
 * Fail fast rather than run production with a known signing secret.
 *
 * Deliberately NOT run at module scope: in the AWS deployment SESSION_SECRET
 * lives only in Secrets Manager and reaches process.env via
 * loadAwsSecretsIntoEnv() + rebuildConfig() inside main() — a module-scope
 * throw would fire during import, before that load could ever run. Called
 * from src/index.ts after the (optional) secrets load.
 */
export function assertProductionSecrets(): void {
  if (config.isProd && config.session.secret === 'dev-insecure-secret-change-me') {
    throw new Error(
      'SESSION_SECRET must be set in production (env var, or AWS Secrets Manager — see deploy/README-deploy.md)',
    )
  }
}
