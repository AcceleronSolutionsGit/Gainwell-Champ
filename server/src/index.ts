/**
 * Gainwell CHAMP · Spot Recognition Tool — application entry point.
 *
 * One service (architecture §1): WhatsApp webhook + conversation engine,
 * rules engine, feed/profile API, admin & moderation console API, analytics,
 * scheduled jobs, and (in production) the built web console as static files.
 */
import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'path'
import fs from 'fs'
import http from 'http'
import { assertProductionSecrets, config } from './config'
import { initDb, closeDb } from './db/knex'
import { seedIfEmpty, upsertAdminUsers } from './db/seed/demo'
import { errorHandler } from './middleware/errorHandler'
import { startScheduler } from './scheduler'
import authRouter from './routes/auth'
import feedRouter from './routes/feed'
import employeesRouter from './routes/employees'
import adminRouter from './routes/admin'
import analyticsRouter from './routes/analytics'
import boardRouter from './routes/board'
import webhookRouter from './routes/webhook'
import gallaboxWebhookRouter from './routes/gallaboxWebhook'
import simulatorRouter from './routes/simulator'

async function main(): Promise<void> {
  // ── AWS Secrets Manager (production only) ──────────────────────────────────
  // On AWS, load every secret (DB URL, WhatsApp token, SMTP password…) into
  // process.env from Secrets Manager BEFORE anything reads config, then
  // rebuild it. Requires `npm i @aws-sdk/client-secrets-manager` and
  // AWS_SECRETS_ENABLED=true — see src/aws/secretsManager.ts.
  //
  // const { loadAwsSecretsIntoEnv } = await import('./aws/secretsManager')
  // await loadAwsSecretsIntoEnv()
  // rebuildConfig() // ← import { rebuildConfig } from './config'

  // Fail fast on a missing signing secret — checked HERE (after the optional
  // vault load above) so Secrets Manager can be the sole source of
  // SESSION_SECRET, per deploy/README-deploy.md §3.
  assertProductionSecrets()

  const db = await initDb()
  await seedIfEmpty(db)
  await upsertAdminUsers(db)

  const app = express()
  app.set('trust proxy', 1) // behind an ALB / App Runner in production

  // The WhatsApp webhooks must be mounted BEFORE global body parsing where needed
  app.use('/webhook/whatsapp', webhookRouter)
  app.use('/webhook/gallabox', gallaboxWebhookRouter)

  app.use(express.json({ limit: '256kb' }))
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: config.nodeEnv, whatsapp: config.whatsapp.provider, email: config.email.provider })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/feed', feedRouter)
  app.use('/api/employees', employeesRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/analytics', analyticsRouter)
  app.use('/api/board', boardRouter)
  if (config.simulatorEnabled) {
    // Dev-only in-app WhatsApp phone — exercises the same conversation engine.
    app.use('/api/dev/simulator', simulatorRouter)
  }

  // Serve the built web console when it exists (production / `npm run build`).
  // In development the web app runs on Vite (port 5173) and proxies /api here.
  const webDist = path.join(config.projectRoot, 'web', 'dist')
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/')) return next()
      res.sendFile(path.join(webDist, 'index.html'))
    })
  }

  app.use(errorHandler)

  startScheduler()

  const server = http.createServer(app)
  server.listen(config.port, () => {
    console.log(`[champ] listening on http://localhost:${config.port} (${config.nodeEnv})`)
    console.log(`[champ] whatsapp=${config.whatsapp.provider} email=${config.email.provider} db=${config.db.client}`)
    if (config.simulatorEnabled) console.log('[champ] WhatsApp simulator API enabled at /api/dev/simulator')
  })

  const shutdown = async (signal: string) => {
    console.log(`[champ] ${signal} — shutting down`)
    server.close()
    await closeDb()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('[champ] fatal boot error:', err)
  process.exit(1)
})
