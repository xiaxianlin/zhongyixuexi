import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Static-analysis test for the current FTS5 schema.
 *
 * better-sqlite3 is a native addon whose ABI must match Electron's, not the
 * host Node/Vitest ABI in this repo. That means we cannot spin up a real DB
 * here. Instead we assert that the schema source text contains the load-bearing SQL
 * fragments (FTS5 external-content DDL, trigram tokenizer, the three triggers,
 * and the WHEN-clause filters that keep soft-deleted / noise segments out of
 * the index). This guards against regressions in the slice's core contract.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(__dirname, 'schema.ts'), 'utf8')

describe('schema.ts fts_paragraphs schema', () => {
  it('declares the current schema version through SQLite user_version', () => {
    expect(source).toContain('CURRENT_SCHEMA_VERSION')
    expect(source).toContain('user_version')
  })

  it('creates the fts_paragraphs external-content FTS5 table', () => {
    expect(source).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS fts_paragraphs USING fts5')
    expect(source).toContain("content='paragraphs'")
    expect(source).toContain("content_rowid='rowid'")
  })

  it('uses the trigram tokenizer (05-search.md §4.1.4 decision)', () => {
    expect(source).toContain('tokenize')
    expect(source).toContain('trigram')
  })

  it('defines the three sync triggers (ai/ad/au)', () => {
    expect(source).toContain('paragraphs_ai')
    expect(source).toContain('paragraphs_ad')
    expect(source).toContain('paragraphs_au')
  })

  it('insert trigger filters on deleted_at IS NULL AND is_noise = 0', () => {
    expect(source).toContain('new.deleted_at IS NULL AND new.is_noise = 0')
  })

  it('delete trigger uses the FTS5 external-content delete command', () => {
    expect(source).toContain("VALUES ('delete', old.rowid, old.text)")
  })

  it('update trigger re-inserts only live non-noise rows (soft-delete eviction)', () => {
    // au: delete old, then SELECT ... WHERE new.deleted_at IS NULL AND new.is_noise = 0
    expect(source).toContain('SELECT new.rowid, new.text')
    expect(source).toContain('WHERE new.deleted_at IS NULL AND new.is_noise = 0')
  })
})
