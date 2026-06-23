/**
 * Schema v4 — detail page revamp (2026-06-22 idea).
 *
 * Adds the tables/columns that back the v3.1 detail page:
 *  - books.category normalized to 'classic' | 'modern'
 *  - chapters.content (whole-chapter plain text) + chapters.updated_at
 *  - chapter_analyses (active-unique, mirrors paragraph_analyses shape)
 *  - excerpts (selection-anchored highlights)
 *  - notes selection columns (start/end offset, quote, stale)
 *  - ai_threads / ai_messages (chapter-scoped chat)
 *  - ai_cache.scope/kind widened (table rebuild — owned by the AI module)
 *  - fts_chapters (FTS5 trigram over chapters.content, IMP-module-owned)
 *
 * Hard constraints (00-architecture §5) preserved:
 *  - paragraphs' TEXT PK + implicit rowid untouched; fts_paragraphs untouched.
 *  - child tables keep ON DELETE CASCADE / SET NULL.
 *  - forward-only: no DROP of stable ids; only ALTER ADD + idempotent CREATE.
 *  - fts_chapters sync stays in the IMP module (triggers + editing service).
 *
 * Idempotent: safe to re-run (guarded by PRAGMA table_info / IF NOT EXISTS).
 * The ai_cache rebuild is the one non-trivially-mutating step; it is guarded
 * by a CHECK-constraint probe so it only runs once.
 */
import type { DB } from '../connection'

/** Titles of the built-in classics (see data/*-original.json + builtin-content.ts). */
const BUILTIN_CLASSIC_TITLES = [
  '黄帝内经·素问',
  '黄帝内经·灵枢',
  '黄帝八十一难经',
  '伤寒论',
  '金匮要略',
]

function columnExists(db: DB, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some((c) => c.name === column)
}

