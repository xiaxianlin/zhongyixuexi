import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { registerActorDecoration } from './request-actor'
import { requireAdmin } from './require-admin'
import { signAuthToken } from './jwt'

function buildApp() {
  const app = Fastify()
  registerActorDecoration(app)
  app.get('/admin-only', { preHandler: requireAdmin }, async () => ({ ok: true }))
  return app
}

describe('requireAdmin', () => {
  const previousSecret = process.env.JWT_SECRET
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })
  afterAll(() => {
    process.env.JWT_SECRET = previousSecret
  })

  it('rejects a guest', async () => {
    const app = buildApp()
    expect((await app.inject({ method: 'GET', url: '/admin-only' })).statusCode).toBe(403)
  })

  it('rejects a regular member', async () => {
    const app = buildApp()
    const token = signAuthToken({ sub: 'user-1', role: 'member' })
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('allows an admin', async () => {
    const app = buildApp()
    const token = signAuthToken({ sub: 'admin-1', role: 'admin' })
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
  })
})
