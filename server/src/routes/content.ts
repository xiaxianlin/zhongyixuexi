import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getBookDetail, listPublishedBooks, searchParagraphs } from '../content/repository'

interface BookParams {
  bookId: string
}

interface SearchQuerystring {
  q?: string
}

/** LIB-01..04 and SRH-01: original text and search are guest-accessible — no requireTier gate. */
export function registerContentRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/books', async () => ({ books: await listPublishedBooks(pool) }))

  app.get<{ Params: BookParams }>('/books/:bookId', async (request, reply) => {
    const detail = await getBookDetail(pool, request.params.bookId)
    if (!detail) {
      return reply.code(404).send({ error: 'book not found' })
    }
    return detail
  })

  app.get<{ Querystring: SearchQuerystring }>('/search', async (request) => ({
    hits: await searchParagraphs(pool, request.query.q ?? ''),
  }))
}
