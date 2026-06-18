import { handle } from './registry'
import { listBooks, getChapterTree, reorderBooks } from '../services/library'
import { setBookCover } from '../services/covers'

/** Library IPC (LIB-01/02/04). Thin pass-throughs to the library service. */
export function registerLibraryHandlers(): void {
  handle('library:list', () => listBooks())

  handle('library:tree', (_event, bookId: unknown) => getChapterTree(bookId as string))

  handle('library:reorder', (_event, input: unknown) => {
    const p = (input ?? {}) as { bookIds?: string[] }
    return reorderBooks(Array.isArray(p.bookIds) ? p.bookIds : [])
  })

  // Opens the OS file picker, stores the chosen image, returns refreshed books.
  handle('books:uploadCover', async (_event, input: unknown) => {
    const p = (input ?? {}) as { bookId?: string }
    await setBookCover(p.bookId ?? '')
    return listBooks()
  })
}
