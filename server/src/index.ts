import cors from '@fastify/cors'
import Fastify from 'fastify'
import { ensureBootstrapAdmin } from './auth/bootstrap'
import { registerActorDecoration } from './auth/request-actor'
import { closePool, getPool } from './db/connection'
import { runMigrations } from './db/migrate'
import { registerAdminRoutes } from './routes/admin'
import { registerAuthRoutes } from './routes/auth'
import { registerChatRoutes } from './routes/chat'
import { registerContentRoutes } from './routes/content'
import { registerWalletRoutes } from './routes/wallet'

const PORT = Number(process.env.PORT ?? 4000)

async function main(): Promise<void> {
  const app = Fastify({ logger: true })

  // The web frontend (web/) is a separate origin from this API — auth is
  // Bearer-token based (no cookies), so reflecting the request origin here
  // carries no CSRF risk and avoids hardcoding an allowlist for this small,
  // invite-only deployment.
  await app.register(cors, { origin: true })

  registerActorDecoration(app)

  app.get('/health', async () => ({ status: 'ok' }))

  if (process.env.DATABASE_URL) {
    const pool = getPool()
    await runMigrations(pool)
    await ensureBootstrapAdmin(pool)
    registerAuthRoutes(app, pool)
    registerContentRoutes(app, pool)
    registerAdminRoutes(app, pool)
    registerWalletRoutes(app, pool)
    registerChatRoutes(app, pool)
  } else {
    app.log.warn('DATABASE_URL not set — skipping migrations and DB-backed routes')
  }

  await app.listen({ port: PORT, host: '0.0.0.0' })

  const shutdown = async (): Promise<void> => {
    await app.close()
    await closePool()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
