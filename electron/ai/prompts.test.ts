/**
 * Unit tests for prompt templates (07-ai.md §12.1).
 *
 * Asserts: (1) the red-line System Prompt fragment is present in every template
 * (layer 1 of the three-layer guard), and (2) the builders are deterministic /
 * stable so cache hashes don't flap on re-generation.
 */
import { describe, it, expect } from 'vitest'
import {
  RED_LINE_PROMPT,
  buildModernPrompt,
} from './prompts'

function systemContent(msgs: { role: string; content: string }[]): string {
  return msgs.find((m) => m.role === 'system')?.content ?? ''
}

describe('red-line presence (layer 1)', () => {
  it('RED_LINE_PROMPT contains the three prohibitions', () => {
    expect(RED_LINE_PROMPT).toContain('疾病诊断')
    expect(RED_LINE_PROMPT).toContain('具体剂量')
    expect(RED_LINE_PROMPT).toContain('请咨询执业医师')
  })

  it('is prepended to every template', () => {
    const cases = [
      buildModernPrompt({ text: '人参' }).messages,
    ]
    for (const msgs of cases) {
      expect(systemContent(msgs)).toContain('严格禁止')
      expect(systemContent(msgs)).toContain('不提供诊疗')
    }
  })
})

describe('buildModernPrompt', () => {
  it('injects the source text into the user message', () => {
    const { messages } = buildModernPrompt({ text: '人参，味甘微寒。' })
    const user = messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('人参，味甘微寒。')
    expect(user).toContain('"version": 1')
  })
  it('uses temperature 0.3 and JSON mode', () => {
    const p = buildModernPrompt({ text: 'x' })
    expect(p.temperature).toBe(0.3)
    expect(p.response_format).toEqual({ type: 'json_object' })
  })
  it('is stable across calls with the same input', () => {
    const a = buildModernPrompt({ text: '人参' })
    const b = buildModernPrompt({ text: '人参' })
    expect(a.messages).toEqual(b.messages)
  })
})
