/**
 * Book cover service — picks an image via the OS file dialog, copies it into
 * userData/covers/<bookId>.<ext>, and updates books.cover with the stored
 * (relative) filename. Reading the cover back as a data URL is done by the
 * library service (listBooks) so the renderer can <img src> it directly under
 * the default webSecurity policy (no file:// loading).
 */
import { app, dialog } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] as const

function coversDir(): string {
  const dir = join(app.getPath('userData'), 'covers')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Open the OS file picker for one image; returns null if the user cancels. */
export async function pickCoverImage(): Promise<{ path: string; ext: string } | null> {
  const result = await dialog.showOpenDialog({
    title: '选择书籍封面',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: [...IMAGE_EXTS] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]!
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (!IMAGE_EXTS.includes(ext as (typeof IMAGE_EXTS)[number])) {
    throw new AppError('VALIDATION', '请选择图片文件(png/jpg/webp/gif/bmp)')
  }
  return { path: filePath, ext }
}

/**
 * Set a book's cover: pick an image, copy it into userData/covers, update the
 * books.cover column with the stored filename (e.g. "<bookId>.png"). Returns
 * the new cover filename (or null if the user cancelled).
 */
export async function setBookCover(bookId: string): Promise<string | null> {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM books WHERE id = ? AND deleted_at IS NULL')
    .get(bookId) as { id: string } | undefined
  if (!existing) throw new AppError('NOT_FOUND', `书籍 ${bookId} 不存在`)

  const picked = await pickCoverImage()
  if (!picked) return null

  const destName = `${bookId}.${picked.ext}`
  const destPath = join(coversDir(), destName)
  // remove any prior cover for this book (different ext) before writing
  removeExistingCover(bookId)
  copyFileSync(picked.path, destPath)

  db.prepare('UPDATE books SET cover = ?, updated_at = ? WHERE id = ?').run(
    destName,
    Date.now(),
    bookId,
  )
  return destName
}

/** Remove any existing cover file for a book (across all image exts). */
function removeExistingCover(bookId: string): void {
  const dir = coversDir()
  for (const ext of IMAGE_EXTS) {
    const p = join(dir, `${bookId}.${ext}`)
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        // ignore — best-effort cleanup
      }
    }
  }
}

/**
 * Read a stored cover filename as a data URL for <img src>. Returns null if the
 * file is missing or cover is null. Memoized by filename in a tiny in-process
 * cache so listBooks doesn't re-read on every call.
 */
const coverCache = new Map<string, string>()

export function readCoverAsDataUrl(storedName: string | null): string | null {
  if (!storedName) return null
  const cached = coverCache.get(storedName)
  if (cached) return cached
  const path = join(coversDir(), storedName)
  if (!existsSync(path)) return null
  const buf = readFileSync(path)
  const ext = storedName.split('.').pop()?.toLowerCase() ?? 'png'
  const mime = ext === 'jpg' ? 'jpeg' : ext
  const dataUrl = `data:image/${mime};base64,${buf.toString('base64')}`
  coverCache.set(storedName, dataUrl)
  return dataUrl
}
