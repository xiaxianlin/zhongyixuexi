import { handle } from './registry'
import {
  searchParagraphs,
  highlightAll,
  listTerms,
  getTerm,
  upsertTerm,
  deleteTerm,
  type SearchOpts,
  type TermInput,
} from '../services/search'

/**
 * Search IPC (SRH-01 / SRH-04 / SRH-05). Thin pass-throughs to the search
 * service. Channels are `search:<action>` per 00-architecture §4.
 *
 * searchParagraphs is re-exported below for the AI module's RAG path (Phase 5,
 * AI-02) so dev-ai imports the service directly rather than going through IPC.
 */
export function registerSearchHandlers(): void {
  // SRH-01 fulltext (also the RAG entry point via the service export).
  handle('search:fulltext', (_e, payload: unknown) => {
    const p = (payload ?? {}) as { query?: string } & SearchOpts
    return searchParagraphs(p.query ?? '', {
      limit: p.limit,
      offset: p.offset,
      bookIds: p.bookIds,
    })
  })

  // SRH-05 full-library highlight scan (per-paragraph match counts).
  handle('search:highlightAll', (_e, payload: unknown) => {
    const p = (payload ?? {}) as { term?: string; scope?: { bookId?: string } }
    return highlightAll(p.term ?? '', p.scope ?? {})
  })

  // SRH-04 terminology dictionary CRUD.
  handle('search:termList', (_e, payload: unknown) => {
    const p = (payload ?? {}) as { q?: string; category?: string }
    return listTerms({ q: p.q, category: p.category })
  })

  handle('search:termGet', (_e, payload: unknown) => {
    const p = (payload ?? {}) as { termId?: string }
    return getTerm(p.termId ?? '')
  })

  handle('search:termUpsert', (_e, payload: unknown) => {
    const p = (payload ?? {}) as TermInput
    return upsertTerm(p)
  })

  handle('search:termDelete', (_e, payload: unknown) => {
    const p = (payload ?? {}) as { termId?: string }
    deleteTerm(p.termId ?? '')
    return null
  })
}
