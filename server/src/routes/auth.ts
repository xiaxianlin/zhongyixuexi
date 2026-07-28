import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { canUseInviteCode } from '../auth/invite-codes'
import { signAuthToken } from '../auth/jwt'
import { hashPassword, verifyPassword } from '../auth/password'

interface RegisterBody {
  inviteCode: string
  username: string
  password: string
}

interface LoginBody {
  username: string
  password: string
}

/** Brute-force/abuse guard tighter than the global default — invite codes and passwords are both guessable in bulk. */
const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }

export function registerAuthRoutes(app: FastifyInstance, pool: Pool): void {
  app.post<{ Body: RegisterBody }>(
    '/auth/register',
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const { inviteCode, username, password } = request.body ?? {}
      if (!inviteCode || !username || !password) {
        return reply.code(400).send({ error: 'inviteCode, username and password are required' })
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        const codeResult = await client.query<{
          id: string
          max_uses: number | null
          use_count: number
          revoked_at: Date | null
        }>('SELECT id, max_uses, use_count, revoked_at FROM invite_codes WHERE code = $1 FOR UPDATE', [
          inviteCode,
        ])
        const codeRow = codeResult.rows[0]
        if (
          !codeRow ||
          !canUseInviteCode({
            maxUses: codeRow.max_uses,
            useCount: codeRow.use_count,
            revokedAt: codeRow.revoked_at,
          })
        ) {
          await client.query('ROLLBACK')
          return reply.code(400).send({ error: 'invite code is invalid, revoked, or exhausted' })
        }

        const existing = await client.query('SELECT id FROM users WHERE username = $1', [username])
        if (existing.rows.length > 0) {
          await client.query('ROLLBACK')
          return reply.code(409).send({ error: 'username already taken' })
        }

        const passwordHash = await hashPassword(password)
        const userId = randomUUID()
        await client.query(
          `INSERT INTO users (id, username, password_hash, role, invited_by_code)
           VALUES ($1, $2, $3, 'member', $4)`,
          [userId, username, passwordHash, codeRow.id],
        )
        await client.query('UPDATE invite_codes SET use_count = use_count + 1 WHERE id = $1', [
          codeRow.id,
        ])

        await client.query('COMMIT')

        return reply.code(201).send({ token: signAuthToken({ sub: userId, role: 'member' }) })
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
  )

  app.post<{ Body: LoginBody }>(
    '/auth/login',
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const { username, password } = request.body ?? {}
      if (!username || !password) {
        return reply.code(400).send({ error: 'username and password are required' })
      }

      const result = await pool.query<{
        id: string
        password_hash: string
        role: 'member' | 'admin'
      }>('SELECT id, password_hash, role FROM users WHERE username = $1', [username])
      const user = result.rows[0]
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return reply.code(401).send({ error: 'invalid credentials' })
      }

      return reply.send({ token: signAuthToken({ sub: user.id, role: user.role }) })
    },
  )
}
