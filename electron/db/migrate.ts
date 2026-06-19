/**
 * Forward-only migration runner.
 *
 * Each entry in MIGRATIONS is an incremental step { version, name, up } applied
 * in ascending version order. The runner reads `user_version`, runs every
 * migration whose version is greater, each inside its OWN transaction so a
 * failure rolls back that step and throws (leaving user_version unchanged — the
 * next launch retries from the last good version). DDL is written to be
 * idempotent so a re-run after a partial failure is safe.
 *
 * Version 3 is the first shipped schema (the "reset era" before this file
 * existed), so the chain starts empty — `CURRENT_SCHEMA` (CREATE TABLE IF NOT
 * EXISTS) in schema.ts is the idempotent baseline for v3. Future schema changes
 * append a migration here and bump CURRENT_SCHEMA_VERSION; existing v3 user DBs
 * upgrade in place WITHOUT losing data.
 *
 * Hard constraints (00-architecture §5) preserved by every migration:
 *  - paragraphs keeps BOTH the TEXT PRIMARY KEY (stable UUID) AND the implicit
 *    rowid (FTS5 content_rowid anchor) — never DROP/regenerate either.
 *  - child tables keep their ON DELETE CASCADE / SET NULL semantics.
 *  - FTS sync stays owned by the IMP module (ai/ad/au triggers); a migration
 *    that rewrites paragraph text must call rebuildFts() afterward.
 */
import type { DB } from './connection'

interface Migration {
  version: number
  name: string
  up: (db: DB) => void
}

/**
 * Forward migration steps, version 3 → onward. v3 itself has no step (it is the
 * baseline applied via CURRENT_SCHEMA). Append here for each future schema bump.
 */
export const MIGRATIONS: Migration[] = [
  // Example for the next change:
  // {
  //   version: 4,
  //   name: 'add books.subtitle',
  //   up: (db) => {
  //     const cols = db.prepare("PRAGMA table_info(books)").all() as { name: string }[]
  //     if (!cols.some((c) => c.name === 'subtitle')) {
  //       db.exec('ALTER TABLE books ADD COLUMN subtitle TEXT')
  //     }
  //   },
  // },
]

/**
 * Apply every pending forward migration to the given connection. Each migration
 * runs in its own transaction and bumps user_version on success. Throws on
 * failure (caller decides recovery); a re-run resumes from the last committed
 * version because user_version was updated per-step.
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
 * DB has user_version=0 but incompatible columns (source_format etc.) and must
 * be reset rather than migrated. A truly fresh DB (no tables at all) also reads
 * user_version=0 but has no schema_meta — it just needs CURRENT_SCHEMA applied.
 */
export function hasLegacySchemaMeta(db: DB): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta' LIMIT 1",
    )
    .get() as { name: string } | undefined
  return row !== undefined
}
