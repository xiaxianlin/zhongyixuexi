import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync, unlinkSync } from 'node:fs'

export type DB = Database.Database

let db: DB | null = null

function getUserDataDir(): string {
  return process.env.ELECTRON_USER_DATA_DIR || app.getPath('userData')
}

export function getDbPath(): string {
  return join(getUserDataDir(), 'app.db')
}

/**
 * Returns the singleton app database (SQLite), stored in the OS userData dir.
 * Hard constraint (00-architecture §5.1): foreign_keys MUST be ON for cascades.
 */
export function getDb(): DB {
  if (db) return db

  const dir = getUserDataDir()
  mkdirSync(dir, { recursive: true })

  db = new Database(getDbPath())
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

export function resetDbFiles(): void {
  closeDb()
  const path = getDbPath()
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      unlinkSync(file)
    } catch {
      // File may not exist on a fresh profile.
    }
  }
}
