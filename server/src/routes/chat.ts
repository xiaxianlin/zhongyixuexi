import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { requireTier } from '../auth/require-tier'
import { askQuestion } from '../ai/chat-service'
import { deepseek } from '../ai/deepseek'
import { AiError, type AiSubCode } from '../ai/errors'
import { getProviderConfig } from '../ai/provider'
import { createWalletBalanceLookup } from '../wallet/repository'

interface ChatBody {
  conversationId?: string
  question: string
}

/** AI-02 degraded-mode copy per failure reason — kept separate from AiError's own (operator-facing) message. */
const AI_ERROR_MESSAGES: Record<AiSubCode, string> = {
  AI_KEY_NOT_CONFIGURED: 'AI 服务暂未配置，问答功能暂不可用',
  AI_AUTH_ERROR: 'AI 服务暂时不可用，请稍后再试或联系管理员',
  AI_QUOTA_EXCEEDED: 'AI 服务额度已用尽，请稍后再试',
  AI_TIMEOUT: 'AI 服务响应超时，请稍后重试',
  AI_SERVER_ERROR: 'AI 服务暂时不可用，请稍后重试',
  AI_REQUEST_FAILED: 'AI 服务调用失败，请稍后重试',
  AI_UNKNOWN: 'AI 服务出现未知错误，请稍后重试',
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
      try {
        const result = await askQuestion(pool, provider, deepseek, {
          userId: request.actor.userId as string,
          conversationId: request.body.conversationId,
          question: request.body.question,
        })
        return reply.send(result)
      } catch (err) {
        if (err instanceof AiError) {
          // AI-02: an upstream/config failure degrades to a clear message,
          // not an opaque 500 — askQuestion() throws before any billing
          // transaction runs, so no balance was deducted for this attempt.
          request.log.error({ err }, err.message)
          return reply.code(502).send({ error: AI_ERROR_MESSAGES[err.sub] })
        }
        throw err
      }
    },
  )
}
