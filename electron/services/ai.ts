/**
 * AI service. Business orchestration:
 *
 *  generateModern(paragraphId) — AI-01: per-paragraph modern interpretation.
 *     cache → DeepSeek (JSON mode, temp 0.3) → validate → write
 *     paragraph_analyses active version + ai_cache.
 *     Returns DTO.
 *  status() — whether a key is configured (no plaintext).
 *
 * Concurrency: same scope_id+kind generation is de-duped via an in-process
 * inflight Map so two simultaneous calls share one Promise (and one billable
 * request), per 07-ai.md §8.3.
 *
 * The plaintext API key is obtained via getActiveApiKey() (SET module), lives
 * only in the local `cfg` const for the duration of one call, and is never
 * logged or returned. Key-absence throws aiError('AI_KEY_NOT_CONFIGURED').
 */
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import { getActiveApiKey } from './settings'
import { deepseek } from '../ai/deepseek'
import type { ProviderConfig } from '../ai/types'
import {
  buildModernPrompt,
  type ModernJson,
  type ModernSentence,
} from '../ai/prompts'
import {
  computePromptHash,
  findCache,
  writeCache,
  invalidateCache,
  type AiCacheKind as StoredAiCacheKind,
} from '../ai/cache'
import { aiError } from '../ai/errors'
import {
  DEFAULT_PARAGRAPH_ANALYSIS_KIND,
  buildParagraphAnalysisInput,
  ensureActiveParagraphAnalysis,
  type ParagraphAnalysisKind,
  type ParagraphAnalysisMeta,
  type ParagraphInterpretationView,
  writeActiveParagraphAnalysis,
} from './paragraph-analysis'

const MODERN_CACHE_KIND: Extract<StoredAiCacheKind, ParagraphAnalysisKind> =
  DEFAULT_PARAGRAPH_ANALYSIS_KIND

// ============================================================================
// DTOs (self-contained; renderer mirrors in src/modules/ai/types.ts)
// ============================================================================

export interface ModernResultDTO {
  paragraphId: string
  fromCache: boolean
  analysisMeta: ParagraphAnalysisMeta | null
  interpretation: ParagraphInterpretationView
  sentences: ModernSentence[]
  analysis: string
  summary: string
  model: string
  tokens: number
}

export interface AiStatusDTO {
  configured: boolean
  provider: string | null
  model: string | null
}

// ============================================================================
// Provider config
// ============================================================================

/**
 * Load the active provider config (plaintext key, main-process only).
 * Throws AI_KEY_NOT_CONFIGURED when no key is set so the renderer can degrade.
 */
function loadConfig(): ProviderConfig {
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
// Concurrency de-dup (07-ai.md §8.3)
// ============================================================================

const inflight = new Map<string, Promise<unknown>>()

function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const p = run().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p as Promise<T>
}

// ============================================================================
// Paragraph fetch helper
// ============================================================================

interface ParagraphRow {
  id: string
  text: string
}

function getParagraph(paragraphId: string): ParagraphRow {
  const db = getDb()
  const row = db
    .prepare('SELECT id, text FROM paragraphs WHERE id = ? AND deleted_at IS NULL')
    .get(paragraphId) as ParagraphRow | undefined
  if (!row) throw new AppError('NOT_FOUND', `段落 ${paragraphId} 不存在`)
  if (!row.text || !row.text.trim()) {
    throw new AppError('VALIDATION', '段落内容为空，无法生成解读')
  }
  return row
}

// ============================================================================
// JSON parsing + validation
// ============================================================================

/** Parse the model's JSON-mode output, tolerating a leading/trailing code fence. */
function parseJsonLoose<T>(raw: string): T {
  let s = (raw ?? '').trim()
  // Strip ```json ... ``` fences if the model added them despite JSON mode.
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  }
  try {
    return JSON.parse(s) as T
  } catch (e) {
    throw aiError('AI_PARSE_ERROR', `模型输出 JSON 解析失败：${(e as Error).message}`, {
      head: s.slice(0, 120),
    })
  }
}

/**
 * Validate the modern-interpretation JSON. sentences must be a non-empty array
 * with the required string fields. We do NOT strictly enforce sentence-count
 * parity with the source (07-ai.md §6.2.2 allows ±1 tolerance) because model
 * sentence-splitting of classical text is inherently fuzzy.
 */
function validateModernJson(obj: ModernJson): ModernJson {
  if (!obj || typeof obj !== 'object') {
    throw aiError('AI_PARSE_ERROR', '模型输出不是有效 JSON 对象')
  }
  if (!Array.isArray(obj.sentences) || obj.sentences.length === 0) {
    throw aiError('AI_PARSE_ERROR', '模型输出缺少 sentences 数组')
  }
  for (const s of obj.sentences) {
    if (typeof s.original !== 'string' || typeof s.modern !== 'string' || typeof s.commentary !== 'string') {
      throw aiError('AI_PARSE_ERROR', 'sentences 项缺少 original/modern/commentary 字段')
    }
  }
  if (typeof obj.summary !== 'string') obj.summary = ''
  if (typeof obj.analysis !== 'string') obj.analysis = obj.summary
  obj.summary = compactAiText(obj.summary)
  obj.analysis = compactAiText(obj.analysis)
  obj.sentences = obj.sentences.map((sentence) => ({
    original: stripLeadingNumber(compactAiText(sentence.original)),
    modern: stripLeadingNumber(compactAiText(sentence.modern)),
    commentary: stripLeadingNumber(compactAiText(sentence.commentary)),
  }))
  return obj
}

function compactAiText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function stripLeadingNumber(text: string): string {
  return text.replace(/^\s*(?:\d+[.、)]|[（(]\d+[）)]|[一二三四五六七八九十]+[、.])\s*/u, '')
}

