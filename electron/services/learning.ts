/**
 * Learning service (LRN module — 04-learning.md).
 *
 * Owns the SM-2 spaced-repetition algorithm (pure `schedule()`), card CRUD,
 * the daily review queue, transactional review grading with undo, quiz
 * generation/scoring/error-to-card, and the dashboard aggregation queries.
 *
 * SM-2 formula reference (04-learning §7.1):
 *   I(1)=1, I(2)=6, I(n)=I(n-1)×EF  (n≥3)
 *   EF'=EF+(0.1-(5-q)(0.08+(5-q)0.02)), floor 1.3
 *   q<3 → lapse: repetitions=0, interval=1
 *
 * The `schedule()` function is a pure export so it can be unit-tested without
 * a database (better-sqlite3 cannot load under vitest/node ABI mismatch).
 */

import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import {
  activeAnalysisSql,
  mapParagraphAnalysisView,
  type ParagraphAnalysisSqlRow,
  type ParagraphAnalysisView,
} from './paragraph-analysis'

// ===================== Types (self-contained DTOs) ==========================

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

/** SM-2 four-button → raw 0..5 mapping (04-learning §7.1.5). */
export const GRADE_MAP: Record<GradeLabel, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
}

const DAY_MS = 24 * 3600 * 1000

interface QuizParagraphCandidate {
  id: string
  chapter_id: string
  book_id: string
  text: string
  interpretation: ParagraphAnalysisView
}

// ===================== SM-2 pure function ===================================

/** Scheduling state carried on each card. */
export interface SchedState {
  ease_factor: number
  interval_days: number
  repetitions: number
}

/** Result of `schedule()` — new state + computed next interval & due_at. */
export interface SchedResult extends SchedState {
  next_interval_days: number
  next_due_at: number
}

/**
 * Compute the next SM-2 interval given repetitions, EF, and previous interval.
 *   n ≤ 0 → 0 (not yet studied)
 *   n = 1 → 1 day
 *   n = 2 → 6 days
 *   n ≥ 3 → round(prevInterval × EF)
 *
 * Pure, no side effects.
 */
export function nextInterval(n: number, ef: number, prevInterval: number): number {
  if (n <= 0) return 0
  if (n === 1) return 1
  if (n === 2) return 6
  return Math.round(prevInterval * ef)
}

/** Round to 2 decimal places (EF precision). */
function round2(x: number): number {
  return Math.round(x * 100) / 100
}

/**
 * SM-2 scheduling core. Given the card's current scheduling state and the
 * user's four-button grade, returns the new scheduling state and next due_at.
 *
 * Pure function — no IO, fully deterministic given `nowMs`.
 *
 * @param prev     Current card scheduling state (EF / interval / repetitions)
 * @param label    UI four-button grade
 * @param nowMs    Current timestamp in ms (default Date.now())
 */
export function schedule(prev: SchedState, label: GradeLabel, nowMs: number = Date.now()): SchedResult {
  const q = GRADE_MAP[label]
  let ef = prev.ease_factor
  let ivl = prev.interval_days
  let n = prev.repetitions

  // 1) EF update (standard SM-2 formula, floor 1.3)
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  ef = Math.max(1.3, ef)

  // 2) repetitions & interval
  if (q < 3) {
    // Lapse: reset repetitions, 1 day until next review
    n = 0
    ivl = 1
  } else {
    n = n + 1
    ivl = nextInterval(n, ef, ivl)
  }

  const next_due_at = nowMs + ivl * DAY_MS

  return {
    ease_factor: round2(ef),
    interval_days: ivl,
    repetitions: n,
    next_interval_days: ivl,
    next_due_at,
  }
}

// ===================== Card DTOs ============================================

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

/** Input for creating a card (manual / reading / quiz_error). */
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

/** Batch draft shape consumed by AI module (AI-06 contract). */
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

// ===================== Quiz DTOs ============================================

