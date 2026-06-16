-- LRN module DDL (04-learning.md §4). This file is the reviewable source of
-- truth; the *executable* copy is inlined as migration v6 'learning' in
-- electron/db/migrate.ts (the migration runner is an inline registry, not a
-- file loader — see S4.4 decision in docs/dev/PROGRESS.md).
--
-- Four new tables: cards, review_log, quiz_questions, quiz_results.
-- All FKs to paragraphs/chapters/books use ON DELETE CASCADE (or SET NULL)
-- per 00-architecture §5.3, so deleting a book wipes its cards/logs/quiz too.

-- ---------------------------------------------------------------------------
-- cards (LRN-01 SM-2 spaced-repetition memory cards)
-- ---------------------------------------------------------------------------
-- One row per card. SM-2 scheduling state lives in ease_factor/interval_days/
-- repetitions/due_at. `source` distinguishes origin; `deck` groups for review.
-- book_id/chapter_id/paragraph_id are optional binding anchors (NULL = unbound
-- manual card). All FKs cascade so book/chapter/paragraph deletion removes
-- bound cards automatically.
CREATE TABLE IF NOT EXISTS cards (
  id              TEXT    PRIMARY KEY,                 -- UUID v4, app-generated
  deck            TEXT    NOT NULL DEFAULT 'default',  -- default / book-<id> / quiz-errors
  type            TEXT    NOT NULL,                    -- original_to_interpret | term_to_meaning | image_to_name | title_to_points
  front           TEXT    NOT NULL,                    -- question / prompt side
  back            TEXT    NOT NULL,                    -- answer / explanation side
  -- binding anchors (nullable: manual cards may be unbound)
  book_id         TEXT,
  chapter_id      TEXT,
  paragraph_id    TEXT,
  -- source provenance
  source          TEXT    NOT NULL DEFAULT 'manual',   -- manual | reading | ai_batch | quiz_error
  source_ref      TEXT,                                -- ai_cache.id / quiz_results.id etc.
  -- SM-2 scheduling state (core)
  ease_factor     REAL    NOT NULL DEFAULT 2.5,        -- EF, init 2.5
  interval_days   INTEGER NOT NULL DEFAULT 0,          -- current interval (days), 0 = new
  repetitions     INTEGER NOT NULL DEFAULT 0,          -- consecutive correct count
  due_at          INTEGER NOT NULL,                    -- next due timestamp (ms); new card = created_at
  -- status & metadata
  status          TEXT    NOT NULL DEFAULT 'active',   -- active | suspended | buried
  reviewed_count  INTEGER NOT NULL DEFAULT 0,          -- total reviews
  lapsed_count    INTEGER NOT NULL DEFAULT 0,          -- total lapses (again grades)
  tags            TEXT,                                -- comma-separated tags (convenience)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,                             -- soft delete
  FOREIGN KEY (book_id)      REFERENCES books(id)      ON DELETE CASCADE,
  FOREIGN KEY (chapter_id)   REFERENCES chapters(id)   ON DELETE CASCADE,
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
);

-- review plan main query: by deck + status + due_at
CREATE INDEX IF NOT EXISTS idx_cards_due     ON cards(deck, status, due_at);
-- reverse lookup by source / paragraph (dedup, chapter stats)
CREATE INDEX IF NOT EXISTS idx_cards_source  ON cards(source, paragraph_id);
CREATE INDEX IF NOT EXISTS idx_cards_chapter ON cards(chapter_id);
CREATE INDEX IF NOT EXISTS idx_cards_book    ON cards(book_id);

-- ---------------------------------------------------------------------------
-- review_log (LRN-01 review history with prev/next snapshot)
-- ---------------------------------------------------------------------------
-- Each review writes a row capturing the scheduling state BEFORE and AFTER,
-- so undo is possible and the learning curve is replayable. CASCADE on card
-- deletion so logs don't outlive their card.
CREATE TABLE IF NOT EXISTS review_log (
  id                  TEXT    PRIMARY KEY,             -- UUID v4
  card_id             TEXT    NOT NULL,
  -- user input
  grade               INTEGER NOT NULL,                 -- 0..5 (SM-2 raw)
  grade_label         TEXT    NOT NULL,                 -- again | hard | good | easy
  -- scheduling snapshot BEFORE
  prev_ease_factor    REAL    NOT NULL,
  prev_interval_days  INTEGER NOT NULL,
  prev_repetitions    INTEGER NOT NULL,
  -- scheduling result AFTER
  next_ease_factor    REAL    NOT NULL,
  next_interval_days  INTEGER NOT NULL,
  next_repetitions    INTEGER NOT NULL,
  next_due_at         INTEGER NOT NULL,
  -- metadata
  elapsed_ms          INTEGER,                          -- flip-to-grade time
  reviewed_at         INTEGER NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- per-card history (curve replay)
CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id, reviewed_at);
-- dashboard daily aggregation (heatmap, streak)
CREATE INDEX IF NOT EXISTS idx_review_log_day  ON review_log(reviewed_at);

-- ---------------------------------------------------------------------------
-- quiz_questions (LRN-05 quiz bank)
-- ---------------------------------------------------------------------------
-- Generated (rule-based or AI) quiz items. payload/answer are JSON strings
-- parsed by qtype. chapter_id drives weak-chapter recommendation.
CREATE TABLE IF NOT EXISTS quiz_questions (
  id              TEXT    PRIMARY KEY,
  book_id         TEXT,
  chapter_id      TEXT,
  paragraph_id    TEXT,
  source          TEXT    NOT NULL DEFAULT 'generated', -- generated | imported
  qtype           TEXT    NOT NULL,                     -- choice | match | judge
  stem            TEXT    NOT NULL,                     -- question text
  payload         TEXT    NOT NULL,                     -- JSON: options/pairs/statement
  answer          TEXT    NOT NULL,                     -- JSON: correct_key/mapping/is_true
  explanation     TEXT,                                 -- rationale (→ card back on error)
  difficulty      REAL    DEFAULT 0.5,                  -- 0..1 estimate
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (book_id)      REFERENCES books(id)      ON DELETE CASCADE,
  FOREIGN KEY (chapter_id)   REFERENCES chapters(id)   ON DELETE CASCADE,
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_q_chapter ON quiz_questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_quiz_q_book    ON quiz_questions(book_id);

-- ---------------------------------------------------------------------------
-- quiz_results (LRN-05 answer records + error-to-card tracking)
-- ---------------------------------------------------------------------------
-- One row per answered question in a session. turned_to_card=1 prevents
-- duplicate card creation. CASCADE on question deletion.
CREATE TABLE IF NOT EXISTS quiz_results (
  id               TEXT    PRIMARY KEY,
  quiz_question_id TEXT    NOT NULL,
  session_id       TEXT    NOT NULL,                    -- groups a quiz run
  user_answer      TEXT,                                -- JSON (same shape as answer)
  is_correct       INTEGER NOT NULL,                    -- 0 / 1
  time_spent_ms    INTEGER,
  turned_to_card   INTEGER NOT NULL DEFAULT 0,          -- 0/1 idempotency flag
  answered_at      INTEGER NOT NULL,
  FOREIGN KEY (quiz_question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_r_session ON quiz_results(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_r_correct  ON quiz_results(is_correct, answered_at);
CREATE INDEX IF NOT EXISTS idx_quiz_r_chapter  ON quiz_results(quiz_question_id);
