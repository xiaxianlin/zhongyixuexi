/**
 * AI service (v3.1 chapter-level model).
 *
 *  status() — whether a key is configured (no plaintext).
 *  generateChapterAnalysis(chapterId, opts) — D4: produce the active
 *     chapter-level analysis (解读 / 医理 / 白话[仅古籍]) via DeepSeek JSON mode,
 *     cache-aware (same prompt hash returns the cached result instantly).
 *
 * Concurrency: per-chapter generation is de-duped via an in-process inflight
 * Map so two simultaneous calls share one Promise (and one billable request).
 *
 * The plaintext API key is obtained via getActiveApiKey() (SET module), lives
 * only in local consts for the duration of a call, and is never logged or
 * returned. Key-absence throws aiError('AI_KEY_NOT_CONFIGURED').
 */
import { getDb } from '../db/connection'
import { getActiveApiKey } from './settings'
import { deepseek } from '../ai/deepseek'
import type { ProviderConfig } from '../ai/types'
import { aiError } from '../ai/errors'
import {
  buildChapterPrompt,
  type ChapterAnalysisJson,
} from '../ai/prompts'
import {
  computePromptHash,
  findCache,
  writeCache,
  invalidateCache,
} from '../ai/cache'
import {
  writeActiveChapterAnalysis,
  getActiveChapterAnalysis,
  type ActiveChapterAnalysis,
} from './chapter-analysis'
import type { AiCacheKind } from '../ai/cache'

export interface AiStatusDTO {
  configured: boolean
  provider: string | null
  model: string | null
}

const CHAPTER_CACHE_KIND: AiCacheKind = 'chapter'

// ============================================================================
// DTOs
// ============================================================================

export interface ChapterAnalysisResultDTO {
  chapterId: string
  fromCache: boolean
  analysis: ActiveChapterAnalysis
}

// ============================================================================
// Provider config
// ============================================================================

/** Load the active provider config (plaintext key, main-process only). */
export function loadConfig(): ProviderConfig {
  const cfg = getActiveApiKey()
  if (!cfg || !cfg.apiKey) {
    throw aiError('AI_KEY_NOT_CONFIGURED', '未配置 API Key，请在设置中添加')
  }
  return cfg
}

/** Whether a key is configured — never returns the plaintext. */
export function status(): AiStatusDTO {
  const cfg = getActiveApiKey()
  if (!cfg || !cfg.apiKey) return { configured: false, provider: null, model: null }
  return { configured: true, provider: cfg.provider, model: cfg.model }
}

// ============================================================================
// Concurrency de-dup
// ============================================================================

const inflight = new Map<string, Promise<unknown>>()

function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const p = run().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

// ============================================================================
// D4: chapter-level analysis generation
// ============================================================================

/** Resolve the chapter + book category needed to build the prompt. */
interface ChapterPromptContext {
  chapterId: string
  title: string
  content: string
  category: 'classic' | 'modern'
}