// ============================================================================
// S5.3 — AI-01 modern interpretation
// ============================================================================

/**
 * Generate (or return cached) modern-language interpretation for a paragraph.
 *
 * Flow: cache lookup by prompt_hash → on miss, call DeepSeek (JSON mode,
 * temp 0.3) → validate → write active paragraph_analyses version,
 * and ai_cache in one transaction → return DTO.
 */
export function generateModern(paragraphId: string, opts: { force?: boolean } = {}): Promise<ModernResultDTO> {
  const cacheKey = `modern:${paragraphId}`
  return dedupe(cacheKey, () => generateModernImpl(paragraphId, opts))
}

function generateModernImpl(
  paragraphId: string,
  opts: { force?: boolean } = {},
): Promise<ModernResultDTO> {
  const para = getParagraph(paragraphId)
  const cfg = loadConfig()
  const built = buildModernPrompt({ text: para.text })
  const promptHash = computePromptHash(built.messages, cfg.model, built.temperature)

  // 1. cache hit?
  if (opts.force) {
    invalidateCache(paragraphId, MODERN_CACHE_KIND)
  }
  const hit = opts.force ? null : findCache(paragraphId, MODERN_CACHE_KIND, promptHash)
  console.info(
    `[ai] generateModern paragraph=${paragraphId} force=${opts.force ? 'true' : 'false'} cache=${hit ? 'hit' : 'miss'}`,
  )
  if (hit) {
    const parsed = validateModernJson(parseJsonLoose<ModernJson>(hit.response))
    const interpretation = modernJsonToInterpretation(parsed, null)
    const analysisMeta = getDb().transaction(() => {
      const analysisInput = buildParagraphAnalysisInput({
        paragraphId,
        content: interpretation,
        summary: parsed.summary,
        model: hit.model,
        promptHash,
        cacheId: hit.id,
        source: 'cache',
        meta: { fromCache: true, sentenceCount: parsed.sentences.length },
      })
      return ensureActiveParagraphAnalysis(analysisInput)
    })()
    return Promise.resolve(
      toModernDTO(paragraphId, parsed, hit.model, hit.totalTokens, true, analysisMeta),
    )
  }

  // 2. miss → call DeepSeek
  return (async () => {
    // Retry-once on parse failure with a lower temperature (07-ai.md §6.2.2).
    let parsed: ModernJson | undefined
    let lastResp
    let temperature = built.temperature
    for (let attempt = 0; attempt < 2; attempt++) {
      console.info(
        `[ai] DeepSeek request paragraph=${paragraphId} force=${opts.force ? 'true' : 'false'} attempt=${attempt + 1}`,
      )
      lastResp = await deepseek.chat(
        {
          model: cfg.model,
          messages: built.messages,
          temperature,
          response_format: built.response_format,
          stream: false,
        },
        cfg,
      )
      try {
        parsed = validateModernJson(
          parseJsonLoose<ModernJson>(lastResp.choices[0]?.message?.content ?? ''),
        )
        break
      } catch (e) {
        if (attempt === 1) throw e
        temperature = 0.2 // retry cooler
      }
    }
    if (!parsed || !lastResp) {
      throw aiError('AI_PARSE_ERROR', '模型未返回有效解读')
    }

    // 3. write active analysis + ai_cache atomically.
    const interpretation = modernJsonToInterpretation(parsed, null)

    const db = getDb()
    const tx = db.transaction(() => {
      const cacheId = writeCache({
        scope: 'paragraph',
        scopeId: paragraphId,
        kind: MODERN_CACHE_KIND,
        paragraphId,
        promptHash,
        response: JSON.stringify(parsed),
        model: cfg.model,
        promptTokens: lastResp.usage?.prompt_tokens ?? 0,
        completionTokens: lastResp.usage?.completion_tokens ?? 0,
        totalTokens: lastResp.usage?.total_tokens ?? 0,
        meta: { summary: parsed.summary, sentenceCount: parsed.sentences.length },
      })
      const analysisInput = buildParagraphAnalysisInput({
        paragraphId,
        content: interpretation,
        summary: parsed.summary,
        model: cfg.model,
        promptHash,
        cacheId,
        source: 'ai',
        meta: {
          sentenceCount: parsed.sentences.length,
          totalTokens: lastResp.usage?.total_tokens ?? 0,
        },
      })
      return writeActiveParagraphAnalysis(analysisInput)
    })
    const analysisMeta = tx()

    return toModernDTO(
      paragraphId,
      parsed,
      cfg.model,
      lastResp.usage?.total_tokens ?? 0,
      false,
      analysisMeta,
    )
  })()
}

function toModernDTO(
  paragraphId: string,
  parsed: ModernJson,
  model: string,
  tokens: number,
  fromCache: boolean,
  analysisMeta: ParagraphAnalysisMeta | null,
): ModernResultDTO {
  const interpretation = modernJsonToInterpretation(parsed, analysisMeta)
  return {
    paragraphId,
    fromCache,
    analysisMeta,
    interpretation,
    sentences: parsed.sentences.map((s) => ({
      original: s.original,
      modern: s.modern,
      commentary: s.commentary,
    })),
    analysis: parsed.analysis || parsed.summary,
    summary: parsed.summary,
    model,
    tokens,
  }
}

export function modernJsonToInterpretation(
  parsed: ModernJson,
  analysisMeta: ParagraphAnalysisMeta | null,
): ParagraphInterpretationView {
  return {
    modern: parsed.sentences.map((s) => s.modern).join('\n'),
    explanation: parsed.sentences.map((s, i) => `${i + 1}. ${s.commentary}`).join('\n'),
    analysis: parsed.analysis || parsed.summary,
    meta: analysisMeta,
  }
}
