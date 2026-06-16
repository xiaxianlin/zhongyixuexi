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
import { describe, it, expect } from 'vitest'
import { joinUrl } from './deepseek'

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
