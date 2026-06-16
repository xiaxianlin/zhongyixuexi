/**
 * SET module DTOs (mirror of electron/services/settings.ts + backup.ts return shapes).
 * Kept dependency-free so the renderer never imports electron/* code.
 */

// ---- SET-01: Provider ----

export interface ProviderConfig {
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
  /** Plaintext key (encrypted in main process); omit to keep existing. */
  apiKey?: string | null
}

// ---- SET-02: Appearance ----

export interface AppearanceSettings {
  theme: string
  fontScale: number
}

// ---- SET-03: Backup ----

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

// ---- SET-04: Book file management ----

export interface BookFileEntry {
  bookId: string | null
  title: string | null
  fileName: string
  filePath: string
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

// ---- SET-05: Disclaimer ----

export interface DisclaimerStatus {
  accepted: boolean
  acceptedAt?: number
  version: string
}
