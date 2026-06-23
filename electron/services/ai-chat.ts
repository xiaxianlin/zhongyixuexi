/**
 * AI chat service (v3.1 D5 — chapter-scoped Q&A).
 *
 * One thread per chapter (uq_ai_threads_chapter). sendChat streams the model's
 * reply via deepseek.chatStream, calling `onToken` for each delta; the user +
 * assistant messages are persisted on completion. The system prompt (red line +
 * chapter content) is injected at call time, never stored as a 'system' row.
 *
 * Layer-2 red-line guard (guard.shouldBlock) refuses diagnosis/prescription
 * queries without calling the model; Layer-3 (guard.sanitizeOutput) scrubs the
 * streamed output. Token budget: chapter content is truncated to keep system +
 * history + content within a sensible window.
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import { deepseek } from '../ai/deepseek'
import { buildChatPrompt } from '../ai/prompts'
import { shouldBlock, sanitizeOutput, REFUSAL_TEXT } from '../ai/guard'
import { loadConfig } from './ai'

const HISTORY_LIMIT = 8
const CHAPTER_CONTENT_BUDGET = 4000 // chars; ~2k tokens, leaves room for output

export interface AiThreadDTO {
  id: string
  book_id: string
  chapter_id: string
  title: string | null
  created_at: number
  updated_at: number
}

export interface AiMessageDTO {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  quote_text: string | null
  quote_start: number | null
  quote_end: number | null
  model: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  created_at: number
}

type AiThreadRow = AiThreadDTO
type AiMessageRow = AiMessageDTO

/** Get the chapter's thread, creating one on first use (uq per chapter). */
export function getOrCreateThreadForChapter(
  bookId: string,
  chapterId: string,
): AiThreadDTO {
  const db = getDb()
  return db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM ai_threads WHERE chapter_id = ?')
      .get(chapterId) as AiThreadRow | undefined
    if (existing) return toThreadDTO(existing)

    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      `INSERT INTO ai_threads (id, book_id, chapter_id, title, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ).run(id, bookId, chapterId, now, now)
    return {
      id,
      book_id: bookId,
      chapter_id: chapterId,
      title: null,
      created_at: now,
      updated_at: now,
    }
  })()
}

/** Load the message history for a thread (oldest first). */
export function getThreadHistory(threadId: string): AiMessageDTO[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM ai_messages WHERE thread_id = ? ORDER BY created_at ASC')
    .all(threadId) as AiMessageRow[]
  return rows.map(toMessageDTO)
}

/** Resolve the chapter title + content needed to build the chat prompt. */
interface ChapterChatContext {
  chapterId: string
  bookId: string
  title: string
  content: string
}

function loadChapterContext(chapterId: string): ChapterChatContext {
  const db = getDb()
  const row = db
    .prepare('SELECT id, book_id, title, content FROM chapters WHERE id = ? AND deleted_at IS NULL')
    .get(chapterId) as
    | { id: string; book_id: string; title: string; content: string | null }
    | undefined
  if (!row) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)
  return {
    chapterId: row.id,
    bookId: row.book_id,
    title: row.title,
    content: row.content ?? '',
  }
}

function truncateContent(content: string): string {
  if (content.length <= CHAPTER_CONTENT_BUDGET) return content
  return content.slice(0, CHAPTER_CONTENT_BUDGET) + '\n\n…（原文过长，已截断）'
}

/** Persist one message row, returning the DTO. */
function persistMessage(
  threadId: string,
  role: AiMessageDTO['role'],
  content: string,
  opts: {
    quoteText?: string | null
    quoteStart?: number | null
    quoteEnd?: number | null
    model?: string | null
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  } = {},
): AiMessageDTO {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO ai_messages
       (id, thread_id, role, content, quote_text, quote_start, quote_end,
        model, prompt_tokens, completion_tokens, total_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    threadId,
    role,
    content,
    opts.quoteText ?? null,
    opts.quoteStart ?? null,
    opts.quoteEnd ?? null,
    opts.model ?? null,
    opts.promptTokens ?? 0,
    opts.completionTokens ?? 0,
    opts.totalTokens ?? 0,
    now,
  )
  db.prepare('UPDATE ai_threads SET updated_at = ? WHERE id = ?').run(now, threadId)
  return {
    id,
    thread_id: threadId,
    role,
    content,
    quote_text: opts.quoteText ?? null,
    quote_start: opts.quoteStart ?? null,
    quote_end: opts.quoteEnd ?? null,
    model: opts.model ?? null,
    prompt_tokens: opts.promptTokens ?? 0,
    completion_tokens: opts.completionTokens ?? 0,
    total_tokens: opts.totalTokens ?? 0,
    created_at: now,
  }
}

export interface SendChatInput {
  threadId: string
  content: string
  quote?: string | null
  quoteStart?: number | null
  quoteEnd?: number | null
}

export interface SendChatResult {
  userMessage: AiMessageDTO
  assistantMessage: AiMessageDTO
}

/**
 * Send a user message + stream the assistant reply. `onToken(delta)` fires for
 * each streamed chunk; the sanitized full reply is persisted on completion.
 *
 * The red-line guard runs first: a blocked query is answered with the fixed
 * refusal text (no model call, no billing) and both messages are stored.
 */
export async function sendChat(
  input: SendChatInput,
  onToken?: (delta: string) => void,
): Promise<SendChatResult> {
  const db = getDb()
  const thread = db
    .prepare('SELECT * FROM ai_threads WHERE id = ?')
    .get(input.threadId) as AiThreadRow | undefined
  if (!thread) throw new AppError('NOT_FOUND', `会话 ${input.threadId} 不存在`)

  const ctx = loadChapterContext(thread.chapter_id)
  const userText = input.content.trim()
  if (!userText) throw new AppError('VALIDATION', '消息不能为空')

  // persist the user turn immediately
  const userMessage = persistMessage(input.threadId, 'user', userText, {
    quoteText: input.quote ?? null,
    quoteStart: input.quoteStart ?? null,
    quoteEnd: input.quoteEnd ?? null,
  })

  // Layer-2 red-line guard: refuse diagnosis/prescription without a model call.
  if (shouldBlock(userText)) {
    const refusal = persistMessage(input.threadId, 'assistant', REFUSAL_TEXT, {
      model: 'guard',
    })
    onToken?.(REFUSAL_TEXT)
    return { userMessage, assistantMessage: refusal }
  }

  // build prompt: red line + chapter content + recent history + this turn
  const history = getThreadHistory(input.threadId)
    .slice(-HISTORY_LIMIT - 1, -1) // exclude the user turn we just persisted
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content } as const))

  const { messages, temperature } = buildChatPrompt({
    chapterTitle: ctx.title,
    chapterContent: truncateContent(ctx.content),
    history,
    user: userText,
    quote: input.quote,
  })

  const cfg = loadConfig()
  const result = await deepseek.chatStream(
    {
      model: cfg.model,
      messages,
      temperature,
      stream: true,
    },
    cfg,
    {
      onDelta: (delta) => onToken?.(delta),
    },
  )

  // Layer-3 output sanitization (scrub dosage/prescription phrasing)
  const { text: sanitized, scrubbed } = sanitizeOutput(result.content)

  const assistantMessage = persistMessage(input.threadId, 'assistant', sanitized, {
    model: cfg.model,
    promptTokens: result.usage?.prompt_tokens ?? 0,
    completionTokens: result.usage?.completion_tokens ?? 0,
    totalTokens: result.usage?.total_tokens ?? 0,
  })

  // if sanitization changed the streamed text, send a corrective delta so the
  // rendered bubble matches the persisted message.
  if (scrubbed && onToken) {
    onToken('\n\n（部分内容已依合规要求隐藏）')
  }

  return { userMessage, assistantMessage }
}

/** Clear all messages in a thread (the thread itself survives). */
export function resetThread(threadId: string): { ok: true } {
  const db = getDb()
  const exists = db.prepare('SELECT 1 FROM ai_threads WHERE id = ?').get(threadId)
  if (!exists) throw new AppError('NOT_FOUND', `会话 ${threadId} 不存在`)
  db.prepare('DELETE FROM ai_messages WHERE thread_id = ?').run(threadId)
  return { ok: true }
}

function toThreadDTO(row: AiThreadRow): AiThreadDTO {
  return {
    id: row.id,
    book_id: row.book_id,
    chapter_id: row.chapter_id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function toMessageDTO(row: AiMessageRow): AiMessageDTO {
  return {
    id: row.id,
    thread_id: row.thread_id,
    role: row.role,
    content: row.content,
    quote_text: row.quote_text,
    quote_start: row.quote_start,
    quote_end: row.quote_end,
    model: row.model,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    total_tokens: row.total_tokens,
    created_at: row.created_at,
  }
}
