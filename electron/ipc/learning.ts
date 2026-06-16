import { handle } from './registry'
import {
  createCard,
  createCards,
  getCard,
  updateCard,
  deleteCard,
  getDueQueue,
  reviewCard,
  undoReview,
  generateQuiz,
  submitQuizAnswer,
  finishQuizSession,
  turnErrorToCard,
  getDashboard,
  getHeatmap,
} from '../services/learning'
import type {
  CardInput,
  CardDraft,
  DueQueueInput,
  ReviewInput,
  QuizGenInput,
  QuizAnswerInput,
} from '../services/learning'

/**
 * Learning IPC (LRN module — 04-learning.md §5).
 *
 * Thin pass-throughs to the learning service. Channel naming follows the
 * `learning:<action>` convention. All results are wrapped in the {__ok}
 * envelope by registry.ts `handle()`.
 */
export function registerLearningHandlers(): void {
  // ---- Card CRUD (LRN-01/03) ----
  handle('learning:createCard', (_e, input: unknown) => createCard(input as CardInput))

  handle('learning:createCardsBatch', (_e, drafts: unknown) =>
    createCards(drafts as CardDraft[]),
  )

  handle('learning:getCard', (_e, id: unknown) => getCard(id as string))

  handle('learning:updateCard', (_e, args: unknown) => {
    const { id, patch } = args as { id: string; patch: Record<string, unknown> }
    return updateCard(id, patch)
  })

  handle('learning:deleteCard', (_e, id: unknown) => {
    deleteCard(id as string)
    return null
  })

  // ---- Daily review queue (LRN-02) ----
  handle('learning:getDueQueue', (_e, input: unknown) => getDueQueue(input as DueQueueInput))

  // ---- Review grading (LRN-01/04) ----
  handle('learning:reviewCard', (_e, input: unknown) => reviewCard(input as ReviewInput))

  handle('learning:undoReview', (_e, cardId: unknown) => undoReview(cardId as string))

  // ---- Quiz (LRN-05) ----
  handle('learning:generateQuiz', (_e, input: unknown) => generateQuiz(input as QuizGenInput))

  handle('learning:submitQuizAnswer', (_e, input: unknown) =>
    submitQuizAnswer(input as QuizAnswerInput),
  )

  handle('learning:finishQuizSession', (_e, args: unknown) => {
    const { session_id } = args as { session_id: string }
    return finishQuizSession(session_id)
  })

  handle('learning:turnErrorToCard', (_e, args: unknown) => {
    const { quiz_result_id } = args as { quiz_result_id: string }
    return turnErrorToCard(quiz_result_id)
  })

  // ---- Dashboard (LRN-06) ----
  handle('learning:getDashboard', (_e, args: unknown) => {
    const { rangeDays } = (args ?? {}) as { rangeDays?: number }
    return getDashboard(rangeDays)
  })

  handle('learning:getHeatmap', (_e, args: unknown) => {
    const { year } = args as { year: number }
    return getHeatmap(year)
  })
}
