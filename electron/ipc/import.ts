import { dialog, type IpcMainInvokeEvent } from 'electron'
import { handle } from './registry'
import { importEpubFile } from '../services/import'
import type { ImportProgress } from '../models/content'

/**
 * Import IPC (IMP-05 import flow). The renderer cannot touch the filesystem
 * (nodeIntegration off), so the main process owns the file picker and streams
 * progress back via the 'import:progress' event.
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
}
