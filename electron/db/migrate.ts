import type { DB } from './connection'

interface Migration {
  version: number
  name: string
  up: (db: DB) => void
}

/**
 * Forward migration steps. Empty in the v3.1 reset era — schema.ts applies
 * CURRENT_SCHEMA on every launch and resets any mismatching DB (no production
 * data to preserve). Append a step here only once a shipped version needs to
 * preserve user data across a change.
 */
export const MIGRATIONS: Migration[] = []

/**
 * Apply every pending forward migration to the given connection. Each migration
 * runs in its own transaction and bumps user_version on success. Currently a
 * no-op (MIGRATIONS is empty); kept for future use.
 */
export function runMigrations(db: DB): void {
  let current = db.pragma('user_version', { simple: true }) as number
  for (const migration of MIGRATIONS) {
    if (current >= migration.version) continue
    db.transaction(() => {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    })()
    current = migration.version
  }
}

/**
 * Detect a DB from the pre-reset era (the deleted `schema_meta`-based runner),
 * which used a `schema_meta` table instead of the `user_version` pragma. Such a
 * DB must be reset rather than treated as fresh.
 */
export function hasLegacySchemaMeta(db: DB): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta' LIMIT 1",
    )
    .get() as { name: string } | undefined
  return row !== undefined
}
