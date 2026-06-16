/**
 * Import orchestration (IMP-01/02, slice S1.3 + AI parse).
 *
 * `importEpubFile` is the thin I/O orchestrator: parse EPUB structure →
 * copy source file → **AI-parse the WHOLE BOOK in a single DeepSeek call**
 * (1M-token context; model judges isContent + extracts body paragraphs for all
 * chapters at once) → write books/chapters/paragraphs atomically.
 *
 * AI parsing replaces the old rule-based splitParagraphs. Non-content chapters
 * (copyright pages, TOC, ads, cover, navigation) are filtered out entirely —
 * they are never written to the database.
 *
 * Requires a configured DeepSeek API Key. If none is configured, throws
 * AppError('AI', ..., { aiCode: 'AI_KEY_NOT_CONFIGURED' }) so the renderer can
 * prompt the user to configure one in Settings. No silent fallback to rules.
 *
 * `reparseBook` re-runs AI parsing on an existing book: hard-deletes old
 * chapters/paragraphs (FK CASCADE), writes new ones with fresh UUIDs, and
 * rebuilds the FTS index (CASCADE does not fire triggers).
 *
 * Stable IDs (00-architecture §5.5): every book/chapter/paragraph id is a
 * fresh crypto.randomUUID(); paragraph rows carry parse_hash (sha256 of the
 * normalised text) for future stable-ID re-parse mapping.
 */

import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { parseEpub } from './epub'
import { normalizeWhitespace } from './paragraph'
import { parseBookByAI, type ParseChapterResult } from './ai'
import { getActiveApiKey } from './settings'
import { getDb } from '../db'
import { rebuildFts } from '../db/fts'
import { aiError } from '../ai/errors'
import { AppError } from '../lib/error'
import type { ImportProgress, ImportResult } from '../models/content'

export interface ImportOptions {
  /** Streamed progress callback (parsing | ai_parsing | copying | writing | done). */
  onProgress?: (p: ImportProgress) => void
}

/** text.trim().replace(/\s+/g,' ') — the canonical form hashed for parse_hash. */
export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** sha256(text) truncated to 16 hex chars (64-bit, collision-immune at book scale). */
function sha256Hex16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Strip HTML tags from an XHTML string and normalize whitespace, producing
 * plain text suitable for AI parsing. Removes script/style blocks first.
 */
