/**
 * Backup service (SET-03) — export/import the entire user library.
 *
 * Export: packages app.db + assets/ + files/ into a single .tcmz archive (zip
 * format via adm-zip), with a manifest.json and per-file sha256 checksums.
 * By default API keys are STRIPPED from the exported DB (includeApiKey=false).
 *
 * Import: verifies the archive (checksums + format version), then restores the
 * DB and files. The DB is VACUUMed into a clean copy before export to ensure
 * consistency (avoids WAL half-write issues).
 *
 * Uses adm-zip (already in devDependencies) for cross-platform zip handling.
 *
 * Security: the plaintext API key NEVER appears in export output. Even with
 * includeApiKey=true, only the encrypted BLOB is preserved (which is
 * machine-bound via safeStorage and cannot be decrypted on another machine
 * without the original OS keychain — §7.3.5). This first version does NOT
 * implement cross-machine key migration (password-based re-encryption).
 */

import { app } from 'electron'
import { join, resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  unlinkSync,
  rmSync,
  copyFileSync,
} from 'node:fs'
import AdmZip from 'adm-zip'
import Database from 'better-sqlite3'
import { getDb, type DB } from '../db/connection'
import { AppError } from '../lib/error'

// ============================================================================
// Types (also mirrored in src/modules/settings/types.ts)
// ============================================================================

export interface BackupManifest {
  format: 'tcm-backup'
  formatVersion: number
  appVersion: string
  schemaVersion: number
  createdAt: number
  machineHint: string
  counts: {
    books: number
    paragraphs: number
  }
  dbBytes: number
  assetsBytes: number
  filesBytes: number
  includeApiKey: boolean
  checksumAlgo: 'sha256'
}

export interface ExportResult {
  path: string
  bytes: number
  manifest: BackupManifest
}

export interface VerifyResult {
  ok: boolean
  manifest: BackupManifest | null
  errors: string[]
}

export interface ImportResult {
  ok: boolean
  restoredBooks: number
}

export interface BackupProgressEvent {
  phase: 'scan' | 'pack' | 'checksum' | 'unpack' | 'restore' | 'done'
  current?: number
  total?: number
  bytesWritten?: number
  message?: string
}

const SUPPORTED_FORMAT_VERSION = 1
const ARCHIVE_SUFFIX = '.tcmz'
const DB_FILE = 'app.db'
const MANIFEST_FILE = 'manifest.json'
const CHECKSUMS_FILE = 'checksums.sha256'

// ============================================================================
// Pure functions (exported for unit testing)
// ============================================================================

/**
 * Parses a checksums.sha256 file content into a Map<relativePath, hexDigest>.
 *
 * Format: standard `sha256sum` output, one file per line:
 *   <64-hex-hash>  <path>
 * (two spaces separating hash and path, matching `sha256sum` convention).
 */
export function parseChecksums(content: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Format: "<hash>  <path>" (sha256sum uses two spaces)
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      const hash = parts[0]
      const path = parts.slice(1).join(' ')
      if (/^[0-9a-f]{64}$/.test(hash)) {
        map.set(path, hash)
      }
    }
  }
  return map
}

/**
 * Formats a checksums map into sha256sum-compatible text.
 */
export function formatChecksums(entries: Map<string, string>): string {
  const lines: string[] = []
  for (const [path, hash] of entries) {
    lines.push(`${hash}  ${path}`)
  }
  return lines.join('\n') + '\n'
}

/** Computes SHA-256 hex digest of a Buffer. */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Validates a manifest object against the expected format.
 * Returns an array of error strings (empty = valid).
 */
export function validateManifest(raw: unknown): string[] {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') {
    errors.push('manifest is not an object')
    return errors
  }
  const m = raw as Record<string, unknown>
  if (m.format !== 'tcm-backup') errors.push('format is not "tcm-backup"')
  if (typeof m.formatVersion !== 'number' || m.formatVersion < 1) {
    errors.push('formatVersion missing or invalid')
  }
  if (typeof m.formatVersion === 'number' && m.formatVersion > SUPPORTED_FORMAT_VERSION) {
    errors.push(
      `backup formatVersion ${m.formatVersion} is newer than supported ${SUPPORTED_FORMAT_VERSION}; please upgrade the app.`,
    )
  }
  if (typeof m.schemaVersion !== 'number' || m.schemaVersion < 1) {
    errors.push('schemaVersion missing or invalid')
  }
  return errors
}