function loadChapterContext(chapterId: string): ChapterPromptContext {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT c.id, c.title, c.content, b.category
         FROM chapters c
         JOIN books b ON b.id = c.book_id
        WHERE c.id = ? AND c.deleted_at IS NULL`,
    )
    .get(chapterId) as
    | { id: string; title: string; content: string | null; category: string | null }
    | undefined
  if (!row) throw aiError('AI_PARSE_ERROR', `章节 ${chapterId} 不存在`)
  return {
    chapterId: row.id,
    title: row.title,
    content: row.content ?? '',
    category: row.category === 'classic' ? 'classic' : 'modern',
  }
}

/** Parse + validate the model's JSON response into the typed shape. */
function parseChapterJson(raw: string): ChapterAnalysisJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw aiError('AI_PARSE_ERROR', '模型返回的 JSON 解析失败')
  }
  const o = parsed as Partial<ChapterAnalysisJson>
  if (typeof o.analysis !== 'string' || typeof o.explanation !== 'string') {
    throw aiError('AI_PARSE_ERROR', '模型返回缺少 analysis / explanation 字段')
  }
  if (typeof o.summary !== 'string') {
    throw aiError('AI_PARSE_ERROR', '模型返回缺少 summary 字段')
  }
  return {
    version: 1,
    analysis: o.analysis,
    explanation: o.explanation,
    summary: o.summary,
    modern: typeof o.modern === 'string' ? o.modern : undefined,
  }
}

/**
 * Generate (or return cached) the active chapter-level analysis.
 *
 *  1. loadConfig → buildChapterPrompt → computePromptHash
 *  2. cache hit (same chapter + prompt hash, not invalidated) → write an active
 *     row sourced 'cache' and return immediately (no DeepSeek call).
 *  3. cache miss → deepseek.chat (JSON mode, temp 0.3) → parse → writeCache →
 *     writeActiveChapterAnalysis (sourced 'ai').
 *
 * `force: true` invalidates prior cache entries first so a re-generate always
 * calls the model.
 */
export function generateChapterAnalysis(
  chapterId: string,
  opts: { force?: boolean } = {},
): Promise<ChapterAnalysisResultDTO> {
  const cacheKey = `chapter:${chapterId}`
  return dedupe(cacheKey, () => generateChapterAnalysisImpl(chapterId, opts))
}

async function generateChapterAnalysisImpl(
  chapterId: string,
  opts: { force?: boolean },
): Promise<ChapterAnalysisResultDTO> {
  const cfg = loadConfig()
  const ctx = loadChapterContext(chapterId)
  if (!ctx.content.trim()) {
    throw aiError('AI_PARSE_ERROR', '章节正文为空，无法分析')
  }

  const { messages, temperature, response_format } = buildChapterPrompt({
    title: ctx.title,
    content: ctx.content,
    category: ctx.category,
  })
  const promptHash = computePromptHash(messages, cfg.model, temperature)

  if (opts.force) {
    invalidateCache(chapterId, CHAPTER_CACHE_KIND)
  }

  // cache hit?
  const hit = findCache(chapterId, CHAPTER_CACHE_KIND, promptHash)
  if (hit) {
    const parsed = parseChapterJson(hit.response)
    writeActiveChapterAnalysis({
      chapterId,
      content: parsed,
      summary: parsed.summary,
      model: hit.model,
      promptHash,
      cacheId: hit.id,
      source: 'cache',
      meta: { promptTokens: hit.promptTokens, completionTokens: hit.completionTokens, totalTokens: hit.totalTokens },
    })
    return {
      chapterId,
      fromCache: true,
      analysis: getActiveChapterAnalysis(chapterId),
    }
  }

  // cache miss → call the model
  const resp = await deepseek.chat(
    {
      model: cfg.model,
      messages,
      temperature,
      max_tokens: 4096,
      response_format,
      stream: false,
    },
    cfg,
  )
  const raw = resp.choices[0]?.message?.content ?? ''
  const parsed = parseChapterJson(raw)

  const cacheId = writeCache({
    scope: 'chapter',
    scopeId: chapterId,
    kind: CHAPTER_CACHE_KIND,
    promptHash,
    response: raw,
    model: cfg.model,
    promptTokens: resp.usage?.prompt_tokens ?? 0,
    completionTokens: resp.usage?.completion_tokens ?? 0,
    totalTokens: resp.usage?.total_tokens ?? 0,
  })

  writeActiveChapterAnalysis({
    chapterId,
    content: parsed,
    summary: parsed.summary,
    model: cfg.model,
    promptHash,
    cacheId,
    source: 'ai',
    meta: {
      promptTokens: resp.usage?.prompt_tokens ?? 0,
      completionTokens: resp.usage?.completion_tokens ?? 0,
      totalTokens: resp.usage?.total_tokens ?? 0,
    },
  })

  return {
    chapterId,
    fromCache: false,
    analysis: getActiveChapterAnalysis(chapterId),
  }
}
