/**
 * Unit tests for the pure helpers of the DeepSeek client (07-ai.md §12.1).
 *
 * joinUrl is a pure URL-join helper — safe to test without a network.
 *
 * The chat() retry/timeout/error-mapping logic is integration-shaped (it needs
 * a fake fetch + AbortController timing), so per the agent contract we test
 * only the pure transform here. A future integration test can inject a
 * DeepSeekClient fake into services/ai.ts.
 */
import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_TIMEOUT_MS, DeepSeekHttp, joinUrl } from './deepseek'

describe('joinUrl', () => {
  it('joins a base with a leading-slash path', () => {
    expect(joinUrl('https://api.deepseek.com/v1', '/chat/completions')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    )
  })
  it('strips a trailing slash from the base', () => {
    expect(joinUrl('https://api.deepseek.com/v1/', '/chat/completions')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    )
  })
  it('strips multiple trailing slashes', () => {
    expect(joinUrl('https://x.com/v1///', '/chat')).toBe('https://x.com/v1/chat')
  })
  it('handles a path without a leading slash', () => {
    expect(joinUrl('https://x.com/v1', 'chat/completions')).toBe('https://x.com/v1/chat/completions')
  })
  it('handles a base without a version path', () => {
    expect(joinUrl('https://x.com', '/chat/completions')).toBe('https://x.com/chat/completions')
  })
})

describe('DeepSeekHttp timeout options', () => {
  it('defaults every request to a 10-minute per-attempt timeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const fetchMock = vi.fn(() => {
      return new Promise<Response>((_resolve, reject) => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })
    const client = new DeepSeekHttp(fetchMock as unknown as typeof fetch)

    await expect(
      client.chat(
        {
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        },
        {
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          apiKey: 'test-key',
        },
      ),
    ).rejects.toThrow(`AI 请求超时（${DEFAULT_TIMEOUT_MS}ms）`)

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), DEFAULT_TIMEOUT_MS)
    setTimeoutSpy.mockRestore()
  })

  it('uses a custom per-attempt timeout when provided', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeDefined()
      return new Promise<Response>((_resolve, reject) => {
        reject(new DOMException('Aborted', 'AbortError'))
      })
    })
    const fetchImpl = fetchMock as unknown as typeof fetch
    const client = new DeepSeekHttp(fetchImpl)

    await expect(
      client.chat(
        {
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        },
        {
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          apiKey: 'test-key',
        },
        { timeoutMs: 1234 },
      ),
    ).rejects.toThrow('AI 请求超时（1234ms）')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234)
    setTimeoutSpy.mockRestore()
  })
})