// ============================================================================
// Helper: walk directory recursively, collecting files
// ============================================================================

interface FileEntry {
  /** Path relative to userData (e.g. 'assets/img/001.png'). */
  relPath: string
  absPath: string
  size: number
}

function walkDir(dirPath: string, baseDir: string): FileEntry[] {
  const entries: FileEntry[] = []
  if (!existsSync(dirPath)) return entries

  for (const name of readdirSync(dirPath)) {
    const abs = join(dirPath, name)
    try {
      const st = statSync(abs)
      if (st.isDirectory()) {
        entries.push(...walkDir(abs, baseDir))
      } else if (st.isFile()) {
        const rel = relative(baseDir, abs).split(sep).join('/')
        entries.push({ relPath: rel, absPath: abs, size: st.size })
      }
    } catch {
      // skip unreadable
    }
  }
  return entries
}

function getPlatformHint(): string {
  return `${process.platform}-${process.arch}`
}

function countDbEntities(db: DB): { books: number; paragraphs: number } {
  const books = db
    .prepare('SELECT COUNT(*) as n FROM books WHERE deleted_at IS NULL')
    .get() as { n: number }
  const paragraphs = db
    .prepare('SELECT COUNT(*) as n FROM paragraphs WHERE deleted_at IS NULL')
    .get() as { n: number }
  return { books: books.n, paragraphs: paragraphs.n }
}

// ============================================================================
// Export
// ============================================================================

/**
 * Exports the entire library to a .tcmz archive.
 *
 * @param outputPath full path for the output archive; if null, a default
 *                   path under userData/backups/ is used.
 * @param includeApiKey if false (default), API keys are stripped from the
 *                      exported DB copy.
 * @param onProgress optional progress callback.
 */
export function exportBackup(
  outputPath: string | null,
  includeApiKey: boolean = false,
  onProgress?: (e: BackupProgressEvent) => void,
): ExportResult {
  const userData = app.getPath('userData')
  const db = getDb()

  onProgress?.({ phase: 'scan', message: '扫描文件…' })

  // 1. Collect files to archive
  const assetsDir = join(userData, 'assets')
  const filesDir = join(userData, 'files')

  const assetFiles = walkDir(assetsDir, userData)
  const userFiles = walkDir(filesDir, userData)

  let assetsBytes = 0
  for (const f of assetFiles) assetsBytes += f.size
  let filesBytes = 0
  for (const f of userFiles) filesBytes += f.size

  // 2. VACUUM INTO a clean DB copy
  onProgress?.({ phase: 'pack', message: '导出数据库…' })
  const tmpDir = join(userData, '.backup-tmp')
  mkdirSync(tmpDir, { recursive: true })
  const tmpDbPath = join(tmpDir, DB_FILE)
  if (existsSync(tmpDbPath)) unlinkSync(tmpDbPath)

  db.exec(`VACUUM INTO '${tmpDbPath.replace(/'/g, "''")}'`)

  // 3. Strip API keys if requested
  if (!includeApiKey) {
    // Open the copy and strip keys in-place
    const tmpDb = new Database(tmpDbPath)
    tmpDb.pragma('foreign_keys = ON')
    const now = Date.now()
    tmpDb.prepare(
      'UPDATE api_credentials SET api_key_enc = NULL, key_iv_hint = ?, updated_at = ?',
    ).run('stripped', now)
    tmpDb.close()
  }

  const dbBytes = statSync(tmpDbPath).size

  // 4. Build manifest
  const counts = countDbEntities(db)
  const manifest: BackupManifest = {
    format: 'tcm-backup',
    formatVersion: SUPPORTED_FORMAT_VERSION,
    appVersion: app.getVersion(),
    schemaVersion: getSchemaVersion(db),
    createdAt: Date.now(),
    machineHint: getPlatformHint(),
    counts,
    dbBytes,
    assetsBytes,
    filesBytes,
    includeApiKey,
    checksumAlgo: 'sha256',
  }

  // 5. Compute per-file checksums
  onProgress?.({ phase: 'checksum', message: '计算校验和…' })
  const checksums = new Map<string, string>()

  // DB file
  checksums.set(DB_FILE, sha256Hex(readFileSync(tmpDbPath)))

  // Asset and user files
  let processed = 0
  const allFiles = [...assetFiles, ...userFiles]
  for (const f of allFiles) {
    checksums.set(f.relPath, sha256Hex(readFileSync(f.absPath)))
    processed++
    if (processed % 50 === 0) {
      onProgress?.({ phase: 'checksum', current: processed, total: allFiles.length })
    }
  }

  // 6. Build the archive
  onProgress?.({ phase: 'pack', message: '打包归档…' })
  const zip = new AdmZip()

  // Add DB (read from the temp copy)
  zip.addFile(DB_FILE, readFileSync(tmpDbPath))

  // Add assets and files with their relative paths preserved in the zip entry.
  for (const f of [...assetFiles, ...userFiles]) {
    zip.addFile(f.relPath, readFileSync(f.absPath))
  }

  // Add checksums file
  const checksumsContent = formatChecksums(checksums)
  zip.addFile(CHECKSUMS_FILE, Buffer.from(checksumsContent, 'utf8'))

  // Add manifest (last, after all checksums are computed)
  zip.addFile(MANIFEST_FILE, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))

  // 7. Write the archive
  const finalPath = outputPath || join(userData, 'backups', `backup-${Date.now()}${ARCHIVE_SUFFIX}`)
  const finalDir = join(finalPath, '..')
  mkdirSync(finalDir, { recursive: true })
  zip.writeZip(finalPath)

  // 8. Cleanup temp
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }

  const archiveBytes = statSync(finalPath).size
  onProgress?.({ phase: 'done', bytesWritten: archiveBytes })

  return { path: finalPath, bytes: archiveBytes, manifest }
}

