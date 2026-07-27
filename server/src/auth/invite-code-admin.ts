/** AUTH-04 — admin CRUD over invite codes. Member-facing consumption (canUseInviteCode) stays in invite-codes.ts. */
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { NotFoundError, ValidationError } from '../lib/errors'

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505'
}

export interface CreateInviteCodeInput {
  code: string
  maxUses?: number | null
  note?: string | null
}

export async function createInviteCode(
  pool: Pool,
  input: CreateInviteCodeInput,
  createdBy: string,
): Promise<{ id: string; code: string }> {
  const code = input.code.trim()
  if (!code) throw new ValidationError('code is required')
  const id = randomUUID()
  try {
    await pool.query(
      'INSERT INTO invite_codes (id, code, max_uses, note, created_by) VALUES ($1, $2, $3, $4, $5)',
      [id, code, input.maxUses ?? null, input.note?.trim() || null, createdBy],
    )
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError('invite code already exists')
    throw err
  }
  return { id, code }
}

export interface InviteCodeSummary {
  id: string
  code: string
  maxUses: number | null
  useCount: number
  note: string | null
  createdAt: Date
  revokedAt: Date | null
}

export async function listInviteCodes(pool: Pool): Promise<InviteCodeSummary[]> {
  const { rows } = await pool.query<{
    id: string
    code: string
    max_uses: number | null
    use_count: number
    note: string | null
    created_at: Date
    revoked_at: Date | null
  }>(
    `SELECT id, code, max_uses, use_count, note, created_at, revoked_at
     FROM invite_codes
     ORDER BY created_at DESC`,
  )
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    maxUses: r.max_uses,
    useCount: r.use_count,
    note: r.note,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  }))
}

export async function revokeInviteCode(pool: Pool, id: string): Promise<void> {
  const result = await pool.query(
    'UPDATE invite_codes SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [id],
  )
  if (result.rowCount === 0) throw new NotFoundError('invite code not found or already revoked')
}
