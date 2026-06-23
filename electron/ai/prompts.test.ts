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
  buildChapterPrompt,
  buildChatPrompt,
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
      buildChapterPrompt({ title: '一难', content: '人参', category: 'classic' }).messages,
      buildChapterPrompt({ title: 'ch1', content: 'x', category: 'modern' }).messages,
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
    expect(user).toContain('"version": 2')
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

describe('buildChapterPrompt', () => {
  it('injects chapter title + content into the user message', () => {
    const { messages } = buildChapterPrompt({
      title: '一难',
      content: '十二经皆有动脉',
      category: 'classic',
    })
    const user = messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('一难')
    expect(user).toContain('十二经皆有动脉')
    expect(user).toContain('"version": 1')
  })

  it('classic asks for the modern (白话) field', () => {
    const { messages } = buildChapterPrompt({
      title: '一难',
      content: 'x',
      category: 'classic',
    })
    const user = messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('"modern"')
    expect(user).toContain('白话译文')
  })

  it('modern books omit the modern (白话) field', () => {
    const { messages } = buildChapterPrompt({
      title: 'ch1',
      content: 'x',
      category: 'modern',
    })
    const user = messages.find((m) => m.role === 'user')!.content
    expect(user).not.toContain('"modern"')
    expect(user).not.toContain('白话译文')
  })

  it('uses temperature 0.3 and JSON mode', () => {
    const p = buildChapterPrompt({ title: 't', content: 'x', category: 'classic' })
    expect(p.temperature).toBe(0.3)
    expect(p.response_format).toEqual({ type: 'json_object' })
  })

  it('is stable across calls with the same input', () => {
    const a = buildChapterPrompt({ title: '一难', content: 'x', category: 'classic' })
    const b = buildChapterPrompt({ title: '一难', content: 'x', category: 'classic' })
    expect(a.messages).toEqual(b.messages)
  })
})

describe('buildChatPrompt', () => {
  it('injects chapter title + content into the system message', () => {
    const { messages } = buildChatPrompt({
      chapterTitle: '一难',
      chapterContent: '十二经皆有动脉',
      history: [],
      user: '这是什么意思？',
    })
    const sys = systemContent(messages)
    expect(sys).toContain('一难')
    expect(sys).toContain('十二经皆有动脉')
  })

  it('appends history + the new user turn after the system message', () => {
    const { messages } = buildChatPrompt({
      chapterTitle: '一难',
      chapterContent: 'x',
      history: [
        { role: 'user', content: '问1' },
        { role: 'assistant', content: '答1' },
      ],
      user: '问2',
    })
    expect(messages[0]!.role).toBe('system')
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: '问1' },
      { role: 'assistant', content: '答1' },
      { role: 'user', content: '问2' },
    ])
  })

  it('wraps a quote as a blockquote above the user text', () => {
    const { messages } = buildChatPrompt({
      chapterTitle: 't',
      chapterContent: 'x',
      history: [],
      user: '解释一下',
      quote: '十二经皆有动脉',
    })
    const last = messages[messages.length - 1]!
    expect(last.role).toBe('user')
    expect(last.content).toContain('> 十二经皆有动脉')
    expect(last.content).toContain('解释一下')
  })

  it('omits the quote block when no quote is given', () => {
    const { messages } = buildChatPrompt({
      chapterTitle: 't',
      chapterContent: 'x',
      history: [],
      user: '解释一下',
    })
    expect(messages[messages.length - 1]!.content).not.toContain('> ')
  })

  it('uses temperature 0.5 (more flexible than analysis) and no JSON mode', () => {
    const p = buildChatPrompt({
      chapterTitle: 't',
      chapterContent: 'x',
      history: [],
      user: 'q',
    })
    expect(p.temperature).toBe(0.5)
    expect((p as { response_format?: unknown }).response_format).toBeUndefined()
  })

  it('embeds the red line in the system message', () => {
    const { messages } = buildChatPrompt({
      chapterTitle: 't',
      chapterContent: 'x',
      history: [],
      user: 'q',
    })
    expect(systemContent(messages)).toContain('严格禁止')
  })
})