export interface QuizQuestion {
  id: string
  book_id: string | null
  chapter_id: string | null
  paragraph_id: string | null
  source: string
  qtype: QuizType
  stem: string
  payload: string // JSON
  answer: string // JSON
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
  user_answer: string // JSON
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

// ===================== Dashboard DTOs =======================================

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

// ===================== Mastery threshold constant ===========================

/** A card is "mastered" if it has reached stable long-interval review. */
const MASTERY_REPS = 2
const MASTERY_INTERVAL = 7
const MASTERY_EF = 2.3

// ===================== Card CRUD ============================================

/** Map a raw DB row to the Card DTO. */
function rowToCard(r: Record<string, unknown>): Card {
  return {
    id: r.id as string,
    deck: r.deck as string,
    type: r.type as CardType,
    front: r.front as string,
    back: r.back as string,
    book_id: (r.book_id as string) ?? null,
    chapter_id: (r.chapter_id as string) ?? null,
    paragraph_id: (r.paragraph_id as string) ?? null,
    source: r.source as CardSource,
    source_ref: (r.source_ref as string) ?? null,
    ease_factor: r.ease_factor as number,
    interval_days: r.interval_days as number,
    repetitions: r.repetitions as number,
    due_at: r.due_at as number,
    status: r.status as string,
    reviewed_count: r.reviewed_count as number,
    lapsed_count: r.lapsed_count as number,
    tags: (r.tags as string) ?? null,
    created_at: r.created_at as number,
    updated_at: r.updated_at as number,
  }
}

const CARD_COLS = `id, deck, type, front, back, book_id, chapter_id, paragraph_id,
  source, source_ref, ease_factor, interval_days, repetitions, due_at,
  status, reviewed_count, lapsed_count, tags, created_at, updated_at`

/**
 * Create a single card. New cards start with SM-2 defaults (EF=2.5,
 * interval=0, repetitions=0, due_at=now → immediately available).
 */
export function createCard(input: CardInput): Card {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  const type = input.type ?? 'original_to_interpret'
  const deck = input.deck ?? 'default'
  const source = input.source ?? 'manual'

  if (!input.front?.trim()) {
    throw new AppError('VALIDATION', 'card front must not be empty')
  }
  if (!input.back?.trim()) {
    throw new AppError('VALIDATION', 'card back must not be empty')
  }

  db.prepare(
    `INSERT INTO cards (id, deck, type, front, back, book_id, chapter_id, paragraph_id,
        source, source_ref, ease_factor, interval_days, repetitions, due_at,
        status, reviewed_count, lapsed_count, tags, created_at, updated_at)
     VALUES (@id, @deck, @type, @front, @back, @book_id, @chapter_id, @paragraph_id,
        @source, @source_ref, 2.5, 0, 0, @due_at, 'active', 0, 0, @tags, @created_at, @updated_at)`,
  ).run({
    id,
    deck,
    type,
    front: input.front,
    back: input.back,
    book_id: input.book_id ?? null,
    chapter_id: input.chapter_id ?? null,
    paragraph_id: input.paragraph_id ?? null,
    source,
    source_ref: input.source_ref ?? null,
    due_at: now,
    tags: input.tags ?? null,
    created_at: now,
    updated_at: now,
  })

  const row = db.prepare(`SELECT ${CARD_COLS} FROM cards WHERE id = ?`).get(id) as Record<string, unknown>
  return rowToCard(row)
}

/**
 * Batch-create cards from AI drafts (AI-06 contract). Validates each draft;
 * invalid ones are skipped (not fatal). All valid inserts run in one transaction.
 *
 * Contract signature for AI module: `createCards(drafts: CardDraft[])`
 */
export function createCards(drafts: CardDraft[]): BatchResult {
  const db = getDb()
  const now = Date.now()
  const ids: string[] = []
  const errors: string[] = []
  let skipped = 0
  let created = 0

  const insert = db.prepare(
    `INSERT INTO cards (id, deck, type, front, back, book_id, chapter_id, paragraph_id,
        source, source_ref, ease_factor, interval_days, repetitions, due_at,
        status, reviewed_count, lapsed_count, tags, created_at, updated_at)
     VALUES (@id, @deck, @type, @front, @back, @book_id, @chapter_id, @paragraph_id,
        @source, @source_ref, 2.5, 0, 0, @due_at, 'active', 0, 0, @tags, @created_at, @updated_at)`,
  )

  const tx = db.transaction(() => {
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i]!
      if (!d.front?.trim() || !d.back?.trim()) {
        skipped++
        errors.push(`draft[${i}]: front/back empty`)
        continue
      }
      const id = randomUUID()
      insert.run({
        id,
        deck: 'default',
        type: d.type ?? 'original_to_interpret',
        front: d.front,
        back: d.back,
        book_id: null,
        chapter_id: null,
        paragraph_id: d.paragraphId ?? null,
        source: 'ai_batch',
        source_ref: null,
        due_at: now,
        tags: null,
        created_at: now,
        updated_at: now,
      })
      ids.push(id)
      created++
    }
  })
  tx()

  return { created, skipped, errors, ids }
}

