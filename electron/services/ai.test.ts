/**
 * Unit tests for the pure parts of the AI service (07-ai.md §12.1).
 *
 * Covers splitAnswerAndCites (trailing-JSON extraction from the model's natural
 * language answer). The DB/networking parts of services/ai.ts are NOT tested
 * here — they require better-sqlite3 (ABI mismatch under vitest/node) and a
 * live DeepSeek endpoint.
 */
import { describe, it, expect } from 'vitest'
import { modernJsonToInterpretation, splitAnswerAndCites } from './ai'
import type { QaContext } from '../ai/prompts'

const CTX: QaContext[] = [
  { n: 1, paragraphId: 'p1', bookTitle: 'b', chapterTitle: 'c', snippet: '人参补五脏' },
  { n: 2, paragraphId: 'p2', bookTitle: 'b', chapterTitle: 'c', snippet: '安精神' },
]

describe('splitAnswerAndCites', () => {
  it('extracts a trailing cites JSON block', () => {
    const raw = '人参可以补五脏 [1]，并能安神 [2]。\n{"cites":[{"n":1,"paragraph_id":"p1","snippet":"人参补五脏"},{"n":2,"paragraph_id":"p2","snippet":"安精神"}]}'
    const { answer, citesJson } = splitAnswerAndCites(raw, CTX)
    expect(answer).toBe('人参可以补五脏 [1]，并能安神 [2]。')
    expect(citesJson).not.toBeNull()
    expect(citesJson!.cites.length).toBe(2)
    expect(citesJson!.cites[0].n).toBe(1)
    expect(citesJson!.cites[0].paragraph_id).toBe('p1')
  })

  it('returns the whole text as answer when no JSON present (non-fatal)', () => {
    const raw = '根据现有内容无法回答该问题。'
    const { answer, citesJson } = splitAnswerAndCites(raw, CTX)
    expect(answer).toBe(raw)
    expect(citesJson).toBeNull()
  })

  it('handles a JSON block with extra whitespace/newlines', () => {
    const raw = '答案 [1]。\n\n  {"cites": [{"n": 1, "paragraph_id": "p1", "snippet": "x"}]}  '
    const { citesJson } = splitAnswerAndCites(raw, CTX)
    expect(citesJson).not.toBeNull()
    expect(citesJson!.cites[0].n).toBe(1)
  })

  it('ignores a non-cites JSON object', () => {
    const raw = '答案。\n{"foo": 1}'
    const { answer, citesJson } = splitAnswerAndCites(raw, CTX)
    expect(citesJson).toBeNull()
    // answer falls back to the whole text since the trailing JSON wasn't a cites block
    expect(answer).toContain('答案')
  })

  it('handles nested braces inside the JSON', () => {
    const raw = '答案 [1]。\n{"cites":[{"n":1,"paragraph_id":"p1","snippet":"a {b} c"}]}'
    const { citesJson } = splitAnswerAndCites(raw, CTX)
    expect(citesJson).not.toBeNull()
    expect(citesJson!.cites[0].snippet).toBe('a {b} c')
  })

  it('handles empty input', () => {
    const { answer, citesJson } = splitAnswerAndCites('', CTX)
    expect(answer).toBe('')
    expect(citesJson).toBeNull()
  })
})

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
