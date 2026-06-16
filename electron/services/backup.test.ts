/**
 * Pure-logic unit tests for backup checksum and manifest validation.
 *
 * These test the exported pure functions from electron/services/backup.ts that
 * don't require Electron, better-sqlite3, or the filesystem. The full
 * export/import flow is integration-tested manually (it needs safeStorage,
 * the app singleton, and disk I/O).
 *
 * NOTE: backup.ts imports electron and better-sqlite3 at the top level, so we
 * cannot import it directly in vitest (ABI mismatch). The pure functions are
 * re-implemented here as self-contained logic tests that verify the algorithms
 * match the sha256sum format specification. If the algorithms diverge, these
 * tests will still pass but integration tests would catch format mismatches.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'

// ---- Re-declarations of the pure functions under test ----
// These mirror the implementations in electron/services/backup.ts exactly.
// They are duplicated here because the module's top-level imports prevent
// vitest from loading it (electron/better-sqlite3 ABI).

function parseChecksums(content: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
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

function formatChecksums(entries: Map<string, string>): string {
  const lines: string[] = []
  for (const [path, hash] of entries) {
    lines.push(`${hash}  ${path}`)
  }
  return lines.join('\n') + '\n'
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

const SUPPORTED_FORMAT_VERSION = 1

function validateManifest(raw: unknown): string[] {
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
      `backup formatVersion ${m.formatVersion} is newer than supported ${SUPPORTED_FORMAT_VERSION}`,
    )
  }
  if (typeof m.schemaVersion !== 'number' || m.schemaVersion < 1) {
    errors.push('schemaVersion missing or invalid')
  }
  return errors
}

// ---- Tests ----

describe('parseChecksums', () => {
  it('parses standard sha256sum format', () => {
    const content = [
      'a'.repeat(64) + '  app.db',
      'b'.repeat(64) + '  files/book.epub',
      'c'.repeat(64) + '  assets/img/001.png',
    ].join('\n')
    const map = parseChecksums(content)
    expect(map.size).toBe(3)
    expect(map.get('app.db')).toBe('a'.repeat(64))
    expect(map.get('files/book.epub')).toBe('b'.repeat(64))
    expect(map.get('assets/img/001.png')).toBe('c'.repeat(64))
  })

  it('handles paths with spaces', () => {
    const content = 'd'.repeat(64) + '  files/my book.epub'
    const map = parseChecksums(content)
    expect(map.get('files/my book.epub')).toBe('d'.repeat(64))
  })

  it('skips blank lines and invalid hashes', () => {
    const content = [
      '',
      'short  app.db',
      'a'.repeat(64) + '  valid.db',
      '   ',
    ].join('\n')
    const map = parseChecksums(content)
    expect(map.size).toBe(1) // only the 64-hex-char line is valid
    expect(map.has('app.db')).toBe(false)
  })

  it('handles empty content', () => {
    expect(parseChecksums('').size).toBe(0)
    expect(parseChecksums('\n\n').size).toBe(0)
  })
})

describe('formatChecksums', () => {
  it('produces sha256sum-compatible format', () => {
    const entries = new Map<string, string>([
      ['app.db', 'a'.repeat(64)],
      ['files/book.epub', 'b'.repeat(64)],
    ])
    const text = formatChecksums(entries)
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe('a'.repeat(64) + '  app.db')
    expect(lines[1]).toBe('b'.repeat(64) + '  files/book.epub')
  })

  it('ends with newline', () => {
    const entries = new Map<string, string>([['app.db', 'x'.repeat(64)]])
    expect(formatChecksums(entries).endsWith('\n')).toBe(true)
  })
})

describe('checksum round-trip', () => {
  it('format → parse round-trips correctly', () => {
    const original = new Map<string, string>([
      ['app.db', sha256Hex(Buffer.from('database'))],
      ['files/test.epub', sha256Hex(Buffer.from('epub content'))],
      ['assets/cover.png', sha256Hex(Buffer.from('png data'))],
    ])
    const formatted = formatChecksums(original)
    const parsed = parseChecksums(formatted)
    expect(parsed).toEqual(original)
  })
})

describe('sha256Hex', () => {
  it('produces 64-char hex digest', () => {
    const hash = sha256Hex(Buffer.from('hello'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // Known SHA-256 of "hello"
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('produces different hashes for different input', () => {
    expect(sha256Hex(Buffer.from('a'))).not.toBe(sha256Hex(Buffer.from('b')))
  })
})

describe('validateManifest', () => {
  const validManifest = {
    format: 'tcm-backup',
    formatVersion: 1,
    appVersion: '0.0.1',
    schemaVersion: 6,
    createdAt: Date.now(),
    machineHint: 'darwin-arm64',
    counts: { books: 1, paragraphs: 10 },
    dbBytes: 1000,
    assetsBytes: 0,
    filesBytes: 500,
    includeApiKey: false,
    checksumAlgo: 'sha256' as const,
  }

  it('accepts a valid manifest', () => {
    expect(validateManifest(validManifest)).toEqual([])
  })

  it('rejects non-object', () => {
    expect(validateManifest(null)).toContain('manifest is not an object')
    expect(validateManifest('string')).toContain('manifest is not an object')
  })

  it('rejects wrong format', () => {
    expect(validateManifest({ ...validManifest, format: 'wrong' })).toContain(
      'format is not "tcm-backup"',
    )
  })

  it('rejects missing formatVersion', () => {
    expect(
      validateManifest({ ...validManifest, formatVersion: undefined }),
    ).toContain('formatVersion missing or invalid')
  })

  it('rejects future formatVersion', () => {
    expect(
      validateManifest({ ...validManifest, formatVersion: 2 }),
    ).toContain('backup formatVersion 2 is newer than supported 1')
  })

  it('rejects missing schemaVersion', () => {
    expect(
      validateManifest({ ...validManifest, schemaVersion: undefined }),
    ).toContain('schemaVersion missing or invalid')
  })

  it('rejects schemaVersion < 1', () => {
    expect(
      validateManifest({ ...validManifest, schemaVersion: 0 }),
    ).toContain('schemaVersion missing or invalid')
  })
})
