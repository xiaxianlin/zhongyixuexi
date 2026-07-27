import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { requireTier } from '../auth/require-tier'
import { createWalletBalanceLookup, getBalance, listAdjustments } from '../wallet/repository'

/** WALLET-01: any logged-in member (free or paid) can see their own balance and history — requireTier('free_member') is really just "authenticated". */
export function registerWalletRoutes(app: FastifyInstance, pool: Pool): void {
  const wallet = createWalletBalanceLookup(pool)

  app.get('/wallet', { preHandler: requireTier('free_member', wallet) }, async (request) => {
    const userId = request.actor.userId as string
    const [balance, adjustments] = await Promise.all([
      getBalance(pool, userId),
      listAdjustments(pool, userId),
    ])
    return { balance, adjustments }
  })
}
