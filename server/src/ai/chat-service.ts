/**
 * AI-05 orchestration: guard → RAG retrieval → DeepSeek call → sanitize →
 * persist + bill. The (slow) network call to DeepSeek deliberately happens
 * OUTSIDE any DB transaction — only the fast read (history/search) and the
 * fast write (messages + ledger + balance deduction) hold a connection.
 */
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { searchParagraphs } from '../content/repository'
import { withTransaction } from '../db/with-transaction'
import { ValidationError } from '../lib/errors'
import { applyAdjustmentWithClient, getBalance } from '../wallet/repository'
import { getOrCreateConversation, insertMessage, loadHistory, touchConversation } from './conversation'
import type { DeepSeekClient } from './deepseek'
import { sanitizeOutput, shouldBlock } from './guard'
import { buildQaPrompt } from './prompts'
import type { ProviderConfig } from './types'

export interface AskQuestionParams {
  userId: string
  conversationId?: string
  question: string
}

export interface AskQuestionResult {
  conversationId: string
  answer: string
  blocked: boolean
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
  balance: number
}

export async function askQuestion(
  pool: Pool,
  provider: ProviderConfig,
  client: DeepSeekClient,
  params: AskQuestionParams,
): Promise<AskQuestionResult> {
  const question = params.question.trim()
  if (!question) throw new ValidationError('question is required')

  const conversationId = await withTransaction(pool, async (tx) => {
    const id = await getOrCreateConversation(tx, params.userId, params.conversationId)
    await insertMessage(tx, id, 'user', question)
    return id
  })

  const guardResult = shouldBlock(question)
  if (guardResult.blocked) {
    await withTransaction(pool, async (tx) => {
      await insertMessage(tx, conversationId, 'assistant', guardResult.refusal)
      await touchConversation(tx, conversationId)
    })
    const balance = await getBalance(pool, params.userId)
    return { conversationId, answer: guardResult.refusal, blocked: true, usage: null, balance }
  }

  const [history, contextHits] = await Promise.all([
    loadHistory(pool, conversationId, 20),
    searchParagraphs(pool, question, 5),
  ])

  const { messages, temperature } = buildQaPrompt(
    history,
    contextHits.map((h) => h.text),
    question,
  )
  const response = await client.chat({ model: provider.model, messages, temperature }, provider)
  const rawAnswer = response.choices[0]?.message.content ?? ''
  const { text: answer } = sanitizeOutput(rawAnswer)
  const usage = response.usage

  const balance = await withTransaction(pool, async (tx) => {
    await insertMessage(tx, conversationId, 'assistant', answer)
    await touchConversation(tx, conversationId)
    const newBalance = await applyAdjustmentWithClient(
      tx,
      params.userId,
      -usage.total_tokens,
      null,
      `AI 问答消耗（conversation ${conversationId}）`,
      params.userId,
    )
    await tx.query(
      `INSERT INTO token_usage_ledger
         (id, user_id, conversation_id, prompt_tokens, completion_tokens, total_tokens, tokens_deducted)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        params.userId,
        conversationId,
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.total_tokens,
        usage.total_tokens,
      ],
    )
    return newBalance
  })

  return {
    conversationId,
    answer,
    blocked: false,
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    },
    balance,
  }
}
