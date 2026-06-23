/**
 * Database schema for the v3.1 chapter-level model.
 *
 * Design (reset era — no forward migrations, no legacy data):
 *  - The reading atom is a CHAPTER (chapters.content holds the whole-chapter
 *    plain text). There is NO paragraphs table; selection excerpts and notes
 *    anchor against chapters.content by UTF-16 offsets.
 *  - AI analysis is chapter-level (chapter_analyses, active-unique). There is
 *    NO paragraph_analyses table.
 *  - Full-text search indexes chapters.content via fts_chapters (trigram).
 *    There is NO fts_paragraphs table.
 *  - Notes bind to a chapter (+ optional selection range), never to a paragraph.
 *
 * prepareDatabase() applies CURRENT_SCHEMA on every launch. Any DB whose
 * user_version differs from CURRENT_SCHEMA_VERSION is treated as a dev-era
 * leftover and reset (delete + recreate), since there is no production user
 * data to preserve. This keeps the schema a single source of truth.
 *
 * Hard constraints (AGENTS.md / 00-architecture §5) preserved:
 *  - PRAGMA foreign_keys = ON is set per-connection in connection.ts.
 *  - Child tables declare ON DELETE CASCADE / SET NULL explicitly.
 *  - fts_chapters sync is owned by this module (ai/ad/au triggers + the editing
 *    service is the only writer of chapters.content).
 */
import { getDb, resetDbFiles } from './connection'
import { hasLegacySchemaMeta } from './migrate'

const CURRENT_SCHEMA_VERSION = 4

const CURRENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS books (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    author        TEXT,
    cover         TEXT,
    category      TEXT NOT NULL DEFAULT 'modern',
    order_index   INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    CHECK (category IN ('classic', 'modern'))
  );

  CREATE TABLE IF NOT EXISTS chapters (
    id           TEXT PRIMARY KEY,
    book_id      TEXT NOT NULL,
    parent_id    TEXT,
    order_index  INTEGER NOT NULL,
    level        TEXT,
    title        TEXT NOT NULL,
    content_hash TEXT,
    content      TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    FOREIGN KEY (book_id)   REFERENCES books(id)    ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES chapters(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_chapters_parent ON chapters(parent_id);

  -- Chapter-level full-text index (trigram). Replaces the old fts_paragraphs.
  CREATE VIRTUAL TABLE IF NOT EXISTS fts_chapters USING fts5(
    content,
    content='chapters',
    content_rowid='rowid',
    tokenize='trigram'
  );

  CREATE TRIGGER IF NOT EXISTS chapters_ai
  AFTER INSERT ON chapters
  WHEN new.deleted_at IS NULL AND new.content IS NOT NULL AND new.content != ''
  BEGIN
    INSERT INTO fts_chapters(rowid, content) VALUES (new.rowid, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS chapters_ad
  AFTER DELETE ON chapters
  BEGIN
    INSERT INTO fts_chapters(fts_chapters, rowid, content)
      VALUES ('delete', old.rowid, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS chapters_au
  AFTER UPDATE ON chapters
  BEGIN
    INSERT INTO fts_chapters(fts_chapters, rowid, content)
      VALUES ('delete', old.rowid, old.content);
    INSERT INTO fts_chapters(rowid, content)
      SELECT new.rowid, new.content
      WHERE new.deleted_at IS NULL AND new.content IS NOT NULL AND new.content != '';
  END;

  CREATE TABLE IF NOT EXISTS reading_progress (
    book_id      TEXT    NOT NULL,
    chapter_id   TEXT    NOT NULL,
    scroll_ratio REAL    NOT NULL DEFAULT 0,
    read_seconds INTEGER NOT NULL DEFAULT 0,
    percent      REAL    NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (book_id),
    FOREIGN KEY (book_id)    REFERENCES books(id)    ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_reading_progress_updated ON reading_progress(updated_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_credentials (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    label TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    api_key_enc BLOB,
    key_iv_hint TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credentials_provider ON api_credentials(provider);
  CREATE INDEX IF NOT EXISTS idx_credentials_active ON api_credentials(is_active) WHERE is_active = 1;

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    book_id TEXT,
    chapter_id TEXT,
    start_offset INTEGER,
    end_offset INTEGER,
    quote_text TEXT,
    stale INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (book_id)    REFERENCES books(id)    ON DELETE SET NULL,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_chapter ON notes(chapter_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_chapter_range ON notes(chapter_id, start_offset);
  CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(deleted_at, updated_at DESC);

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

  CREATE TABLE IF NOT EXISTS ai_cache (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('chapter', 'chat')),
    scope_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('chapter', 'chat')),
    prompt_hash TEXT NOT NULL,
    response TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    invalidated INTEGER NOT NULL DEFAULT 0,
    meta TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ai_cache_hit ON ai_cache(scope_id, kind, prompt_hash, invalidated);
  CREATE INDEX IF NOT EXISTS idx_ai_cache_scope ON ai_cache(scope, scope_id, kind);

  CREATE TABLE IF NOT EXISTS chapter_analyses (
    id           TEXT PRIMARY KEY,
    chapter_id   TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'chapter',
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
    FOREIGN KEY (cache_id)   REFERENCES ai_cache(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chapter_analyses_chapter ON chapter_analyses(chapter_id, kind, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_analyses_active ON chapter_analyses(chapter_id, kind) WHERE is_active = 1;
`

export function prepareDatabase(): number {
  let db = getDb()

  const currentVersion = db.pragma('user_version', { simple: true }) as number

  // Reset policy (no forward migrations in the reset era): any DB whose
  // user_version differs from the current version, or a pre-reset-era DB
  // (schema_meta table), is wiped and rebuilt from CURRENT_SCHEMA. There is no
  // production user data to preserve; seedBuiltinContent repopulates classics.
  const needsReset =
    (currentVersion > 0 && currentVersion !== CURRENT_SCHEMA_VERSION) ||
    (currentVersion === 0 && hasLegacySchemaMeta(db))
  if (needsReset) {
    resetDbFiles()
    db = getDb()
  }

  db.transaction(() => {
    db.exec(CURRENT_SCHEMA)
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
  })()

  return CURRENT_SCHEMA_VERSION
}
