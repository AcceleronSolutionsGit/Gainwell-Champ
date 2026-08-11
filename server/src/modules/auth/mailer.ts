/**
 * Outbound email (OTP codes only, architecture §3.3).
 *
 * Providers (EMAIL_PROVIDER):
 *   - 'console' — local default: pretty-prints the mail (incl. the OTP code)
 *     to the server terminal. The login page additionally shows the devCode
 *     returned by requestOtp() in this mode.
 *   - 'smtp'    — real nodemailer transport using SMTP_* env (works with any
 *     relay: corporate Exchange, SES SMTP interface, Mailgun, …).
 *   - 'ses'     — Amazon SES API. Real code is COMMENTED below because the
 *     project intentionally ships without @aws-sdk/client-ses; the active
 *     stub throws with a pointer to deploy/README-deploy.md.
 *
 * OTP mail is deliberately plain text: transactional one-liners with no HTML
 * score better with spam filters and render everywhere (architecture §3.3).
 */
import nodemailer, { Transporter } from 'nodemailer'
import { config } from '../../config'

let smtpTransporter: Transporter | null = null

function getSmtpTransporter(): Transporter {
  if (!smtpTransporter) {
    const { host, port, user, pass, secure } = config.email.smtp
    if (!host) {
      throw new Error('EMAIL_PROVIDER=smtp requires SMTP_HOST (and usually SMTP_USER/SMTP_PASS)')
    }
    smtpTransporter = nodemailer.createTransport({
      host,
      port,
      secure, // true = implicit TLS (465); false = STARTTLS upgrade on 587
      auth: user ? { user, pass } : undefined,
    })
  }
  return smtpTransporter
}

// ── PRODUCTION (real integration) ─────────────────────────────
// Amazon SES — enabled by EMAIL_PROVIDER=ses after `npm i @aws-sdk/client-ses`
// and verifying the sending domain (SPF + DKIM + DMARC; see
// deploy/README-deploy.md). Runs in ap-south-1 alongside the rest of the
// stack; the App Runner instance role needs ses:SendEmail.
//
// import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
//
// let sesClient: SESClient | null = null
//
// async function sendViaSes(to: string, subject: string, text: string): Promise<void> {
//   if (!sesClient) sesClient = new SESClient({ region: process.env.AWS_REGION ?? 'ap-south-1' })
//   await sesClient.send(
//     new SendEmailCommand({
//       Source: config.email.from,
//       Destination: { ToAddresses: [to] },
//       Message: {
//         Subject: { Data: subject, Charset: 'UTF-8' },
//         Body: { Text: { Data: text, Charset: 'UTF-8' } },
//       },
//     }),
//   )
// }
// ── LOCAL (stub) — active until the SES SDK is installed ─────
function sendViaSes(_to: string, _subject: string, _text: string): Promise<void> {
  throw new Error(
    'EMAIL_PROVIDER=ses requires @aws-sdk/client-ses — uncomment the SES block in ' +
      'server/src/modules/auth/mailer.ts and see deploy/README-deploy.md',
  )
}

/** Send a plain-text mail via the configured provider. */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  switch (config.email.provider) {
    case 'console': {
      const line = '─'.repeat(60)
      console.log(`\n┌${line}`)
      console.log(`│ ✉  [email:console]  (set EMAIL_PROVIDER=smtp for real mail)`)
      console.log(`│ To:      ${to}`)
      console.log(`│ From:    ${config.email.from}`)
      console.log(`│ Subject: ${subject}`)
      console.log(`├${line}`)
      for (const l of text.split('\n')) console.log(`│ ${l}`)
      console.log(`└${line}\n`)
      return
    }
    case 'smtp': {
      await getSmtpTransporter().sendMail({ from: config.email.from, to, subject, text })
      return
    }
    case 'ses': {
      await sendViaSes(to, subject, text)
      return
    }
  }
}

/** The one transactional mail this system sends: the login OTP. */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const subject = `${code} is your Gainwell CHAMP sign-in code`
  const text = [
    `Your Gainwell CHAMP sign-in code is: ${code}`,
    '',
    `It expires in ${config.auth.otpTtlMinutes} minutes and can be used once.`,
    "If you didn't request this code, you can safely ignore this email.",
  ].join('\n')
  await sendMail(email, subject, text)
}
