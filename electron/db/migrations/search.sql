-- SRH module DDL (05-search.md §4.3). This file is the reviewable source of
-- truth; the *executable* copy is inlined as migration v4 'dictionary' in
-- electron/db/migrate.ts (the migration runner is an inline registry, not a
-- file loader — see S4.4 decision in docs/dev/PROGRESS.md).
--
-- fts_paragraphs + its ai/ad/au triggers already exist (migration v3, owned by
-- IMP). SRH only READS fts_paragraphs and never writes it (00-arch §5.4).
-- The only new tables SRH introduces are the terminology dictionary.

-- ---------------------------------------------------------------------------
-- dictionary_terms (SRH-04)
-- ---------------------------------------------------------------------------
-- User-built (or AI-assisted, Phase 5) terminology dictionary. One row per
-- unique term. paragraph_id points at an authoritative definition paragraph
-- and is ON DELETE SET NULL so the term survives its source paragraph's
-- removal (a dangling term is still useful; the link just goes null).
CREATE TABLE IF NOT EXISTS dictionary_terms (
    term_id      TEXT PRIMARY KEY,            -- UUID v4, app-generated
    term         TEXT NOT NULL,               -- term text, e.g. 「脾虚」
    definition   TEXT,                        --释义/定义
    source       TEXT,                        -- 出处（书名·篇名）自由文本
    category     TEXT,                        -- 病机/治法/中药/方剂/经络/穴位/其它
    attributes   TEXT,                        -- JSON: 性味/归经/功效 等（Phase 5 AI 可填充）
    created_by   TEXT NOT NULL,               -- 'user' | 'ai'
    paragraph_id TEXT,                        -- 权威定义所在段落（可空，用于跳转）
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE SET NULL
);

-- term is unique: upsert on conflict merges into the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dict_term     ON dictionary_terms(term);
CREATE INDEX        IF NOT EXISTS idx_dict_category ON dictionary_terms(category);

-- ---------------------------------------------------------------------------
-- term_occurrences (术语 → 出现段落 多对多)
-- ---------------------------------------------------------------------------
-- Populated by background scans (SRH-05 full-library highlight byproduct) or
-- AI annotation (Phase 5). Powers the term popup 「出现于 N 段」 list with
-- jump targets. Both FKs cascade: deleting the term wipes its occurrences,
-- deleting the paragraph wipes that occurrence row.
CREATE TABLE IF NOT EXISTS term_occurrences (
    term_id      TEXT NOT NULL,
    paragraph_id TEXT NOT NULL,
    count        INTEGER NOT NULL DEFAULT 1,  -- 该段命中次数
    PRIMARY KEY (term_id, paragraph_id),
    FOREIGN KEY (term_id)      REFERENCES dictionary_terms(term_id) ON DELETE CASCADE,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id)           ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_occ_paragraph ON term_occurrences(paragraph_id);
