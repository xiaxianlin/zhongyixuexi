/**
 * Learning module shared types (renderer-side DTOs).
 *
 * Mirrors the server-side types from electron/services/learning.ts but kept
 * self-contained in the learning module's own types file (per dev-lrn.md
 * ownership — we do NOT edit src/lib/types.ts).
 */

export type CardType =
  | 'original_to_interpret'
  | 'term_to_meaning'
  | 'image_to_name'
  | 'title_to_points'

export type CardSource = 'manual' | 'reading' | 'ai_batch' | 'quiz_error'

export type GradeLabel = 'again' | 'hard' | 'good' | 'easy'

export type ReviewMode = 'today' | 'all' | 'random'

export type ReviewOrder = 'reviews_first' | 'new_first' | 'mixed'

export type QuizType = 'choice' | 'match' | 'judge'

/** SM-2 four-button → raw 0..5 mapping. */
export const GRADE_MAP: Record<GradeLabel, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
}

export interface Card {
  id: string
  deck: string
  type: CardType
  front: string
  back: string
  book_id: string | null
  chapter_id: string | null
  paragraph_id: string | null
  source: CardSource
  source_ref: string | null
  ease_factor: number
  interval_days: number
  repetitions: number
  due_at: number
  status: string
  reviewed_count: number
  lapsed_count: number
  tags: string | null
  created_at: number
  updated_at: number
}

export interface CardInput {
  front: string
  back: string
  type?: CardType
  deck?: string
  book_id?: string | null
  chapter_id?: string | null
  paragraph_id?: string | null
  source?: CardSource
  source_ref?: string | null
  tags?: string | null
}

export interface CardDraft {
  front: string
  back: string
  type?: CardType
  paragraphId?: string | null
}

export interface BatchResult {
  created: number
  skipped: number
  errors: string[]
  ids: string[]
}

export interface ReviewInput {
  card_id: string
  grade_label: GradeLabel
  elapsed_ms?: number | null
}

export interface ReviewResult {
  card: Card
  log: { id: string }
}

export interface DueQueueInput {
  deck?: string
  mode: ReviewMode
  limit?: number
  newPerDay?: number
  reviewOrder?: ReviewOrder
}

export interface QuizQuestion {
  id: string
  book_id: string | null
  chapter_id: string | null
  paragraph_id: string | null
  source: string
  qtype: QuizType
  stem: string
  payload: string
  answer: string
  explanation: string | null
  difficulty: number | null
  created_at: number
}

export interface QuizGenInput {
  book_id?: string | null
  chapter_id?: string | null
  count: number
  qtypes: QuizType[]
}

export interface QuizAnswerInput {
  session_id: string
  quiz_question_id: string
  user_answer: string
  time_spent_ms?: number | null
}

export interface QuizAnswerResult {
  is_correct: boolean
  answer: string
  explanation: string | null
}

export interface SessionSummary {
  total: number
  correct: number
  wrongQuestions: {
    result_id: string
    question_id: string
    stem: string
    user_answer: string
    correct_answer: string
    explanation: string | null
    qtype: QuizType
  }[]
}

export interface DashboardDTO {
  totalCards: number
  dueToday: number
  mastered: number
  masteryRate: number
  streak: number
  heatmap: Record<string, number>
  weakChapters: {
    chapter_id: string
    title: string
    card_count: number
    lapse_rate: number
  }[]
  recent7: { day: string; reviewed: number; again: number }[]
}
