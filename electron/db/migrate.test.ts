import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Static-analysis test for the v4 detail-revamp migration.
 *
 * better-sqlite3 is a native addon whose ABI must match Electron's, not the
 * host Node/Vitest ABI in this repo, so we cannot spin up a real DB here (see
 * fts.test.ts for the same constraint). Instead we assert the migration source
 * contains the load-bearing SQL fragments that back the v3.1 detail page, and
 * that migrate.ts registers it as version 4.
 *
 * What this guards (from docs/tech/20260622-detail-revamp.md §3):
 *  - chapters.content + updated_at columns (reading pane source of truth)
 *  - chapter_analyses active-unique table (mirrors paragraph_analyses)
 *  - excerpts (selection-anchored highlights)
 *  - notes selection columns (start/end/quote/stale)
 *  - ai_threads / ai_messages (chapter-scoped chat)
 *  - ai_cache rebuild with widened scope/kind CHECK
 *  - fts_chapters FTS5 trigram + three triggers
 *  - forward-only + idempotent (IF NOT EXISTS / column guards)
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationSource = readFileSync(
  join(__dirname, 'migrations/0004_detail_revamp.ts'),
  'utf8',
)
const migrateSource = readFileSync(join(__dirname, 'migrate.ts'), 'utf8')

describe('0004_detail_revamp migration registration', () => {
  it('is registered as version 4 in MIGRATIONS', () => {
    expect(migrateSource).toMatch(/version:\s*4/)
    expect(migrateSource).toContain("name: 'detail_revamp'")
    expect(migrateSource).toContain("up as up0004")
    expect(migrateSource).toContain("from './migrations/0004_detail_revamp'")
  })
})

describe('0004_detail_revamp books.category backfill', () => {
  it('normalizes built-in classics to classic and the rest to modern', () => {
    expect(migrationSource).toContain("UPDATE books SET category = 'classic'")
    expect(migrationSource).toContain("UPDATE books SET category = 'modern'")
    // All five built-in classics are listed
    expect(migrationSource).toContain('黄帝内经·素问')
    expect(migrationSource).toContain('黄帝内经·灵枢')
    expect(migrationSource).toContain('黄帝八十一难经')
    expect(migrationSource).toContain('伤寒论')
    expect(migrationSource).toContain('金匮要略')
  })
})

describe('0004_detail_revamp chapters.content + updated_at', () => {
  it('adds content and updated_at columns guarded by columnExists', () => {
    expect(migrationSource).toContain("columnExists(db, 'chapters', 'content')")
    expect(migrationSource).toContain("ALTER TABLE chapters ADD COLUMN content TEXT")
    expect(migrationSource).toContain("columnExists(db, 'chapters', 'updated_at')")
    expect(migrationSource).toContain(
      'ALTER TABLE chapters ADD COLUMN updated_at INTEGER',
    )
  })

  it('backfills updated_at from created_at', () => {
    expect(migrationSource).toContain(
      'UPDATE chapters SET updated_at = created_at WHERE updated_at IS NULL',
    )
  })

  it('backfills chapters.content from paragraph text joined by blank lines', () => {
    expect(migrationSource).toContain('backfillChapterContent')
    // selects live paragraphs ordered by order_index, created_at
    expect(migrationSource).toContain('ORDER BY order_index, created_at')
    // joins with double newline (v3.1 reading-pane convention)
    expect(migrationSource).toContain(".map((p) => p.text).join('\\n\\n')")
  })
})

describe('0004_detail_revamp chapter_analyses table', () => {
  it('creates the table mirroring paragraph_analyses with active-unique index', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS chapter_analyses')
    expect(migrationSource).toContain('chapter_id   TEXT NOT NULL')
    expect(migrationSource).toContain('modern       TEXT')
    expect(migrationSource).toContain('explanation  TEXT')
    expect(migrationSource).toContain('analysis     TEXT')
    expect(migrationSource).toContain('summary      TEXT')
    expect(migrationSource).toContain('cache_id     TEXT')
    // FK chapter CASCADE, cache SET NULL (00-arch §5)
    expect(migrationSource).toMatch(
      /FOREIGN KEY \(chapter_id\) REFERENCES chapters\(id\) ON DELETE CASCADE/,
    )
    expect(migrationSource).toMatch(
      /FOREIGN KEY \(cache_id\)\s+REFERENCES ai_cache\(id\)\s+ON DELETE SET NULL/,
    )
    // active-unique partial index (mirrors paragraph_analyses)
    expect(migrationSource).toContain('uq_chapter_analyses_active')
    expect(migrationSource).toContain('WHERE is_active = 1')
  })
})

describe('0004_detail_revamp excerpts table', () => {
  it('creates the selection-anchored excerpts table with range index', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS excerpts')
    expect(migrationSource).toContain('start_offset  INTEGER NOT NULL')
    expect(migrationSource).toContain('end_offset    INTEGER NOT NULL')
    expect(migrationSource).toContain('excerpt_text  TEXT NOT NULL')
    expect(migrationSource).toContain('stale         INTEGER NOT NULL DEFAULT 0')
    expect(migrationSource).toContain(
      'FOREIGN KEY (book_id)    REFERENCES books(id)    ON DELETE CASCADE',
    )
    expect(migrationSource).toContain(
      'FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE',
    )
    expect(migrationSource).toContain(
      'idx_excerpts_chapter ON excerpts(chapter_id, start_offset)',
    )
  })
})