function stripHtmlToText(xhtml: string): string {
  return normalizeWhitespace(
    xhtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote|section|article|td|th|dd|dt)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

/**
 * Verify a DeepSeek API key is configured. Throws AI_KEY_NOT_CONFIGURED if not.
 * Called early in importEpubFile/reparseBook so the user gets a clear error
 * before any chapters are processed.
 */
function ensureApiKey(): void {
  const cfg = getActiveApiKey()
  if (!cfg || !cfg.apiKey) {
    throw aiError(
      'AI_KEY_NOT_CONFIGURED',
      '未配置 AI，请先在设置中配置 DeepSeek API Key',
    )
  }
}

/**
 * Imports an EPUB into the local library using AI-driven chapter parsing.
 *
 * Flow: parseEpub (structure) → ensureApiKey → strip HTML per chapter →
 * parseChapterByAI (DeepSeek judges isContent + extracts paragraphs) →
 * copy source file → write books/chapters/paragraphs atomically.
 *
 * Non-content chapters (isContent=false) are skipped — not written to DB.
 * If any chapter's AI parsing fails, the entire import aborts (no half-written
 * data) so the user can retry cleanly.
 *
 * @param filePath absolute path to the .epub on disk
 * @param opts.onProgress optional progress callback
 * @returns ImportResult (bookId + chapter/paragraph counts)
 */
export async function importEpubFile(
  filePath: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const emit = opts.onProgress ?? (() => {})

  // 1. Verify API key before any work (fail fast, clear error).
  ensureApiKey()

  // 2. Parse EPUB structure.
  emit({ stage: 'parsing', message: '正在解析 EPUB…' })
  const parsed = await parseEpub(filePath)

  // 3. AI-parse ALL chapters in a SINGLE call (whole-book, 1M context).
  //    Strip HTML per chapter first, then send all {title, text} to parseBookByAI.
  emit({ stage: 'ai_parsing', message: 'AI 解析全书…' })

  const chaptersForAI = parsed.chapters.map((ch) => ({
    title: ch.title,
    text: stripHtmlToText(ch.xhtml),
  }))
  const aiResults = await parseBookByAI(chaptersForAI)

  emit({ stage: 'ai_parsing', message: 'AI 解析全书完成' })

  // 4. Filter to content chapters only (align by index).
  const contentChapters: { chapter: typeof parsed.chapters[0]; result: ParseChapterResult }[] = []
  for (let i = 0; i < parsed.chapters.length; i++) {
    const result = aiResults[i]
    if (result && result.isContent && result.paragraphs.length > 0) {
      contentChapters.push({ chapter: parsed.chapters[i], result })
    }
  }

  // 5. Copy original epub into userData/files/<bookId>.epub.
  const bookId = randomUUID()
  const now = Date.now()
  const sourceFile = `files/${bookId}.epub`

  emit({ stage: 'copying', message: '正在复制源文件…' })
  const filesDir = join(app.getPath('userData'), 'files')
  await mkdir(filesDir, { recursive: true })
  await copyFile(filePath, join(filesDir, `${bookId}.epub`))

  // 6. Write to DB atomically.
  emit({
    stage: 'writing',
    current: 0,
    total: contentChapters.length,
    message: '正在写入数据库…',
  })

  const db = getDb()

  const insertBook = db.prepare(
    `INSERT INTO books
       (id, title, author, source_format, source_file, cover, category,
        imported_at, parse_version, updated_at, deleted_at)
     VALUES (@id, @title, @author, 'epub', @sourceFile, NULL, NULL,
             @importedAt, 1, @updatedAt, NULL)`,
  )

  const insertChapter = db.prepare(
    `INSERT INTO chapters
       (id, book_id, parent_id, order_index, level, title, content_hash,
        created_at, deleted_at)
     VALUES (@id, @bookId, NULL, @orderIndex, NULL, @title, @contentHash,
             @createdAt, NULL)`,
  )

  const insertParagraph = db.prepare(
    `INSERT INTO paragraphs
       (id, chapter_id, order_index, text, content_modern, content_explanation,
        edited, parse_hash, is_noise, quality_flag, created_at, deleted_at)
     VALUES (@id, @chapterId, @orderIndex, @text, NULL, NULL,
             0, @parseHash, @isNoise, @qualityFlag, @createdAt, NULL)`,
  )

  let paragraphCount = 0

  const tx = db.transaction(() => {
    insertBook.run({
      id: bookId,
      title: parsed.title,
      author: parsed.creator || null,
      sourceFile,
      importedAt: now,
      updatedAt: now,
    })

    let chapterIndex = 0
    for (const { chapter: ch, result } of contentChapters) {
      const chapterId = randomUUID()
      const contentHash = sha256Hex16(ch.xhtml)

      insertChapter.run({
        id: chapterId,
        bookId,
        orderIndex: chapterIndex,
        title: ch.title,
        contentHash,
        createdAt: now,
      })
      chapterIndex++

      let orderIndex = 0
      for (const paraText of result.paragraphs) {
        const normalized = normalize(paraText)
        if (!normalized) continue
        insertParagraph.run({
          id: randomUUID(),
          chapterId,
          orderIndex,
          text: normalized,
          parseHash: sha256Hex16(normalized),
          isNoise: 0,
          qualityFlag: 'ok',
          createdAt: now,
        })
        orderIndex++
        paragraphCount++
      }
    }
  })

  tx()

  emit({ stage: 'done', current: contentChapters.length, total: contentChapters.length })

  return {
    bookId,
    chapterCount: contentChapters.length,
    paragraphCount,
  }
}

/**
 * Re-parses an existing book: reads the stored source EPUB, re-runs AI chapter
 * parsing, and replaces all chapters/paragraphs with fresh data.
 *
 * Strategy:
 *   1. Read books.source_file → resolve absolute path → re-parse EPUB.
 *   2. AI-parse every chapter (same as importEpubFile).
 *   3. Transaction: DELETE old chapters (FK CASCADE removes paragraphs +
 *      downstream rows) → INSERT new chapters/paragraphs with fresh UUIDs.
 *   4. Rebuild FTS index (CASCADE deletes do NOT fire AFTER DELETE triggers,
 *      so fts_paragraphs would be orphaned — rebuildFts fixes this per
 *      00-architecture §5.4).
 *   5. Bump books.parse_version + updated_at.
 *
 * Note: paragraphs get new UUIDs (not stable-ID-mapped), so downstream notes/
 * cards bound to old paragraph_ids will be cascaded. This is the "reset"
 * semantics — acceptable for re-parse (PRD IMP-07 treats full re-parse as a
 * reset; incremental stable-ID mapping can be layered on later).
 *
 * @param bookId existing book id
 * @param onProgress optional progress callback
 * @returns ImportResult (same bookId + new chapter/paragraph counts)
 */
export async function reparseBook(
  bookId: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const emit = opts.onProgress ?? (() => {})
  const db = getDb()

  // 1. Verify API key.
  ensureApiKey()

  // 2. Read book row to get source file path.
  const book = db
    .prepare('SELECT id, title, source_file FROM books WHERE id = ? AND deleted_at IS NULL')
    .get(bookId) as { id: string; title: string; source_file: string } | undefined
  if (!book) {
    throw new AppError('NOT_FOUND', `书籍 ${bookId} 不存在`)
  }

  const sourceFileAbs = join(app.getPath('userData'), book.source_file)

  // 3. Re-parse EPUB structure.
  emit({ stage: 'parsing', message: '正在重新解析 EPUB…' })
  const parsed = await parseEpub(sourceFileAbs)

  // 4. AI-parse ALL chapters in a SINGLE call (whole-book, 1M context).
  emit({ stage: 'ai_parsing', message: 'AI 解析全书…' })

  const chaptersForAI = parsed.chapters.map((ch) => ({
    title: ch.title,
    text: stripHtmlToText(ch.xhtml),
  }))
  const aiResults = await parseBookByAI(chaptersForAI)

  emit({ stage: 'ai_parsing', message: 'AI 解析全书完成' })

  // 5. Filter to content chapters (align by index).
  const contentChapters: { chapter: typeof parsed.chapters[0]; result: ParseChapterResult }[] = []
  for (let i = 0; i < parsed.chapters.length; i++) {
    const result = aiResults[i]
    if (result && result.isContent && result.paragraphs.length > 0) {
      contentChapters.push({ chapter: parsed.chapters[i], result })
    }
  }

  // 6. Transaction: delete old chapters (CASCADE → paragraphs) + insert new.
  emit({
    stage: 'writing',
    current: 0,
    total: contentChapters.length,
    message: '正在写入数据库…',
  })

  const now = Date.now()

  const deleteChapters = db.prepare('DELETE FROM chapters WHERE book_id = ?')

  const insertChapter = db.prepare(
    `INSERT INTO chapters
       (id, book_id, parent_id, order_index, level, title, content_hash,
        created_at, deleted_at)
     VALUES (@id, @bookId, NULL, @orderIndex, NULL, @title, @contentHash,
             @createdAt, NULL)`,
  )

  const insertParagraph = db.prepare(
    `INSERT INTO paragraphs
       (id, chapter_id, order_index, text, content_modern, content_explanation,
        edited, parse_hash, is_noise, quality_flag, created_at, deleted_at)
     VALUES (@id, @chapterId, @orderIndex, @text, NULL, NULL,
             0, @parseHash, @isNoise, @qualityFlag, @createdAt, NULL)`,
  )

  const bumpBook = db.prepare(
    `UPDATE books SET updated_at = ?, parse_version = parse_version + 1 WHERE id = ?`,
  )

  let paragraphCount = 0

  const tx = db.transaction(() => {
    // Delete old chapters → FK CASCADE removes old paragraphs (+ downstream).
    deleteChapters.run(bookId)

    let chapterIndex = 0
    for (const { chapter: ch, result } of contentChapters) {
      const chapterId = randomUUID()
      const contentHash = sha256Hex16(ch.xhtml)

      insertChapter.run({
        id: chapterId,
        bookId,
        orderIndex: chapterIndex,
        title: ch.title,
        contentHash,
        createdAt: now,
      })
      chapterIndex++

      let orderIndex = 0
      for (const paraText of result.paragraphs) {
        const normalized = normalize(paraText)
        if (!normalized) continue
        insertParagraph.run({
          id: randomUUID(),
          chapterId,
          orderIndex,
          text: normalized,
          parseHash: sha256Hex16(normalized),
          isNoise: 0,
          qualityFlag: 'ok',
          createdAt: now,
        })
        orderIndex++
        paragraphCount++
      }
    }

    // Bump parse_version + updated_at.
    bumpBook.run(now, bookId)

    // Rebuild FTS: CASCADE deletes did NOT fire AFTER DELETE triggers, so
    // fts_paragraphs was not cleaned. Rebuild from the now-fresh paragraphs.
    rebuildFts(db)
  })

  tx()

  emit({ stage: 'done', current: contentChapters.length, total: contentChapters.length })

  return {
    bookId,
    chapterCount: contentChapters.length,
    paragraphCount,
  }
}