// ============================================================================
// Verify
// ============================================================================

/**
 * Verifies an archive's integrity without writing anything.
 * Checks manifest validity and per-file checksums.
 */
export function verifyBackup(archivePath: string): VerifyResult {
  const errors: string[] = []

  if (!existsSync(archivePath)) {
    return { ok: false, manifest: null, errors: ['archive file not found'] }
  }

  const zip = new AdmZip(archivePath)

  // Read manifest
  const manifestEntry = zip.getEntry(MANIFEST_FILE)
  if (!manifestEntry) {
    return { ok: false, manifest: null, errors: ['manifest.json not found in archive'] }
  }

  let manifest: BackupManifest
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as BackupManifest
  } catch {
    return { ok: false, manifest: null, errors: ['manifest.json is not valid JSON'] }
  }

  // Validate manifest
  const manifestErrors = validateManifest(manifest)
  errors.push(...manifestErrors)
  if (errors.length > 0) {
    return { ok: false, manifest, errors }
  }

  // Read checksums
  const checksumsEntry = zip.getEntry(CHECKSUMS_FILE)
  if (!checksumsEntry) {
    return { ok: false, manifest, errors: ['checksums.sha256 not found in archive'] }
  }

  const checksums = parseChecksums(checksumsEntry.getData().toString('utf8'))

  // Verify each entry's checksum
  for (const [path, expectedHash] of checksums) {
    const entry = zip.getEntry(path)
    if (!entry) {
      errors.push(`file listed in checksums not found in archive: ${path}`)
      continue
    }
    const actualHash = sha256Hex(entry.getData())
    if (actualHash !== expectedHash) {
      errors.push(`checksum mismatch for ${path}: expected ${expectedHash}, got ${actualHash}`)
    }
  }

  // Verify DB file exists
  if (!zip.getEntry(DB_FILE)) {
    errors.push(`${DB_FILE} not found in archive`)
  }

  return { ok: errors.length === 0, manifest, errors }
}

// ============================================================================
// Import
// ============================================================================

/**
 * Imports (restores) a backup archive.
 *
 * mode='replace': overwrites the current DB and files (a pre-import snapshot
 *                 is created first for safety).
 *
 * @param archivePath path to the .tcmz archive
 * @param mode currently only 'replace' is supported
 * @param onProgress optional progress callback
 */
