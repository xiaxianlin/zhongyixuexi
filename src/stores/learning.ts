/**
 * Learning module Zustand store (04-learning.md §6.2).
 *
 * Manages the flashcard review session state machine and quiz session state.
 * Session/UI cache only — all persisted data lives in SQLite via IPC.
 */

import { create } from 'zustand'
import { learningApi } from '@/lib/learning-api'
import type { Card, GradeLabel, ReviewMode, QuizQuestion } from '@/modules/learning/types'

// ---- Flashcard state machine (LRN-04) ----

export type FlipState = 'idle' | 'showingFront' | 'showingBack' | 'graded' | 'done'

interface SessionStats {
  reviewed: number
  again: number
  totalMs: number
}

interface LearningStore {
  // queue
  queue: Card[]
  cursor: number
  current: Card | null
  // flip state machine
  flipState: FlipState
  flippedAt: number | null
  submitting: boolean
  // session stats
  sessionStats: SessionStats
  // error
  error: string | null

  // actions
  loadQueue: (mode: ReviewMode) => Promise<void>
  flip: () => void
  grade: (label: GradeLabel) => Promise<void>
  undo: () => Promise<void>
  next: () => void
  reset: () => void
}

export const useLearningStore = create<LearningStore>((set, get) => ({
  queue: [],
  cursor: 0,
  current: null,
  flipState: 'idle',
  flippedAt: null,
  submitting: false,
  sessionStats: { reviewed: 0, again: 0, totalMs: 0 },
  error: null,

  loadQueue: async (mode: ReviewMode) => {
    set({ flipState: 'idle', error: null })
    try {
      const cards = await learningApi.getDueQueue({ mode })
      if (cards.length === 0) {
        set({ queue: [], cursor: 0, current: null, flipState: 'done' })
        return
      }
      set({
        queue: cards,
        cursor: 0,
        current: cards[0]!,
        flipState: 'showingFront',
        flippedAt: null,
        sessionStats: { reviewed: 0, again: 0, totalMs: 0 },
      })
    } catch (e) {
      set({ error: (e as Error).message, flipState: 'idle' })
    }
  },

  flip: () => {
    const { flipState } = get()
    if (flipState === 'showingFront') {
      set({ flipState: 'showingBack', flippedAt: Date.now() })
    }
  },

  grade: async (label: GradeLabel) => {
    const { current, flippedAt, submitting } = get()
    if (!current || submitting) return

    set({ flipState: 'graded', submitting: true })
    const elapsedMs = flippedAt ? Date.now() - flippedAt : null

    try {
      const result = await learningApi.reviewCard({
        card_id: current.id,
        grade_label: label,
        elapsed_ms: elapsedMs,
      })

      set((state) => ({
        submitting: false,
        sessionStats: {
          reviewed: state.sessionStats.reviewed + 1,
          again: state.sessionStats.again + (label === 'again' ? 1 : 0),
          totalMs: state.sessionStats.totalMs + (elapsedMs ?? 0),
        },
        // Update the card in the queue so undo can reference it
        queue: state.queue.map((c, i) =>
          i === state.cursor ? result.card : c,
        ),
      }))

      get().next()
    } catch (e) {
      set({ submitting: false, error: (e as Error).message, flipState: 'showingBack' })
    }
  },

  undo: async () => {
    const { current } = get()
    if (!current) return
    try {
      const restored = await learningApi.undoReview(current.id)
      set((state) => ({
        queue: state.queue.map((c, i) => (i === state.cursor ? restored : c)),
        current: restored,
        sessionStats: {
          ...state.sessionStats,
          reviewed: Math.max(0, state.sessionStats.reviewed - 1),
        },
      }))
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  next: () => {
    const { queue, cursor } = get()
    const nextCursor = cursor + 1
    if (nextCursor < queue.length) {
      set({
        cursor: nextCursor,
        current: queue[nextCursor]!,
        flipState: 'showingFront',
        flippedAt: null,
      })
    } else {
      set({ flipState: 'done', current: null })
    }
  },

  reset: () => {
    set({
      queue: [],
      cursor: 0,
      current: null,
      flipState: 'idle',
      flippedAt: null,
      submitting: false,
      sessionStats: { reviewed: 0, again: 0, totalMs: 0 },
      error: null,
    })
  },
}))

// ---- Quiz session state (LRN-05) ----

interface QuizStore {
  sessionId: string | null
  questions: QuizQuestion[]
  cursor: number
  current: QuizQuestion | null
  answers: Map<string, boolean>
  finished: boolean
  error: string | null

  startQuiz: (bookId?: string | null, chapterId?: string | null, count?: number) => Promise<void>
  submitAnswer: (userAnswer: string) => Promise<boolean>
  nextQuestion: () => void
  reset: () => void
}

export const useQuizStore = create<QuizStore>((set, get) => ({
  sessionId: null,
  questions: [],
  cursor: 0,
  current: null,
  answers: new Map(),
  finished: false,
  error: null,

  startQuiz: async (bookId, chapterId, count = 10) => {
    set({ error: null, finished: false })
    try {
      const res = await learningApi.generateQuiz({
        book_id: bookId ?? null,
        chapter_id: chapterId ?? null,
        count,
        qtypes: ['choice', 'judge', 'match'],
      })
      set({
        sessionId: res.session_id,
        questions: res.questions,
        cursor: 0,
        current: res.questions[0] ?? null,
        answers: new Map(),
        finished: false,
      })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  submitAnswer: async (userAnswer: string) => {
    const { current, sessionId } = get()
    if (!current || !sessionId) return false

    try {
      const result = await learningApi.submitQuizAnswer({
        session_id: sessionId,
        quiz_question_id: current.id,
        user_answer: userAnswer,
      })
      set((state) => {
        const newAnswers = new Map(state.answers)
        newAnswers.set(current.id, result.is_correct)
        return { answers: newAnswers }
      })
      return result.is_correct
    } catch (e) {
      set({ error: (e as Error).message })
      return false
    }
  },

  nextQuestion: () => {
    const { questions, cursor } = get()
    const next = cursor + 1
    if (next < questions.length) {
      set({ cursor: next, current: questions[next]! })
    } else {
      set({ finished: true, current: null })
    }
  },

  reset: () => {
    set({
      sessionId: null,
      questions: [],
      cursor: 0,
      current: null,
      answers: new Map(),
      finished: false,
      error: null,
    })
  },
}))
