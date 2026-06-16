/**
 * Import orchestration (IMP-01/02, slice S1.3).
 *
 * `importEpubFile` is the thin I/O orchestrator: parse → copy source file →
 * write books/chapters/paragraphs in a single transaction. The FTS5 virtual
 * table is intentionally NOT touched here — S1.4 owns its triggers, and
 * writing to it manually would double-index (00-architecture §5.4).
 *
 * Stable IDs (00-architecture §5.5): every book/chapter/paragraph id is a
 * fresh crypto.randomUUID(); paragraph rows also carry a parse_hash (sha256 of
 * the normalised text) so that a future re-parse (IMP-07) can match old rows
 * by content and preserve downstream references.
 */

import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { parseEpub } from './epub'
import { splitParagraphs } from './paragraph'
import { getDb } from '../db'
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

/**
 * Imports an EPUB into the local library.
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
  emit({ stage: 'parsing', message: '正在解析 EPUB…' })

  const parsed = await parseEpub(filePath)

  const bookId = randomUUID()
  const now = Date.now()
  const sourceFile = `files/${bookId}.epub`

  // ---- copy original epub into userData/files/<bookId>.epub ----
  emit({ stage: 'copying', message: '正在复制源文件…' })
  const filesDir = join(app.getPath('userData'), 'files')
  await mkdir(filesDir, { recursive: true })
  await copyFile(filePath, join(filesDir, `${bookId}.epub`))

  // ---- prepare all rows in memory, then commit atomically ----
  emit({
    stage: 'writing',
    current: 0,
    total: parsed.chapters.length,
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
    for (const ch of parsed.chapters) {
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

      const drafts = splitParagraphs(ch.xhtml)
      let orderIndex = 0
      for (const draft of drafts) {
        insertParagraph.run({
          id: randomUUID(),
          chapterId,
          orderIndex,
          text: draft.text,
          parseHash: sha256Hex16(normalize(draft.text)),
          isNoise: draft.isNoise ? 1 : 0,
          qualityFlag: 'ok',
          createdAt: now,
        })
        orderIndex++
        paragraphCount++
      }
    }
  })

  tx()

  emit({ stage: 'done', current: parsed.chapters.length, total: parsed.chapters.length })

  return {
    bookId,
    chapterCount: parsed.chapters.length,
    paragraphCount,
  }
}
