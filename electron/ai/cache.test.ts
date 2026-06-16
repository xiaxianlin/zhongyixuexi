/**
 * Unit tests for the pure parts of the AI cache layer (07-ai.md §12.1).
 *
 * Covers: prompt normalization (whitespace robustness) and prompt_hash stability
 * — same logical prompt → same hash; whitespace-only edits → same hash; real
 * content edits → different hash; model/temperature changes → different hash.
 * The DB-touching findCache/writeCache/invalidateCache are NOT tested here
 * (better-sqlite3 won't load under vitest/node ABI mismatch).
 */
import { describe, it, expect } from 'vitest'
import { normalizePrompt, computePromptHash } from './cache'
import type { ChatMessage } from './types'

const SYS: ChatMessage = { role: 'system', content: 'system-prompt' }
const USER: ChatMessage = { role: 'user', content: '原文： 人参' }

describe('normalizePrompt', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizePrompt('  hi  ')).toBe('hi')
  })
  it('collapses runs of spaces/tabs into one', () => {
    expect(normalizePrompt('a    b\tc')).toBe('a b c')
  })
  it('unifies CRLF and CR to LF', () => {
    expect(normalizePrompt('a\r\nb\rc')).toBe('a\nb\nc')
  })
  it('collapses 3+ newlines to 2', () => {
    expect(normalizePrompt('a\n\n\n\nb')).toBe('a\n\nb')
  })
})

describe('computePromptHash', () => {
  it('is stable for identical input', () => {
    const a = computePromptHash([SYS, USER], 'deepseek-chat', 0.3)
    const b = computePromptHash([SYS, USER], 'deepseek-chat', 0.3)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is invariant to whitespace-only edits', () => {
    const userSpaced: ChatMessage = { role: 'user', content: '原文：   人参  ' }
    const a = computePromptHash([SYS, USER], 'deepseek-chat', 0.3)
    const b = computePromptHash([SYS, userSpaced], 'deepseek-chat', 0.3)
    expect(a).toBe(b) // whitespace normalized → same hash
  })

  it('changes when the prompt content changes (real edit)', () => {
    const userEdited: ChatMessage = { role: 'user', content: '原文：黄芪' }
    const a = computePromptHash([SYS, USER], 'deepseek-chat', 0.3)
    const b = computePromptHash([SYS, userEdited], 'deepseek-chat', 0.3)
    expect(a).not.toBe(b)
  })

  it('changes when the model changes', () => {
    const a = computePromptHash([SYS, USER], 'deepseek-chat', 0.3)
    const b = computePromptHash([SYS, USER], 'deepseek-reasoner', 0.3)
    expect(a).not.toBe(b)
  })

  it('changes when the temperature changes', () => {
    const a = computePromptHash([SYS, USER], 'deepseek-chat', 0.3)
    const b = computePromptHash([SYS, USER], 'deepseek-chat', 0.5)
    expect(a).not.toBe(b)
  })

  it('changes when message order changes', () => {
    const a = computePromptHash([SYS, USER], 'deepseek-chat', 0.3)
    const b = computePromptHash([USER, SYS], 'deepseek-chat', 0.3)
    expect(a).not.toBe(b)
  })
})
