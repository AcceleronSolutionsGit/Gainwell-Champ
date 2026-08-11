/**
 * AWS Secrets Manager loader — architecture §3.5 (secrets vault).
 *
 * In production on AWS, secrets (DATABASE_URL, SESSION_SECRET, the WhatsApp
 * token, SMTP password…) must never live in a .env file baked into the image.
 * Instead they are stored as ONE JSON secret in AWS Secrets Manager (created
 * by deploy/aws/main.tf) and loaded into process.env at boot, BEFORE anything
 * reads `config` — see the commented call site in src/index.ts, which follows
 * up with `rebuildConfig()` so the freshly loaded values take effect.
 *
 * The runtime IAM role (App Runner instance role, deploy/aws/main.tf) grants
 * `secretsmanager:GetSecretValue` on exactly that secret, so no AWS keys are
 * needed in the environment — the SDK default credential chain finds the role.
 *
 * Env contract:
 *   AWS_SECRETS_ENABLED=true            → load the secret (anything else: no-op)
 *   AWS_SECRETS_ID=champ-spot-tool/production   → the secret name or full ARN
 *   AWS_REGION=ap-south-1               → region (DPDP residency, architecture §6)
 */

/** Mirrors the truthiness rules used by config.ts for boolean env vars. */
function secretsEnabled(): boolean {
  const v = (process.env.AWS_SECRETS_ENABLED ?? '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(v)
}

// ── PRODUCTION (real integration) ────────────────────────────────────────────
// The AWS SDK is intentionally NOT shipped in the local dependency set. To
// enable, run:
//
//     npm i @aws-sdk/client-secrets-manager -w server
//
// then replace the stub below with this implementation (and uncomment the
// call in src/index.ts). Full runbook: deploy/README-deploy.md.
//
// import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
//
// export async function loadAwsSecretsIntoEnv(): Promise<void> {
//   if (!secretsEnabled()) return // local/dev: .env + process.env are the source of truth
//
//   const secretId = process.env.AWS_SECRETS_ID
//   if (!secretId) {
//     throw new Error('AWS_SECRETS_ENABLED=true but AWS_SECRETS_ID is not set')
//   }
//
//   const client = new SecretsManagerClient({
//     region: process.env.AWS_REGION ?? 'ap-south-1', // DPDP residency default
//   })
//   const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
//
//   // Secrets Manager returns either a string or (rarely) binary — handle both.
//   const raw =
//     out.SecretString ??
//     (out.SecretBinary ? Buffer.from(out.SecretBinary).toString('utf8') : undefined)
//   if (!raw) throw new Error(`Secret "${secretId}" is empty`)
//
//   let parsed: unknown
//   try {
//     parsed = JSON.parse(raw)
//   } catch {
//     throw new Error(`Secret "${secretId}" is not valid JSON — expected {"KEY":"value",…}`)
//   }
//   if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
//     throw new Error(`Secret "${secretId}" must be a JSON object of env-var keys`)
//   }
//
//   // The vault is authoritative in production: secret keys overwrite any
//   // same-named values already present in the container environment.
//   const entries = Object.entries(parsed as Record<string, unknown>)
//   for (const [key, value] of entries) {
//     if (value === null || value === undefined) continue
//     process.env[key] = String(value)
//   }
//   // Log key NAMES only — never values.
//   console.log(`[secrets] loaded ${entries.length} keys from Secrets Manager (${secretId})`)
// }

// ── LOCAL (stub) — active by default ─────────────────────────────────────────
// A no-op unless AWS_SECRETS_ENABLED=true, in which case it fails fast with
// instructions rather than silently booting without production secrets.

export async function loadAwsSecretsIntoEnv(): Promise<void> {
  if (!secretsEnabled()) return // nothing to do locally — .env already holds config

  throw new Error(
    'AWS_SECRETS_ENABLED=true, but the AWS Secrets Manager client is not installed. ' +
      'Run `npm i @aws-sdk/client-secrets-manager -w server`, swap this stub for the ' +
      'PRODUCTION implementation commented above in server/src/aws/secretsManager.ts, ' +
      'and uncomment the loader call in server/src/index.ts. ' +
      'Runbook: deploy/README-deploy.md ("Populate the application secret").',
  )
}
