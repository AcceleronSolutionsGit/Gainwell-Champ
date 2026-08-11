# CHAMP Spot Tool — AWS deployment runbook

Step-by-step path from this repository to a production deployment in
**ap-south-1 (Mumbai)** — the region is deliberate: recognition text and
employee personal data stay in India (DPDP, architecture §6).

The Terraform under `deploy/aws/` is a **reference implementation — review
before applying**. Adapt names, tags, CIDRs and the state backend to
Gainwell's AWS landing zone before running it against a real account.

> Local/demo deployment needs none of this — see the root `README.md`
> (`npm run dev`) or `deploy/docker-compose.yml`.

---

## 1. Prerequisites

- AWS account with admin (or equivalently scoped) access, region `ap-south-1`
- CLI tools: `aws` (v2, configured), `terraform` >= 1.5, `docker`, `node` 22
- DNS control for `gainwellengineering.com` (SES records, §7)
- Access to Meta Business Manager (WhatsApp, §8) and the DarwinBox admin
  console (§9)

All shell examples run from the repo root. **The local checkout path contains
a space** — keep it quoted: `cd "/Users/…/Claude Code/champ-spot-tool"`.

## 2. Start the long-lead approvals NOW

These are people-and-process gated and can take **days to weeks**. Kick them
off before touching infrastructure.

### 2a. WhatsApp Business Platform — ⚠️ template-approval lead time

The app sends two kinds of messages outside Meta's 24-hour customer-service
window, and those **require pre-approved message templates** (FR-21):

| Template name | Purpose | Suggested category |
|---|---|---|
| `recognition_received` | Notify the recipient of a new recognition (FR-19) | Utility |
| `weekly_digest` | Monday-morning programme digest (FR-20) | Utility |

Lead times to plan for:

1. **Meta Business Verification** — legal documents, typically **2 days to
   2+ weeks**. Nothing else proceeds without it.
2. **Phone number** — a number NOT currently registered on consumer WhatsApp
   (porting an in-use number disconnects it from the app).
3. **Template review** — usually under 48 h per attempt, but rejections
   (formatting, category, placeholder wording) restart the clock. Budget **a
   week of calendar time** and submit templates immediately after
   verification.

Collect for the secret in §6: `META_WA_PHONE_NUMBER_ID`, a **system-user
permanent access token** (`META_WA_TOKEN`), the app secret
(`META_WA_APP_SECRET`), and a random string of your choice for
`META_WA_VERIFY_TOKEN`.

Alternative: a BSP (Gupshup / Wati / Twilio) can shortcut Meta onboarding —
see "What's stubbed" in the root README for what changes (only the transport
in `server/src/modules/whatsapp/`).

### 2b. Amazon SES — production access

New SES accounts start in **sandbox** (can only mail verified addresses).
Request production access in the SES console for `ap-south-1` — typically
approved within 24 h. DNS records come later in §7.

### 2c. DarwinBox — API credentials + IP allowlisting

Request from the DarwinBox account manager: tenant base URL, API key, OAuth
client id/secret, and the employee **dataset id**. DarwinBox allowlists
caller IPs — you will hand them the stack's NAT egress IP after §5 (it is a
Terraform output).

## 3. Enable the AWS code paths (one-time code change)

The repo ships with AWS SDK integrations written but **stubbed**, because the
SDKs are not in the local dependency set. Before building the production
image:

```bash
npm i @aws-sdk/client-secrets-manager @aws-sdk/client-ses -w server
```

then:

1. `server/src/aws/secretsManager.ts` — replace the stub with the
   `PRODUCTION` implementation commented directly above it.
2. `server/src/modules/auth/mailer.ts` — activate the commented SES provider.
3. `server/src/index.ts` — uncomment the `loadAwsSecretsIntoEnv()` /
   `rebuildConfig()` lines at the top of `main()`.

Commit this on a deployment branch. Local development is unaffected — the
loader is a no-op unless `AWS_SECRETS_ENABLED=true`.

## 4. Build the image and push to ECR

Create just the registry first (the App Runner service in §5 needs the image
to exist):

```bash
cd deploy/aws
terraform init
terraform apply -target=aws_ecr_repository.app \
  -var db_password=placeholder -var session_secret=placeholder
cd ../..
```

Build and push (note `-f deploy/Dockerfile`, context = repo root):

```bash
REGION=ap-south-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
TAG=v1   # stamp releases; avoid a moving "latest" in production

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"
docker build -f deploy/Dockerfile -t "champ-spot-tool:$TAG" .
docker tag  "champ-spot-tool:$TAG" "$ECR/champ-spot-tool:$TAG"
docker push "$ECR/champ-spot-tool:$TAG"
```

## 5. Provision the full stack

```bash
cd deploy/aws
export TF_VAR_db_password="$(openssl rand -hex 24)"
export TF_VAR_session_secret="$(openssl rand -hex 32)"
terraform plan  -var image_tag=v1     # READ THE PLAN — this is the review gate
terraform apply -var image_tag=v1
```

Terraform creates: VPC (private RDS subnets + one NAT gateway), encrypted RDS
PostgreSQL, the Secrets Manager secret (arch §3.5), IAM roles, and the App
Runner service pointing at your image. Record the outputs:

- `apprunner_service_url` — the public HTTPS host
- `nat_egress_ip` — for DarwinBox allowlisting (§9)
- `app_secret_name` / `app_secret_arn` — for §6

