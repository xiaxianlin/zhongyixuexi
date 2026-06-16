import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/zyxx-test',
  },
}))

import {
  alignAiContentChapters,
  buildAiParseInput,
  normalize,
  pickChapterMatch,
  pickParagraphMatch,
  stripHtmlToText,
} from './import'

describe('import AI parsing helpers', () => {
  it('strips chapter HTML into whole-book AI parse input', () => {
    const input = buildAiParseInput([
      {
        id: 'ch1',
        href: 'ch1.xhtml',
        title: '上品',
        xhtml:
          '<body><script>ignored()</script><h1>上品</h1><p>人参，味甘微寒。</p><p>久服轻身延年。</p></body>',
      },
    ])

    expect(input).toEqual([
      {
        title: '上品',
        text: '上品 人参，味甘微寒。 久服轻身延年。',
      },
    ])
  })

  it('keeps only AI-confirmed content chapters and paragraphs', () => {
    const chapters = [
      {
        id: 'ch1',
        href: 'ch1.xhtml',
        title: '上品',
        xhtml: '<body><p>人参。</p></body>',
      },
      {
        id: 'toc',
        href: 'toc.xhtml',
        title: '目录',
        xhtml: '<body><p>目录。</p></body>',
      },
    ]
    const content = alignAiContentChapters(chapters, [
      { isContent: true, paragraphs: ['人参，味甘微寒。', '久服轻身延年。'] },
      { isContent: false, paragraphs: [] },
    ])

    expect(content).toHaveLength(1)
    expect(content[0].chapter.title).toBe('上品')
    expect(content[0].result.paragraphs).toEqual(['人参，味甘微寒。', '久服轻身延年。'])
  })

  it('strips raw HTML for direct full-text parsing', () => {
    expect(stripHtmlToText('<body><h1>题</h1><p>正文<br/>次句</p></body>')).toBe(
      '题 正文 次句',
    )
  })

  it('normalizes text to the parse-hash canonical form', () => {
    expect(normalize('  人参\u3000味甘\n微寒。  ')).toBe('人参 味甘 微寒。')
  })
})

describe('stable reparse matching helpers', () => {
  it('prefers chapter content hash, then title, then order', () => {
    const oldChapters = [
      { id: 'a', order_index: 0, title: '旧名', content_hash: 'h1' },
      {
        id: 'b',
        order_index: 1,
        title: '中品',
        content_hash: 'h2',
      },
    ]
    const available = new Map(oldChapters.map((ch) => [ch.id, ch]))
    const byHash = new Map([['h2', [oldChapters[1]]]])
    const byTitle = new Map([['上品', [oldChapters[0]]]])

    expect(
      pickChapterMatch({
        orderIndex: 0,
        title: '上品',
        contentHash: 'h2',
        available,
        byHash,
        byTitle,
      })?.id,
    ).toBe('b')
  })

  it('prefers paragraph parse_hash before order fallback', () => {
    const oldParagraphs = [
      { id: 'p1', chapter_id: 'c1', order_index: 0, text: '旧一', edited: 0, parse_hash: 'a' },
      { id: 'p2', chapter_id: 'c1', order_index: 1, text: '旧二', edited: 0, parse_hash: 'b' },
    ]
    const available = new Map(oldParagraphs.map((p) => [p.id, p]))
    const byHash = new Map([['b', [oldParagraphs[1]]]])

    expect(
      pickParagraphMatch({
        orderIndex: 0,
        parseHash: 'b',
        available,
        byHash,
      })?.id,
    ).toBe('p2')
  })
})
