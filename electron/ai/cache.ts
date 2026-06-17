/**
 * ai_cache read/write (S5.2 / 07-ai.md §4.1, §6).
 *
 * Hit strategy: an entry is a hit when scope_id + kind + prompt_hash match and
 * invalidated=0. prompt_hash = sha256(normalized_prompt + model + temperature)
 * — normalization strips whitespace differences so trivial reformatting doesn't
 * cause cache misses, while a real content edit (paragraph text changed) yields
 * a different user-prompt and thus a different hash. Manual invalidation sets
 * invalidated=1 on old rows (soft, preserves history for audit/rollback) rather
 * than deleting them.
 *
 * The hash + normalization are pure exports so they can be unit-tested without
 * a database (better-sqlite3 won't load under vitest/node ABI mismatch).
 */
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import type { ChatMessage } from './types'

export type AiCacheScope = 'paragraph' | 'chapter' | 'global' | 'book'
export type AiCacheKind = 'modern' | 'qa' | 'annotation'

export interface AiCacheWrite {
  scope: AiCacheScope
  scopeId: string
  kind: AiCacheKind
  paragraphId: string | null
  promptHash: string
  response: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  meta?: Record<string, unknown> | null
}

export interface AiCacheHit {
  id: string
  response: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  createdAt: number
  meta: Record<string, unknown> | null
}

/**
 * Normalize a prompt string for hashing: trim, collapse runs of whitespace to a
 * single space, unify CRLF/CR → LF. This makes the hash robust to indentation
 * changes while remaining sensitive to actual content edits.
 *
 * Pure — exported for unit testing.
 */
export function normalizePrompt(s: string): string {
  return (s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Compute the cache key hash for a prompt.
 *
 * hash = sha256( normalized(messages joined) + '\x00' + model + '\x00' + temp )
 *
 * Including model + temperature means swapping models or temps won't false-hit
 * an entry generated under different settings (07-ai.md §4.1, open Q5).
 *
 * Pure — exported for unit testing.
 */
export function computePromptHash(
  messages: ChatMessage[],
  model: string,
  temperature: number,
): string {
  // System+user are joined role-tagged so reordering changes the hash.
  const joined = messages.map((m) => `[${m.role}]\n${m.content}`).join('\n---\n')
  const blob = `${normalizePrompt(joined)}\x00${model}\x00${temperature}`
  return createHash('sha256').update(blob, 'utf8').digest('hex')
}

/** Look up an un-invalidated cache entry by (scopeId, kind, promptHash). */
export function findCache(
  scopeId: string,
  kind: AiCacheKind,
  promptHash: string,
): AiCacheHit | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, response, model, prompt_tokens, completion_tokens, total_tokens,
              created_at, meta
       FROM ai_cache
       WHERE scope_id = ? AND kind = ? AND prompt_hash = ? AND invalidated = 0
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(scopeId, kind, promptHash) as
    | {
        id: string
        response: string
        model: string
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
        created_at: number
        meta: string | null
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    response: row.response,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
    meta: row.meta ? (JSON.parse(row.meta) as Record<string, unknown>) : null,
  }
}

/** Persist a generation result. Returns the stored row id. */
export function writeCache(entry: AiCacheWrite): string {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO ai_cache
       (id, scope, scope_id, kind, paragraph_id, prompt_hash, response, model,
        prompt_tokens, completion_tokens, total_tokens, created_at, invalidated, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    id,
    entry.scope,
    entry.scopeId,
    entry.kind,
    entry.paragraphId,
    entry.promptHash,
    entry.response,
    entry.model,
    entry.promptTokens,
    entry.completionTokens,
    entry.totalTokens,
    now,
    entry.meta ? JSON.stringify(entry.meta) : null,
  )
  return id
}

/**
 * Invalidate (soft) all entries under a scope_id+kind. Used by "regenerate":
 * old rows are flagged invalidated=1 (preserved for history) so the next
 * generation writes a fresh row.
 */
export function invalidateCache(scopeId: string, kind: AiCacheKind): number {
  const db = getDb()
  const res = db
    .prepare(
      `UPDATE ai_cache SET invalidated = 1
       WHERE scope_id = ? AND kind = ? AND invalidated = 0`,
    )
    .run(scopeId, kind)
  return res.changes
}
