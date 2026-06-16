-- AI module DDL (07-ai.md §4.1). This file is the reviewable source of truth;
-- the *executable* copy is to be inlined as migration v9 'ai_cache' in
-- electron/db/migrate.ts by the main agent (the migration runner is an inline
-- registry, not a file loader — see S4.4 decision in docs/dev/PROGRESS.md).
--
-- New table: ai_cache. Stores all AI text-generation results keyed by
-- prompt_hash so repeated prompts hit cache (no network, no billing).
--
-- Hard constraints honoured (00-architecture §5):
--  - foreign_keys=ON is set globally by the connection initializer; the FK
--    ON DELETE CASCADE declared below fires only because of that pragma.
--  - paragraphs has BOTH the TEXT stable id AND the implicit rowid; we FK on
--    the stable paragraph_id (TEXT) here, not rowid, so cascade semantics are
--    predictable. paragraph_id is nullable for scope='global' rows (e.g. qa).
--  - No DROP / regenerate of any existing stable ID column (§5.5).
--  - Forward-only, idempotent DDL (CREATE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS ai_cache (
  id               TEXT    PRIMARY KEY,            -- UUID v4
  scope            TEXT    NOT NULL,               -- 'paragraph' | 'chapter' | 'global'
  scope_id         TEXT    NOT NULL,               -- paragraph_id / chapter_id / 'qa' etc.
  kind             TEXT    NOT NULL,               -- 'modern' | 'qa' | 'cards' | 'annotation'
  paragraph_id     TEXT,                           -- FK paragraphs.id (nullable for scope='global')
  prompt_hash      TEXT    NOT NULL,               -- sha256(normalized_prompt + model + temperature)
  response         TEXT    NOT NULL,               -- raw/structured result (JSON string or plain text)
  model            TEXT    NOT NULL,               -- 'deepseek-chat' etc.
  prompt_tokens    INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,               -- unix ms
  invalidated      INTEGER NOT NULL DEFAULT 0,     -- 0 valid / 1 user-invalidated (regenerate sets old rows =1)
  meta             TEXT,                            -- JSON: extra info (qa query, cards count, etc.)
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
);

-- Hit query: same scope_id + kind + prompt_hash, not invalidated, latest first.
CREATE INDEX IF NOT EXISTS idx_ai_cache_hit
  ON ai_cache(scope_id, kind, prompt_hash, invalidated);

CREATE INDEX IF NOT EXISTS idx_ai_cache_scope
  ON ai_cache(scope, scope_id, kind);

CREATE INDEX IF NOT EXISTS idx_ai_cache_paragraph
  ON ai_cache(paragraph_id) WHERE paragraph_id IS NOT NULL;
