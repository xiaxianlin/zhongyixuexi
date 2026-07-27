import { describe, expect, it, vi } from 'vitest'
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
  it('handles a path without a leading slash', () => {
    expect(joinUrl('https://x.com/v1', 'chat/completions')).toBe('https://x.com/v1/chat/completions')
  })
})

const cfg = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: 'test-key',
}

describe('DeepSeekHttp.chat', () => {
  it('returns the parsed response on 2xx', async () => {
    const response = {
      id: 'x',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }))
    const client = new DeepSeekHttp(fetchMock as unknown as typeof fetch)

    const result = await client.chat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }] }, cfg)
    expect(result).toEqual(response)
  })

  it('rejects immediately without calling fetch when no apiKey is configured', async () => {
    const fetchMock = vi.fn()
    const client = new DeepSeekHttp(fetchMock as unknown as typeof fetch)
    await expect(
      client.chat({ model: 'deepseek-chat', messages: [] }, { ...cfg, apiKey: '' }),
    ).rejects.toThrow('平台未配置 AI Key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry a 401 (auth error)', async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    const client = new DeepSeekHttp(fetchMock as unknown as typeof fetch)
    await expect(
      client.chat({ model: 'deepseek-chat', messages: [] }, cfg),
    ).rejects.toThrow(/鉴权失败/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('defaults every request to a 10-minute per-attempt timeout', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const fetchMock = vi.fn(
      () => new Promise<Response>((_resolve, reject) => reject(new DOMException('Aborted', 'AbortError'))),
    )
    const client = new DeepSeekHttp(fetchMock as unknown as typeof fetch)

    await expect(
      client.chat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }] }, cfg),
    ).rejects.toThrow(`AI 请求超时（${DEFAULT_TIMEOUT_MS}ms）`)

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), DEFAULT_TIMEOUT_MS)
    setTimeoutSpy.mockRestore()
  })

  it('uses a custom per-attempt timeout and retries up to 3 attempts', async () => {
    const fetchMock = vi.fn(
      () => new Promise<Response>((_resolve, reject) => reject(new DOMException('Aborted', 'AbortError'))),
    )
    const client = new DeepSeekHttp(fetchMock as unknown as typeof fetch)

    await expect(
      client.chat({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }] }, cfg, {
        timeoutMs: 50,
      }),
    ).rejects.toThrow('AI 请求超时（50ms）')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
