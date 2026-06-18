/**
 * Search domain renderer IPC client — search:* channels (SRH module).
 *
 * Unwraps the {__ok} envelope via models/shared/ipc.ts. Mirrors channels
 * registered in electron/ipc/search.ts.
 */
import { invokeRaw } from '@/models/shared/ipc'
import type { SearchResult } from './types'

export interface FulltextArgs {
  query: string
  limit?: number
  offset?: number
  bookIds?: string[]
}

export const searchApi = {
  fulltext: (args: FulltextArgs) => invokeRaw<SearchResult>('search:fulltext', args),
}
