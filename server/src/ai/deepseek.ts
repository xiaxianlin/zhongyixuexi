/**
 * DeepSeek chat client — ported from electron/ai/deepseek.ts, trimmed to the
 * non-streaming `chat()` call (no chatStream; the AI-05 question route is
 * request/response, not SSE). Same resilience policy as the desktop client:
 * 10-minute per-attempt timeout, up to 3 attempts with jittered exponential
 * backoff on retryable statuses/network errors, no retry on 401/403/402.
 */
import type { ChatRequest, ChatResponse, ProviderConfig } from './types'
import { AiError, type AiSubCode } from './errors'

export const DEFAULT_TIMEOUT_MS = 10 * 60_000
const MAX_RETRIES = 2
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

export interface ChatOptions {
  timeoutMs?: number
}

export interface DeepSeekClient {
  chat(req: ChatRequest, cfg: ProviderConfig, opts?: ChatOptions): Promise<ChatResponse>
}

function sleep(ms: number): Promise<void> {
  const jitter = ms * (0.8 + Math.random() * 0.4)
  return new Promise((r) => setTimeout(r, jitter))
}

function backoffMs(attempt: number): number {
  return 500 * Math.pow(2, attempt)
}

function statusToError(
  status: number,
  bodyText: string,
): { sub: AiSubCode; msg: string; retryable: boolean } {
  if (status === 401 || status === 403) {
    return { sub: 'AI_AUTH_ERROR', msg: `API 鉴权失败（${status}），请检查平台 Key 配置`, retryable: false }
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
  const hint = bodyText.slice(0, 200).replace(/\s+/g, ' ')
  return { sub: 'AI_REQUEST_FAILED', msg: `AI 请求失败（${status}）${hint ? `：${hint}` : ''}`, retryable: false }
}

export class DeepSeekHttp implements DeepSeekClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch.bind(globalThis)) {}

  async chat(req: ChatRequest, cfg: ProviderConfig, opts: ChatOptions = {}): Promise<ChatResponse> {
    if (!cfg.apiKey) {
      throw new AiError('AI_KEY_NOT_CONFIGURED', '平台未配置 AI Key')
    }

    const url = joinUrl(cfg.baseUrl, '/chat/completions')
    const body = JSON.stringify(req)
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeoutMs)

      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body,
          signal: ctl.signal,
        })

        if (res.ok) {
          return (await res.json()) as ChatResponse
        }

        const bodyText = await res.text().catch(() => '')
        const mapped = statusToError(res.status, bodyText)
        const err = new AiError(mapped.sub, mapped.msg)
        if (!mapped.retryable || attempt === MAX_RETRIES) throw err
        await sleep(backoffMs(attempt))
        continue
      } catch (e) {
        if (e instanceof AiError) {
          if (e.sub !== 'AI_SERVER_ERROR' && e.sub !== 'AI_QUOTA_EXCEEDED') throw e
          if (attempt === MAX_RETRIES) throw e
          await sleep(backoffMs(attempt))
          continue
        }

        const isAbort =
          (e instanceof DOMException && e.name === 'AbortError') ||
          (e instanceof Error && e.name === 'AbortError')
        const sub: AiSubCode = isAbort ? 'AI_TIMEOUT' : 'AI_SERVER_ERROR'
        const err = new AiError(
          sub,
          isAbort
            ? `AI 请求超时（${timeoutMs}ms）`
            : `AI 网络错误：${(e as Error).message || 'unknown'}`,
        )
        if (attempt === MAX_RETRIES) throw err
        await sleep(backoffMs(attempt))
      } finally {
        clearTimeout(timer)
      }
    }

    // Unreachable: every branch above throws once attempt === MAX_RETRIES.
    throw new AiError('AI_UNKNOWN', 'AI 调用失败（未知原因）')
  }
}

export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}`
}

export const deepseek: DeepSeekClient = new DeepSeekHttp()
