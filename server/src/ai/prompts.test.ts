import { describe, expect, it } from 'vitest'
import { buildQaPrompt, RED_LINE_PROMPT } from './prompts'

describe('buildQaPrompt', () => {
  it('includes the red-line system prompt first', () => {
    const { messages } = buildQaPrompt([], [], '人参性味是什么')
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain(RED_LINE_PROMPT)
  })

  it('numbers the retrieved context paragraphs and appends the question', () => {
    const { messages } = buildQaPrompt([], ['太阳之为病，脉浮。', '太阳病，发热。'], '太阳病的脉象是什么')
    const last = messages[messages.length - 1]
    expect(last?.role).toBe('user')
    expect(last?.content).toContain('[1] 太阳之为病，脉浮。')
    expect(last?.content).toContain('[2] 太阳病，发热。')
    expect(last?.content).toContain('问题：太阳病的脉象是什么')
  })

  it('notes when no context paragraphs were retrieved', () => {
    const { messages } = buildQaPrompt([], [], '什么是归经')
    const last = messages[messages.length - 1]
    expect(last?.content).toContain('未检索到直接相关的原文片段')
  })

  it('inserts prior conversation turns between the system prompt and the new question', () => {
    const history = [
      { role: 'user' as const, content: '第一问' },
      { role: 'assistant' as const, content: '第一答' },
    ]
    const { messages } = buildQaPrompt(history, [], '追问')
    expect(messages).toHaveLength(4)
    expect(messages[1]).toEqual(history[0])
    expect(messages[2]).toEqual(history[1])
    expect(messages[3]?.content).toContain('问题：追问')
  })
})
