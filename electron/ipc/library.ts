import { handle } from './registry'
import { listBooks, getChapterTree } from '../services/library'

/** Library IPC (LIB-01/02/04). Thin pass-throughs to the library service. */
export function registerLibraryHandlers(): void {
  handle('library:list', () => listBooks())

  handle('library:tree', (_event, bookId: unknown) => getChapterTree(bookId as string))
}