function tableExists(db: DB, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`)
    .get(table) as { name: string } | undefined
  return row !== undefined
}

/** True when ai_cache still has the narrow v3 CHECK (scope = 'paragraph'). */
function aiCacheIsNarrow(db: DB): boolean {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_cache'").get() as
    | { sql: string }
    | undefined
  if (!sql) return false
  return sql.sql.includes("scope = 'paragraph'")
}

/** Backfill chapters.content by concatenating each chapter's live paragraphs. */
function backfillChapterContent(db: DB): void {
  const chapters = db
    .prepare(
      `SELECT id FROM chapters
        WHERE deleted_at IS NULL AND (content IS NULL OR content = '')`,
    )
    .all() as { id: string }[]
  if (chapters.length === 0) return

  const sel = db.prepare(
    `SELECT text FROM paragraphs
       WHERE chapter_id = ? AND deleted_at IS NULL
       ORDER BY order_index, created_at`,
  )
  const upd = db.prepare(`UPDATE chapters SET content = ? WHERE id = ?`)
  for (const c of chapters) {
    const paras = sel.all(c.id) as { text: string }[]
    const content = paras.map((p) => p.text).join('\n\n')
    upd.run(content, c.id)
  }
}

/** Rebuild ai_cache with widened scope/kind CHECK constraints (owned by AI module). */
function rebuildAiCache(db: DB): void {
  if (!aiCacheIsNarrow(db)) return // already widened (idempotent guard)

  db.exec(`
    CREATE TABLE ai_cache_new (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK (scope IN ('paragraph', 'chapter', 'chat')),
      scope_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('modern', 'chapter', 'chat')),
      paragraph_id TEXT,
      prompt_hash TEXT NOT NULL,
      response TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      invalidated INTEGER NOT NULL DEFAULT 0,
      meta TEXT,
      FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE SET NULL
    );

    INSERT INTO ai_cache_new (
      id, scope, scope_id, kind, paragraph_id, prompt_hash, response, model,
      prompt_tokens, completion_tokens, total_tokens, created_at, invalidated, meta
    )
    SELECT id, scope, scope_id, kind, paragraph_id, prompt_hash, response, model,
           prompt_tokens, completion_tokens, total_tokens, created_at, invalidated, meta
      FROM ai_cache;

    DROP TABLE ai_cache;
    ALTER TABLE ai_cache_new RENAME TO ai_cache;

    CREATE INDEX IF NOT EXISTS idx_ai_cache_hit
      ON ai_cache(scope_id, kind, prompt_hash, invalidated);
    CREATE INDEX IF NOT EXISTS idx_ai_cache_scope
      ON ai_cache(scope, scope_id, kind);
    CREATE INDEX IF NOT EXISTS idx_ai_cache_paragraph
      ON ai_cache(paragraph_id) WHERE paragraph_id IS NOT NULL;
  `)
}

export function up(db: DB): void {
  // 1) books.category backfill (classic for built-ins, modern for the rest).
  const classicList = BUILTIN_CLASSIC_TITLES.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')
  db.exec(`
    UPDATE books SET category = 'classic'
      WHERE (category IS NULL OR category = '') AND title IN (${classicList});
    UPDATE books SET category = 'modern'
      WHERE (category IS NULL OR category = '');
  `)

  // 2) chapters.content + chapters.updated_at.
  if (!columnExists(db, 'chapters', 'content')) {
    db.exec('ALTER TABLE chapters ADD COLUMN content TEXT')
  }
  if (!columnExists(db, 'chapters', 'updated_at')) {
    db.exec('ALTER TABLE chapters ADD COLUMN updated_at INTEGER')
    db.exec('UPDATE chapters SET updated_at = created_at WHERE updated_at IS NULL')
  }
  backfillChapterContent(db)

  // 3) chapter_analyses (mirrors paragraph_analyses; FK chapter CASCADE, cache SET NULL).
  db.exec(`
    CREATE TABLE IF NOT EXISTS chapter_analyses (
      id           TEXT PRIMARY KEY,
      chapter_id   TEXT NOT NULL,
      kind         TEXT NOT NULL DEFAULT 'modern',
      version      INTEGER NOT NULL,
      is_active    INTEGER NOT NULL DEFAULT 1,
      modern       TEXT,
      explanation  TEXT,
      analysis     TEXT,
      summary      TEXT,
      model        TEXT,
      prompt_hash  TEXT,
      cache_id     TEXT,
      source       TEXT NOT NULL DEFAULT 'ai',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      meta         TEXT,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (cache_id)   REFERENCES ai_cache(id)  ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_analyses_chapter
      ON chapter_analyses(chapter_id, kind, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_analyses_active
      ON chapter_analyses(chapter_id, kind) WHERE is_active = 1;
  `)

  // 4) excerpts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS excerpts (
      id            TEXT PRIMARY KEY,
      book_id       TEXT NOT NULL,
      chapter_id    TEXT NOT NULL,
      start_offset  INTEGER NOT NULL,
      end_offset    INTEGER NOT NULL,
      excerpt_text  TEXT NOT NULL,
      note          TEXT,
      stale         INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (book_id)    REFERENCES books(id)    ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_excerpts_chapter ON excerpts(chapter_id, start_offset);
    CREATE INDEX IF NOT EXISTS idx_excerpts_book    ON excerpts(book_id, created_at DESC);
  `)

  // 5) notes selection columns (nullable; legacy paragraph notes stay valid).
  if (!columnExists(db, 'notes', 'start_offset')) {
    db.exec('ALTER TABLE notes ADD COLUMN start_offset INTEGER')
  }
  if (!columnExists(db, 'notes', 'end_offset')) {
    db.exec('ALTER TABLE notes ADD COLUMN end_offset INTEGER')
  }
  if (!columnExists(db, 'notes', 'quote_text')) {
    db.exec('ALTER TABLE notes ADD COLUMN quote_text TEXT')
  }
  if (!columnExists(db, 'notes', 'stale')) {
    db.exec('ALTER TABLE notes ADD COLUMN stale INTEGER NOT NULL DEFAULT 0')
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notes_chapter_range ON notes(chapter_id, start_offset)`,
  )

  // 6) ai_threads / ai_messages (chapter-scoped chat; one thread per chapter).
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_threads (
      id          TEXT PRIMARY KEY,
      book_id     TEXT NOT NULL,
      chapter_id  TEXT NOT NULL,
      title       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (book_id)    REFERENCES books(id)    ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_threads_chapter ON ai_threads(chapter_id);

    CREATE TABLE IF NOT EXISTS ai_messages (
      id                TEXT PRIMARY KEY,
      thread_id         TEXT NOT NULL,
      role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content           TEXT NOT NULL,
      quote_text        TEXT,
      quote_start       INTEGER,
      quote_end         INTEGER,
      model             TEXT,
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens      INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_messages_thread ON ai_messages(thread_id, created_at);
  `)

  // 7) ai_cache rebuild (widened CHECK). Must run BEFORE chapter_analyses FK is
  //    exercised with non-null cache_id — order here is fine because nothing has
  //    written chapter_analyses yet, but keep it last for clarity.
  rebuildAiCache(db)

  // 8) fts_chapters (FTS5 trigram over chapters.content). IMP-module-owned:
  //    triggers mirror fts_paragraphs; rebuild once to seed.
  if (!tableExists(db, 'fts_chapters')) {
    db.exec(`
      CREATE VIRTUAL TABLE fts_chapters USING fts5(
        content,
        content='chapters',
        content_rowid='rowid',
        tokenize='trigram'
      );

      CREATE TRIGGER chapters_ai
      AFTER INSERT ON chapters
      WHEN new.deleted_at IS NULL AND new.content IS NOT NULL AND new.content != ''
      BEGIN
        INSERT INTO fts_chapters(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER chapters_ad
      AFTER DELETE ON chapters
      BEGIN
        INSERT INTO fts_chapters(fts_chapters, rowid, content)
          VALUES ('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER chapters_au
      AFTER UPDATE ON chapters
      BEGIN
        INSERT INTO fts_chapters(fts_chapters, rowid, content)
          VALUES ('delete', old.rowid, old.content);
        INSERT INTO fts_chapters(rowid, content)
          SELECT new.rowid, new.content
          WHERE new.deleted_at IS NULL AND new.content IS NOT NULL AND new.content != '';
      END;
    `)
    // Seed the index from already-backfilled content. 'rebuild' reads every row.
    db.exec(`INSERT INTO fts_chapters(fts_chapters) VALUES ('rebuild');`)
  }
}