/** Get a single card by id. Returns null if not found / soft-deleted. */
export function getCard(id: string): Card | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT ${CARD_COLS} FROM cards WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToCard(row) : null
}

export interface CardEditable {
  front?: string
  back?: string
  type?: CardType
  deck?: string
  tags?: string | null
  status?: string
  book_id?: string | null
  chapter_id?: string | null
  paragraph_id?: string | null
}

/** Update editable fields on a card. */
export function updateCard(id: string, patch: CardEditable): Card {
  const db = getDb()
  const existing = getCard(id)
  if (!existing) throw new AppError('NOT_FOUND', `card ${id} not found`)

  const sets: string[] = []
  const vals: Record<string, unknown> = { id, updated_at: Date.now() }

  if (patch.front !== undefined) {
    sets.push('front = @front')
    vals.front = patch.front
  }
  if (patch.back !== undefined) {
    sets.push('back = @back')
    vals.back = patch.back
  }
  if (patch.type !== undefined) {
    sets.push('type = @type')
    vals.type = patch.type
  }
  if (patch.deck !== undefined) {
    sets.push('deck = @deck')
    vals.deck = patch.deck
  }
  if (patch.tags !== undefined) {
    sets.push('tags = @tags')
    vals.tags = patch.tags
  }
  if (patch.status !== undefined) {
    sets.push('status = @status')
    vals.status = patch.status
  }
  if (patch.book_id !== undefined) {
    sets.push('book_id = @book_id')
    vals.book_id = patch.book_id
  }
  if (patch.chapter_id !== undefined) {
    sets.push('chapter_id = @chapter_id')
    vals.chapter_id = patch.chapter_id
  }
  if (patch.paragraph_id !== undefined) {
    sets.push('paragraph_id = @paragraph_id')
    vals.paragraph_id = patch.paragraph_id
  }

  if (sets.length > 0) {
    sets.push('updated_at = @updated_at')
    db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = @id`).run(vals)
  }

  return getCard(id)!
}

/** Soft-delete a card (set deleted_at). */
export function deleteCard(id: string): void {
  const db = getDb()
  db.prepare('UPDATE cards SET deleted_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), id)
}

// ===================== Daily review queue (LRN-02) ==========================

/**
 * Get the review queue for a session.
 *
 * Modes:
 *  - today: due cards (due_at <= now) + new cards (repetitions=0), capped by newPerDay
 *  - all:   all active cards in the deck, ordered by due_at
 *  - random: random sample of active cards
 *
 * The `reviewOrder` setting (reviews_first / new_first / mixed) controls the
 * interleaving of review vs new cards in `today` mode.
 */
export function getDueQueue(input: DueQueueInput): Card[] {
  const db = getDb()
  const deck = input.deck ?? 'default'
  const now = Date.now()
  const order = input.reviewOrder ?? 'reviews_first'
  const newPerDay = input.newPerDay ?? 20

  if (input.mode === 'all') {
    const rows = db
      .prepare(
        `SELECT ${CARD_COLS} FROM cards
         WHERE deck = ? AND status = 'active' AND deleted_at IS NULL
         ORDER BY due_at ASC`,
      )
      .all(deck) as Record<string, unknown>[]
    return rows.map(rowToCard)
  }

  if (input.mode === 'random') {
    const limit = input.limit ?? 20
    const rows = db
      .prepare(
        `SELECT ${CARD_COLS} FROM cards
         WHERE deck = ? AND status = 'active' AND deleted_at IS NULL
         ORDER BY RANDOM()
         LIMIT ?`,
      )
      .all(deck, limit) as Record<string, unknown>[]
    return rows.map(rowToCard)
  }

  // mode === 'today'
  const reviews = db
    .prepare(
      `SELECT ${CARD_COLS} FROM cards
       WHERE deck = ? AND status = 'active' AND deleted_at IS NULL
         AND repetitions > 0 AND due_at <= ?
       ORDER BY due_at ASC`,
    )
    .all(deck, now) as Record<string, unknown>[]

  const newCards = db
    .prepare(
      `SELECT ${CARD_COLS} FROM cards
       WHERE deck = ? AND status = 'active' AND deleted_at IS NULL
         AND repetitions = 0
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(deck, newPerDay) as Record<string, unknown>[]

  const reviewCards = reviews.map(rowToCard)
  const newCardList = newCards.map(rowToCard)

  if (order === 'reviews_first') {
    return [...reviewCards, ...newCardList]
  }
  if (order === 'new_first') {
    return [...newCardList, ...reviewCards]
  }
  // mixed: interleave
  const mixed: Card[] = []
  const maxLen = Math.max(reviewCards.length, newCardList.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < newCardList.length) mixed.push(newCardList[i]!)
    if (i < reviewCards.length) mixed.push(reviewCards[i]!)
  }
  return mixed
}

