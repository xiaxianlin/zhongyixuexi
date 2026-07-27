import type { FastifyReply, FastifyRequest } from 'fastify'

/** Fastify preHandler gating a route (or a whole prefix) to the admin role — orthogonal to the member access tiers in tier.ts. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.actor.role !== 'admin') {
    await reply.code(403).send({ error: 'requires admin access' })
  }
}
