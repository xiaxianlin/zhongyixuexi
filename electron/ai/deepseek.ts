/**
 * DeepSeek chat client (S5.1 / 07-ai.md §6.1).
 *
 * Main-process-only HTTP client over the global `fetch` (Node 18+ undici).
 * Posts to `${baseUrl}/chat/completions` with Bearer auth. Wraps every failure
 * in an AppError carrying a fine-grained aiCode (errors.ts) so the renderer can
 * pick the right degraded-state reason. The API key plaintext lives only in
 * the in-memory ProviderConfig passed to each call — it is never logged, never
 * returned in error.details, and never crosses IPC.
 *
 * Resilience policy:
 *  - 10min per-attempt timeout via AbortController by default.
 *  - Up to 3 attempts total (1 + 2 retries) on retryable statuses / network errors.
 *  - Exponential backoff: 500ms, 1000ms (jittered ±20% to avoid thundering herd).
 *  - 401/403/402 → not retried (key/quota problem, retrying wastes budget).
 *
 * Exported as a class so tests can inject a fake fetch; production uses the
 * module-level singleton `deepseek`.
 */
import type { ChatRequest, ChatResponse, ChatStreamResult, ProviderConfig } from './types'
import { aiError, type AiSubCode } from './errors'
import { AppError } from '../lib/error'

export const DEFAULT_TIMEOUT_MS = 10 * 60_000
const MAX_RETRIES = 2 // total attempts = 1 + MAX_RETRIES = 3
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

export interface ChatOptions {
  /** Per-attempt timeout in milliseconds. Defaults to 10 minutes. */
  timeoutMs?: number
}

export interface ChatStreamOptions extends ChatOptions {
  onDelta?: (chunk: string, snapshot: { chars: number; chunks: number }) => void
}

/** Sleep helper with ±20% jitter to de-sync concurrent retries. */
function sleep(ms: number): Promise<void> {
  const jitter = ms * (0.8 + Math.random() * 0.4)
  return new Promise((r) => setTimeout(r, jitter))
}

/** Exponential backoff: 500ms, 1000ms for attempts 0, 1. */
function backoffMs(attempt: number): number {
  return 500 * Math.pow(2, attempt)
}

export interface DeepSeekClient {
  /**
   * POST /chat/completions with retry/timeout/error mapping.
   *
   * @param req   Chat request body (model/messages/temperature/...).
   * @param cfg   Provider config incl. plaintext apiKey (main-process only).
   * @returns     Parsed ChatResponse on 2xx.
   * @throws      AppError('AI', ...) with aiCode in details on any failure.
   */
  chat(req: ChatRequest, cfg: ProviderConfig, opts?: ChatOptions): Promise<ChatResponse>
  chatStream(
    req: ChatRequest,
    cfg: ProviderConfig,
    opts?: ChatStreamOptions,
  ): Promise<ChatStreamResult>
}

/** Map an HTTP status to (aiCode, message). Non-retryable by default. */
function statusToError(
  status: number,
  bodyText: string,
): { sub: AiSubCode; msg: string; retryable: boolean; hint?: string } {
  if (status === 401 || status === 403) {
    return {
      sub: 'AI_AUTH_ERROR',
      msg: `API 鉴权失败（${status}），请检查 API Key 配置`,
      retryable: false,
    }
  }
  if (status === 402) {
    return { sub: 'AI_QUOTA_EXCEEDED', msg: 'API 余额不足或配额用尽', retryable: false }
  }
  if (status === 429) {
    return { sub: 'AI_QUOTA_EXCEEDED', msg: '请求频率超限，请稍后重试', retryable: true }
  }
  if (RETRYABLE_STATUS.has(status)) {
    return { sub: 'AI_SERVER_ERROR', msg: `AI 服务暂时不可用（${status}）`, retryable: true }
  }
  // Body is included only as a length-bounded, sanitized hint for debugging.
  const hint = bodyText.slice(0, 200).replace(/\s+/g, ' ')
  return {
    sub: 'AI_REQUEST_FAILED',
    msg: `AI 请求失败（${status}）`,
    retryable: false,
    hint: hint || undefined,
  }
}

/**
 * Production client using the global fetch. A class (not bare functions) so a
 * test double can implement the same DeepSeekClient interface.
 */
