/**
 * AI service (S5.3/S5.4/S5.5/S5.6 / 07-ai.md §6). Business orchestration:
 *
 *  generateModern(paragraphId) — AI-01: per-paragraph modern interpretation.
 *     cache → DeepSeek (JSON mode, temp 0.3) → validate → write
 *     paragraph_analyses active version + ai_cache.
 *     Returns DTO.
 *  ask(query, opts) — AI-02: RAG Q&A. guard pre-check → FTS5 top-k → prompt →
 *     DeepSeek (temp 0.5) → parse trailing cites JSON → guard post-sanitize →
 *     cache. Returns answer + cites with paragraphId (jumpable).
 *  invalidate(scopeId, kind) — manual regenerate entry point.
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
import { searchParagraphs, type SearchHit } from './search'
import { deepseek } from '../ai/deepseek'
import type { ProviderConfig } from '../ai/types'
import {
  buildModernPrompt,
  buildQaPrompt,
  buildParseChapterPrompt,
  buildParseBookPrompt,
  type ModernJson,
  type ModernSentence,
  type QaContext,
  type QaTrailingJson,
  type ParseChapterJson,
  type ParseBookJson,
} from '../ai/prompts'
import { shouldBlock, sanitizeOutput } from '../ai/guard'
import { hitsToContext } from '../ai/rag'
import {
  computePromptHash,
  findCache,
  writeCache,
  invalidateCache,
  type AiCacheKind as StoredAiCacheKind,
} from '../ai/cache'
import { aiError } from '../ai/errors'
import { createHash } from 'node:crypto'
import {
  DEFAULT_PARAGRAPH_ANALYSIS_KIND,
  buildParagraphAnalysisInput,
  ensureActiveParagraphAnalysis,
  type ParagraphAnalysisKind,
  type ParagraphAnalysisMeta,
  type ParagraphInterpretationView,
  writeActiveParagraphAnalysis,
} from './paragraph-analysis'

/**
 * Extended cache-kind union — adds 'parse' for AI-driven chapter parsing.
 * The DB column is TEXT so 'parse' is accepted at runtime; we widen the type
 * locally so the existing findCache/writeCache calls type-check.
 */
type AiCacheKind = 'modern' | 'qa' | 'annotation' | 'parse'
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

export interface QaCiteDTO {
  n: number
  paragraphId: string
  snippet: string
}

export interface QaAnswerDTO {
  answer: string
  cites: QaCiteDTO[]
  fromCache: boolean
  model: string
  tokens: number
  /** true when the post-guard scrubbed dosage expressions from the answer. */
  scrubbed: boolean
}

export interface AiStatusDTO {
  configured: boolean
  provider: string | null
  model: string | null
}

export interface AiProgressPayload {
  jobId: string
  phase: string
  current: number
  total: number
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
  chapter_id: string
  text: string
}

function getParagraph(paragraphId: string): ParagraphRow {
  const db = getDb()
  const row = db
    .prepare('SELECT id, chapter_id, text FROM paragraphs WHERE id = ? AND deleted_at IS NULL')
    .get(paragraphId) as ParagraphRow | undefined
  if (!row) throw new AppError('NOT_FOUND', `段落 ${paragraphId} 不存在`)
  if (!row.text || !row.text.trim()) {
    throw new AppError('VALIDATION', '段落内容为空，无法生成解读')
  }
  return row
}

