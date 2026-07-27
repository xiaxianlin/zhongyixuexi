import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { WalletBalanceLookup } from '../auth/tier'
import { NotFoundError } from '../lib/errors'
import { validateAdjustmentInput, type AdjustmentInput } from './validation'

export type { AdjustmentInput } from './validation'

export async function getBalance(pool: Pool, userId: string): Promise<number> {
  const { rows } = await pool.query<{ balance_tokens: string }>(
    'SELECT balance_tokens FROM wallets WHERE user_id = $1',
    [userId],
  )
  return rows[0] ? Number(rows[0].balance_tokens) : 0
}

/** The real WalletBalanceLookup for requireTier — replaces the S9.3 `NO_WALLET_YET` stub now that wallets exist. */
export function createWalletBalanceLookup(pool: Pool): WalletBalanceLookup {
  return { getBalance: (userId) => getBalance(pool, userId) }
}

export interface AdjustmentSummary {
  id: string
  userId: string
  deltaTokens: number
  amountCny: number | null
  note: string | null
  createdBy: string
  createdAt: Date
}

/** WALLET-02: applies one manual top-up/correction — upserts the wallet balance and appends the audit-trail row in one transaction. */
export async function applyBalanceAdjustment(
  pool: Pool,
  userId: string,
  input: AdjustmentInput,
  createdBy: string,
): Promise<{ balance: number }> {
  validateAdjustmentInput(input)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const userExists = await client.query('SELECT 1 FROM users WHERE id = $1', [userId])
    if (userExists.rowCount === 0) throw new NotFoundError('user not found')

    await client.query(
      `INSERT INTO wallets (user_id, balance_tokens)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET balance_tokens = wallets.balance_tokens + EXCLUDED.balance_tokens,
             updated_at = now()`,
      [userId, input.deltaTokens],
    )
    await client.query(
      `INSERT INTO balance_adjustments (id, user_id, delta_tokens, amount_cny, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        userId,
        input.deltaTokens,
        input.amountCny ?? null,
        input.note?.trim() || null,
        createdBy,
      ],
    )

    const { rows } = await client.query<{ balance_tokens: string }>(
      'SELECT balance_tokens FROM wallets WHERE user_id = $1',
      [userId],
    )
    await client.query('COMMIT')
    return { balance: Number(rows[0]!.balance_tokens) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listAdjustments(pool: Pool, userId: string): Promise<AdjustmentSummary[]> {
  const { rows } = await pool.query<{
    id: string
    user_id: string
    delta_tokens: string
    amount_cny: string | null
    note: string | null
    created_by: string
    created_at: Date
  }>(
    `SELECT id, user_id, delta_tokens, amount_cny, note, created_by, created_at
     FROM balance_adjustments
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  )
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    deltaTokens: Number(r.delta_tokens),
    amountCny: r.amount_cny !== null ? Number(r.amount_cny) : null,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }))
}
