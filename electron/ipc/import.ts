import { dialog, type IpcMainInvokeEvent } from 'electron'
import { handle } from './registry'
import { importEpubFile, reparseBook } from '../services/import'
import type { ImportProgress } from '../models/content'

/**
 * Import IPC (IMP-01/05/07 import + reparse flow). The renderer cannot touch
 * the filesystem (nodeIntegration off), so the main process owns the file
 * picker and streams progress back via the 'import:progress' event.
 *
 * Both import:pickAndImport and import:reparse use AI-driven chapter parsing
 * (DeepSeek). A configured API Key is required — errors carry
 * aiCode='AI_KEY_NOT_CONFIGURED' so the renderer can prompt the user to
 * configure one in Settings before retrying.
 */
export function registerImportHandlers(): void {
  handle('import:pickAndImport', async (event: IpcMainInvokeEvent) => {
    const result = await dialog.showOpenDialog({
      title: '选择 EPUB 书籍',
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    return importEpubFile(filePath, {
      onProgress: (p: ImportProgress) => event.sender.send('import:progress', p),
    })
  })

  handle('import:reparse', async (event: IpcMainInvokeEvent, payload: unknown) => {
    const bookId = (payload as { bookId?: unknown } | null)?.bookId
    if (!bookId || typeof bookId !== 'string') {
      throw new Error('bookId is required')
    }
    return reparseBook(bookId, {
      onProgress: (p: ImportProgress) => event.sender.send('import:progress', p),
    })
  })
}
