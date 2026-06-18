/**
 * Unit tests for the pure parts of the AI service (07-ai.md §12.1).
 *
 * Covers pure mapping logic. The DB/networking parts of services/ai.ts are NOT
 * tested here — they require better-sqlite3 (ABI mismatch under vitest/node)
 * and a live DeepSeek endpoint.
 */
import { describe, it, expect } from 'vitest'
import { modernJsonToInterpretation } from './ai'

describe('modernJsonToInterpretation', () => {
  it('maps modern JSON into the unified paragraph interpretation view', () => {
    const meta = {
      id: 'analysis-1',
      kind: 'modern' as const,
      version: 2,
      source: 'ai',
      model: 'deepseek-chat',
      meta: null,
      created_at: 1710000000000,
      updated_at: 1710000001000,
    }

    expect(
      modernJsonToInterpretation(
        {
          version: 2,
          modern: '黄帝问道：我听说上古时代的人，年龄都超过一百岁。',
          explanation: '黄帝与岐伯的问答，是中医经典阐述医理的常用范式。',
          analysis: '本段以黄帝发问开篇，引出上古之人长寿的话题。',
          summary: '问答结构',
        },
        meta,
      ),
    ).toEqual({
      modern: '黄帝问道：我听说上古时代的人，年龄都超过一百岁。',
      explanation: '黄帝与岐伯的问答，是中医经典阐述医理的常用范式。',
      analysis: '本段以黄帝发问开篇，引出上古之人长寿的话题。',
      meta,
    })
  })

  it('falls back to summary when analysis is empty', () => {
    const view = modernJsonToInterpretation(
      {
        version: 2,
        modern: '白话',
        explanation: '医理',
        analysis: '',
        summary: '一句话概括',
      },
      null,
    )

    expect(view.analysis).toBe('一句话概括')
    expect(view.meta).toBeNull()
  })
})
