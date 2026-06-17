import type { DB } from './connection'
import { getDb, resetDbFiles } from './connection'

const SCHEMA_ID = '2026-06-current-builtin-study-v1'
const SCHEMA_VERSION = 1

const META_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

const CURRENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS books (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    author        TEXT,
    source_format TEXT NOT NULL,
    source_file   TEXT NOT NULL,
    cover         TEXT,
    category      TEXT,
    imported_at   INTEGER NOT NULL,
    parse_version INTEGER NOT NULL DEFAULT 1,
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
    created_at   INTEGER NOT NULL,
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

  CREATE TABLE IF NOT EXISTS dictionary_terms (
    term_id      TEXT PRIMARY KEY,
    term         TEXT NOT NULL,
    definition   TEXT,
    source       TEXT,
    category     TEXT,
    attributes   TEXT,
    created_by   TEXT NOT NULL,
    paragraph_id TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_dict_term ON dictionary_terms(term);
  CREATE INDEX IF NOT EXISTS idx_dict_category ON dictionary_terms(category);

  CREATE TABLE IF NOT EXISTS term_occurrences (
    term_id      TEXT NOT NULL,
    paragraph_id TEXT NOT NULL,
    count        INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (term_id, paragraph_id),
    FOREIGN KEY (term_id)      REFERENCES dictionary_terms(term_id) ON DELETE CASCADE,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_occ_paragraph ON term_occurrences(paragraph_id);

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

  CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    icon TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES notebooks(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_notebooks_parent ON notebooks(parent_id, sort_order);

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    book_id TEXT,
    chapter_id TEXT,
    paragraph_id TEXT,
    notebook_id TEXT,
    word_count INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE SET NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_paragraph ON notes(paragraph_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id, deleted_at, updated_at);
  CREATE INDEX IF NOT EXISTS idx_notes_chapter ON notes(chapter_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_book ON notes(book_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(deleted_at, updated_at DESC);

  CREATE TABLE IF NOT EXISTS note_links (
    id TEXT PRIMARY KEY,
    source_note_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_alias TEXT,
    display_text TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_note_links ON note_links(source_note_id, target_type, target_id);

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tag_refs (
    id TEXT PRIMARY KEY,
    tag_id TEXT NOT NULL,
    ref_type TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
    UNIQUE (tag_id, ref_type, ref_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tag_refs_target ON tag_refs(ref_type, ref_id);
  CREATE INDEX IF NOT EXISTS idx_tag_refs_tag ON tag_refs(tag_id);

  CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(
    note_id UNINDEXED,
    title,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS trg_notes_ai AFTER INSERT ON notes
  WHEN new.deleted_at IS NULL
  BEGIN
    INSERT INTO fts_notes(note_id, title, content) VALUES (new.id, new.title, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS trg_notes_ad AFTER DELETE ON notes
  BEGIN
    DELETE FROM fts_notes WHERE note_id = old.id;
  END;

  CREATE TRIGGER IF NOT EXISTS trg_notes_au AFTER UPDATE OF title, content ON notes
  WHEN new.deleted_at IS NULL
  BEGIN
    DELETE FROM fts_notes WHERE note_id = old.id;
    INSERT INTO fts_notes(note_id, title, content) VALUES (new.id, new.title, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS trg_notes_softdel AFTER UPDATE OF deleted_at ON notes
  WHEN new.deleted_at IS NOT NULL AND old.deleted_at IS NULL
  BEGIN
    DELETE FROM fts_notes WHERE note_id = new.id;
  END;

  CREATE TABLE IF NOT EXISTS ai_cache (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    kind TEXT NOT NULL,
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

function hasAppTables(db: DB): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS found
       FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'
         AND name <> 'schema_meta'
       LIMIT 1`,
    )
    .get() as { found: number } | undefined
  return row != null
}

function schemaId(db: DB): string | undefined {
  try {
    const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_id') as
      | { value?: string }
      | undefined
    return row?.value
  } catch {
    return undefined
  }
}

function writeMeta(db: DB): void {
  const upsertMeta = db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
  upsertMeta.run('schema_id', SCHEMA_ID)
  upsertMeta.run('version', String(SCHEMA_VERSION))
}

export function prepareDatabase(): number {
  let db = getDb()
  db.exec(META_TABLE)

  const currentSchemaId = schemaId(db)
  if (currentSchemaId !== SCHEMA_ID && (currentSchemaId != null || hasAppTables(db))) {
    resetDbFiles()
    db = getDb()
    db.exec(META_TABLE)
  }

  db.transaction(() => {
    db.exec(CURRENT_SCHEMA)
    writeMeta(db)
  })()

  return SCHEMA_VERSION
}
