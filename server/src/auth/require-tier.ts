import type { FastifyReply, FastifyRequest } from 'fastify'
import { NO_WALLET_YET, meetsTier, resolveAccessTier, type AccessTier, type WalletBalanceLookup } from './tier'

/** Fastify preHandler factory gating a route at a minimum access tier. */
export function requireTier(minTier: AccessTier, wallet: WalletBalanceLookup = NO_WALLET_YET) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const tier = await resolveAccessTier(request.actor, wallet)
    if (!meetsTier(tier, minTier)) {
      await reply.code(403).send({ error: `requires ${minTier} access` })
    }
  }
}
