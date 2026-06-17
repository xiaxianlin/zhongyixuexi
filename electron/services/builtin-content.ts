import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getDb } from '../db'
import { rebuildFts } from '../db/fts'
import { normalize } from './content-normalize'

interface BuiltinParagraph {
  index: number
  text: string
}

interface BuiltinChapter {
  index: number
  title: string
  paragraphs: BuiltinParagraph[]
}

interface BuiltinBook {
  title: string
  source: string
  sourceEntry: string
  chapterCount: number
  paragraphCount: number
  chapters: BuiltinChapter[]
}

type AiTaskKind = 'modern'

const BUILTIN_BOOK_ID = stableUuid('book:nanjing-original')
const BUILTIN_SOURCE_FILE = 'builtin:data/nanjing-original.json'

function sha256Hex16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

function stableUuid(seed: string): string {
  const hex = createHash('sha256').update(seed, 'utf8').digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-')
}

function validateBuiltinBook(book: BuiltinBook): void {
  if (!book.title || !Array.isArray(book.chapters)) {
    throw new Error('内置书籍数据格式错误')
  }
  if (book.chapters.length !== book.chapterCount) {
    throw new Error(`内置书籍章节数不一致：${book.chapters.length}/${book.chapterCount}`)
  }
  const paragraphCount = book.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0)
  if (paragraphCount !== book.paragraphCount) {
    throw new Error(`内置书籍段落数不一致：${paragraphCount}/${book.paragraphCount}`)
  }
}

function loadBuiltinBook(): BuiltinBook {
  const candidates = [
    join(app.getAppPath(), 'data/nanjing-original.json'),
    join(__dirname, '../../data/nanjing-original.json'),
    join(process.cwd(), 'data/nanjing-original.json'),
  ]
  const filePath = candidates.find((candidate) => existsSync(candidate))
  if (!filePath) {
    throw new Error(`未找到内置书籍数据：${candidates.join(', ')}`)
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as BuiltinBook
}

/**
 * Seeds bundled classical content on app startup. Idempotent: once the built-in
 * book is present, startup leaves existing user edits/progress untouched.
 */
export function seedBuiltinContent(): { inserted: boolean; bookId: string } {
  const book = loadBuiltinBook()
  validateBuiltinBook(book)

  const db = getDb()
  const existing = db
    .prepare('SELECT id, parse_version FROM books WHERE id = ? AND deleted_at IS NULL')
    .get(BUILTIN_BOOK_ID) as { id: string; parse_version: number } | undefined
  const version = builtinVersion(book)
  if (existing?.parse_version === version) return { inserted: false, bookId: BUILTIN_BOOK_ID }

  const now = Date.now()

  const insertBook = db.prepare(
    `INSERT INTO books
       (id, title, author, source_format, source_file, cover, category,
        imported_at, parse_version, updated_at, deleted_at)
     VALUES (@id, @title, @author, 'builtin', @sourceFile, NULL, NULL,
             @importedAt, @parseVersion, @updatedAt, NULL)`,
  )

  const updateBook = db.prepare(
    `UPDATE books
     SET title = @title,
         author = @author,
         source_format = 'builtin',
         source_file = @sourceFile,
         parse_version = @parseVersion,
         updated_at = @updatedAt,
         deleted_at = NULL
     WHERE id = @id`,
  )

  const insertChapter = db.prepare(
    `INSERT INTO chapters
       (id, book_id, parent_id, order_index, level, title, content_hash,
        created_at, deleted_at)
     VALUES (@id, @bookId, NULL, @orderIndex, '难', @title, @contentHash,
             @createdAt, NULL)
     ON CONFLICT(id) DO UPDATE SET
       book_id = excluded.book_id,
       parent_id = excluded.parent_id,
       order_index = excluded.order_index,
       level = excluded.level,
       title = excluded.title,
       content_hash = excluded.content_hash,
       deleted_at = NULL`,
  )

  const insertParagraph = db.prepare(
    `INSERT INTO paragraphs
       (id, chapter_id, order_index, text, content_modern, content_explanation,
        edited, parse_hash, is_noise, quality_flag, created_at, deleted_at)
     VALUES (@id, @chapterId, @orderIndex, @text, NULL, NULL,
             0, @parseHash, 0, 'ok', @createdAt, NULL)
     ON CONFLICT(id) DO UPDATE SET
       chapter_id = excluded.chapter_id,
       order_index = excluded.order_index,
       text = excluded.text,
       content_modern = NULL,
       content_explanation = NULL,
       edited = 0,
       parse_hash = excluded.parse_hash,
       is_noise = 0,
       quality_flag = 'ok',
       deleted_at = NULL`,
  )

  const tx = db.transaction(() => {
    const bookParams = {
      id: BUILTIN_BOOK_ID,
      title: book.title,
      author: '秦越人',
      sourceFile: BUILTIN_SOURCE_FILE,
      parseVersion: version,
      importedAt: now,
      updatedAt: now,
    }
    if (existing) {
      db.prepare(
        `UPDATE paragraphs
         SET deleted_at = ?
         WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)
           AND deleted_at IS NULL`,
      ).run(now, BUILTIN_BOOK_ID)
      db.prepare('UPDATE chapters SET deleted_at = ? WHERE book_id = ? AND deleted_at IS NULL').run(
        now,
        BUILTIN_BOOK_ID,
      )
      db.prepare('DELETE FROM ai_generation_tasks WHERE book_id = ?').run(BUILTIN_BOOK_ID)
      updateBook.run(bookParams)
    } else {
      insertBook.run(bookParams)
    }

    for (const chapter of book.chapters) {
      const chapterId = stableUuid(`chapter:nanjing-original:${chapter.index}:${chapter.title}`)
      const chapterText = chapter.paragraphs.map((p) => normalize(p.text)).join('\n')
      insertChapter.run({
        id: chapterId,
        bookId: BUILTIN_BOOK_ID,
        orderIndex: chapter.index - 1,
        title: chapter.title,
        contentHash: sha256Hex16(chapterText),
        createdAt: now,
      })

      for (const paragraph of chapter.paragraphs) {
        const text = normalize(paragraph.text)
        if (!text) continue
        insertParagraph.run({
          id: stableUuid(
            `paragraph:nanjing-original:${chapter.index}:${paragraph.index}:${sha256Hex16(text)}`,
          ),
          chapterId,
          orderIndex: paragraph.index - 1,
          text,
          parseHash: sha256Hex16(text),
          createdAt: now,
        })
      }
    }

    createAiTasksForBook(BUILTIN_BOOK_ID, now)
    rebuildFts(db)
  })

  tx()
  return { inserted: true, bookId: BUILTIN_BOOK_ID }
}

function builtinVersion(book: BuiltinBook): number {
  const payload = JSON.stringify({
    title: book.title,
    chapterCount: book.chapterCount,
    paragraphCount: book.paragraphCount,
    chapters: book.chapters.map((chapter) => ({
      index: chapter.index,
      title: chapter.title,
      paragraphs: chapter.paragraphs.map((paragraph) => ({
        index: paragraph.index,
        text: normalize(paragraph.text),
      })),
    })),
  })
  return parseInt(sha256Hex16(payload).slice(0, 8), 16)
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
    for (const kind of ['modern'] satisfies AiTaskKind[]) {
      const result = insertTask.run({
        id: randomUUID(),
        bookId,
        chapterId: paragraph.chapterId,
        paragraphId: paragraph.paragraphId,
        kind,
        priority: paragraph.orderIndex,
        createdAt: now,
        updatedAt: now,
        meta: JSON.stringify({ source: 'builtin' }),
      })
      created += result.changes
    }
  }
  return created
}
