import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { hashPassword } from './password'

/**
 * Invite-only registration has no public signup path, so the very first admin
 * account can't come through /auth/register. If ADMIN_BOOTSTRAP_USERNAME/
 * PASSWORD are set and no admin exists yet, create one; otherwise no-op.
 */
export async function ensureBootstrapAdmin(pool: Pool): Promise<void> {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD
  if (!username || !password) return

  const existingAdmin = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
  if ((existingAdmin.rowCount ?? 0) > 0) return

  const passwordHash = await hashPassword(password)
  await pool.query(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (username) DO NOTHING`,
    [randomUUID(), username, passwordHash],
  )
}