function listChapterParagraphIds(chapterId: string): string[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id FROM paragraphs
       WHERE chapter_id = ? AND deleted_at IS NULL AND is_noise = 0
       ORDER BY order_index`,
    )
    .all(chapterId) as { id: string }[]
  return rows.map((r) => r.id)
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

// ============================================================================
// S5.3 batch — AI-01 whole-chapter modern interpretation (long task)
// ============================================================================

/**
 * Generate modern interpretation for every non-noise paragraph in a chapter,
 * emitting progress after each paragraph. Each paragraph is generated via
 * generateModern() so the cache short-circuits already-interpreted ones
 * (re-running on an already-done chapter is near-instant and free).
 */
export async function generateModernBatch(
  chapterId: string,
  onProgress?: (p: AiProgressPayload) => void,
): Promise<{ done: number; total: number; errors: string[] }> {
  const ids = listChapterParagraphIds(chapterId)
  if (ids.length === 0) {
    throw new AppError('NOT_FOUND', `章节 ${chapterId} 无可用段落`)
  }
  const jobId = `modern-batch-${chapterId}-${Date.now()}`
  const errors: string[] = []
  let done = 0
  for (const paragraphId of ids) {
    try {
      await generateModern(paragraphId)
    } catch (e) {
      // A single paragraph failure shouldn't abort the whole batch; record and
      // continue. The renderer's degraded-state handler still surfaces the error.
      errors.push(`${paragraphId}: ${(e as Error).message}`)
    }
    done++
    onProgress?.({ jobId, phase: 'modern', current: done, total: ids.length })
  }
  onProgress?.({ jobId, phase: 'done', current: done, total: ids.length })
  return { done, total: ids.length, errors }
}

// ============================================================================
// S5.4 — AI-02 RAG Q&A
// ============================================================================

const QA_MAX_QUERY = 2000

export interface AskOpts {
  bookId?: string | null
  topK?: number
}

/**
 * RAG Q&A. Flow: guard pre-check (no network on blocked) → FTS5 top-k → prompt
 * → cache lookup → DeepSeek (temp 0.5) → parse trailing cites JSON → guard
 * post-sanitize → cache. Cites carry paragraphId so the renderer can jump.
 */
export function ask(query: string, opts: AskOpts = {}): Promise<QaAnswerDTO> {
  const q = (query ?? '').trim()
  if (!q) throw new AppError('VALIDATION', '问题不能为空')
  if (q.length > QA_MAX_QUERY) {
    throw new AppError('VALIDATION', `问题过长（>${QA_MAX_QUERY} 字）`)
  }

  // Layer 2: pre-call guard — refuse diagnosis/prescription/dosage requests.
  const blocked = shouldBlock(q)
  if (blocked.blocked) {
    return Promise.resolve<QaAnswerDTO>({
      answer: blocked.refusal,
      cites: [],
      fromCache: false,
      model: 'guard',
      tokens: 0,
      scrubbed: false,
    })
  }

  const topK = Math.max(1, Math.min(opts.topK ?? 5, 10))
  return dedupe(`qa:${q}:${opts.bookId ?? ''}:${topK}`, () => askImpl(q, opts, topK))
}

async function askImpl(query: string, opts: AskOpts, topK: number): Promise<QaAnswerDTO> {
  const cfg = loadConfig()

  // 1. RAG retrieval via SRH (FTS5).
  const sr: { hits: SearchHit[] } = searchParagraphs(query, {
    limit: topK,
    ...(opts.bookId ? { bookIds: [opts.bookId] } : {}),
  })
  const contexts: QaContext[] = hitsToContext(sr.hits, topK)

  // No retrieval → still ask, but the model will likely say "无法回答".
  const built = buildQaPrompt({ query, contexts })
  const promptHash = computePromptHash(built.messages, cfg.model, built.temperature)

  // 2. cache hit?
  const scopeId = 'qa'
  const hit = findCache(scopeId, 'qa', promptHash)
  if (hit) {
    const cached = JSON.parse(hit.response) as { answer: string; cites: QaCiteDTO[]; scrubbed: boolean }
    return {
      answer: cached.answer,
      cites: cached.cites,
      fromCache: true,
      model: hit.model,
      tokens: hit.totalTokens,
      scrubbed: cached.scrubbed,
    }
  }

  // 3. call DeepSeek (non-JSON mode; natural language + trailing cites JSON).
  const resp = await deepseek.chat(
    {
      model: cfg.model,
      messages: built.messages,
      temperature: built.temperature,
      stream: false,
    },
    cfg,
  )
  const raw = resp.choices[0]?.message?.content ?? ''

  // 4. parse trailing cites JSON. Failure is non-fatal (answer still shown).
  const { answer, citesJson } = splitAnswerAndCites(raw, contexts)

  // 5. Layer 3: post-guard sanitize (scrub dosage expressions).
  const { text: cleanAnswer, scrubbed } = sanitizeOutput(answer)

  // 6. cache + return.
  const citeDtos: QaCiteDTO[] = (citesJson?.cites ?? []).map((c) => {
    const ctx = contexts.find((x) => x.n === c.n)
    return {
      n: c.n,
      paragraphId: c.paragraph_id ?? ctx?.paragraphId ?? '',
      snippet: c.snippet ?? ctx?.snippet ?? '',
    }
  })

  const payload = JSON.stringify({ answer: cleanAnswer, cites: citeDtos, scrubbed })
  writeCache({
    scope: 'global',
    scopeId,
    kind: 'qa',
    paragraphId: null,
    promptHash,
    response: payload,
    model: cfg.model,
    promptTokens: resp.usage?.prompt_tokens ?? 0,
    completionTokens: resp.usage?.completion_tokens ?? 0,
    totalTokens: resp.usage?.total_tokens ?? 0,
    meta: { query, contextCount: contexts.length },
  })

  return {
    answer: cleanAnswer,
    cites: citeDtos,
    fromCache: false,
    model: cfg.model,
    tokens: resp.usage?.total_tokens ?? 0,
    scrubbed,
  }
}

/**
 * Split the model's natural-language answer from its trailing cites JSON.
 * The prompt asks for a JSON block on the final line(s); we locate the last
 * top-level {...} in the text. If parsing fails, returns the whole text as the
 * answer with empty cites (non-fatal — 07-ai.md §6.2.3).
 *
 * Pure — exported for unit testing.
 */
export function splitAnswerAndCites(
  raw: string,
  _contexts: QaContext[],
): { answer: string; citesJson: QaTrailingJson | null } {
  const text = raw ?? ''
  // Find the LAST top-level {...} block by depth-tracking from the start.
  // (lastIndexOf('{') would land on a nested inner brace — e.g. inside a
  // snippet — and miss the outer envelope, so JSON.parse would not see cites.)
  let depth = 0
  let blockStart = -1
  let lastStart = -1
  let lastEnd = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      if (depth === 0) blockStart = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && blockStart !== -1) {
        lastStart = blockStart
        lastEnd = i
      }
    }
  }
  if (lastStart === -1) return { answer: text.trim(), citesJson: null }
  const jsonStr = text.slice(lastStart, lastEnd + 1)
  try {
    const parsed = JSON.parse(jsonStr) as QaTrailingJson
    if (parsed && Array.isArray(parsed.cites)) {
      return { answer: text.slice(0, lastStart).trim(), citesJson: parsed }
    }
  } catch {
    // fall through
  }
  return { answer: text.trim(), citesJson: null }
}

// ============================================================================
// Manual invalidation (regenerate)
// ============================================================================

export function invalidate(scopeId: string, kind: AiCacheKind): { invalidated: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { invalidated: invalidateCache(scopeId, kind as any) }
}

// ============================================================================
// IMP-AI — AI-driven chapter parsing
// ============================================================================

export interface ParseChapterResult {
  isContent: boolean
  paragraphs: string[]
}

/**
 * AI-driven chapter parsing for the IMP module.
 *
 * Given a chapter title and its plain-text body (HTML already stripped),
 * asks DeepSeek to:
 *   1. Judge whether the chapter is real book content (isContent).
 *   2. If yes, extract clean body paragraphs (no headers/footers/page-numbers/
 *      watermarks/repeated-lines/garbled/pure-punctuation/isolated-numbers).
 *
 * Requires a configured API key — throws AI_KEY_NOT_CONFIGURED if none.
 * Caches by (scope='chapter', scope_id=contentHash, kind='parse',
 * prompt_hash includes title+text). Cache hit returns instantly (no network).
 *
 * @param title chapter title from TOC/spine
 * @param text  chapter body as plain text (HTML stripped + whitespace normalized)
 * @returns     { isContent, paragraphs }
 */
export async function parseChapterByAI(title: string, text: string): Promise<ParseChapterResult> {
  const cfg = loadConfig()
  const built = buildParseChapterPrompt({ title, text })
  const promptHash = computePromptHash(built.messages, cfg.model, built.temperature)

  // Cache key: scope='chapter', scope_id = sha256(title + text) for stable identity.
  const scopeId = createHashScopeId(title, text)

  // 1. cache hit?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hit = findCache(scopeId, 'parse' as any, promptHash)
  if (hit) {
    const cached = parseJsonLoose<ParseChapterJson>(hit.response)
    return validateParseChapterJson(cached)
  }

  // 2. miss → call DeepSeek with one retry on parse failure (cooler temp).
  let parsed: ParseChapterJson | undefined
  let lastResp
  let temperature = built.temperature
  for (let attempt = 0; attempt < 2; attempt++) {
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
      parsed = validateParseChapterJson(
        parseJsonLoose<ParseChapterJson>(lastResp.choices[0]?.message?.content ?? ''),
      )
      break
    } catch (e) {
      if (attempt === 1) throw e
      temperature = 0.1 // retry even cooler for stability
    }
  }
  if (!parsed || !lastResp) {
    throw aiError('AI_PARSE_ERROR', '模型未返回有效的章节解析结果')
  }

  // 3. write cache.
  writeCache({
    scope: 'chapter',
    scopeId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kind: 'parse' as any,
    paragraphId: null,
    promptHash,
    response: JSON.stringify(parsed),
    model: cfg.model,
    promptTokens: lastResp.usage?.prompt_tokens ?? 0,
    completionTokens: lastResp.usage?.completion_tokens ?? 0,
    totalTokens: lastResp.usage?.total_tokens ?? 0,
    meta: { title, isContent: parsed.isContent, paragraphCount: parsed.paragraphs.length },
  })

  return parsed
}

/** Compute a stable scope_id from title+text for cache keying. */
function createHashScopeId(title: string, text: string): string {
  return computePromptHash(
    [{ role: 'user', content: `${title}\n\n${text}` }],
    'scope',
    0,
  )
}

/** Validate the parse-chapter JSON shape. */
function validateParseChapterJson(obj: ParseChapterJson): ParseChapterJson {
  if (!obj || typeof obj !== 'object') {
    throw aiError('AI_PARSE_ERROR', '模型输出不是有效 JSON 对象')
  }
  if (typeof obj.isContent !== 'boolean') {
    throw aiError('AI_PARSE_ERROR', '模型输出缺少 isContent 布尔字段')
  }
  if (!Array.isArray(obj.paragraphs)) {
    throw aiError('AI_PARSE_ERROR', '模型输出缺少 paragraphs 数组')
  }
  // Coerce every paragraph to a non-empty trimmed string; drop empties.
  obj.paragraphs = obj.paragraphs
    .map((p) => (typeof p === 'string' ? p.trim() : String(p ?? '').trim()))
    .filter((p) => p.length > 0)
  if (obj.isContent && obj.paragraphs.length === 0) {
    // Model said content=true but produced no paragraphs — treat as non-content
    // rather than producing an empty chapter.
    obj.isContent = false
  }
  return obj
}

// ============================================================================
// IMP-AI — whole-book AI parsing (single call)
// ============================================================================

/**
 * Max tokens for whole-book parse output. The full-book paragraphs JSON can be
 * large; keep this high because the import contract intentionally sends the
 * whole book in a single request and expects the model to return every parsed
 * paragraph.
 */
const PARSE_BOOK_MAX_TOKENS = 384_000

/**
 * AI-driven whole-book chapter parsing for the IMP module.
 *
 * Sends ALL chapters to DeepSeek in a SINGLE call (leveraging 1M-token context
 * window), so the model has full-book visibility for better isContent judgment
 * (e.g. identifying duplicate/duplicated chapters, cross-referencing structure).
 *
 * Cache: scope='book', scope_id = sha256(concatenated chapter content), kind='parse'.
 * On cache hit returns instantly (no network).
 *
 * Validation: the returned chapters array is aligned to the input length — if
 * the model returned fewer entries, the missing ones are filled with
 * isContent=false; if more, the tail is truncated. Every item's paragraphs is
 * coerced to string[].
 *
 * @param chapters  array of { title, text } for every chapter in the book
 * @returns         ParseChapterResult[] in the SAME ORDER as input chapters
 *
 * RISK: For very large books (many chapters × long text), the output JSON may
 * exceed PARSE_BOOK_MAX_TOKENS or the provider's model limit, causing
 * truncation and a JSON parse error.
 */
export async function parseBookByAI(
  chapters: { title: string; text: string }[],
  opts: { onStreamProgress?: (chars: number, chunks: number) => void } = {},
): Promise<ParseChapterResult[]> {
  const cfg = loadConfig()
  const built = buildParseBookPrompt(chapters)
  const promptHash = computePromptHash(built.messages, cfg.model, built.temperature)

  // Cache key: scope='book', scope_id = sha256 of all chapter content.
  const scopeId = createBookScopeId(chapters)

  // 1. cache hit?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hit = findCache(scopeId, 'parse' as any, promptHash)
  if (hit) {
    const cached = parseJsonLoose<ParseBookJson>(hit.response)
    return validateParseBookJson(cached, chapters.length)
  }

  // 2. miss → call DeepSeek with one retry on parse failure (cooler temp).
  let parsed: ParseBookJson | undefined
  let lastResp
  let temperature = built.temperature
  for (let attempt = 0; attempt < 2; attempt++) {
    lastResp = await deepseek.chatStream(
      {
        model: cfg.model,
        messages: built.messages,
        temperature,
        max_tokens: PARSE_BOOK_MAX_TOKENS,
        response_format: built.response_format,
        stream: true,
      },
      cfg,
      {
        onDelta: (_chunk, snapshot) => {
          opts.onStreamProgress?.(snapshot.chars, snapshot.chunks)
        },
      },
    )
    try {
      const raw = lastResp.content
      parsed = parseJsonLoose<ParseBookJson>(raw)
      // Validate immediately — may throw, triggering retry.
      validateParseBookJson(parsed, chapters.length)
      break
    } catch (e) {
      if (attempt === 1) throw e
      temperature = 0.1 // retry even cooler for stability
    }
  }
  if (!parsed || !lastResp) {
    throw aiError('AI_PARSE_ERROR', '模型未返回有效的全书解析结果')
  }

  // 3. Normalize + validate (align length to input).
  const results = validateParseBookJson(parsed, chapters.length)

  // 4. write cache.
  writeCache({
    scope: 'book',
    scopeId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kind: 'parse' as any,
    paragraphId: null,
    promptHash,
    response: JSON.stringify(parsed),
    model: cfg.model,
    promptTokens: lastResp.usage?.prompt_tokens ?? 0,
    completionTokens: lastResp.usage?.completion_tokens ?? 0,
    totalTokens: lastResp.usage?.total_tokens ?? 0,
    meta: {
      chapterCount: chapters.length,
      contentCount: results.filter((r) => r.isContent).length,
      totalParagraphs: results.reduce((sum, r) => sum + r.paragraphs.length, 0),
    },
  })

  return results
}

/** Compute a stable book-level scope_id from all chapter content for cache keying. */
function createBookScopeId(chapters: { title: string; text: string }[]): string {
  const blob = chapters.map((ch) => `${ch.title}\n\n${ch.text}`).join('\n===\n')
  return createHash('sha256').update(blob, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Validate the parse-book JSON and align the chapters array to the expected length.
 *
 * - If chapters array is shorter than expected: pad with isContent=false entries.
 * - If longer: truncate to expected length.
 * - Each item's paragraphs is coerced to string[] with trimmed non-empty strings.
 * - isContent is coerced to boolean.
 */
function validateParseBookJson(obj: ParseBookJson, expectedLength: number): ParseChapterResult[] {
  if (!obj || typeof obj !== 'object') {
    throw aiError('AI_PARSE_ERROR', '模型输出不是有效 JSON 对象')
  }
  if (!Array.isArray(obj.chapters)) {
    throw aiError('AI_PARSE_ERROR', '模型输出缺少 chapters 数组')
  }

  const arr = obj.chapters

  // Align length to expected.
  const results: ParseChapterResult[] = []
  for (let i = 0; i < expectedLength; i++) {
    const item = arr[i]
    if (!item || typeof item !== 'object') {
      // Missing or invalid → default to non-content.
      results.push({ isContent: false, paragraphs: [] })
      continue
    }

    const isContent = typeof item.isContent === 'boolean' ? item.isContent : false

    let paragraphs: string[] = []
    if (Array.isArray(item.paragraphs)) {
      paragraphs = item.paragraphs
        .map((p) => (typeof p === 'string' ? p.trim() : String(p ?? '').trim()))
        .filter((p) => p.length > 0)
    }

    // If model said content=true but produced no paragraphs, treat as non-content.
    const finalIsContent = isContent && paragraphs.length > 0

    results.push({ isContent: finalIsContent, paragraphs: finalIsContent ? paragraphs : [] })
  }

  return results
}
