import type { DB } from './connection'
import { getDb } from './connection'

type Migration = { version: number; name: string; up: (db: DB) => void }

/**
 * Inline migration registry. Schema migrations arrive with their owning slices
 * (S1.1 books/chapters/paragraphs, S4.4 migration-runner hardening, etc.).
 * Migrations are forward-only and MUST NOT drop stable ID columns (00-architecture §5.5).
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'bootstrap',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    },
  },
  {
    version: 2,
    name: 'content_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS books (
          id            TEXT PRIMARY KEY,
          title         TEXT NOT NULL,
          author        TEXT,
          source_format TEXT NOT NULL,        -- 'epub' (pdf later)
          source_file   TEXT NOT NULL,        -- relative path under files/
          cover         TEXT,                 -- relative path under covers/, nullable
          category      TEXT,
          imported_at   INTEGER NOT NULL,
          parse_version INTEGER NOT NULL DEFAULT 1,
          updated_at    INTEGER NOT NULL,
          deleted_at    INTEGER               -- soft delete (NULL = live)
        );

        CREATE TABLE IF NOT EXISTS chapters (
          id           TEXT PRIMARY KEY,       -- stable UUID (00-arch §5.2)
          book_id      TEXT NOT NULL,
          parent_id    TEXT,                    -- self-ref hierarchy (卷-品-篇)
          order_index  INTEGER NOT NULL,
          level        TEXT,                    -- e.g. '卷' / '品' / '篇'
          title        TEXT NOT NULL,
          content_hash TEXT,                    -- chapter-level fingerprint for re-parse
          created_at   INTEGER NOT NULL,
          deleted_at   INTEGER,
          FOREIGN KEY (book_id)   REFERENCES books(id)    ON DELETE CASCADE,
          FOREIGN KEY (parent_id) REFERENCES chapters(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_chapters_book   ON chapters(book_id)   WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_chapters_parent ON chapters(parent_id);

        -- paragraphs.id is TEXT (stable UUID); the implicit rowid is used by
        -- fts_paragraphs content_rowid (00-arch §5.2 double-key constraint).
        CREATE TABLE IF NOT EXISTS paragraphs (
          id                 TEXT PRIMARY KEY,
          chapter_id         TEXT NOT NULL,
          order_index        INTEGER NOT NULL,
          text               TEXT NOT NULL,
          content_modern     TEXT,              -- AI-generated (DeepSeek), nullable
          content_explanation TEXT,             -- AI-generated, nullable
          edited             INTEGER NOT NULL DEFAULT 0,  -- user hand-edited
          parse_hash         TEXT,              -- content fingerprint for re-parse mapping
          is_noise           INTEGER NOT NULL DEFAULT 0,  -- header/footer/watermark
          quality_flag       TEXT,              -- 'ok' | 'suspect'
          created_at         INTEGER NOT NULL,
          deleted_at         INTEGER,
          FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_paragraphs_chapter ON paragraphs(chapter_id) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_paragraphs_hash    ON paragraphs(parse_hash);
      `)
    },
  },
  {
    version: 3,
    name: 'fts_index',
    up: (db) => {
      // FTS5 external-content table (05-search.md §4.1).
      // content_rowid='rowid' binds to paragraphs' implicit rowid (00-arch §5.2).
      // trigram tokenizer chosen first-pass: no dictionary needed, strong
      // substring recall for classical/obscure TCM terms, zero native deps.
      // Only indexes live (deleted_at IS NULL) non-noise (is_noise=0) paragraphs;
      // the WHEN clauses keep soft-deleted / noise segments out of the index.
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_paragraphs USING fts5(
          text,
          content='paragraphs',
          content_rowid='rowid',
          tokenize='trigram'
        );

        -- paragraphs INSERT -> add to FTS index (only live, non-noise).
        -- NOTE: FK CASCADE deletes do NOT fire triggers in SQLite, so deleting a
        -- book/chapter will leave orphan FTS rows; IMP must rebuild() after bulk
        -- removal. These triggers cover the normal INSERT/UPDATE/DELETE paths.
        CREATE TRIGGER IF NOT EXISTS paragraphs_ai
        AFTER INSERT ON paragraphs
        WHEN new.deleted_at IS NULL AND new.is_noise = 0
        BEGIN
          INSERT INTO fts_paragraphs(rowid, text) VALUES (new.rowid, new.text);
        END;

        -- paragraphs DELETE -> remove from FTS index (external-content 'delete' cmd).
        CREATE TRIGGER IF NOT EXISTS paragraphs_ad
        AFTER DELETE ON paragraphs
        BEGIN
          INSERT INTO fts_paragraphs(fts_paragraphs, rowid, text)
            VALUES ('delete', old.rowid, old.text);
        END;

        -- paragraphs UPDATE -> delete old then conditionally re-insert new.
        -- A soft delete is an UPDATE setting deleted_at; this trigger first removes
        -- the old index row, then re-inserts only if still live & non-noise,
        -- effectively evicting soft-deleted segments from the index.
        CREATE TRIGGER IF NOT EXISTS paragraphs_au
        AFTER UPDATE ON paragraphs
        BEGIN
          INSERT INTO fts_paragraphs(fts_paragraphs, rowid, text)
            VALUES ('delete', old.rowid, old.text);
          INSERT INTO fts_paragraphs(rowid, text)
            SELECT new.rowid, new.text
            WHERE new.deleted_at IS NULL AND new.is_noise = 0;
        END;
      `)
    },
  },
]

const META_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

/** Runs all pending migrations in order. Returns the resulting schema version. */
export function runMigrations(): number {
  const db = getDb()
  db.exec(META_TABLE)

  const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version') as
    | { value?: string }
    | undefined
  let current = row?.value ? Number(row.value) : 0

  const upsertVersion = db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    db.transaction(() => {
      m.up(db)
      upsertVersion.run(String(m.version))
    })()
    current = m.version
  }

  return current
}
