/**
 * Content DTOs shared across the import/library/reading modules.
 *
 * These are the *read shapes* returned by services/IPC and consumed by the
 * renderer; they are deliberately decoupled from the on-disk schema columns
 * (see electron/db/migrate.ts) so callers never touch raw SQL rows.
 *
 * Stable IDs (00-architecture §5.5): BookDto.id / ChapterDto.id / ParagraphDto.id
 * are app-generated UUIDv4 strings and MUST NOT be regenerated across re-parses.
 */

export interface BookDto {
  id: string
  title: string
  author: string | null
  /** 'epub' today; 'pdf'/etc later. */
  sourceFormat: string
  /** Relative path under userData, e.g. `files/<id>.epub`. */
  sourceFile: string
  /** Relative path under userData, e.g. `covers/<id>.png`, or null. */
  cover: string | null
  category: string | null
  importedAt: number
  parseVersion: number
  updatedAt: number
  /** Soft-delete marker; null means the row is live. */
  deletedAt: number | null
}

export interface ChapterDto {
  id: string
  bookId: string
  /** Self-reference for hierarchy (卷-品-篇); null for top-level. */
  parentId: string | null
  orderIndex: number
  /** Semantic level label, e.g. '卷' / '品' / '篇'; null when flat. */
  level: string | null
  title: string
  /** Chapter content fingerprint (sha256 prefix) for re-parse mapping. */
  contentHash: string | null
  createdAt: number
  deletedAt: number | null
  /** Nested children when the chapter tree is materialised; absent for flat lists. */
  children?: ChapterDto[]
}

export interface ParagraphDto {
  id: string
  chapterId: string
  orderIndex: number
  text: string
  /** AI modern-language translation, populated by the AI module. */
  contentModern: string | null
  /** AI medical reasoning commentary, populated by the AI module. */
  contentExplanation: string | null
  /** 1 if a user hand-edited this paragraph. */
  edited: number
  /** Content fingerprint (sha256 prefix) — the core of IMP-07 re-parse mapping. */
  parseHash: string | null
  /** 1 if flagged as header/footer/watermark noise. */
  isNoise: number
  /** 'ok' | 'suspect' — quality gate for the review workbench. */
  qualityFlag: string | null
  createdAt: number
  deletedAt: number | null
}

/**
 * Progress payload pushed during a long import. `stage` is a free-form label
 * (parsing | copying | writing | done | error); `current`/`total` are present
 * for stages that report fractional progress.
 */
export interface ImportProgress {
  stage: string
  current?: number
  total?: number
  message?: string
}

export interface ImportResult {
  bookId: string
  chapterCount: number
  paragraphCount: number
  taskCount?: number
}
