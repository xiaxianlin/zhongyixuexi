/**
 * Settings service (SET module).
 *
 * Bridges the keystore (SET-01) to a clean service layer: provider CRUD (safe
 * DTOs without key plaintext), appearance read/write (SET-02), disclaimer
 * state (SET-05), and book file management (SET-04).
 *
 * Also exports `getActiveApiKey` (re-exported from keystore) so the AI module
 * (Phase 5) imports from a single entry point:
 *   import { getActiveApiKey } from '../services/settings'
 *
 * All DB access goes through the better-sqlite3 singleton from getDb().
 */

import { app } from 'electron'
import { join, resolve, relative, sep } from 'node:path'
import { statSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import { reparseBook } from './import'
import {
  saveProviderCredential,
  deleteProviderCredential,
  setActiveProvider,
  listProviderCredentials,
  getActiveApiKey as keystoreGetActiveApiKey,
  type ProviderCredentialRow,
} from '../lib/keystore'

// Re-export for AI module convenience (stable import path).
// The AI module (Phase 5) imports: import { getActiveApiKey } from '../services/settings'
export type { ActiveApiKeyResult } from '../lib/keystore'

// ============================================================================
// DTOs (self-contained; renderer mirrors in src/modules/settings/types.ts)
// ============================================================================

/** Safe provider config — never contains the API key plaintext. */
export interface ProviderConfigDTO {
  id: string
  provider: string
  label: string
  baseUrl: string
  model: string
  hasKey: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface SaveProviderInput {
  id?: string
  provider: string
  label: string
  baseUrl: string
  model: string
  /** Plaintext key (will be encrypted in main process); omit to keep existing. */
  apiKey?: string | null
}

export interface AppearanceSettings {
  theme: string
  fontScale: number
}

export interface DisclaimerStatus {
  accepted: boolean
  acceptedAt?: number
  version: string
}

export interface BookFileEntry {
  bookId: string | null
  title: string | null
  fileName: string
  filePath: string // relative to userData
  sizeBytes: number
  importedAt: number | null
}

export interface OrphanScanResult {
  orphanAssets: string[]
  orphanFiles: string[]
  totalBytes: number
}

export interface CleanOrphansResult {
  freedBytes: number
  cleaned: number
}

// ============================================================================
// SET-01: Provider CRUD (returns safe DTOs, never key plaintext)
// ============================================================================

function toDTO(row: ProviderCredentialRow): ProviderConfigDTO {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.base_url,
    model: row.model,
    hasKey: !!(row.api_key_enc && row.api_key_enc.length > 0),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listProviders(): ProviderConfigDTO[] {
  return listProviderCredentials().map(toDTO)
}

export function getProvider(id: string): ProviderConfigDTO {
  const all = listProviderCredentials()
  const row = all.find((r) => r.id === id)
  if (!row) throw new AppError('NOT_FOUND', `provider ${id} not found`)
  return toDTO(row)
}

export function saveProvider(input: SaveProviderInput): { id: string } {
  const id = input.id || `custom-${Date.now().toString(36)}`
  saveProviderCredential(id, input.provider, input.label, input.baseUrl, input.model, input.apiKey)
  return { id }
}

export function deleteProvider(id: string): { ok: boolean } {
  deleteProviderCredential(id)
  return { ok: true }
}

export function activateProvider(id: string): { ok: boolean } {
  setActiveProvider(id)
  return { ok: true }
}

// Convenience for internal use (AI module).
export const getActiveApiKey = keystoreGetActiveApiKey

// ============================================================================
// SET-02: Appearance settings (stored in settings key/value table)
// ============================================================================

const APPEARANCE_DEFAULTS: AppearanceSettings = {
  theme: 'paper',
  fontScale: 1,
}

export function getAppearance(): AppearanceSettings {
  const db = getDb()
  const theme = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('appearance.theme') as { value?: string } | undefined
  const fontScale = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('appearance.fontScale') as { value?: string } | undefined

  return {
    theme: theme?.value || APPEARANCE_DEFAULTS.theme,
    fontScale: fontScale?.value ? Number(fontScale.value) : APPEARANCE_DEFAULTS.fontScale,
  }
}

export function setAppearance(patch: Partial<AppearanceSettings>): { ok: boolean } {
  const db = getDb()
  const now = Date.now()
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
  const tx = db.transaction(() => {
    if (patch.theme !== undefined) upsert.run('appearance.theme', patch.theme, now)
    if (patch.fontScale !== undefined) upsert.run('appearance.fontScale', String(patch.fontScale), now)
  })
  tx()
  return { ok: true }
}

// ============================================================================
// SET-05: Disclaimer status
// ============================================================================

const DISCLAIMER_VERSION = '1.0.0'

export function getDisclaimerStatus(): DisclaimerStatus {
  const db = getDb()
  const accepted = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('disclaimer.accepted') as { value?: string } | undefined
  const acceptedAt = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('disclaimer.acceptedAt') as { value?: string } | undefined

  return {
    accepted: accepted?.value === 'true',
    acceptedAt: acceptedAt?.value ? Number(acceptedAt.value) : undefined,
    version: DISCLAIMER_VERSION,
  }
}

export function acceptDisclaimer(version: string): { ok: boolean } {
  const db = getDb()
  const now = Date.now()
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
  const tx = db.transaction(() => {
    upsert.run('disclaimer.accepted', 'true', now)
    upsert.run('disclaimer.acceptedAt', String(now), now)
    upsert.run('disclaimer.version', version, now)
  })
  tx()
  return { ok: true }
}

// ============================================================================
// SET-04: Book file management
// ============================================================================

/**
 * Lists all files under userData/files/ with their associated book metadata.
 */
export function listBookFiles(): BookFileEntry[] {
  const db = getDb()
  const userData = app.getPath('userData')
  const filesDir = join(userData, 'files')

  if (!existsSync(filesDir)) return []

  // Build a lookup of source_file -> book info
  const books = db
    .prepare('SELECT id, title, source_file, imported_at FROM books WHERE deleted_at IS NULL')
    .all() as { id: string; title: string; source_file: string; imported_at: number }[]

  const bookMap = new Map<string, { id: string; title: string; importedAt: number }>()
  for (const b of books) {
    bookMap.set(b.source_file, { id: b.id, title: b.title, importedAt: b.imported_at })
  }

  const entries: BookFileEntry[] = []
  const allFiles = readdirSync(filesDir)
  for (const fileName of allFiles) {
    const fullPath = join(filesDir, fileName)
    try {
      const st = statSync(fullPath)
      if (!st.isFile()) continue
      const relPath = `files/${fileName}`
      const book = bookMap.get(relPath)
      entries.push({
        bookId: book?.id ?? null,
        title: book?.title ?? null,
        fileName,
        filePath: relPath,
        sizeBytes: st.size,
        importedAt: book?.importedAt ?? null,
      })
    } catch {
      // skip unreadable files
    }
  }

  return entries.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/** Runs IMP-07 stable-ID-preserving reparse for a book. */
export function triggerReparse(bookId: string): ReturnType<typeof reparseBook> {
  if (!bookId) throw new AppError('VALIDATION', 'bookId is required')
  return reparseBook(bookId)
}

/**
 * Scans assets/ and files/ for orphaned resources (files not referenced by any
 * DB row). Returns the lists for user confirmation before deletion.
 */
export function scanOrphans(): OrphanScanResult {
  const db = getDb()
  const userData = app.getPath('userData')

  const orphanAssets: string[] = []
  const orphanFiles: string[] = []
  let totalBytes = 0

  // Collect DB-referenced paths
  const referencedPaths = new Set<string>()

  // books.source_file
  const bookFiles = db
    .prepare('SELECT source_file FROM books WHERE deleted_at IS NULL')
    .all() as { source_file: string }[]
  for (const b of bookFiles) referencedPaths.add(b.source_file)

  // books.cover
  const bookCovers = db
    .prepare('SELECT cover FROM books WHERE deleted_at IS NULL AND cover IS NOT NULL')
    .all() as { cover: string }[]
  for (const b of bookCovers) referencedPaths.add(b.cover)

  // Scan files/
  const filesDir = join(userData, 'files')
  if (existsSync(filesDir)) {
    for (const fileName of readdirSync(filesDir)) {
      const rel = `files/${fileName}`
      if (!referencedPaths.has(rel)) {
        try {
          totalBytes += statSync(join(filesDir, fileName)).size
          orphanFiles.push(rel)
        } catch {
          // skip
        }
      }
    }
  }

  // Scan assets/ (covers + future AI-generated assets)
  const assetsDir = join(userData, 'assets')
  if (existsSync(assetsDir)) {
    scanDirRecursive(assetsDir, userData, referencedPaths, orphanAssets, (bytes) => {
      totalBytes += bytes
    })
  }

  return { orphanAssets, orphanFiles, totalBytes }
}

function scanDirRecursive(
  dir: string,
  userData: string,
  referenced: Set<string>,
  orphans: string[],
  onBytes: (bytes: number) => void,
): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    try {
      const st = statSync(fullPath)
      if (st.isDirectory()) {
        scanDirRecursive(fullPath, userData, referenced, orphans, onBytes)
      } else if (st.isFile()) {
        const rel = relative(userData, fullPath).split(sep).join('/')
        if (!referenced.has(rel)) {
          onBytes(st.size)
          orphans.push(rel)
        }
      }
    } catch {
      // skip unreadable
    }
  }
}

/**
 * Deletes the specified orphaned files. Best-effort: missing/locked files are
 * skipped with a warning. Returns total bytes freed and count cleaned.
 */
export function cleanOrphans(paths: string[]): CleanOrphansResult {
  const userData = app.getPath('userData')
  let freedBytes = 0
  let cleaned = 0

  for (const relPath of paths) {
    // Path traversal guard: resolved path must be under userData
    const abs = resolve(userData, relPath)
    if (!abs.startsWith(userData + sep) && abs !== userData) {
      continue
    }
    try {
      const st = statSync(abs)
      unlinkSync(abs)
      freedBytes += st.size
      cleaned++
    } catch (e) {
      console.warn('[settings] cleanOrphans: failed to delete', relPath, e)
    }
  }

  return { freedBytes, cleaned }
}
