import { dialog, type IpcMainInvokeEvent } from 'electron'
import { handle } from './registry'
import { importEpubFile, reparseBook } from '../services/import'
import type { ImportProgress } from '../models/content'

export function registerImportHandlers(): void {
  handle('import:pickAndImport', async (event: IpcMainInvokeEvent) => {
    const result = await dialog.showOpenDialog({
      title: '选择 EPUB',
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
