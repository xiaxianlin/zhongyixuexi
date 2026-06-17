import { describe, expect, it } from 'vitest'
import {
  activeAnalysisSql,
  buildParagraphAnalysisInput,
  joinActiveAnalysis,
  hasParagraphAnalysisContent,
  mapParagraphAnalysisHistoryItem,
  mapParagraphAnalysisMeta,
  mapParagraphAnalysisView,
  normalizeParagraphAnalysisContent,
  parseParagraphAnalysisMetaJson,
  selectActiveAnalysisColumns,
  toParagraphInterpretationDTO,
  toParagraphInterpretationView,
} from './paragraph-analysis'

describe('active paragraph analysis SQL helpers', () => {
  it('joins the active modern analysis row by default', () => {
    const joinSql = joinActiveAnalysis()

    expect(joinSql).toContain('LEFT JOIN paragraph_analyses pa')
    expect(joinSql).toContain('pa.paragraph_id = p.id')
    expect(joinSql).toContain("pa.kind = 'modern'")
    expect(joinSql).toContain('pa.is_active = 1')
  })

  it('supports custom SQL aliases for callers with different paragraph joins', () => {
    const joinSql = joinActiveAnalysis({ paragraphAlias: 'paragraph', analysisAlias: 'active_pa' })
    const selectSql = selectActiveAnalysisColumns({
      paragraphAlias: 'paragraph',
      analysisAlias: 'active_pa',
    })

    expect(joinSql).toContain('LEFT JOIN paragraph_analyses active_pa')
    expect(joinSql).toContain('active_pa.paragraph_id = paragraph.id')
    expect(joinSql).toContain("active_pa.kind = 'modern'")
    expect(selectSql).toContain(
      'COALESCE(active_pa.modern, paragraph.content_modern) AS content_modern',
    )
    expect(selectSql).toContain('active_pa.id AS analysis_id')
  })

  it('returns paired select and join SQL from the same alias options', () => {
    const activeAnalysis = activeAnalysisSql({
      paragraphAlias: 'source_p',
      analysisAlias: 'source_pa',
    })

    expect(activeAnalysis.columns).toContain(
      'COALESCE(source_pa.modern, source_p.content_modern) AS content_modern',
    )
    expect(activeAnalysis.join).toContain('LEFT JOIN paragraph_analyses source_pa')
    expect(activeAnalysis.join).toContain('source_pa.paragraph_id = source_p.id')
  })

  it('selects active analysis fields with legacy paragraph fallbacks', () => {
    const selectSql = selectActiveAnalysisColumns()

    expect(selectSql).toContain('COALESCE(pa.modern, p.content_modern) AS content_modern')
    expect(selectSql).toContain(
      'COALESCE(pa.explanation, p.content_explanation) AS content_explanation',
    )
    expect(selectSql).toContain('COALESCE(pa.analysis, p.content_analysis) AS content_analysis')
    expect(selectSql).toContain('pa.id AS analysis_id')
    expect(selectSql).toContain('pa.meta AS analysis_meta')
  })
})

describe('mapParagraphAnalysisMeta', () => {
  it('returns null when no active analysis row exists', () => {
    expect(
      mapParagraphAnalysisMeta({
        analysis_id: null,
        analysis_kind: null,
        analysis_version: null,
        analysis_source: null,
        analysis_model: null,
        analysis_meta: null,
        analysis_created_at: null,
        analysis_updated_at: null,
      }),
    ).toBeNull()
  })

  it('maps active analysis metadata from SQL aliases', () => {
    expect(
      mapParagraphAnalysisMeta({
        analysis_id: 'pa-1',
        analysis_kind: 'modern',
        analysis_version: 3,
        analysis_source: 'ai',
        analysis_model: 'deepseek-chat',
        analysis_meta: '{"totalTokens":128}',
        analysis_created_at: 1710000000000,
        analysis_updated_at: 1710000001000,
      }),
    ).toEqual({
      id: 'pa-1',
      kind: 'modern',
      version: 3,
      source: 'ai',
      model: 'deepseek-chat',
      meta: { totalTokens: 128 },
      created_at: 1710000000000,
      updated_at: 1710000001000,
    })
  })

  it('keeps legacy-compatible timestamps when nullable aliases are absent', () => {
    expect(
      mapParagraphAnalysisMeta({
        analysis_id: 'pa-legacy',
        analysis_kind: null,
        analysis_version: 1,
        analysis_source: 'legacy',
        analysis_model: null,
        analysis_meta: null,
        analysis_created_at: null,
        analysis_updated_at: null,
      }),
    ).toEqual({
      id: 'pa-legacy',
      kind: 'modern',
      version: 1,
      source: 'legacy',
      model: null,
      meta: null,
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
        analysis_kind: 'modern',
        analysis_version: 2,
        analysis_source: 'cache',
        analysis_model: 'deepseek-chat',
        analysis_meta: '{"fromCache":true}',
        analysis_created_at: 1710000000000,
        analysis_updated_at: 1710000002000,
      }),
    ).toEqual({
      modern: '白话',
      explanation: '医理',
      analysis: '解读',
      analysisMeta: {
        id: 'pa-2',
        kind: 'modern',
        version: 2,
        source: 'cache',
        model: 'deepseek-chat',
        meta: { fromCache: true },
        created_at: 1710000000000,
        updated_at: 1710000002000,
      },
    })
  })
})