export class DeepSeekHttp implements DeepSeekClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch.bind(globalThis)) {}

  async chat(
    req: ChatRequest,
    cfg: ProviderConfig,
    opts: ChatOptions = {},
  ): Promise<ChatResponse> {
    // Key sanity check — never log the key, only that one is present.
    if (!cfg.apiKey) {
      throw aiError('AI_KEY_NOT_CONFIGURED', '未配置 API Key，请在设置中添加')
    }

    const url = joinUrl(cfg.baseUrl, '/chat/completions')
    const body = JSON.stringify(req)
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    let lastErr: unknown = null
    let lastSub: AiSubCode = 'AI_UNKNOWN'

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Per-attempt timeout. A fresh controller per attempt so a retry isn't
      // already-aborted.
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeoutMs)

      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body,
          signal: ctl.signal,
        })

        if (res.ok) {
          return (await res.json()) as ChatResponse
        }

        // Non-2xx — read body for diagnostics (bounded, sanitized).
        const bodyText = await res.text().catch(() => '')
        const mapped = statusToError(res.status, bodyText)
        lastSub = mapped.sub
        lastErr = aiError(mapped.sub, mapped.msg, {
          status: res.status,
          attempt,
          ...(mapped.hint ? { bodyHint: mapped.hint } : {}),
        })

        if (!mapped.retryable || attempt === MAX_RETRIES) {
          throw lastErr
        }
        // retryable & attempts remain → backoff and continue
        await sleep(backoffMs(attempt))
        continue
      } catch (e) {
        // Already an AI AppError we chose to throw — rethrow unless retryable.
        if (e instanceof AppError) {
          // Distinguish retryable by sub-code we set above.
          const sub = (e as { details?: { aiCode?: AiSubCode } }).details?.aiCode
          if (sub && sub !== 'AI_SERVER_ERROR' && sub !== 'AI_QUOTA_EXCEEDED') {
            throw e
          }
          if (attempt === MAX_RETRIES) throw e
          lastErr = e
          lastSub = sub ?? 'AI_UNKNOWN'
          await sleep(backoffMs(attempt))
          continue
        }

        // Network error or AbortError (timeout).
        const isAbort =
          (e instanceof DOMException && e.name === 'AbortError') ||
          (e instanceof Error && e.name === 'AbortError')
        lastSub = isAbort ? 'AI_TIMEOUT' : 'AI_SERVER_ERROR'
        lastErr = aiError(
          lastSub,
          isAbort ? `AI 请求超时（${timeoutMs}ms）` : `AI 网络错误：${(e as Error).message || 'unknown'}`,
          { attempt, cause: String((e as Error).name || e) },
        )
        if (attempt === MAX_RETRIES) throw lastErr
        await sleep(backoffMs(attempt))
      } finally {
        clearTimeout(timer)
      }
    }

    // Exhausted retries.
    if (lastErr instanceof Error) {
      if (lastErr.name === 'AppError') throw lastErr
      throw aiError(lastSub === 'AI_TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNKNOWN', 'AI 调用失败', {
        cause: String(lastErr),
      })
    }
    throw aiError('AI_UNKNOWN', 'AI 调用失败（未知原因）')
  }

  async chatStream(
    req: ChatRequest,
    cfg: ProviderConfig,
    opts: ChatStreamOptions = {},
  ): Promise<ChatStreamResult> {
    if (!cfg.apiKey) {
      throw aiError('AI_KEY_NOT_CONFIGURED', '未配置 API Key，请在设置中添加')
    }

    const url = joinUrl(cfg.baseUrl, '/chat/completions')
    const body = JSON.stringify({ ...req, stream: true, stream_options: { include_usage: true } })
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const ctl = new AbortController()
    let timer = setTimeout(() => ctl.abort(), timeoutMs)
    const resetTimer = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => ctl.abort(), timeoutMs)
    }

    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body,
        signal: ctl.signal,
      })

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '')
        const mapped = statusToError(res.status, bodyText)
        throw aiError(mapped.sub, mapped.msg, {
          status: res.status,
          ...(mapped.hint ? { bodyHint: mapped.hint } : {}),
        })
      }
      if (!res.body) {
        throw aiError('AI_REQUEST_FAILED', 'AI 流式响应为空')
      }

      return await readSseStream(res.body, opts.onDelta, resetTimer)
    } catch (e) {
      if (e instanceof AppError) throw e
      const isAbort =
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError')
      throw aiError(
        isAbort ? 'AI_TIMEOUT' : 'AI_SERVER_ERROR',
        isAbort ? `AI 请求超时（${timeoutMs}ms）` : `AI 网络错误：${(e as Error).message || 'unknown'}`,
        { cause: String((e as Error).name || e) },
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: ChatStreamOptions['onDelta'],
  onActivity?: () => void,
): Promise<ChatStreamResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let chunks = 0
  let id = ''
  let finishReason: string | null = null
  let usage: ChatStreamResult['usage']

  const consumeEvent = (event: string): boolean => {
    const lines = event.split(/\r?\n/)
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      if (data === '[DONE]') return true
      let parsed: {
        id?: string
        choices?: { delta?: { content?: string }; finish_reason?: string | null }[]
        usage?: ChatStreamResult['usage']
      }
      try {
        parsed = JSON.parse(data) as typeof parsed
      } catch {
        continue
      }
      if (parsed.id) id = parsed.id
      if (parsed.usage) usage = parsed.usage
      const choice = parsed.choices?.[0]
      if (choice?.finish_reason != null) finishReason = choice.finish_reason
      const delta = choice?.delta?.content
      if (delta) {
        content += delta
        chunks++
        onDelta?.(delta, { chars: content.length, chunks })
      }
    }
    return false
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onActivity?.()
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ''
    for (const event of events) {
      if (consumeEvent(event)) {
        await reader.cancel().catch(() => undefined)
        return { id, content, finish_reason: finishReason, usage }
      }
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) consumeEvent(buffer)
  return { id, content, finish_reason: finishReason, usage }
}

/** Join a baseUrl and a path, tolerating trailing/leading slashes. */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  // baseUrl like 'https://api.deepseek.com/v1' + '/chat/completions'
  return `${b}/${p}`
}

/** Module-level singleton used by services/ai.ts. */
export const deepseek: DeepSeekClient = new DeepSeekHttp()
