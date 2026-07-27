/** CMS-01/CMS-02 content admin + AUTH-04 invite-code management — everything under /admin requires the admin role. */
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { createInviteCode, listInviteCodes, revokeInviteCode } from '../auth/invite-code-admin'
import { requireAdmin } from '../auth/require-admin'
import * as contentAdmin from '../content/admin'
import { NotFoundError, ValidationError } from '../lib/errors'
import { applyBalanceAdjustment, getBalance, listAdjustments, type AdjustmentInput } from '../wallet/repository'

interface BookParams {
  bookId: string
}
interface ChapterParams {
  chapterId: string
}
interface ParagraphParams {
  paragraphId: string
}
interface InviteCodeParams {
  id: string
}
interface WalletParams {
  userId: string
}

export function registerAdminRoutes(app: FastifyInstance, pool: Pool): void {
  app.register(
    async (admin) => {
      admin.addHook('preHandler', requireAdmin)

      admin.setErrorHandler((err, _request, reply) => {
        if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message })
        if (err instanceof ValidationError) return reply.code(400).send({ error: err.message })
        throw err
      })

      // ---- books ----
      admin.post<{ Body: contentAdmin.CreateBookInput }>('/books', async (request, reply) => {
        const book = await contentAdmin.createBook(pool, request.body, request.actor.userId as string)
        return reply.code(201).send(book)
      })

      admin.patch<{ Params: BookParams; Body: contentAdmin.UpdateBookInput }>(
        '/books/:bookId',
        async (request, reply) => {
          await contentAdmin.updateBook(pool, request.params.bookId, request.body)
          return reply.code(204).send()
        },
      )

      admin.post<{ Params: BookParams }>('/books/:bookId/publish', async (request, reply) => {
        await contentAdmin.setBookStatus(pool, request.params.bookId, 'published')
        return reply.code(204).send()
      })

      admin.post<{ Params: BookParams }>('/books/:bookId/unpublish', async (request, reply) => {
        await contentAdmin.setBookStatus(pool, request.params.bookId, 'draft')
        return reply.code(204).send()
      })

      admin.delete<{ Params: BookParams }>('/books/:bookId', async (request, reply) => {
        await contentAdmin.deleteBook(pool, request.params.bookId)
        return reply.code(204).send()
      })

      // ---- chapters ----
      admin.post<{ Params: BookParams; Body: { title: string } }>(
        '/books/:bookId/chapters',
        async (request, reply) => {
          const chapter = await contentAdmin.createChapter(
            pool,
            request.params.bookId,
            request.body.title,
          )
          return reply.code(201).send(chapter)
        },
      )

      admin.patch<{ Params: ChapterParams; Body: { title: string } }>(
        '/chapters/:chapterId',
        async (request, reply) => {
          await contentAdmin.updateChapterTitle(pool, request.params.chapterId, request.body.title)
          return reply.code(204).send()
        },
      )

      admin.delete<{ Params: ChapterParams }>('/chapters/:chapterId', async (request, reply) => {
        await contentAdmin.deleteChapter(pool, request.params.chapterId)
        return reply.code(204).send()
      })

      // ---- paragraphs ----
      admin.post<{ Params: ChapterParams; Body: { text: string } }>(
        '/chapters/:chapterId/paragraphs',
        async (request, reply) => {
          const paragraph = await contentAdmin.createParagraph(
            pool,
            request.params.chapterId,
            request.body.text,
          )
          return reply.code(201).send(paragraph)
        },
      )

      admin.patch<{ Params: ParagraphParams; Body: { text: string } }>(
        '/paragraphs/:paragraphId',
        async (request, reply) => {
          await contentAdmin.editParagraphText(pool, request.params.paragraphId, request.body.text)
          return reply.code(204).send()
        },
      )

      admin.post<{ Body: { paragraphIds: string[] } }>('/paragraphs/merge', async (request, reply) => {
        const result = await contentAdmin.mergeParagraphs(pool, request.body.paragraphIds)
        return reply.send(result)
      })

      admin.post<{ Params: ParagraphParams; Body: { offset: number } }>(
        '/paragraphs/:paragraphId/split',
        async (request, reply) => {
          const result = await contentAdmin.splitParagraph(
            pool,
            request.params.paragraphId,
            request.body.offset,
          )
          return reply.send(result)
        },
      )

      admin.delete<{ Params: ParagraphParams }>('/paragraphs/:paragraphId', async (request, reply) => {
        const result = await contentAdmin.deleteParagraph(pool, request.params.paragraphId)
        return reply.send(result)
      })

      // ---- invite codes (AUTH-04) ----
      admin.post<{ Body: { code: string; maxUses?: number | null; note?: string | null } }>(
        '/invite-codes',
        async (request, reply) => {
          const created = await createInviteCode(pool, request.body, request.actor.userId as string)
          return reply.code(201).send(created)
        },
      )

      admin.get('/invite-codes', async () => ({ inviteCodes: await listInviteCodes(pool) }))

      admin.post<{ Params: InviteCodeParams }>('/invite-codes/:id/revoke', async (request, reply) => {
        await revokeInviteCode(pool, request.params.id)
        return reply.code(204).send()
      })

      // ---- wallets (WALLET-02/03) — manual top-ups, no payment gateway ----
      admin.post<{ Params: WalletParams; Body: AdjustmentInput }>(
        '/wallets/:userId/adjustments',
        async (request, reply) => {
          const result = await applyBalanceAdjustment(
            pool,
            request.params.userId,
            request.body,
            request.actor.userId as string,
          )
          return reply.code(201).send(result)
        },
      )

      admin.get<{ Params: WalletParams }>('/wallets/:userId', async (request) => {
        const [balance, adjustments] = await Promise.all([
          getBalance(pool, request.params.userId),
          listAdjustments(pool, request.params.userId),
        ])
        return { userId: request.params.userId, balance, adjustments }
      })
    },
    { prefix: '/admin' },
  )
}
