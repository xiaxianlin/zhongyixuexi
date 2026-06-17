import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getDb } from '../db'
import { rebuildFts } from '../db/fts'
import { normalize } from './content-normalize'
import { deactivateParagraphAnalysesForBook } from './paragraph-analysis'

const BUILTIN_FILES = ['nanjing-original.json', 'huangdi-neijing-original.json'] as const

interface BuiltinDataFile {
  schemaVersion: number
  book: {
    id: string
    title: string
    author: string | null
    category: string | null
    sourceFormat: string
  }
  source?: {
    path?: string
    format?: string
  }
  quality?: {
    chapterCount?: number
    paragraphCount?: number
  }
  chapters: BuiltinChapter[]
}

interface BuiltinChapter {
  id: string
  parentId: string | null
  orderIndex: number
  level: string | null
  title: string
  contentHash?: string
  quality?: {
    flag?: string
  }
  paragraphs: BuiltinParagraph[]
}

interface BuiltinParagraph {
  id: string
  orderIndex: number
  text: string
  parseHash?: string
  quality?: {
    flag?: string
  }
}

export interface SeedBuiltinResult {
  inserted: boolean
  bookIds: string[]
}

function sha256Hex16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

function dataPath(fileName: string): string {
  const candidates = [
    join(app.getAppPath(), 'data', fileName),
    join(__dirname, '../../data', fileName),
    join(process.cwd(), 'data', fileName),
  ]
  const filePath = candidates.find((candidate) => existsSync(candidate))
  if (!filePath) throw new Error(`未找到内置书籍数据：${candidates.join(', ')}`)
  return filePath
}

function loadBuiltinFile(fileName: string): BuiltinDataFile {
  const file = JSON.parse(readFileSync(dataPath(fileName), 'utf8')) as BuiltinDataFile
  validateBuiltinFile(file, fileName)
  return file
}

function validateBuiltinFile(file: BuiltinDataFile, fileName: string): void {
  if (!file.book?.id || !file.book.title || !Array.isArray(file.chapters)) {
    throw new Error(`内置书籍数据格式错误：${fileName}`)
  }
  for (const chapter of file.chapters) {
    if (!chapter.id || !chapter.title || !Array.isArray(chapter.paragraphs)) {
      throw new Error(`内置章节数据格式错误：${fileName}`)
    }
    for (const paragraph of chapter.paragraphs) {
      if (!paragraph.id || typeof paragraph.text !== 'string') {
        throw new Error(`内置段落数据格式错误：${fileName}`)
      }
    }
  }

  const expectedChapters = file.quality?.chapterCount
  if (typeof expectedChapters === 'number' && expectedChapters !== file.chapters.length) {
    throw new Error(`内置书籍章节数不一致：${fileName} ${file.chapters.length}/${expectedChapters}`)
  }

  const paragraphCount = file.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0)
  const expectedParagraphs = file.quality?.paragraphCount
  if (typeof expectedParagraphs === 'number' && expectedParagraphs !== paragraphCount) {
    throw new Error(`内置书籍段落数不一致：${fileName} ${paragraphCount}/${expectedParagraphs}`)
  }
}

/**
 * Seeds bundled classical content on app startup. Idempotent: when bundled data
 * is unchanged, startup leaves existing progress, notes, and analyses untouched.
 */
