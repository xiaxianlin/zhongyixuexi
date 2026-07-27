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
