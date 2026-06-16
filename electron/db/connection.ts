import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export type DB = Database.Database

let db: DB | null = null

/**
 * Returns the singleton app database (SQLite), stored in the OS userData dir.
 * Hard constraint (00-architecture §5.1): foreign_keys MUST be ON for cascades.
 */
export function getDb(): DB {
  if (db) return db

  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })

  db = new Database(join(dir, 'app.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function closeDb(): void {
  try {
    db?.close()
  } catch {
    // ignore double-close on shutdown
  }
  db = null
}