export function seedBuiltinContent(): SeedBuiltinResult {
  const files = BUILTIN_FILES.map((fileName) => ({
    fileName,
    data: loadBuiltinFile(fileName),
  }))
  const db = getDb()
  const now = Date.now()
  const bookIds: string[] = []
  let inserted = false

  const insertBook = db.prepare(
    `INSERT INTO books
       (id, title, author, source_format, source_file, cover, category,
        imported_at, parse_version, updated_at, deleted_at)
     VALUES (@id, @title, @author, 'builtin', @sourceFile, NULL, @category,
             @importedAt, @parseVersion, @updatedAt, NULL)`,
  )

  const updateBook = db.prepare(
    `UPDATE books
     SET title = @title,
         author = @author,
         source_format = 'builtin',
         source_file = @sourceFile,
         category = @category,
         parse_version = @parseVersion,
         updated_at = @updatedAt,
         deleted_at = NULL
     WHERE id = @id`,
  )

  const insertChapter = db.prepare(
    `INSERT INTO chapters
       (id, book_id, parent_id, order_index, level, title, content_hash,
        created_at, deleted_at)
     VALUES (@id, @bookId, @parentId, @orderIndex, @level, @title, @contentHash,
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
       (id, chapter_id, order_index, text, edited, parse_hash, is_noise,
        quality_flag, created_at, deleted_at)
     VALUES (@id, @chapterId, @orderIndex, @text, 0, @parseHash, 0,
             @qualityFlag, @createdAt, NULL)
     ON CONFLICT(id) DO UPDATE SET
       chapter_id = excluded.chapter_id,
       order_index = excluded.order_index,
       text = excluded.text,
       edited = 0,
       parse_hash = excluded.parse_hash,
       is_noise = 0,
       quality_flag = excluded.quality_flag,
       deleted_at = NULL`,
  )

  const tx = db.transaction(() => {
    for (const { fileName, data } of files) {
      const bookId = data.book.id
      const version = builtinVersion(data)
      bookIds.push(bookId)

      const existing = db
        .prepare('SELECT id, parse_version FROM books WHERE id = ? AND deleted_at IS NULL')
        .get(bookId) as { id: string; parse_version: number } | undefined
      if (existing?.parse_version === version) continue

      inserted = true
      const bookParams = {
        id: bookId,
        title: data.book.title,
        author: data.book.author,
        category: data.book.category,
        sourceFile: `builtin:data/${fileName}`,
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
        ).run(now, bookId)
        deactivateParagraphAnalysesForBook(bookId, now)
        db.prepare('UPDATE chapters SET deleted_at = ? WHERE book_id = ? AND deleted_at IS NULL').run(
          now,
          bookId,
        )
        updateBook.run(bookParams)
      } else {
        insertBook.run(bookParams)
      }

      for (const chapter of data.chapters) {
        const chapterText = chapter.paragraphs.map((p) => normalize(p.text)).join('\n')
        insertChapter.run({
          id: chapter.id,
          bookId,
          parentId: chapter.parentId,
          orderIndex: chapter.orderIndex,
          level: chapter.level,
          title: chapter.title,
          contentHash: chapter.contentHash ?? sha256Hex16(chapterText),
          createdAt: now,
        })

        for (const paragraph of chapter.paragraphs) {
          const text = normalize(paragraph.text)
          if (!text) continue
          insertParagraph.run({
            id: paragraph.id,
            chapterId: chapter.id,
            orderIndex: paragraph.orderIndex,
            text,
            parseHash: paragraph.parseHash ?? sha256Hex16(text),
            qualityFlag: paragraph.quality?.flag ?? chapter.quality?.flag ?? 'ok',
            createdAt: now,
          })
        }
      }
    }

    if (inserted) rebuildFts(db)
  })

  tx()
  return { inserted, bookIds }
}

function builtinVersion(data: BuiltinDataFile): number {
  const payload = JSON.stringify({
    schemaVersion: data.schemaVersion,
    book: data.book,
    source: data.source,
    quality: data.quality,
    chapters: data.chapters.map((chapter) => ({
      id: chapter.id,
      parentId: chapter.parentId,
      orderIndex: chapter.orderIndex,
      level: chapter.level,
      title: chapter.title,
      contentHash: chapter.contentHash,
      paragraphs: chapter.paragraphs.map((paragraph) => ({
        id: paragraph.id,
        orderIndex: paragraph.orderIndex,
        text: normalize(paragraph.text),
        parseHash: paragraph.parseHash,
      })),
    })),
  })
  return parseInt(sha256Hex16(payload).slice(0, 8), 16)
}