export function importBackup(
  archivePath: string,
  mode: 'replace' | 'merge' = 'replace',
  onProgress?: (e: BackupProgressEvent) => void,
): ImportResult {
  if (mode === 'merge') {
    throw new AppError(
      'VALIDATION',
      '合并导入 (merge mode) 暂未实现，当前仅支持替换模式 (replace)。',
    )
  }

  // Verify first
  onProgress?.({ phase: 'scan', message: '校验归档…' })
  const verification = verifyBackup(archivePath)
  if (!verification.ok) {
    throw new AppError(
      'VALIDATION',
      `归档校验失败: ${verification.errors.join('; ')}`,
    )
  }

  const userData = app.getPath('userData')
  const zip = new AdmZip(archivePath)

  // Pre-import snapshot (safety backup of current state)
  onProgress?.({ phase: 'pack', message: '创建导入前快照…' })
  const snapshotDir = join(userData, 'backups')
  mkdirSync(snapshotDir, { recursive: true })
  const snapshotPath = join(snapshotDir, `pre-import-${Date.now()}${ARCHIVE_SUFFIX}`)
  try {
    exportBackup(snapshotPath, false)
  } catch (e) {
    console.warn('[backup] pre-import snapshot failed:', e)
    // Continue anyway — user requested restore
  }

  // Unpack DB
  onProgress?.({ phase: 'unpack', message: '解压数据库…' })
  const dbEntry = zip.getEntry(DB_FILE)
  if (!dbEntry) {
    throw new AppError('VALIDATION', '归档中缺少 app.db')
  }

  // Close current DB connection (the main process owns it)
  // We write the new DB file directly, then the caller must reopen.
  const dbPath = join(userData, DB_FILE)

  // Write new DB
  const tmpDbPath = join(userData, '.import-tmp.db')
  writeFileSync(tmpDbPath, dbEntry.getData())

  // Backup current DB
  const currentDbBackup = dbPath + '.pre-import'
  if (existsSync(dbPath)) {
    copyFileSync(dbPath, currentDbBackup)
  }

  try {
    // Replace
    rmSync(dbPath, { force: true })
    // Also remove WAL/SHM files
    rmSync(dbPath + '-wal', { force: true })
    rmSync(dbPath + '-shm', { force: true })
    copyFileSync(tmpDbPath, dbPath)
    unlinkSync(tmpDbPath)
  } catch (e) {
    // Restore from backup
    if (existsSync(currentDbBackup)) {
      copyFileSync(currentDbBackup, dbPath)
    }
    throw new AppError('IO', `数据库替换失败: ${(e as Error).message}`)
  }

  // Unpack assets and files
  onProgress?.({ phase: 'restore', message: '恢复资源文件…' })
  const manifest = verification.manifest!
  const entries = zip.getEntries()
  for (const entry of entries) {
    const name = entry.entryName
    // Skip manifest and checksums
    if (name === MANIFEST_FILE || name === CHECKSUMS_FILE) continue
    // Skip the DB (already handled)
    if (name === DB_FILE) continue

    // Extract to userData
    const targetPath = join(userData, name)
    const targetDir = join(targetPath, '..')
    // Path traversal guard
    const resolved = resolve(targetPath)
    if (!resolved.startsWith(userData + sep) && resolved !== userData) {
      continue
    }
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(targetPath, entry.getData())
  }

  // Cleanup pre-import backup of the old DB file
  try {
    if (existsSync(currentDbBackup)) unlinkSync(currentDbBackup)
  } catch {
    // best-effort
  }

  const restoredBooks = manifest.counts?.books ?? 0
  onProgress?.({ phase: 'done', message: `恢复完成: ${restoredBooks} 本书` })

  // NOTE: The caller (IPC layer) should signal the main process to reopen the
  // DB connection and run migrations to catch up the schema version.
  return { ok: true, restoredBooks }
}

// ============================================================================
// Helpers
// ============================================================================

function getSchemaVersion(db: DB): number {
  const row = db
    .prepare('SELECT value FROM schema_meta WHERE key = ?')
    .get('version') as { value?: string } | undefined
  return row?.value ? Number(row.value) : 0
}
