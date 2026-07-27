import Fastify from 'fastify'
import { closePool, getPool } from './db/connection'
import { runMigrations } from './db/migrate'

const PORT = Number(process.env.PORT ?? 4000)

async function main(): Promise<void> {
  const app = Fastify({ logger: true })

  app.get('/health', async () => ({ status: 'ok' }))

  if (process.env.DATABASE_URL) {
    await runMigrations(getPool())
  } else {
    app.log.warn('DATABASE_URL not set — skipping migrations; DB-backed routes will fail')
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
