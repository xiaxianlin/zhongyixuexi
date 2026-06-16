/**
 * Import orchestration (IMP-01/02/07).
 *
 * Import path: read EPUB structure, extract whole-book chapter text, hand the
 * full book to AI for non-content exclusion + chapter/paragraph parsing, then
 * write books/chapters/paragraphs atomically. AI interpretation/image jobs are
 * downstream work; this module creates the clean paragraph graph they target.
 *
 * Reparse is stable-ID preserving: existing chapters/paragraphs are matched by
 * content hash, title/order and parse_hash before new rows are minted. Unmatched
 * old rows are soft-deleted, so SET NULL references degrade gracefully and
 * CASCADE-bound rows are not destroyed by a hard delete.
 */

import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { parseEpub, type ParsedChapter } from './epub'
import { normalizeWhitespace } from './paragraph'
import { parseBookByAI, type ParseChapterResult } from './ai'
import { getDb } from '../db'
import { rebuildFts } from '../db/fts'
import { AppError } from '../lib/error'
import type { ImportProgress, ImportResult } from '../models/content'

export interface ImportOptions {
  /** Streamed progress callback (parsing | copying | writing | done). */
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

interface ParsedContentChapter {
  chapter: ParsedChapter
  result: ParseChapterResult
}

interface ChapterRow {
  id: string
  order_index: number
  title: string
  content_hash: string | null
}

interface ParagraphRow {
  id: string
  chapter_id: string
  order_index: number
  text: string
  edited: number
  parse_hash: string | null
}

type AiTaskKind = 'modern' | 'image'

export function stripHtmlToText(xhtml: string): string {
  return normalizeWhitespace(
    xhtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote|section|article|td|th|dd|dt)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

export function buildAiParseInput(chapters: ParsedChapter[]): { title: string; text: string }[] {
  return chapters.map((chapter) => ({
    title: chapter.title,
    text: stripHtmlToText(chapter.xhtml),
  }))
}

export function alignAiContentChapters(
  chapters: ParsedChapter[],
  aiResults: ParseChapterResult[],
): ParsedContentChapter[] {
  const out: ParsedContentChapter[] = []
  for (let i = 0; i < chapters.length; i++) {
    const result = aiResults[i]
    if (result?.isContent && result.paragraphs.length > 0) {
      out.push({ chapter: chapters[i], result })
    }
  }
  return out
}

function getBookOrThrow(bookId: string): { id: string; title: string; source_file: string } {
  const row = getDb()
    .prepare('SELECT id, title, source_file FROM books WHERE id = ? AND deleted_at IS NULL')
    .get(bookId) as { id: string; title: string; source_file: string } | undefined
  if (!row) throw new AppError('NOT_FOUND', `书籍 ${bookId} 不存在`)
  return row
}

/**
 * @param filePath absolute path to the .epub on disk
 * @param opts.onProgress optional progress callback
 * @returns ImportResult (bookId + chapter/paragraph counts)
 */
export async function importEpubFile(
  filePath: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const emit = opts.onProgress ?? (() => {})

  emit({ stage: 'importing', message: '正在导入文件…' })
  const parsed = await parseEpub(filePath)

  emit({
    stage: 'whole_book_ai_parse',
    current: 0,
    total: parsed.chapters.length,
    message: '正在全书解析并排除目录/版权页等非正文…',
  })
  const aiResults = await parseBookByAI(buildAiParseInput(parsed.chapters))
  const contentChapters = alignAiContentChapters(parsed.chapters, aiResults)

  const bookId = randomUUID()
  const now = Date.now()
  const sourceFile = `files/${bookId}.epub`

  emit({ stage: 'copying', message: '正在复制源文件…' })
  const filesDir = join(app.getPath('userData'), 'files')
  await mkdir(filesDir, { recursive: true })
  await copyFile(filePath, join(filesDir, `${bookId}.epub`))

  emit({
    stage: 'saving_parse',
    current: 0,
    total: contentChapters.length,
    message: '正在保存章节与段落解析结果…',
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
  let taskCount = 0

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
      for (const paragraph of result.paragraphs) {
        const normalized = normalize(paragraph)
        if (!normalized) continue
        const paragraphId = randomUUID()
        insertParagraph.run({
          id: paragraphId,
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

    taskCount = createAiTasksForBook(bookId, now)
  })

  tx()

  emit({
    stage: 'creating_tasks',
    current: taskCount,
    total: paragraphCount * 2,
    message: `已创建 ${taskCount} 个段落解析/图片生成任务…`,
  })
  emit({ stage: 'done', current: contentChapters.length, total: contentChapters.length, message: '完成解析' })

  return {
    bookId,
    chapterCount: contentChapters.length,
    paragraphCount,
    taskCount,
  }
}

/**
 * Re-parses an existing book without hard-deleting content rows.
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

  const book = getBookOrThrow(bookId)
  const sourceFileAbs = join(app.getPath('userData'), book.source_file)

  emit({ stage: 'importing', message: '正在读取原始 EPUB…' })
  const parsed = await parseEpub(sourceFileAbs)

  emit({
    stage: 'whole_book_ai_parse',
    current: 0,
    total: parsed.chapters.length,
    message: '正在全书 AI 重新解析并排除非正文…',
  })
  const aiResults = await parseBookByAI(buildAiParseInput(parsed.chapters))
  const contentChapters = alignAiContentChapters(parsed.chapters, aiResults)

  emit({
    stage: 'saving_parse',
    current: 0,
    total: contentChapters.length,
    message: '正在保存新的章节与段落解析结果…',
  })

  const now = Date.now()

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

  const updateChapter = db.prepare(
    `UPDATE chapters
     SET order_index = @orderIndex,
         title = @title,
         content_hash = @contentHash,
         deleted_at = NULL
     WHERE id = @id`,
  )

  const softDeleteChapter = db.prepare(
    `UPDATE chapters SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
  )

  const updateParagraph = db.prepare(
    `UPDATE paragraphs
     SET chapter_id = @chapterId,
         order_index = @orderIndex,
         text = CASE WHEN edited = 1 THEN text ELSE @text END,
         parse_hash = CASE WHEN edited = 1 THEN parse_hash ELSE @parseHash END,
         is_noise = @isNoise,
         quality_flag = @qualityFlag,
         deleted_at = NULL
     WHERE id = @id`,
  )

  const softDeleteParagraph = db.prepare(
    `UPDATE paragraphs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
  )

  const bumpBook = db.prepare(
    `UPDATE books SET updated_at = ?, parse_version = parse_version + 1 WHERE id = ?`,
  )

  const oldChapters = db
    .prepare(
      `SELECT id, order_index, title, content_hash
       FROM chapters
       WHERE book_id = ? AND deleted_at IS NULL
       ORDER BY order_index, id`,
    )
    .all(bookId) as ChapterRow[]

  const oldParagraphs = db
    .prepare(
      `SELECT id, chapter_id, order_index, text, edited, parse_hash
       FROM paragraphs
       WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)
         AND deleted_at IS NULL
       ORDER BY chapter_id, order_index, id`,
    )
    .all(bookId) as ParagraphRow[]

  let paragraphCount = 0
  let taskCount = 0

  const tx = db.transaction(() => {
    const availableChapters = new Map(oldChapters.map((ch) => [ch.id, ch]))
    const chaptersByHash = groupBy(oldChapters.filter((ch) => ch.content_hash), (ch) => ch.content_hash!)
    const chaptersByTitle = groupBy(oldChapters, (ch) => normalize(ch.title))
    const paragraphsByChapter = groupBy(oldParagraphs, (p) => p.chapter_id)
    const usedParagraphIds = new Set<string>()
    const usedChapterIds = new Set<string>()

    let chapterIndex = 0
    for (const { chapter: ch, result } of contentChapters) {
      const contentHash = sha256Hex16(ch.xhtml)
      const matchedChapter = pickChapterMatch({
        orderIndex: chapterIndex,
        title: ch.title,
        contentHash,
        available: availableChapters,
        byHash: chaptersByHash,
        byTitle: chaptersByTitle,
      })
      const chapterId = matchedChapter?.id ?? randomUUID()

      if (matchedChapter) {
        availableChapters.delete(matchedChapter.id)
        usedChapterIds.add(matchedChapter.id)
        updateChapter.run({
          id: chapterId,
          orderIndex: chapterIndex,
          title: ch.title,
          contentHash,
        })
      } else {
        insertChapter.run({
          id: chapterId,
          bookId,
          orderIndex: chapterIndex,
          title: ch.title,
          contentHash,
          createdAt: now,
        })
      }
      chapterIndex++

      const existingParas = matchedChapter ? (paragraphsByChapter.get(matchedChapter.id) ?? []) : []
      const availableParas = new Map(existingParas.map((p) => [p.id, p]))
      const parasByHash = groupBy(existingParas.filter((p) => p.parse_hash), (p) => p.parse_hash!)

      let orderIndex = 0
      for (const paragraph of result.paragraphs) {
        const normalized = normalize(paragraph)
        if (!normalized) continue
        const parseHash = sha256Hex16(normalized)
        const matchedPara = pickParagraphMatch({
          orderIndex,
          parseHash,
          available: availableParas,
          byHash: parasByHash,
        })
        if (matchedPara) {
          availableParas.delete(matchedPara.id)
          usedParagraphIds.add(matchedPara.id)
          updateParagraph.run({
            id: matchedPara.id,
            chapterId,
            orderIndex,
            text: normalized,
            parseHash,
            isNoise: 0,
            qualityFlag: 'ok',
          })
        } else {
          insertParagraph.run({
            id: randomUUID(),
            chapterId,
            orderIndex,
            text: normalized,
            parseHash,
            isNoise: 0,
            qualityFlag: 'ok',
            createdAt: now,
          })
        }
        orderIndex++
        paragraphCount++
      }

      for (const oldPara of existingParas) {
        if (!usedParagraphIds.has(oldPara.id)) {
          softDeleteParagraph.run(now, oldPara.id)
        }
      }
    }

    for (const oldChapter of oldChapters) {
      if (!usedChapterIds.has(oldChapter.id)) {
        for (const oldPara of paragraphsByChapter.get(oldChapter.id) ?? []) {
          softDeleteParagraph.run(now, oldPara.id)
        }
        softDeleteChapter.run(now, oldChapter.id)
      }
    }

    bumpBook.run(now, bookId)
    rebuildFts(db)
    taskCount = createAiTasksForBook(bookId, now)
  })

  tx()

  emit({
    stage: 'creating_tasks',
    current: taskCount,
    total: paragraphCount * 2,
    message: `已创建/补齐 ${taskCount} 个段落解析/图片生成任务…`,
  })
  emit({ stage: 'done', current: contentChapters.length, total: contentChapters.length, message: '完成解析' })

  return {
    bookId,
    chapterCount: contentChapters.length,
    paragraphCount,
    taskCount,
  }
}

function createAiTasksForBook(bookId: string, now: number): number {
  const db = getDb()
  const paragraphs = db
    .prepare(
      `SELECT p.id AS paragraphId,
              p.chapter_id AS chapterId,
              p.order_index AS orderIndex
       FROM paragraphs p
       JOIN chapters c ON c.id = p.chapter_id
       WHERE c.book_id = ?
         AND c.deleted_at IS NULL
         AND p.deleted_at IS NULL
         AND p.is_noise = 0
       ORDER BY c.order_index, p.order_index`,
    )
    .all(bookId) as { paragraphId: string; chapterId: string; orderIndex: number }[]

  const insertTask = db.prepare(
    `INSERT OR IGNORE INTO ai_generation_tasks
       (id, book_id, chapter_id, paragraph_id, kind, status, priority,
        attempts, created_at, updated_at, started_at, finished_at, error, meta)
     VALUES
       (@id, @bookId, @chapterId, @paragraphId, @kind, 'pending', @priority,
        0, @createdAt, @updatedAt, NULL, NULL, NULL, @meta)`,
  )

  let created = 0
  for (const paragraph of paragraphs) {
    for (const kind of ['modern', 'image'] satisfies AiTaskKind[]) {
      const result = insertTask.run({
        id: randomUUID(),
        bookId,
        chapterId: paragraph.chapterId,
        paragraphId: paragraph.paragraphId,
        kind,
        priority: paragraph.orderIndex,
        createdAt: now,
        updatedAt: now,
        meta: JSON.stringify({ source: 'import' }),
      })
      created += result.changes
    }
  }
  return created
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const bucket = out.get(key)
    if (bucket) bucket.push(row)
    else out.set(key, [row])
  }
  return out
}

function firstAvailable<T extends { id: string }>(
  rows: T[] | undefined,
  available: Map<string, T>,
): T | undefined {
  return rows?.find((row) => available.has(row.id))
}

export function pickChapterMatch(input: {
  orderIndex: number
  title: string
  contentHash: string
  available: Map<string, ChapterRow>
  byHash: Map<string, ChapterRow[]>
  byTitle: Map<string, ChapterRow[]>
}): ChapterRow | undefined {
  const hashHit = firstAvailable(input.byHash.get(input.contentHash), input.available)
  if (hashHit) return hashHit

  const titleHit = firstAvailable(input.byTitle.get(normalize(input.title)), input.available)
  if (titleHit) return titleHit

  return [...input.available.values()].find((ch) => ch.order_index === input.orderIndex)
}

export function pickParagraphMatch(input: {
  orderIndex: number
  parseHash: string
  available: Map<string, ParagraphRow>
  byHash: Map<string, ParagraphRow[]>
}): ParagraphRow | undefined {
  const hashHit = firstAvailable(input.byHash.get(input.parseHash), input.available)
  if (hashHit) return hashHit

  return [...input.available.values()].find((p) => p.order_index === input.orderIndex)
}
