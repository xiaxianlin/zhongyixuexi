import { handle } from './registry'
import {
  searchParagraphs,
  type SearchOpts,
} from '../services/search'

/**
 * Search IPC. Thin pass-throughs to the search service.
 */
export function registerSearchHandlers(): void {
  handle('search:fulltext', (_e, payload: unknown) => {
    const p = (payload ?? {}) as { query?: string } & SearchOpts
    return searchParagraphs(p.query ?? '', {
      limit: p.limit,
      offset: p.offset,
      bookIds: p.bookIds,
    })
  })
}
