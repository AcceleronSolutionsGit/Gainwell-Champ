import { config } from './config'
import { sendRecognitionEmail } from './modules/auth/mailer'

async function main() {
  console.log(`[test-mail] Provider:  ${config.email.provider}`)
  console.log(`[test-mail] From:      ${config.email.from}`)
  console.log(`[test-mail] SMTP Host: ${config.email.smtp.host || 'smtp.office365.com'}:${config.email.smtp.port}`)
  console.log(`[test-mail] SMTP User: ${config.email.smtp.user || '(none)'}`)
  console.log(`[test-mail] Secure:    ${config.email.smtp.secure}`)

  const targetEmail = process.argv[2] || 'sabarnik.lahiri@acceleronsolutions.io'
  console.log(`\n[test-mail] Dispatching test recognition email to ${targetEmail}...`)

  await sendRecognitionEmail({
    recipientEmail: targetEmail,
    recipientName: 'Sabarnik Lahiri',
    giverName: 'System Administrator',
    giverEmail: 'admin@gainwellengineering.com',
    managerEmail: 'manager@gainwellengineering.com',
    behaviourName: 'Safety First',
  })

  console.log('\n✅ Test email executed successfully!')
}

main().catch((err) => {
  console.error('\n❌ Test email failed:')
  console.error(err)
  process.exit(1)
})
