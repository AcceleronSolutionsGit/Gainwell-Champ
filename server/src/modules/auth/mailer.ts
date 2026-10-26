/**
 * Outbound email service.
 *
 * Supports:
 *   - 'console' — local development (prints to server terminal with full To, CC, Subject, Body)
 *   - 'smtp'    — Microsoft Outlook (Office 365) / standard corporate SMTP via nodemailer
 *   - 'ses'     — Amazon SES
 */
import nodemailer, { Transporter } from 'nodemailer'
import { config } from '../../config'

let smtpTransporter: Transporter | null = null

function getSmtpTransporter(): Transporter {
  if (!smtpTransporter) {
    const { host, port, user, pass, secure } = config.email.smtp
    const smtpHost = host || 'smtp.office365.com'
    const smtpPort = port || 587

    smtpTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: secure ?? false, // false = STARTTLS upgrade on 587 (Office 365 default)
      auth: user ? { user, pass } : undefined,
      tls: {
        rejectUnauthorized: false,
      },
    })
  }
  return smtpTransporter
}

// ── SES Local Stub ────────────────────────────────────────────────────────────
function sendViaSes(_to: string | string[], _subject: string, _text: string): Promise<void> {
  throw new Error(
    'EMAIL_PROVIDER=ses requires @aws-sdk/client-ses — see deploy/README-deploy.md',
  )
}

export interface MailOptions {
  to: string | string[]
  cc?: string | string[]
  subject: string
  text: string
  html?: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Send mail via the configured provider (console, smtp/Outlook, or ses). */
export async function sendMail(
  toOrOptions: string | MailOptions,
  subjectArg?: string,
  textArg?: string,
): Promise<void> {
  let opts: MailOptions
  if (typeof toOrOptions === 'string') {
    opts = {
      to: toOrOptions,
      subject: subjectArg ?? '',
      text: textArg ?? '',
    }
  } else {
    opts = toOrOptions
  }

  const { to, cc, subject, text, html } = opts
  const toList = Array.isArray(to) ? to.join(', ') : to
  const ccList = cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : ''

  switch (config.email.provider) {
    case 'console': {
      const line = '─'.repeat(60)
      console.log(`\n┌${line}`)
      console.log(`│ ✉  [email:console]  (set EMAIL_PROVIDER=smtp for Microsoft Outlook SMTP)`)
      console.log(`│ To:      ${toList}`)
      if (ccList) {
        console.log(`│ CC:      ${ccList}`)
      }
      console.log(`│ From:    ${config.email.from}`)
      console.log(`│ Subject: ${subject}`)
      console.log(`├${line}`)
      for (const l of text.split('\n')) console.log(`│ ${l}`)
      console.log(`└${line}\n`)
      return
    }
    case 'smtp': {
      const mailPayload: Record<string, unknown> = {
        from: config.email.from,
        to,
        subject,
        text,
      }
      if (cc && (Array.isArray(cc) ? cc.length > 0 : cc.trim())) {
        mailPayload.cc = cc
      }
      if (html) {
        mailPayload.html = html
      }
      await getSmtpTransporter().sendMail(mailPayload)
      return
    }
    case 'ses': {
      await sendViaSes(to, subject, text)
      return
    }
  }
}

/** OTP transactional mail. */
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

/**
 * Recognition notification email sent to the recipient, CCing reporting manager and sender.
 *
 * Subject: Notification from Gainwell Engineering CHAMP
 *
 * Dear Employee Name,
 *
 * Congratulations, you have been recognized by Recognizer Name for embodying the value of Value.
 *
 * Thank you for living our values and setting an example for others around you. Keep up the excellent work!
 *
 * Best regards,
 * Team HCM
 */
export async function sendRecognitionEmail(params: {
  recipientEmail: string
  recipientName: string
  giverName: string
  giverEmail?: string | null
  managerEmail?: string | null
  behaviourName: string
}): Promise<void> {
  const subject = 'Notification from Gainwell Engineering CHAMP'

  const recipientName = params.recipientName.trim()
  const giverName = params.giverName.trim()
  const valueName = params.behaviourName.trim()

  const plainText = [
    `Dear ${recipientName},`,
    '',
    `Congratulations, you have been recognized by ${giverName} for embodying the value of ${valueName}.`,
    '',
    'Thank you for living our values and setting an example for others around you. Keep up the excellent work!',
    '',
    'Best regards,',
    'Team HCM',
  ].join('\n')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      margin: 0;
      padding: 24px;
      background-color: #ffffff;
    }
    p {
      margin: 0 0 16px 0;
      font-size: 15px;
    }
    .signature {
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <p>Dear <strong>${escapeHtml(recipientName)}</strong>,</p>
  <p>Congratulations, you have been recognized by <strong>${escapeHtml(giverName)}</strong> for embodying the value of <strong>${escapeHtml(valueName)}</strong>.</p>
  <p>Thank you for living our values and setting an example for others around you. Keep up the excellent work!</p>
  <div class="signature">
    <p>Best regards,<br/><strong>Team HCM</strong></p>
  </div>
</body>
</html>`

  const cc: string[] = []
  if (params.managerEmail && params.managerEmail.trim()) {
    cc.push(params.managerEmail.trim())
  }
  if (params.giverEmail && params.giverEmail.trim() && !cc.includes(params.giverEmail.trim())) {
    cc.push(params.giverEmail.trim())
  }

  await sendMail({
    to: params.recipientEmail.trim(),
    cc: cc.length > 0 ? cc : undefined,
    subject,
    text: plainText,
    html,
  })
}
