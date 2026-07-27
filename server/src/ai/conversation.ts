import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { NotFoundError } from '../lib/errors'
import type { ChatMessage } from './types'

/** Validates ownership if `conversationId` is given, otherwise starts a new conversation — must run inside the caller's transaction. */
export async function getOrCreateConversation(
  client: PoolClient,
  userId: string,
  conversationId: string | undefined,
): Promise<string> {
  if (conversationId) {
    const { rowCount } = await client.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2',
      [conversationId, userId],
    )
    if (rowCount === 0) throw new NotFoundError('conversation not found')
    return conversationId
  }
  const id = randomUUID()
  await client.query('INSERT INTO conversations (id, user_id) VALUES ($1, $2)', [id, userId])
  return id
}

export async function insertMessage(
  client: PoolClient,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  await client.query(
    'INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)',
    [randomUUID(), conversationId, role, content],
  )
}

export async function touchConversation(client: PoolClient, conversationId: string): Promise<void> {
  await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId])
}

/** Read-only — safe to call outside a transaction. */
export async function loadHistory(
  pool: Pool,
  conversationId: string,
  limit = 20,
): Promise<ChatMessage[]> {
  const { rows } = await pool.query<{ role: 'user' | 'assistant'; content: string }>(
    `SELECT role, content FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, limit],
  )
  return rows.map((r) => ({ role: r.role, content: r.content }))
}
