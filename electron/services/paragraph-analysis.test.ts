import { describe, expect, it } from 'vitest'
import {
  mapParagraphAnalysisHistoryItem,
  mapParagraphAnalysisMeta,
  mapParagraphAnalysisView,
} from './paragraph-analysis'

describe('mapParagraphAnalysisMeta', () => {
  it('returns null when no active analysis row exists', () => {
    expect(
      mapParagraphAnalysisMeta({
        analysis_id: null,
        analysis_version: null,
        analysis_source: null,
        analysis_model: null,
        analysis_created_at: null,
        analysis_updated_at: null,
      }),
    ).toBeNull()
  })

  it('maps active analysis metadata from SQL aliases', () => {
    expect(
      mapParagraphAnalysisMeta({
        analysis_id: 'pa-1',
        analysis_version: 3,
        analysis_source: 'ai',
        analysis_model: 'deepseek-chat',
        analysis_created_at: 1710000000000,
        analysis_updated_at: 1710000001000,
      }),
    ).toEqual({
      id: 'pa-1',
      version: 3,
      source: 'ai',
      model: 'deepseek-chat',
      created_at: 1710000000000,
      updated_at: 1710000001000,
    })
  })

  it('keeps legacy-compatible timestamps when nullable aliases are absent', () => {
    expect(
      mapParagraphAnalysisMeta({
        analysis_id: 'pa-legacy',
        analysis_version: 1,
        analysis_source: 'legacy',
        analysis_model: null,
        analysis_created_at: null,
        analysis_updated_at: null,
      }),
    ).toEqual({
      id: 'pa-legacy',
      version: 1,
      source: 'legacy',
      model: null,
      created_at: 0,
      updated_at: 0,
    })
  })
})

describe('mapParagraphAnalysisView', () => {
  it('maps content fields and nested metadata together', () => {
    expect(
      mapParagraphAnalysisView({
        content_modern: '白话',
        content_explanation: '医理',
        content_analysis: '解读',
        analysis_id: 'pa-2',
        analysis_version: 2,
        analysis_source: 'cache',
        analysis_model: 'deepseek-chat',
        analysis_created_at: 1710000000000,
        analysis_updated_at: 1710000002000,
      }),
    ).toEqual({
      modern: '白话',
      explanation: '医理',
      analysis: '解读',
      analysisMeta: {
        id: 'pa-2',
        version: 2,
        source: 'cache',
        model: 'deepseek-chat',
        created_at: 1710000000000,
        updated_at: 1710000002000,
      },
    })
  })
})

describe('mapParagraphAnalysisHistoryItem', () => {
  it('converts SQLite active flags into booleans', () => {
    expect(
      mapParagraphAnalysisHistoryItem({
        id: 'pa-3',
        version: 4,
        is_active: 1,
        source: 'ai',
        model: null,
        summary: '摘要',
        prompt_hash: 'hash',
        cache_id: 'cache',
        created_at: 1710000000000,
        updated_at: 1710000003000,
      }),
    ).toMatchObject({
      id: 'pa-3',
      version: 4,
      is_active: true,
    })

    expect(
      mapParagraphAnalysisHistoryItem({
        id: 'pa-4',
        version: 3,
        is_active: 0,
        source: 'cache',
        model: null,
        summary: null,
        prompt_hash: null,
        cache_id: null,
        created_at: 1710000000000,
        updated_at: 1710000001000,
      }).is_active,
    ).toBe(false)
  })
})
