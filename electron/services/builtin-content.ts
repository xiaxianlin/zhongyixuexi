import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getDb } from '../db'
import { rebuildFts } from '../db/fts'
import { normalize } from './content-normalize'
import { sha256Hex16 } from './parse-hash'

const BUILTIN_FILES = [
  'nanjing-original.json',
  'suwen-original.json',
  'lingshu-original.json',
  'shanghanlun-original.json',
  'jinkuiyaolue-original.json',
] as const

interface BuiltinDataFile {
  book: {
    id: string
    title: string
    author: string | null
    category: string | null
    /** Stored cover filename, e.g. "nanjing.jpg". Copied from data/covers into
     *  userData/covers on seed so covers.ts can read it back as a data URL. */
    cover?: string | null
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

/**
 * Copy a bundled cover (data/covers/<cover>) into userData/covers/ so the
 * covers service can read it back as a data URL. Idempotent (overwrites).
 * Silently skips if the source isn't bundled (e.g. user-uploaded only).
 */
function copyBuiltinCover(cover: string): void {
  const srcCandidates = [
    join(app.getAppPath(), 'data', 'covers', cover),
    join(__dirname, '../../data/covers', cover),
    join(process.cwd(), 'data', 'covers', cover),
  ]
  const src = srcCandidates.find((c) => existsSync(c))
  if (!src) return // no bundled cover for this book; skip silently
  const destDir = join(app.getPath('userData'), 'covers')
  mkdirSync(destDir, { recursive: true })
  copyFileSync(src, join(destDir, cover))
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
 * Seeds bundled classical content on app startup.
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
       (id, title, author, cover, category, updated_at, deleted_at)
     VALUES (@id, @title, @author, @cover, @category, @updatedAt, NULL)`,
  )

  const insertChapter = db.prepare(
    `INSERT INTO chapters
       (id, book_id, parent_id, order_index, level, title, content_hash,
        created_at, deleted_at)
     VALUES (@id, @bookId, @parentId, @orderIndex, @level, @title, @contentHash,
             @createdAt, NULL)`,
  )

  const insertParagraph = db.prepare(
    `INSERT INTO paragraphs
       (id, chapter_id, order_index, text, edited, parse_hash, is_noise,
        quality_flag, created_at, deleted_at)
     VALUES (@id, @chapterId, @orderIndex, @text, 0, @parseHash, 0,
             @qualityFlag, @createdAt, NULL)`,
  )

  const tx = db.transaction(() => {
    for (const { data } of files) {
      const bookId = data.book.id
      bookIds.push(bookId)

      const existing = db
        .prepare('SELECT id FROM books WHERE id = ? AND deleted_at IS NULL')
        .get(bookId) as { id: string } | undefined
      if (existing) continue

      inserted = true
      const bookParams = {
        id: bookId,
        title: data.book.title,
        author: data.book.author,
        cover: data.book.cover ?? null,
        category: data.book.category,
        updatedAt: now,
      }

      insertBook.run(bookParams)
      // copy the bundled cover (data/covers/<cover>) into userData/covers so
      // covers.ts can read it back as a data URL. Idempotent (overwrite).
      if (data.book.cover) copyBuiltinCover(data.book.cover)

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
