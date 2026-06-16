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
  {
    // v4 — SRH terminology dictionary (05-search.md §4.3). fts_paragraphs already
    // exists (v3, IMP-owned); SRH only reads it. New tables: dictionary_terms +
    // term_occurrences. DDL mirrored from electron/db/migrations/search.sql.
    version: 4,
    name: 'dictionary',
    up: (db) => {
      db.exec(`
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
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dict_term     ON dictionary_terms(term);
        CREATE INDEX        IF NOT EXISTS idx_dict_category ON dictionary_terms(category);

        CREATE TABLE IF NOT EXISTS term_occurrences (
            term_id      TEXT NOT NULL,
            paragraph_id TEXT NOT NULL,
            count        INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (term_id, paragraph_id),
            FOREIGN KEY (term_id)      REFERENCES dictionary_terms(term_id) ON DELETE CASCADE,
            FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id)           ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_occ_paragraph ON term_occurrences(paragraph_id);
      `)
    },
  },
  {
    // v5 — RD reading progress + bookmarks (03-reading.md §4). DDL mirrored from
    // electron/db/migrations/reading.sql. reading_progress is segment-level
    // (one row per book); bookmarks bind to segment or chapter (paragraph_id
    // NULL → chapter-level) and degrade via ON DELETE SET NULL.
    version: 5,
    name: 'reading',
    up: (db) => {
      db.exec(`
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

        CREATE TABLE IF NOT EXISTS bookmarks (
            id           TEXT    PRIMARY KEY,
            book_id      TEXT    NOT NULL,
            chapter_id   TEXT    NOT NULL,
            paragraph_id TEXT,
            title        TEXT,
            note         TEXT,
            color        TEXT,
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL,
            FOREIGN KEY (book_id)      REFERENCES books(id)      ON DELETE CASCADE,
            FOREIGN KEY (chapter_id)   REFERENCES chapters(id)   ON DELETE CASCADE,
            FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bookmarks_book_created ON bookmarks(book_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_paragraph ON bookmarks(paragraph_id) WHERE paragraph_id IS NOT NULL;
      `)
    },
  },
  {
    // v6 — SET preferences + encrypted API credentials (08-settings-data.md §4).
    // Mirrored from electron/db/migrations/settings.sql. api_key_enc is the
    // safeStorage ciphertext only; plaintext never touches disk/logs/IPC.
    version: 6,
    name: 'settings',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS api_credentials (
          id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL,
          base_url TEXT NOT NULL, model TEXT NOT NULL, api_key_enc BLOB,
          key_iv_hint TEXT, is_active INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_credentials_provider ON api_credentials(provider);
        CREATE INDEX IF NOT EXISTS idx_credentials_active ON api_credentials(is_active) WHERE is_active = 1;
      `)
    },
  },
  {
    // v7 — LRN spaced-repetition cards + review log + quiz (04-learning.md §4).
    // Mirrored from electron/db/migrations/learning.sql. All content FKs CASCADE.
    version: 7,
    name: 'learning',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cards (
          id TEXT PRIMARY KEY,
          deck TEXT NOT NULL DEFAULT 'default',
          type TEXT NOT NULL,
          front TEXT NOT NULL,
          back TEXT NOT NULL,
          book_id TEXT, chapter_id TEXT, paragraph_id TEXT,
          source TEXT NOT NULL DEFAULT 'manual', source_ref TEXT,
          ease_factor REAL NOT NULL DEFAULT 2.5,
          interval_days INTEGER NOT NULL DEFAULT 0,
          repetitions INTEGER NOT NULL DEFAULT 0,
          due_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          reviewed_count INTEGER NOT NULL DEFAULT 0,
          lapsed_count INTEGER NOT NULL DEFAULT 0,
          tags TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
          FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(deck, status, due_at);
        CREATE INDEX IF NOT EXISTS idx_cards_source ON cards(source, paragraph_id);
        CREATE INDEX IF NOT EXISTS idx_cards_chapter ON cards(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_cards_book ON cards(book_id);

        CREATE TABLE IF NOT EXISTS review_log (
          id TEXT PRIMARY KEY, card_id TEXT NOT NULL,
          grade INTEGER NOT NULL, grade_label TEXT NOT NULL,
          prev_ease_factor REAL NOT NULL, prev_interval_days INTEGER NOT NULL, prev_repetitions INTEGER NOT NULL,
          next_ease_factor REAL NOT NULL, next_interval_days INTEGER NOT NULL, next_repetitions INTEGER NOT NULL,
          next_due_at INTEGER NOT NULL,
          elapsed_ms INTEGER, reviewed_at INTEGER NOT NULL,
          FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id, reviewed_at);
        CREATE INDEX IF NOT EXISTS idx_review_log_day ON review_log(reviewed_at);

        CREATE TABLE IF NOT EXISTS quiz_questions (
          id TEXT PRIMARY KEY,
          book_id TEXT, chapter_id TEXT, paragraph_id TEXT,
          source TEXT NOT NULL DEFAULT 'generated',
          qtype TEXT NOT NULL, stem TEXT NOT NULL, payload TEXT NOT NULL, answer TEXT NOT NULL,
          explanation TEXT, difficulty REAL DEFAULT 0.5, created_at INTEGER NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
          FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_quiz_q_chapter ON quiz_questions(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_quiz_q_book ON quiz_questions(book_id);

        CREATE TABLE IF NOT EXISTS quiz_results (
          id TEXT PRIMARY KEY, quiz_question_id TEXT NOT NULL, session_id TEXT NOT NULL,
          user_answer TEXT, is_correct INTEGER NOT NULL, time_spent_ms INTEGER,
          turned_to_card INTEGER NOT NULL DEFAULT 0, answered_at INTEGER NOT NULL,
          FOREIGN KEY (quiz_question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_quiz_r_session ON quiz_results(session_id);
        CREATE INDEX IF NOT EXISTS idx_quiz_r_correct ON quiz_results(is_correct, answered_at);
        CREATE INDEX IF NOT EXISTS idx_quiz_r_chapter ON quiz_results(quiz_question_id);
      `)
    },
  },
  {
    // v8 — NOTE notes + wiki-links + tags + notebooks + fts_notes (06-notes.md §4).
    // Mirrored from electron/db/migrations/notes.sql. paragraph_id FK is SET NULL
    // (a deleted segment degrades the note to free-standing, never lost).
    version: 8,
    name: 'notes',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notebooks (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0, icon TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          FOREIGN KEY (parent_id) REFERENCES notebooks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notebooks_parent ON notebooks(parent_id, sort_order);

        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '无标题笔记',
          content TEXT NOT NULL DEFAULT '',
          book_id TEXT, chapter_id TEXT, paragraph_id TEXT, notebook_id TEXT,
          word_count INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
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
          id TEXT PRIMARY KEY, source_note_id TEXT NOT NULL,
          target_type TEXT NOT NULL, target_id TEXT NOT NULL,
          target_alias TEXT, display_text TEXT,
          position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
          FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_note_links ON note_links(source_note_id, target_type, target_id);

        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tag_refs (
          id TEXT PRIMARY KEY, tag_id TEXT NOT NULL,
          ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, created_at INTEGER NOT NULL,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
          UNIQUE (tag_id, ref_type, ref_id)
        );
        CREATE INDEX IF NOT EXISTS idx_tag_refs_target ON tag_refs(ref_type, ref_id);
        CREATE INDEX IF NOT EXISTS idx_tag_refs_tag ON tag_refs(tag_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(
          note_id UNINDEXED, title, content,
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