// ===================== Review grading (LRN-01/04) ===========================

/**
 * Grade a card: run SM-2 `schedule()`, write review_log (with prev/next
 * snapshot), update the card's scheduling state. All in one transaction.
 */
export function reviewCard(input: ReviewInput): ReviewResult {
  const db = getDb()
  const card = getCard(input.card_id)
  if (!card) throw new AppError('NOT_FOUND', `card ${input.card_id} not found`)

  const prev: SchedState = {
    ease_factor: card.ease_factor,
    interval_days: card.interval_days,
    repetitions: card.repetitions,
  }

  const result = schedule(prev, input.grade_label)
  const now = Date.now()
  const logId = randomUUID()
  const lapsed = input.grade_label === 'again' ? 1 : 0

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO review_log (id, card_id, grade, grade_label,
          prev_ease_factor, prev_interval_days, prev_repetitions,
          next_ease_factor, next_interval_days, next_repetitions, next_due_at,
          elapsed_ms, reviewed_at)
       VALUES (@id, @card_id, @grade, @grade_label,
          @prev_ef, @prev_ivl, @prev_n,
          @next_ef, @next_ivl, @next_n, @next_due,
          @elapsed_ms, @reviewed_at)`,
    ).run({
      id: logId,
      card_id: card.id,
      grade: GRADE_MAP[input.grade_label],
      grade_label: input.grade_label,
      prev_ef: prev.ease_factor,
      prev_ivl: prev.interval_days,
      prev_n: prev.repetitions,
      next_ef: result.ease_factor,
      next_ivl: result.next_interval_days,
      next_n: result.repetitions,
      next_due: result.next_due_at,
      elapsed_ms: input.elapsed_ms ?? null,
      reviewed_at: now,
    })

    db.prepare(
      `UPDATE cards SET ease_factor = ?, interval_days = ?, repetitions = ?, due_at = ?,
          reviewed_count = reviewed_count + 1, lapsed_count = lapsed_count + ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      result.ease_factor,
      result.interval_days,
      result.repetitions,
      result.next_due_at,
      lapsed,
      now,
      card.id,
    )
  })
  tx()

  const updated = getCard(card.id)!
  return { card: updated, log: { id: logId } }
}

/**
 * Undo the most recent review on a card: restore prev_* scheduling state
 * from the latest review_log row, then delete that log row.
 */
