import { getDb, resetDbFiles } from './connection'
import { runMigrations, hasLegacySchemaMeta } from './migrate'

const CURRENT_SCHEMA_VERSION = 4

const CURRENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS books (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    author        TEXT,
    cover         TEXT,
    category      TEXT,
    order_index   INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS chapters (
    id           TEXT PRIMARY KEY,
    book_id      TEXT NOT NULL,
    parent_id    TEXT,
    order_index  INTEGER NOT NULL,
    level        TEXT,
    title        TEXT NOT NULL,
    content_hash TEXT,
    content      TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER,
    deleted_at   INTEGER,
    FOREIGN KEY (book_id)   REFERENCES books(id)    ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES chapters(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_chapters_parent ON chapters(parent_id);

  CREATE TABLE IF NOT EXISTS paragraphs (
    id           TEXT PRIMARY KEY,
    chapter_id   TEXT NOT NULL,
    order_index  INTEGER NOT NULL,
    text         TEXT NOT NULL,
    edited       INTEGER NOT NULL DEFAULT 0,
    parse_hash   TEXT,
    is_noise     INTEGER NOT NULL DEFAULT 0,
    quality_flag TEXT,
    created_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_paragraphs_chapter ON paragraphs(chapter_id) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_paragraphs_hash ON paragraphs(parse_hash);

  CREATE VIRTUAL TABLE IF NOT EXISTS fts_paragraphs USING fts5(
    text,
    content='paragraphs',
    content_rowid='rowid',
    tokenize='trigram'
  );

  CREATE TRIGGER IF NOT EXISTS paragraphs_ai
  AFTER INSERT ON paragraphs
  WHEN new.deleted_at IS NULL AND new.is_noise = 0
  BEGIN
    INSERT INTO fts_paragraphs(rowid, text) VALUES (new.rowid, new.text);
  END;

  CREATE TRIGGER IF NOT EXISTS paragraphs_ad
  AFTER DELETE ON paragraphs
  BEGIN
    INSERT INTO fts_paragraphs(fts_paragraphs, rowid, text)
      VALUES ('delete', old.rowid, old.text);
  END;

  CREATE TRIGGER IF NOT EXISTS paragraphs_au
  AFTER UPDATE ON paragraphs
  BEGIN
    INSERT INTO fts_paragraphs(fts_paragraphs, rowid, text)
      VALUES ('delete', old.rowid, old.text);
    INSERT INTO fts_paragraphs(rowid, text)
      SELECT new.rowid, new.text
      WHERE new.deleted_at IS NULL AND new.is_noise = 0;
  END;

  CREATE TABLE IF NOT EXISTS reading_progress (
    book_id      TEXT    NOT NULL,
    chapter_id   TEXT    NOT NULL,
    paragraph_id TEXT    NOT NULL,
    scroll_ratio REAL    NOT NULL DEFAULT 0,
    read_seconds INTEGER NOT NULL DEFAULT 0,
    percent      REAL    NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (book_id),
    FOREIGN KEY (book_id)      REFERENCES books(id)      ON DELETE CASCADE,
    FOREIGN KEY (chapter_id)   REFERENCES chapters(id)   ON DELETE CASCADE,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
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
    paragraph_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_paragraph ON notes(paragraph_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_chapter ON notes(chapter_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(deleted_at, updated_at DESC);

  CREATE TABLE IF NOT EXISTS ai_cache (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope = 'paragraph'),
    scope_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind = 'modern'),
    paragraph_id TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    response TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    invalidated INTEGER NOT NULL DEFAULT 0,
    meta TEXT,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_ai_cache_hit ON ai_cache(scope_id, kind, prompt_hash, invalidated);
  CREATE INDEX IF NOT EXISTS idx_ai_cache_scope ON ai_cache(scope, scope_id, kind);
  CREATE INDEX IF NOT EXISTS idx_ai_cache_paragraph ON ai_cache(paragraph_id) WHERE paragraph_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS paragraph_analyses (
    id TEXT PRIMARY KEY,
    paragraph_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'modern',
    version INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    modern TEXT,
    explanation TEXT,
    analysis TEXT,
    summary TEXT,
    model TEXT,
    prompt_hash TEXT,
    cache_id TEXT,
    source TEXT NOT NULL DEFAULT 'ai',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    meta TEXT,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE,
    FOREIGN KEY (cache_id) REFERENCES ai_cache(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_paragraph_analyses_paragraph ON paragraph_analyses(paragraph_id, kind, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_paragraph_analyses_active ON paragraph_analyses(paragraph_id, kind)
    WHERE is_active = 1;
`

export function prepareDatabase(): number {
  let db = getDb()

  const currentVersion = db.pragma('user_version', { simple: true }) as number

  // First-release reset policy: any DB below the shipped version is a dev-era
  // leftover (the old schema_meta-based runner, or a v2 build) with an
  // incompatible column layout and no real user data. Reset so CURRENT_SCHEMA
  // rebuilds it cleanly + seedBuiltinContent repopulates the classics.
  //
  //   user_version < 3 (and > 0)         → reset (v2 dev build)
  //   user_version = 0 + schema_meta table → reset (pre-reset-era dev build)
  //   user_version = 0, no tables        → fresh DB, just apply CURRENT_SCHEMA
  //   user_version = 3                   → already current, NO reset (data kept)
  //
  // From v3 onward, upgrades are forward-only via runMigrations — user data
  // survives every future version bump.
  const needsReset =
    (currentVersion > 0 && currentVersion < CURRENT_SCHEMA_VERSION) ||
    (currentVersion === 0 && hasLegacySchemaMeta(db))
  if (needsReset) {
    resetDbFiles()
    db = getDb()
  }

  db.transaction(() => {
    db.exec(CURRENT_SCHEMA)
    // Idempotent backfill: add books.order_index to a v3 DB that predates the
    // column (CREATE TABLE IF NOT EXISTS won't add it to an existing table).
    // No-op once the column exists; existing rows keep rowid order.
    const cols = db.prepare('PRAGMA table_info(books)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'order_index')) {
      db.exec('ALTER TABLE books ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0')
      const rows = db.prepare('SELECT id FROM books ORDER BY rowid').all() as { id: string }[]
      const stmt = db.prepare('UPDATE books SET order_index = ? WHERE id = ?')
      rows.forEach((row, i) => stmt.run(i, row.id))
    }
    runMigrations(db)
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
  })()

  return CURRENT_SCHEMA_VERSION
}