Notes:

- Terraform **state now contains secrets** (DB password, seeded secret
  version) — use the encrypted S3 backend commented in `main.tf`, never a
  laptop-local state file, for anything beyond a sandbox.
- The database schema is applied automatically: the app runs its knex
  migrations at boot.

## 6. Populate the application secret

Terraform seeded `champ-spot-tool/production` with a working skeleton
(DATABASE_URL, SESSION_SECRET, EMAIL_PROVIDER=ses) and **placeholders** for
WhatsApp and DarwinBox. Fill the real values in as the §2 approvals land —
Terraform will not overwrite them (`ignore_changes` on the secret version):

```bash
aws secretsmanager get-secret-value --secret-id champ-spot-tool/production \
  --query SecretString --output text > /tmp/champ-secret.json
# edit /tmp/champ-secret.json: set WHATSAPP_PROVIDER=meta, META_WA_*,
# DARWINBOX_ENABLED=true + DARWINBOX_*, optionally BOARD_TOKEN…
aws secretsmanager put-secret-value --secret-id champ-spot-tool/production \
  --secret-string file:///tmp/champ-secret.json
rm /tmp/champ-secret.json
```

The app reads the secret **once at boot** — after changing it, redeploy or
restart the App Runner service to pick the new values up.

## 7. SES — verify the domain and publish DNS records

In the SES console (ap-south-1): **Verified identities → Create identity →
Domain** for `gainwellengineering.com`, with **Easy DKIM** and a **custom
MAIL FROM domain** (`mail.gainwellengineering.com`). Then publish at the DNS
provider:

| Record | Host | Type | Value |
|---|---|---|---|
| DKIM ×3 | `<token1..3>._domainkey.gainwellengineering.com` | CNAME | `<token1..3>.dkim.amazonses.com` (tokens from the SES console) |
| MAIL FROM MX | `mail.gainwellengineering.com` | MX | `10 feedback-smtp.ap-south-1.amazonses.com` |
| SPF (MAIL FROM) | `mail.gainwellengineering.com` | TXT | `"v=spf1 include:amazonses.com ~all"` |
| DMARC | `_dmarc.gainwellengineering.com` | TXT | `"v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@gainwellengineering.com"` |

Wait for SES to show the identity as **Verified** (minutes to a few hours
after DNS propagates). The OTP mail is deliberately plain text — better
deliverability for time-sensitive codes (arch §3.3). The IAM instance role
already carries `ses:SendEmail`; no SMTP credentials are involved.

If IT prefers the corporate SMTP relay instead of SES, set
`EMAIL_PROVIDER=smtp` + `SMTP_*` in the secret — no code change needed.

## 8. WhatsApp go-live (webhook + templates)

Once §2a credentials are in the secret and the service is redeployed with
`WHATSAPP_PROVIDER=meta`:

1. In the Meta app dashboard → WhatsApp → **Configuration**, set:
   - Callback URL: `https://<apprunner_service_url>/webhook/whatsapp`
   - Verify token: the `META_WA_VERIFY_TOKEN` value from the secret
   Meta performs the GET handshake against the running service — it must be
   deployed first.
2. Subscribe the webhook to the **`messages`** field.
3. Confirm both templates (`recognition_received`, `weekly_digest`) show
   **Approved** — recipient notifications and digests silently depend on
   them (FR-19/20/21).
4. Send `hi` to the business number from an enrolled phone and complete a
   recognition end-to-end.

The webhook rejects payloads whose `X-Hub-Signature-256` does not match
`META_WA_APP_SECRET` — if Meta's test pings fail, check that value first.

## 9. DarwinBox go-live

1. Give DarwinBox the `nat_egress_ip` Terraform output for their allowlist
   (all app egress leaves through that one IP).
2. Set `DARWINBOX_ENABLED=true` + the `DARWINBOX_*` values in the secret;
   redeploy.
3. Trigger a manual sync from the admin console (Employees → “Sync from
   DarwinBox”) and review the upserted/deactivated counts. The nightly sync
   then runs on the `SYNC_CRON` schedule (02:30 IST by default).

## 10. Smoke checks and rolling out updates

After any deploy:

```bash
curl https://<apprunner_service_url>/api/health
# → { "ok": true, "env": "production", "whatsapp": "meta", "email": "ses" }
```

- Web console loads at `https://<apprunner_service_url>/`, OTP mail arrives,
  committee/admin roles land on the right tabs.
- `/board` renders on a plant kiosk (append `?token=…` if `BOARD_TOKEN` set).
- App Runner health checks hit `/api/health` — a container that cannot reach
  RDS or refuses to boot never receives traffic.

Updates: build + push a **new** tag (§4), then
`terraform apply -var image_tag=v2` (auto-deployments are disabled on
purpose; the image tag is the release lever).

## 11. Environments: dev / staging / prod (arch §7)

- **dev** — laptops: `npm run dev`, SQLite, simulator, console OTP. No AWS.
- **staging** — a second copy of this stack (`-var environment=staging`, its
  own `terraform workspace`, own secret `champ-spot-tool/staging`, smaller
  everything). Use a Meta **test number** so template experiments never touch
  the production number's quality rating.
- **prod** — this runbook. Keep `deletion_protection` on RDS, 7-day backups,
  and the S3 state backend.

Keep the three secrets strictly separate; nothing in the app distinguishes
environments except the values it is handed.