export function undoReview(cardId: string): Card {
  const db = getDb()
  const card = getCard(cardId)
  if (!card) throw new AppError('NOT_FOUND', `card ${cardId} not found`)

  const tx = db.transaction(() => {
    const lastLog = db
      .prepare(
        `SELECT * FROM review_log WHERE card_id = ? ORDER BY reviewed_at DESC LIMIT 1`,
      )
      .get(cardId) as
      | {
          id: string
          prev_ease_factor: number
          prev_interval_days: number
          prev_repetitions: number
        }
      | undefined

    if (!lastLog) {
      throw new AppError('NOT_FOUND', `no review history for card ${cardId}`)
    }

    db.prepare(
      `UPDATE cards SET ease_factor = ?, interval_days = ?, repetitions = ?,
          reviewed_count = MAX(reviewed_count - 1, 0),
          lapsed_count = MAX(lapsed_count - CASE WHEN ? = 1 THEN 1 ELSE 0 END, 0),
          updated_at = ?
       WHERE id = ?`,
    ).run(
      lastLog.prev_ease_factor,
      lastLog.prev_interval_days,
      lastLog.prev_repetitions,
      0, // we don't track per-log lapse in the row; approximate by not decrementing
      Date.now(),
      cardId,
    )

    // Recompute due_at from prev state
    const prevDue = lastLog.prev_interval_days === 0
      ? (db.prepare('SELECT created_at FROM cards WHERE id = ?').get(cardId) as { created_at: number }).created_at
      : Date.now() - DAY_MS // approximate; the true prev due_at was overwritten
    db.prepare('UPDATE cards SET due_at = ? WHERE id = ?').run(prevDue, cardId)

    db.prepare('DELETE FROM review_log WHERE id = ?').run(lastLog.id)
  })
  tx()

  return getCard(cardId)!
}

// ===================== Quiz (LRN-05) ========================================

/**
 * Generate a quiz session. Rule-based generation from paragraphs:
 *  - judge: take a paragraph's text, optionally negate it
 *  - choice: take a paragraph as stem, use active modern analysis as correct answer
 *  - match: (simplified) pair paragraph text with active modern analysis
 *
 * Falls back gracefully if paragraphs are insufficient.
 */
