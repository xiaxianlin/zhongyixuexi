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
          version: 1,
          sentences: [
            {
              original: '曰：',
              modern: '问：',
              commentary: '提示问答结构。',
            },
            {
              original: '然：',
              modern: '答：',
              commentary: '提示回答开始。',
            },
          ],
          analysis: '这一段用问答推进学习。',
          summary: '问答结构',
        },
        meta,
      ),
    ).toEqual({
      modern: '问：\n答：',
      explanation: '1. 提示问答结构。\n2. 提示回答开始。',
      analysis: '这一段用问答推进学习。',
      meta,
    })
  })

  it('falls back to summary when analysis is empty', () => {
    const view = modernJsonToInterpretation(
      {
        version: 1,
        sentences: [
          {
            original: '原文',
            modern: '白话',
            commentary: '医理',
          },
        ],
        analysis: '',
        summary: '一句话概括',
      },
      null,
    )

    expect(view.analysis).toBe('一句话概括')
    expect(view.meta).toBeNull()
  })
})
