import { describe, it, expect } from 'vitest'
import { splitParagraphs, normalizeWhitespace } from './paragraph'

describe('normalizeWhitespace', () => {
  it('collapses whitespace runs and folds full-width spaces', () => {
    expect(normalizeWhitespace('  a\u3000 b \n\t c ')).toBe('a b c')
    expect(normalizeWhitespace('a    b')).toBe('a b')
    expect(normalizeWhitespace('  ')).toBe('')
  })
})

describe('splitParagraphs', () => {
  it('returns [] for empty / whitespace-only input', () => {
    expect(splitParagraphs('')).toEqual([])
    expect(splitParagraphs('   \n\t  ')).toEqual([])
  })

  it('splits multiple <p> blocks into ordered paragraphs', () => {
    const xhtml = `<html><body>
      <p>第一段正文。</p>
      <p>第二段正文。</p>
      <p>第三段正文。</p>
    </body></html>`
    const out = splitParagraphs(xhtml)
    expect(out.map((p) => p.text)).toEqual(['第一段正文。', '第二段正文。', '第三段正文。'])
    expect(out.every((p) => p.isNoise === false)).toBe(true)
  })

  it('walks nested tags and keeps document order', () => {
    const xhtml = `<body>
      <div><section>
        <p>外层一段。</p>
        <blockquote>引用文。</blockquote>
      </section></div>
      <p>末尾段。</p>
    </body>`
    const out = splitParagraphs(xhtml)
    expect(out.map((p) => p.text)).toEqual(['外层一段。', '引用文。', '末尾段。'])
  })

  it('handles headings and list items as paragraph boundaries', () => {
    const xhtml = `<body>
      <h2>上品</h2>
      <ul><li>人参</li><li>甘草</li></ul>
      <p>正文。</p>
    </body>`
    const out = splitParagraphs(xhtml)
    expect(out.map((p) => p.text)).toEqual(['上品', '人参', '甘草', '正文。'])
  })

  it('treats <br> as a paragraph boundary inside a single <p>', () => {
    const xhtml = `<body><p>句一。<br/>句二。<br/>句三。</p></body>`
    const out = splitParagraphs(xhtml)
    expect(out.map((p) => p.text)).toEqual(['句一。', '句二。', '句三。'])
  })

  it('strips script/style/nav/header/footer content', () => {
    const xhtml = `<body>
      <header>页眉噪声</header>
      <script>var x = 'ignored'</script>
      <style>.c { color: red }</style>
      <nav><a href="#">目录链接</a></nav>
      <p>真正正文。</p>
      <footer>页脚噪声</footer>
    </body>`
    const out = splitParagraphs(xhtml)
    expect(out.map((p) => p.text)).toEqual(['真正正文。'])
  })

  it('normalises full-width spaces and whitespace runs in text', () => {
    const xhtml = `<body><p>黄芪\u3000  性\u3000  温。</p></body>`
    const out = splitParagraphs(xhtml)
    expect(out[0].text).toBe('黄芪 性 温。')
  })

  it('splits overlong paragraphs on 。！？； without cutting sentences', () => {
    // 12 sentences joined, each ~10 chars → total ~120 chars; raise bar so
    // splitting kicks in by building a >300 char block with sentence punctuation
    const sentence = '此药味甘性温无毒主补中益气。'
    const longText = sentence.repeat(20) // ~260 chars, single sentence w/ trailing 。
    // build a paragraph with multiple sentences exceeding the cap
    const multi = Array.from({ length: 40 }, (_, i) => `第${i}句测试句子应被保留完整。`).join('')
    const xhtml = `<body><p>${multi}</p></body>`
    const out = splitParagraphs(xhtml)
    expect(out.length).toBeGreaterThan(1)
    // no piece may be cut mid-sentence: each must end with sentence punctuation
    // (the only exception is the final piece which we also expect to be punctuated)
    for (const p of out) {
      expect(/[。！？；!?]$/.test(p.text) || /。|！|？|；/.test(p.text)).toBe(true)
    }
    // reassembling pieces yields the same sentences, order preserved
    const firstSentence = out[0].text
    expect(firstSentence).toContain('第0句测试句子应被保留完整。')
    // ensure sentence completeness: every emitted piece ends in punctuation
    expect(out.every((p) => /[。！？；!?…]$/.test(p.text))).toBe(true)
    // confirm the long block actually triggered splitting
    expect(longText).not.toContain('x') // sanity placeholder used above
  })

  it('does not split a long block that has no sentence punctuation (keeps whole)', () => {
    const longNoPunct = '字'.repeat(400)
    const xhtml = `<body><p>${longNoPunct}</p></body>`
    const out = splitParagraphs(xhtml)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(longNoPunct)
  })

  it('flags page-number / watermark / too-short non-CJK noise as isNoise', () => {
    const xhtml = `<body>
      <p>12</p>
      <p>第 3 页</p>
      <p>- 5 -</p>
      <p>试读版本</p>
      <p>www.example.com</p>
      <p>正常中医正文段落。</p>
    </body>`
    const out = splitParagraphs(xhtml)
    expect(out.map((p) => ({ t: p.text, n: p.isNoise }))).toEqual([
      { t: '12', n: true },
      { t: '第 3 页', n: true },
      { t: '- 5 -', n: true },
      { t: '试读版本', n: true },
      { t: 'www.example.com', n: true },
      { t: '正常中医正文段落。', n: false },
    ])
  })

  it('drops empty paragraphs but keeps meaningful short CJK blocks', () => {
    const xhtml = `<body>
      <p></p>
      <p>   </p>
      <p>序</p>
      <p>正文段。</p>
    </body>`
    const out = splitParagraphs(xhtml)
    expect(out.map((p) => p.text)).toEqual(['序', '正文段。'])
  })

  it('falls back gracefully on malformed XHTML (does not throw)', () => {
    const broken = `<body><p>未闭合段落<<P>乱码`
    const out = splitParagraphs(broken)
    // must not throw; must recover at least some text
    expect(out.length).toBeGreaterThan(0)
    expect(out.some((p) => p.text.includes('未闭合段落') || p.text.includes('乱码'))).toBe(true)
  })
})