export function generateQuiz(input: QuizGenInput): { session_id: string; questions: QuizQuestion[] } {
  const db = getDb()
  const sessionId = randomUUID()
  const now = Date.now()
  const questions: QuizQuestion[] = []

  // Fetch candidate paragraphs from scope
  let scopeWhere = 'p.deleted_at IS NULL AND p.is_noise = 0'
  const scopeParams: unknown[] = []
  if (input.chapter_id) {
    scopeWhere += ' AND p.chapter_id = ?'
    scopeParams.push(input.chapter_id)
  } else if (input.book_id) {
    scopeWhere += ' AND p.chapter_id IN (SELECT id FROM chapters WHERE book_id = ? AND deleted_at IS NULL)'
    scopeParams.push(input.book_id)
  }

  const activeAnalysis = activeAnalysisSql()
  const paragraphRows = db
    .prepare(
      `SELECT p.id,
         p.chapter_id,
         (SELECT book_id FROM chapters WHERE id = p.chapter_id) AS book_id,
         p.text,
         ${activeAnalysis.columns}
       FROM paragraphs p
       ${activeAnalysis.join}
       WHERE ${scopeWhere}
       ORDER BY RANDOM()
       LIMIT ?`,
    )
    .all(...scopeParams, input.count * 3) as ({
      id: string
      chapter_id: string
      book_id: string
      text: string
    } & ParagraphAnalysisSqlRow)[]
  const paragraphs: QuizParagraphCandidate[] = paragraphRows.map((row) => ({
    id: row.id,
    chapter_id: row.chapter_id,
    book_id: row.book_id,
    text: row.text,
    interpretation: mapParagraphAnalysisView(row),
  }))

  const insertQ = db.prepare(
    `INSERT INTO quiz_questions (id, book_id, chapter_id, paragraph_id, source, qtype,
        stem, payload, answer, explanation, difficulty, created_at)
     VALUES (@id, @book_id, @chapter_id, @paragraph_id, 'generated', @qtype,
        @stem, @payload, @answer, @explanation, 0.5, @created_at)`,
  )

  const tx = db.transaction(() => {
    let qIdx = 0
    for (const para of paragraphs) {
      if (questions.length >= input.count) break
      const qtype = input.qtypes[qIdx % input.qtypes.length] ?? 'judge'
      qIdx++
      const qid = randomUUID()

      let stem: string
      let payload: string
      let answer: string
      let explanation: string | null

      if (qtype === 'judge') {
        const isTrue = Math.random() > 0.5
        const statement = para.text.slice(0, 120)
        stem = isTrue ? statement : `${statement}（此说有误）`
        payload = JSON.stringify({ statement })
        answer = JSON.stringify({ is_true: isTrue })
        explanation = para.interpretation.modern?.slice(0, 200) ?? null
      } else if (qtype === 'choice') {
        stem = `以下哪项是对原文的最佳解读？\n「${para.text.slice(0, 80)}」`
        const correct = para.interpretation.modern?.slice(0, 50) ?? '（无解读）'
        const distractors = paragraphs
          .filter((p) => p.id !== para.id && p.interpretation.modern)
          .slice(0, 3)
          .map((p) => p.interpretation.modern!.slice(0, 50))
        const options = [
          { key: 'A', text: correct },
          ...distractors.map((d, i) => ({ key: String.fromCharCode(66 + i), text: d })),
        ]
        // shuffle options
        for (let i = options.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[options[i]!, options[j]!] = [options[j]!, options[i]!]
        }
        const correctKey = options.find((o) => o.text === correct)?.key ?? 'A'
        payload = JSON.stringify({ options })
        answer = JSON.stringify({ correct_key: correctKey })
        explanation = para.interpretation.modern ?? null
      } else {
        // match: simplified — pair text with modern
        stem = `将原文与解读配对`
        const pair = {
          left: para.text.slice(0, 40),
          right: para.interpretation.modern?.slice(0, 40) ?? '（无解读）',
        }
        payload = JSON.stringify({ pairs: [pair], shuffled: true })
        answer = JSON.stringify({ mapping: { [pair.left]: pair.right } })
        explanation = para.interpretation.modern ?? null
      }

      insertQ.run({
        id: qid,
        book_id: para.book_id,
        chapter_id: para.chapter_id,
        paragraph_id: para.id,
        qtype,
        stem,
        payload,
        answer,
        explanation,
        created_at: now,
      })

      questions.push({
        id: qid,
        book_id: para.book_id,
        chapter_id: para.chapter_id,
        paragraph_id: para.id,
        source: 'generated',
        qtype: qtype as QuizType,
        stem,
        payload,
        answer,
        explanation,
        difficulty: 0.5,
        created_at: now,
      })
    }
  })
  tx()

  return { session_id: sessionId, questions }
}