describe('paragraph interpretation mapping', () => {
  it('maps the internal analysis view to the renderer-facing interpretation shape', () => {
    const analysisView = {
      modern: '白话',
      explanation: '医理',
      analysis: '解读',
      analysisMeta: {
        id: 'pa-view',
        kind: 'modern' as const,
        version: 1,
        source: 'ai',
        model: null,
        meta: null,
        created_at: 1710000000000,
        updated_at: 1710000001000,
      },
    }

    expect(toParagraphInterpretationView(analysisView)).toEqual({
      modern: '白话',
      explanation: '医理',
      analysis: '解读',
      meta: analysisView.analysisMeta,
    })
    expect(toParagraphInterpretationDTO(analysisView)).toEqual({
      modern: '白话',
      explanation: '医理',
      analysis: '解读',
      meta: analysisView.analysisMeta,
      cached: true,
    })
  })

  it('treats a fully empty interpretation as uncached', () => {
    const emptyView = {
      modern: null,
      explanation: null,
      analysis: null,
      analysisMeta: null,
    }

    expect(hasParagraphAnalysisContent(emptyView)).toBe(false)
    expect(toParagraphInterpretationDTO(emptyView).cached).toBe(false)
  })

  it('normalizes nullable analysis content for database writes', () => {
    expect(
      normalizeParagraphAnalysisContent({
        modern: '白话',
        explanation: null,
        analysis: undefined,
      }),
    ).toEqual({
      modern: '白话',
      explanation: '',
      analysis: '',
    })
  })

  it('builds a write input with normalized content and metadata', () => {
    expect(
      buildParagraphAnalysisInput({
        paragraphId: 'paragraph-1',
        content: {
          modern: '白话',
          explanation: null,
          analysis: '解读',
        },
        summary: '摘要',
        model: 'deepseek-chat',
        promptHash: 'prompt-hash',
        cacheId: 'cache-1',
        source: 'cache',
        meta: { fromCache: true },
      }),
    ).toEqual({
      paragraphId: 'paragraph-1',
      kind: 'modern',
      modern: '白话',
      explanation: '',
      analysis: '解读',
      summary: '摘要',
      model: 'deepseek-chat',
      promptHash: 'prompt-hash',
      cacheId: 'cache-1',
      source: 'cache',
      meta: { fromCache: true },
    })
  })
})

describe('mapParagraphAnalysisHistoryItem', () => {
  it('converts SQLite active flags into booleans', () => {
    expect(
      mapParagraphAnalysisHistoryItem({
        id: 'pa-3',
        kind: 'modern',
        version: 4,
        is_active: 1,
        source: 'ai',
        model: null,
        summary: '摘要',
        prompt_hash: 'hash',
        cache_id: 'cache',
        meta: '{"sentenceCount":2,"totalTokens":128}',
        created_at: 1710000000000,
        updated_at: 1710000003000,
      }),
    ).toMatchObject({
      id: 'pa-3',
      kind: 'modern',
      version: 4,
      is_active: true,
      meta: { sentenceCount: 2, totalTokens: 128 },
    })

    expect(
      mapParagraphAnalysisHistoryItem({
        id: 'pa-4',
        kind: 'modern',
        version: 3,
        is_active: 0,
        source: 'cache',
        model: null,
        summary: null,
        prompt_hash: null,
        cache_id: null,
        meta: null,
        created_at: 1710000000000,
        updated_at: 1710000001000,
      }).is_active,
    ).toBe(false)
  })

  it('parses optional history metadata defensively', () => {
    expect(parseParagraphAnalysisMetaJson('{"fromCache":true}')).toEqual({ fromCache: true })
    expect(parseParagraphAnalysisMetaJson('[1,2,3]')).toBeNull()
    expect(parseParagraphAnalysisMetaJson('not json')).toBeNull()
    expect(parseParagraphAnalysisMetaJson(null)).toBeNull()
  })
})
