/**
 * Forward-only migration runner (Postgres analogue of electron/db/migrate.ts).
 *
 * SQLite tracks schema version via the built-in `user_version` pragma; Postgres
 * has no equivalent, so applied versions are tracked in a `schema_migrations`
 * table created idempotently on every run. Each pending migration runs in its
 * own transaction; a failure rolls back that step only, leaving earlier
 * versions committed so a re-run resumes from the last good version.
 */
import type { Pool, PoolClient } from 'pg'

export interface Migration {
  version: number
  name: string
  up: (client: PoolClient) => Promise<void>
}

/**
 * Forward migration steps. Product tables land here as later slices append
 * entries and bump the version; nothing is ever edited or removed in place.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'create_users_and_invite_codes',
    up: async (client) => {
      // No FK from invite_codes.created_by to users yet — users doesn't exist
      // until the next statement, so the constraint is added afterward.
      await client.query(`
        CREATE TABLE IF NOT EXISTS invite_codes (
          id UUID PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          max_uses INTEGER,
          use_count INTEGER NOT NULL DEFAULT 0,
          note TEXT,
          created_by UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          revoked_at TIMESTAMPTZ
        )
      `)
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
          invited_by_code UUID REFERENCES invite_codes(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'invite_codes_created_by_fkey'
          ) THEN
            ALTER TABLE invite_codes
              ADD CONSTRAINT invite_codes_created_by_fkey
              FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
          END IF;
        END $$;
      `)
    },
  },
  {
    version: 2,
    name: 'create_content_tables',
    up: async (client) => {
      // pg_trgm backs the full-text search (SRH-01): a GIN trigram index on
      // paragraphs.text plays the role SQLite's FTS5 trigram tokenizer + the
      // paragraphs_ai/ad/au sync triggers played there. Postgres indexes are
      // maintained transactionally by the engine on every insert/update, so
      // no equivalent sync triggers are needed here.
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')

      // Content is global (shared across every member), not per-user — no
      // user_id column. `status`/`created_by` back the content admin
      // workflow (CMS-01/CMS-02/CMS-03, S9.5); parse-era fields from the old
      // EPUB-import pipeline (parse_hash/is_noise/quality_flag/edited) are
      // dropped since content is now authored directly through the CMS, not
      // parsed and re-synced from bundled JSON.
      await client.query(`
        CREATE TABLE IF NOT EXISTS books (
          id UUID PRIMARY KEY,
          title TEXT NOT NULL,
          author TEXT,
          cover TEXT,
          category TEXT,
          order_index INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )
      `)

      await client.query(`
        CREATE TABLE IF NOT EXISTS chapters (
          id UUID PRIMARY KEY,
          book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          parent_id UUID REFERENCES chapters(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL,
          level TEXT,
          title TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )
      `)
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id) WHERE deleted_at IS NULL',
      )
      await client.query('CREATE INDEX IF NOT EXISTS idx_chapters_parent ON chapters(parent_id)')

      await client.query(`
        CREATE TABLE IF NOT EXISTS paragraphs (
          id UUID PRIMARY KEY,
          chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )
      `)
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_paragraphs_chapter ON paragraphs(chapter_id) WHERE deleted_at IS NULL',
      )
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_paragraphs_text_trgm ON paragraphs USING GIN (text gin_trgm_ops)',
      )
    },
  },
  {
    version: 3,
    name: 'create_wallet_tables',
    up: async (client) => {
      // One row per member; created lazily by the first balance_adjustments
      // upsert (WALLET-02) rather than at registration, since a free member
      // who never charges up has nothing to track yet.
      await client.query(`
        CREATE TABLE IF NOT EXISTS wallets (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          balance_tokens BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      // Append-only ledger of admin-applied top-ups/corrections (WALLET-02) —
      // this table, not a payment gateway webhook, is the only record of a
      // "charge" in the system (proposal §5.1/§7).
      await client.query(`
        CREATE TABLE IF NOT EXISTS balance_adjustments (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          delta_tokens BIGINT NOT NULL,
          amount_cny NUMERIC(10, 2),
          note TEXT,
          created_by UUID NOT NULL REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_balance_adjustments_user ON balance_adjustments(user_id, created_at DESC)',
      )
    },
  },
  {
    version: 4,
    name: 'create_ai_qa_tables',
    up: async (client) => {
      // AI-05: multi-turn Q&A. Unlike paragraph_analyses (S9.4's plan — global,
      // shared cache), a conversation is per-user and not cacheable — every
      // question is a fresh, individually-billed call (proposal §4).
      await client.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC)',
      )

      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY,
          conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)',
      )

      // tokens_deducted mirrors total_tokens today (1 token of usage = 1 token
      // of balance, no markup applied at spend time — markup happens at
      // top-up time per proposal §5.2). Kept as its own column so a future
      // spend-time markup policy doesn't need a schema change.
      await client.query(`
        CREATE TABLE IF NOT EXISTS token_usage_ledger (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
          prompt_tokens INTEGER NOT NULL,
          completion_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          tokens_deducted BIGINT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_token_usage_user ON token_usage_ledger(user_id, created_at DESC)',
      )
    },
  },
]

/** Pure planning step (no DB access) — kept separate so it's unit-testable without Postgres. */
export function getPendingMigrations(
  appliedVersions: ReadonlySet<number>,
  migrations: Migration[] = MIGRATIONS,
): Migration[] {
  return migrations
    .filter((m) => !appliedVersions.has(m.version))
    .sort((a, b) => a.version - b.version)
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function getAppliedVersions(client: PoolClient): Promise<Set<number>> {
  const { rows } = await client.query<{ version: number }>('SELECT version FROM schema_migrations')
  return new Set(rows.map((r) => r.version))
}

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await ensureMigrationsTable(client)
    const applied = await getAppliedVersions(client)
    for (const migration of getPendingMigrations(applied)) {
      await client.query('BEGIN')
      try {
        await migration.up(client)
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
          migration.version,
          migration.name,
        ])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    client.release()
  }
}
