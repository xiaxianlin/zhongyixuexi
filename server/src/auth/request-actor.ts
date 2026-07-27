import type { FastifyInstance, FastifyRequest } from 'fastify'
import { verifyAuthToken } from './jwt'
import type { RequestActor } from './tier'

declare module 'fastify' {
  interface FastifyRequest {
    actor: RequestActor
  }
}

const GUEST: RequestActor = { userId: null, role: null }

function extractActor(request: FastifyRequest): RequestActor {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return GUEST
  try {
    const payload = verifyAuthToken(header.slice('Bearer '.length))
    return { userId: payload.sub, role: payload.role }
  } catch {
    // Missing/expired/tampered token reads as an anonymous guest rather than
    // a 401 — routes that require more than guest access reject it via
    // requireTier, but a bad token shouldn't break routes open to everyone.
    return GUEST
  }
}

/** Populates `request.actor` for every request; call once when building the app. */
export function registerActorDecoration(app: FastifyInstance): void {
  // Placeholder default; the preHandler hook below overwrites it on every
  // request before any route handler runs.
  app.decorateRequest('actor', null as unknown as RequestActor)
  app.addHook('preHandler', async (request) => {
    request.actor = extractActor(request)
  })
}