describe('0004_detail_revamp notes selection columns', () => {
  it('adds start_offset / end_offset / quote_text / stale (nullable, legacy-safe)', () => {
    expect(migrationSource).toContain("columnExists(db, 'notes', 'start_offset')")
    expect(migrationSource).toContain('ALTER TABLE notes ADD COLUMN start_offset INTEGER')
    expect(migrationSource).toContain('ALTER TABLE notes ADD COLUMN end_offset INTEGER')
    expect(migrationSource).toContain('ALTER TABLE notes ADD COLUMN quote_text TEXT')
    expect(migrationSource).toContain(
      'ALTER TABLE notes ADD COLUMN stale INTEGER NOT NULL DEFAULT 0',
    )
  })
})

describe('0004_detail_revamp ai_threads / ai_messages', () => {
  it('creates one-thread-per-chapter (uq) and messages with role CHECK', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS ai_threads')
    expect(migrationSource).toContain('chapter_id  TEXT NOT NULL')
    expect(migrationSource).toContain('uq_ai_threads_chapter ON ai_threads(chapter_id)')
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS ai_messages')
    expect(migrationSource).toContain(
      "CHECK (role IN ('user', 'assistant', 'system'))",
    )
    expect(migrationSource).toContain('quote_text        TEXT')
    expect(migrationSource).toContain('quote_start       INTEGER')
    expect(migrationSource).toContain('quote_end         INTEGER')
    expect(migrationSource).toContain(
      'FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE',
    )
  })
})

describe('0004_detail_revamp ai_cache rebuild', () => {
  it('rebuilds ai_cache with widened scope/kind CHECK (idempotent guard)', () => {
    // guard so it only runs once
    expect(migrationSource).toContain('aiCacheIsNarrow')
    expect(migrationSource).toContain("scope = 'paragraph'")
    // widened CHECK allows chapter + chat in addition to paragraph/modern
    expect(migrationSource).toContain(
      "CHECK (scope IN ('paragraph', 'chapter', 'chat'))",
    )
    expect(migrationSource).toContain(
      "CHECK (kind IN ('modern', 'chapter', 'chat'))",
    )
    // copies rows, drops, renames
    expect(migrationSource).toContain('CREATE TABLE ai_cache_new')
    expect(migrationSource).toContain('INSERT INTO ai_cache_new')
    expect(migrationSource).toContain('DROP TABLE ai_cache')
    expect(migrationSource).toContain('ALTER TABLE ai_cache_new RENAME TO ai_cache')
  })

  it('makes paragraph_id nullable in the rebuilt cache (chat/chapter rows have none)', () => {
    // The rebuilt table declares paragraph_id TEXT (no NOT NULL) so chapter/chat
    // cache rows can store null.
    expect(migrationSource).toContain('paragraph_id TEXT,\n      prompt_hash')
  })
})

describe('0004_detail_revamp fts_chapters', () => {
  it('creates the FTS5 trigram table over chapters.content with three triggers', () => {
    expect(migrationSource).toContain('CREATE VIRTUAL TABLE fts_chapters USING fts5')
    expect(migrationSource).toContain("content='chapters'")
    expect(migrationSource).toContain("content_rowid='rowid'")
    expect(migrationSource).toContain('trigram')
    expect(migrationSource).toContain('chapters_ai')
    expect(migrationSource).toContain('chapters_ad')
    expect(migrationSource).toContain('chapters_au')
  })

  it('seeds the index once via rebuild (idempotent guard on table existence)', () => {
    expect(migrationSource).toContain("tableExists(db, 'fts_chapters')")
    expect(migrationSource).toContain(
      "INSERT INTO fts_chapters(fts_chapters) VALUES ('rebuild')",
    )
  })

  it('insert/update triggers skip empty or soft-deleted chapters', () => {
    expect(migrationSource).toContain(
      'new.deleted_at IS NULL AND new.content IS NOT NULL',
    )
  })
})

describe('0004_detail_revamp forward-only / idempotency', () => {
  it('uses column-existence guards for all ALTER TABLE ADD COLUMN', () => {
    const alterCount = (migrationSource.match(/ALTER TABLE \w+ ADD COLUMN/g) || []).length
    const guardCount = (migrationSource.match(/columnExists\(db/g) || []).length
    // every ADD COLUMN is preceded by a columnExists guard
    expect(alterCount).toBeGreaterThan(0)
    expect(guardCount).toBeGreaterThanOrEqual(alterCount)
  })

  it('uses IF NOT EXISTS for every CREATE TABLE / INDEX', () => {
    const creates = migrationSource.match(/CREATE (TABLE|INDEX|UNIQUE INDEX|VIRTUAL TABLE)/g) || []
    const guarded = migrationSource.match(/CREATE (TABLE|INDEX|UNIQUE INDEX|VIRTUAL TABLE) IF NOT EXISTS/g) || []
    // the only non-guarded creates are ai_cache_new + its post-rename indexes
    // (intentional — they run inside the one-shot rebuildAiCache path)
    expect(creates.length - guarded.length).toBeLessThanOrEqual(4)
  })
})
