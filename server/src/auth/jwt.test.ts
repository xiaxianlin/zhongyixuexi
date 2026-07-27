import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signAuthToken, verifyAuthToken } from './jwt'

describe('auth token', () => {
  const previousSecret = process.env.JWT_SECRET

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  afterAll(() => {
    process.env.JWT_SECRET = previousSecret
  })

  it('round-trips the payload', () => {
    const token = signAuthToken({ sub: 'user-1', role: 'member' })
    expect(verifyAuthToken(token)).toMatchObject({ sub: 'user-1', role: 'member' })
  })

  it('rejects a tampered token', () => {
    const token = signAuthToken({ sub: 'user-1', role: 'member' })
    expect(() => verifyAuthToken(`${token}tampered`)).toThrow()
  })

  it('throws when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET
    expect(() => signAuthToken({ sub: 'user-1', role: 'member' })).toThrow('JWT_SECRET is not set')
    process.env.JWT_SECRET = 'test-secret'
  })
})
