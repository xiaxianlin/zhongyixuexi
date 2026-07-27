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
 * Forward migration steps. Empty for now (S9.1 only ships the runner
 * mechanism); product tables (users, invite_codes, ...) land as later slices
 * append entries here and bump their version.
 */
export const MIGRATIONS: Migration[] = []

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
