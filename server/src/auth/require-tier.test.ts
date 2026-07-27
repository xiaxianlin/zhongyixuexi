import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { registerActorDecoration } from './request-actor'
import { requireTier } from './require-tier'
import { signAuthToken } from './jwt'
import type { WalletBalanceLookup } from './tier'

function buildApp(wallet: WalletBalanceLookup) {
  const app = Fastify()
  registerActorDecoration(app)
  app.get('/original-text', async () => ({ ok: true }))
  app.get('/ai-analysis', { preHandler: requireTier('free_member', wallet) }, async () => ({
    ok: true,
  }))
  app.get('/ai-chat', { preHandler: requireTier('paid_member', wallet) }, async () => ({
    ok: true,
  }))
  return app
}

describe('tiered route access', () => {
  const previousSecret = process.env.JWT_SECRET
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })
  afterAll(() => {
    process.env.JWT_SECRET = previousSecret
  })

  const zeroBalance: WalletBalanceLookup = { getBalance: async () => 0 }
  const positiveBalance: WalletBalanceLookup = { getBalance: async () => 100 }

  it('a guest can read original text but not AI analysis or chat', async () => {
    const app = buildApp(zeroBalance)
    expect((await app.inject({ method: 'GET', url: '/original-text' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/ai-analysis' })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/ai-chat' })).statusCode).toBe(403)
  })

  it('a free member (zero balance) can read analysis but not chat', async () => {
    const app = buildApp(zeroBalance)
    const token = signAuthToken({ sub: 'user-1', role: 'member' })
    const headers = { authorization: `Bearer ${token}` }
    expect((await app.inject({ method: 'GET', url: '/ai-analysis', headers })).statusCode).toBe(
      200,
    )
    expect((await app.inject({ method: 'GET', url: '/ai-chat', headers })).statusCode).toBe(403)
  })

  it('a paid member (positive balance) can chat', async () => {
    const app = buildApp(positiveBalance)
    const token = signAuthToken({ sub: 'user-1', role: 'member' })
    const headers = { authorization: `Bearer ${token}` }
    expect((await app.inject({ method: 'GET', url: '/ai-chat', headers })).statusCode).toBe(200)
  })

  it('an admin always passes regardless of wallet balance', async () => {
    const app = buildApp(zeroBalance)
    const token = signAuthToken({ sub: 'admin-1', role: 'admin' })
    const headers = { authorization: `Bearer ${token}` }
    expect((await app.inject({ method: 'GET', url: '/ai-chat', headers })).statusCode).toBe(200)
  })

  it('an invalid token reads as a guest rather than erroring', async () => {
    const app = buildApp(zeroBalance)
    const headers = { authorization: 'Bearer garbage' }
    expect((await app.inject({ method: 'GET', url: '/ai-analysis', headers })).statusCode).toBe(
      403,
    )
  })
})
