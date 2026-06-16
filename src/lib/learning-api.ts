/**
 * Typed renderer-side client for `learning:*` channels (LRN module).
 *
 * Lives in its own file (per dev-lrn.md ownership) so the learning surface is
 * self-contained; src/lib/ipc.ts stays untouched. The unwrap follows the same
 * {__ok} envelope + IpcError contract as src/lib/ipc.ts (re-declared locally
 * to avoid editing the shared file).
 */

import { IpcError, type SerializedError } from './ipc'
import type {
  Card,
  CardInput,
  CardDraft,
  BatchResult,
  ReviewInput,
  ReviewResult,
  DueQueueInput,
  QuizGenInput,
  QuizQuestion,
  QuizAnswerInput,
  QuizAnswerResult,
  SessionSummary,
  DashboardDTO,
} from '@/modules/learning/types'

type IpcResult<T> = { __ok: true; data: T } | { __ok: false; error: SerializedError }

async function invokeRaw<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.api) {
    throw new IpcError({ code: 'UNKNOWN', message: 'API bridge unavailable' })
  }
  const result = (await window.api.invoke(channel, ...args)) as IpcResult<T>
  if (!result.__ok) throw new IpcError(result.error)
  return result.data
}

/** learning:* — LRN module IPC wrappers. */
export const learningApi = {
  // Card CRUD
  createCard: (input: CardInput) => invokeRaw<Card>('learning:createCard', input),
  createCardsBatch: (drafts: CardDraft[]) =>
    invokeRaw<BatchResult>('learning:createCardsBatch', drafts),
  getCard: (id: string) => invokeRaw<Card | null>('learning:getCard', id),
  updateCard: (id: string, patch: Partial<CardInput>) =>
    invokeRaw<Card>('learning:updateCard', { id, patch }),
  deleteCard: (id: string) => invokeRaw<null>('learning:deleteCard', id),

  // Review queue & grading
  getDueQueue: (input: DueQueueInput) => invokeRaw<Card[]>('learning:getDueQueue', input),
  reviewCard: (input: ReviewInput) => invokeRaw<ReviewResult>('learning:reviewCard', input),
  undoReview: (cardId: string) => invokeRaw<Card>('learning:undoReview', cardId),

  // Quiz
  generateQuiz: (input: QuizGenInput) =>
    invokeRaw<{ session_id: string; questions: QuizQuestion[] }>('learning:generateQuiz', input),
  submitQuizAnswer: (input: QuizAnswerInput) =>
    invokeRaw<QuizAnswerResult>('learning:submitQuizAnswer', input),
  finishQuizSession: (sessionId: string) =>
    invokeRaw<SessionSummary>('learning:finishQuizSession', { session_id: sessionId }),
  turnErrorToCard: (quizResultId: string) =>
    invokeRaw<Card>('learning:turnErrorToCard', { quiz_result_id: quizResultId }),

  // Dashboard
  getDashboard: (rangeDays?: number) =>
    invokeRaw<DashboardDTO>('learning:getDashboard', { rangeDays }),
  getHeatmap: (year: number) =>
    invokeRaw<Record<string, number>>('learning:getHeatmap', { year }),
}
