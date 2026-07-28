import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { requireTier } from '../auth/require-tier'
import { askQuestion } from '../ai/chat-service'
import { deepseek } from '../ai/deepseek'
import { getProviderConfig } from '../ai/provider'
import { createWalletBalanceLookup } from '../wallet/repository'

interface ChatBody {
  conversationId?: string
  question: string
}

/** AI-05: paid_member only (requireTier gate reads the real wallet balance from S9.6). */
export function registerChatRoutes(app: FastifyInstance, pool: Pool): void {
  const wallet = createWalletBalanceLookup(pool)

  app.post<{ Body: ChatBody }>(
    '/chat',
    {
      preHandler: requireTier('paid_member', wallet),
      // Each call is a real, billed DeepSeek round trip — cap the rate
      // independently of the wallet balance so a runaway client can't hammer
      // the upstream API even while it still has tokens to spend.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const provider = getProviderConfig()
      const result = await askQuestion(pool, provider, deepseek, {
        userId: request.actor.userId as string,
        conversationId: request.body.conversationId,
        question: request.body.question,
      })
      return reply.send(result)
    },
  )
}