/** Submit a quiz answer, judge it, and persist the result. */
export function submitQuizAnswer(input: QuizAnswerInput): QuizAnswerResult {
  const db = getDb()
  const q = db
    .prepare('SELECT * FROM quiz_questions WHERE id = ?')
    .get(input.quiz_question_id) as
    | { answer: string; explanation: string | null }
    | undefined
  if (!q) throw new AppError('NOT_FOUND', `quiz question ${input.quiz_question_id} not found`)

  const correctAnswer = JSON.parse(q.answer) as Record<string, unknown>
  const userAnswer = JSON.parse(input.user_answer) as Record<string, unknown>
  let isCorrect = false

  if ('correct_key' in correctAnswer) {
    isCorrect = userAnswer['correct_key'] === correctAnswer['correct_key']
  } else if ('is_true' in correctAnswer) {
    isCorrect = userAnswer['is_true'] === correctAnswer['is_true']
  } else if ('mapping' in correctAnswer) {
    const correctMap = correctAnswer['mapping'] as Record<string, string>
    const userMap = (userAnswer['mapping'] as Record<string, string>) ?? {}
    isCorrect =
      Object.keys(correctMap).every((k) => userMap[k] === correctMap[k]) &&
      Object.keys(userMap).length === Object.keys(correctMap).length
  }

  const resultId = randomUUID()
  db.prepare(
    `INSERT INTO quiz_results (id, quiz_question_id, session_id, user_answer, is_correct,
        time_spent_ms, turned_to_card, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    resultId,
    input.quiz_question_id,
    input.session_id,
    input.user_answer,
    isCorrect ? 1 : 0,
    input.time_spent_ms ?? null,
    Date.now(),
  )

  return { is_correct: isCorrect, answer: q.answer, explanation: q.explanation }
}

/** Finish a quiz session: aggregate score and list wrong questions. */
export function finishQuizSession(sessionId: string): SessionSummary {
  const db = getDb()
  const results = db
    .prepare(
      `SELECT r.id AS result_id, r.quiz_question_id, r.user_answer, r.is_correct,
          q.stem, q.answer AS correct_answer, q.explanation, q.qtype
       FROM quiz_results r
       JOIN quiz_questions q ON q.id = r.quiz_question_id
       WHERE r.session_id = ?
       ORDER BY r.answered_at`,
    )
    .all(sessionId) as {
      result_id: string
      quiz_question_id: string
      user_answer: string
      is_correct: number
      stem: string
      correct_answer: string
      explanation: string | null
      qtype: QuizType
    }[]

  const correct = results.filter((r) => r.is_correct === 1).length
  const wrongQuestions = results
    .filter((r) => r.is_correct === 0)
    .map((r) => ({
      result_id: r.result_id,
      question_id: r.quiz_question_id,
      stem: r.stem,
      user_answer: r.user_answer,
      correct_answer: r.correct_answer,
      explanation: r.explanation,
      qtype: r.qtype,
    }))

  return { total: results.length, correct, wrongQuestions }
}

/** Turn a quiz error into a card. Idempotent: returns existing card if already turned. */
export function turnErrorToCard(resultId: string): Card {
  const db = getDb()
  const result = db
    .prepare(
      `SELECT r.id, r.turned_to_card, r.quiz_question_id,
          q.stem, q.answer, q.explanation, q.qtype, q.chapter_id, q.paragraph_id,
          (SELECT book_id FROM chapters WHERE id = q.chapter_id) AS book_id
       FROM quiz_results r
       JOIN quiz_questions q ON q.id = r.quiz_question_id
       WHERE r.id = ?`,
    )
    .get(resultId) as {
      id: string
      turned_to_card: number
      quiz_question_id: string
      stem: string
      answer: string
      explanation: string | null
      qtype: QuizType
      chapter_id: string | null
      paragraph_id: string | null
      book_id: string | null
    } | undefined

  if (!result) throw new AppError('NOT_FOUND', `quiz result ${resultId} not found`)

  // Idempotent: already turned → find and return existing card
  if (result.turned_to_card === 1) {
    const existing = db
      .prepare(
        `SELECT ${CARD_COLS} FROM cards WHERE source_ref = ? AND source = 'quiz_error' AND deleted_at IS NULL LIMIT 1`,
      )
      .get(resultId) as Record<string, unknown> | undefined
    if (existing) return rowToCard(existing)
  }

  const typeMap: Record<QuizType, CardType> = {
    choice: 'term_to_meaning',
    judge: 'term_to_meaning',
    match: 'title_to_points',
  }

  const card = createCard({
    front: result.stem,
    back: `${result.answer}${result.explanation ? '\n\n' + result.explanation : ''}`,
    type: typeMap[result.qtype],
    deck: 'quiz-errors',
    source: 'quiz_error',
    source_ref: resultId,
    chapter_id: result.chapter_id,
    paragraph_id: result.paragraph_id,
    book_id: result.book_id,
  })

  db.prepare('UPDATE quiz_results SET turned_to_card = 1 WHERE id = ?').run(resultId)

  return card
}

// ===================== Dashboard (LRN-06) ===================================

/** Compute local-day streak: consecutive days with at least one review, from today backwards. */
function computeStreak(dayCounts: Map<string, number>): number {
  const today = new Date()
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  let streak = 0
  const cursor = new Date(today)
  // If today has no reviews yet, allow starting from yesterday (grace)
  if (!dayCounts.has(fmt(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while (dayCounts.get(fmt(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** Get the learning dashboard aggregate. */
export function getDashboard(rangeDays = 365): DashboardDTO {
  const db = getDb()
  const now = Date.now()
  const rangeStart = now - rangeDays * DAY_MS

  // Total / mastered counts
  const mastery = db
    .prepare(
      `SELECT COUNT(*) AS total,
          SUM(CASE WHEN repetitions >= ? AND interval_days >= ? AND ease_factor >= ? THEN 1 ELSE 0 END) AS mastered
       FROM cards WHERE status = 'active' AND deleted_at IS NULL`,
    )
    .get(MASTERY_REPS, MASTERY_INTERVAL, MASTERY_EF) as { total: number; mastered: number | null }

  const totalCards = mastery.total ?? 0
  const mastered = mastery.mastered ?? 0

  // Due today count
  const due = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM cards
       WHERE status = 'active' AND deleted_at IS NULL AND due_at <= ?`,
    )
    .get(now) as { cnt: number }

  // Heatmap: daily review counts (localtime aggregation for timezone-correct streaks)
  const heatmapRows = db
    .prepare(
      `SELECT date(reviewed_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS cnt
       FROM review_log
       WHERE reviewed_at >= ? AND reviewed_at < ?
       GROUP BY day`,
    )
    .all(rangeStart, now) as { day: string; cnt: number }[]

  const heatmap: Record<string, number> = {}
  const dayCounts = new Map<string, number>()
  for (const r of heatmapRows) {
    heatmap[r.day] = r.cnt
    dayCounts.set(r.day, r.cnt)
  }

  const streak = computeStreak(dayCounts)

  // Weak chapters: highest lapse rate
  const weakRows = db
    .prepare(
      `SELECT c.chapter_id,
          ch.title,
          COUNT(*) AS card_count,
          SUM(c.lapsed_count) AS total_lapse,
          AVG(c.lapsed_count * 1.0 / MAX(c.reviewed_count, 1)) AS lapse_rate
       FROM cards c
       LEFT JOIN chapters ch ON ch.id = c.chapter_id
       WHERE c.status = 'active' AND c.deleted_at IS NULL AND c.chapter_id IS NOT NULL
       GROUP BY c.chapter_id
       HAVING card_count >= 3
       ORDER BY lapse_rate DESC, total_lapse DESC
       LIMIT 5`,
    )
    .all() as {
      chapter_id: string
      title: string | null
      card_count: number
      total_lapse: number
      lapse_rate: number | null
    }[]

  const weakChapters = weakRows.map((r) => ({
    chapter_id: r.chapter_id,
    title: r.title ?? '(unknown)',
    card_count: r.card_count,
    lapse_rate: r.lapse_rate ?? 0,
  }))

  // Recent 7 days trend
  const sevenDaysAgo = now - 7 * DAY_MS
  const recentRows = db
    .prepare(
      `SELECT date(reviewed_at / 1000, 'unixepoch', 'localtime') AS day,
          COUNT(*) AS reviewed,
          SUM(CASE WHEN grade_label = 'again' THEN 1 ELSE 0 END) AS again
       FROM review_log
       WHERE reviewed_at >= ?
       GROUP BY day
       ORDER BY day`,
    )
    .all(sevenDaysAgo) as { day: string; reviewed: number; again: number }[]

  const recent7 = recentRows.map((r) => ({
    day: r.day,
    reviewed: r.reviewed,
    again: r.again ?? 0,
  }))

  return {
    totalCards,
    dueToday: due.cnt ?? 0,
    mastered,
    masteryRate: totalCards > 0 ? mastered / totalCards : 0,
    streak,
    heatmap,
    weakChapters,
    recent7,
  }
}

/** Get heatmap for a specific year (for the full-year GitHub-style grid). */
export function getHeatmap(year: number): Record<string, number> {
  const db = getDb()
  const yearStart = new Date(year, 0, 1).getTime()
  const yearEnd = new Date(year + 1, 0, 1).getTime()

  const rows = db
    .prepare(
      `SELECT date(reviewed_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS cnt
       FROM review_log
       WHERE reviewed_at >= ? AND reviewed_at < ?
       GROUP BY day`,
    )
    .all(yearStart, yearEnd) as { day: string; cnt: number }[]

  const out: Record<string, number> = {}
  for (const r of rows) {
    out[r.day] = r.cnt
  }
  return out
}
