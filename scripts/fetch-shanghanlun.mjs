/**
 * One-shot tool: fetch simplified-Chinese 伤寒论 from Wikisource, rebuild the
 * builtin-content JSON (`data/shanghanlun-original.json`) with stable IDs.
 *
 * Run: `node scripts/fetch-shanghanlun.mjs` (writes the JSON, prints a report).
 *
 * Why a script: Wikisource stores the page in traditional Chinese behind a
 * `{{s2t}}` template; the simplified form is only produced by the render path.
 * So we fetch rendered HTML (`action=parse&prop=text&variant=zh-hans`), then
 * walk the 22 chapter headings (h3) and their `<p>`/`<dl>` body blocks.
 *
 * Output schema matches what `seedBuiltinContent` actually reads — everything
 * else (contentHash/parseHash/quality.flag) is left out so the seed recomputes
 * it, and the mobi-import leftovers are dropped entirely.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const API =
  'https://zh.wikisource.org/w/api.php?action=parse&page=%E5%82%B7%E5%AF%92%E8%AB%96' +
  '&prop=text&format=json&formatversion=2&variant=zh-hans'
const DEST = new URL('../data/shanghanlun-original.json', import.meta.url)

async function fetchHtml() {
  let lastErr
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(API, {
        headers: { 'user-agent': 'zhongyixuexi-bot/1.0 (research)' },
        signal: AbortSignal.timeout(40000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!json?.parse?.text) throw new Error('no parse.text in response')
      return json.parse.text
    } catch (err) {
      lastErr = err
      console.error(`attempt ${attempt} failed: ${err.message}; retrying...`)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  throw new Error(`fetch failed after retries: ${lastErr?.message}`)
}

/**
 * Wikisource's auto t→s converter occasionally mangles rare characters by
 * splitting them into their radical components (e.g. 漐 → 执水). These are
 * converter bugs confirmed against the traditional source, not ambiguous text.
 * Patch them after cleaning so the output matches the original 伤寒论 wording.
 */
const CONVERSION_FIXES = [
  ['执水 执水然', '漐漐然'],
  ['以执水', '以漐漐'],
]

function fixConversions(text) {
  let out = text
  for (const [bad, good] of CONVERSION_FIXES) out = out.split(bad).join(good)
  return out
}

/**
 * Strip HTML tags and collapse whitespace, but preserve the original line
 * structure (don't join separate `<dd>` blocks). Returns trimmed text.
 */
function cleanText(html) {
  return fixConversions(
    html
      .replace(/<[^>]+>/g, '\n') // tags → newline boundaries
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, '') // numeric entities (rare)
      .replace(/\u3000/g, '') // drop the leading full-width indent (U+3000 x2)
      .replace(/[ \t]+/g, ' ')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ')
      .trim(),
  )
}

/**
 * The 22 chapters are all h3-level and end with a 第N ordinal. h2 headings are
 * either the two prefaces (林亿校序/张仲景原序) or 卷第N wrappers — all skipped.
 */
function isChapterHeading(level, text) {
  if (level !== '3') return false
  return /第[一二三四五六七八九十]+[一二三四五六七八九十]*$/.test(text)
}

function parse(html) {
  // Split the document on h2/h3 headers, keeping each header + its body together.
  // The HTML is flat: <h3>title</h3><editsection>...</editsection> then <p>/<dl>.
  const chunks = html.split(/(<h[23][^>]*>.*?<\/h[23]>)/)
  const chapters = []
  let current = null

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    const headerMatch = chunk.match(/^<h([23])[^>]*>(.*?)<\/h\1>$/s)
    if (headerMatch) {
      const level = headerMatch[1]
      const title = cleanText(headerMatch[2])
      if (isChapterHeading(level, title)) {
        current = { title, paragraphs: [] }
        chapters.push(current)
      } else {
        // entered a non-chapter section (preface, 卷第N wrapper); detach so we
        // don't accidentally collect its body into the previous chapter.
        current = null
      }
      continue
    }
    // body content — only collect if we're inside a chapter
    if (!current) continue
    collectBody(chunk, current.paragraphs)
  }
  return chapters
}

function collectBody(html, out) {
  // Extract each <p>…</p> and each <dt>/<dd> inside <dl> as its own paragraph.
  const blockRe = /<p>([\s\S]*?)<\/p>|<dt>([\s\S]*?)<\/dt>|<dd>([\s\S]*?)<\/dd>/g
  let m
  while ((m = blockRe.exec(html)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3]
    const text = cleanText(raw)
    if (text && !isFooterText(text)) out.push(text)
  }
}

function isFooterText(text) {
  return (
    /Public domain|false false|Creative Commons|Wikisource/i.test(text) ||
    /此作品在全世界都属于\s*公有领域/.test(text)
  )
}

function stableUuid(seed) {
  const hex = createHash('sha1').update(seed, 'utf8').digest('hex')
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`
}

function loadExistingIds() {
  const chapterIds = new Map()
  const paragraphIds = new Map()
  if (!existsSync(DEST)) return { chapterIds, paragraphIds }
  const existing = JSON.parse(readFileSync(DEST, 'utf8'))
  for (const chapter of existing.chapters ?? []) {
    if (chapter?.title && chapter?.id) chapterIds.set(chapter.title, chapter.id)
    for (const paragraph of chapter.paragraphs ?? []) {
      if (!paragraph?.id || typeof paragraph.text !== 'string') continue
      const key = `${chapter.title}\0${paragraph.text}`
      const bucket = paragraphIds.get(key) ?? []
      bucket.push(paragraph.id)
      paragraphIds.set(key, bucket)
    }
  }
  return { chapterIds, paragraphIds }
}

function takeExistingParagraphId(ids, chapterTitle, text) {
  const key = `${chapterTitle}\0${text}`
  const bucket = ids.paragraphIds.get(key)
  if (!bucket || bucket.length === 0) return null
  return bucket.shift()
}

// ---- self-check anchors ---------------------------------------------------
const ANCHORS = [
  // [chapterIndex (0-based), paragraphIndex (0-based), expected substring]
  [0, 0, '问曰'], // 辨脉法第一 opens with a 问曰
  [4, 0, '太阳之为病，脉浮，头项强痛而恶寒'], // 第五篇首条 = 提纲
]

function assertAnchors(chapters) {
  for (const [ci, pi, sub] of ANCHORS) {
    const ch = chapters[ci]
    if (!ch) throw new Error(`anchor fail: chapter ${ci} missing`)
    const p = ch.paragraphs[pi]
    if (!p || !p.includes(sub)) {
      throw new Error(
        `anchor fail: chapters[${ci}].paragraphs[${pi}] = ${JSON.stringify(p)} (want substring "${sub}")`,
      )
    }
  }
}

async function main() {
  console.log('fetching simplified HTML from Wikisource...')
  const html = await fetchHtml()
  console.log(`  got ${html.length} bytes`)

  const chapters = parse(html)
  console.log(`  parsed ${chapters.length} chapters`)

  if (chapters.length !== 22) {
    throw new Error(`expected 22 chapters, got ${chapters.length}`)
  }
  for (const ch of chapters) {
    if (ch.paragraphs.length === 0) {
      throw new Error(`chapter "${ch.title}" has 0 paragraphs`)
    }
  }
  assertAnchors(chapters)
  const existingIds = loadExistingIds()

  // Assemble the builtin-content JSON.
  let paragraphCount = 0
  const out = {
    book: {
      id: 'shanghanlun',
      title: '伤寒论',
      author: '张仲景',
      category: '伤寒论',
      cover: 'shanghanlun.jpg',
    },
    quality: { chapterCount: 0, paragraphCount: 0 },
    chapters: chapters.map((ch, orderIndex) => {
      const paragraphs = ch.paragraphs.map((text, pIdx) => ({
        id:
          takeExistingParagraphId(existingIds, ch.title, text) ??
          stableUuid(`shanghanlun:paragraph:${ch.title}:${pIdx}:${text}`),
        orderIndex: pIdx,
        text,
      }))
      paragraphCount += paragraphs.length
      return {
        id:
          existingIds.chapterIds.get(ch.title) ??
          stableUuid(`shanghanlun:chapter:${ch.title}`),
        parentId: null,
        orderIndex,
        level: '篇',
        title: ch.title,
        paragraphs,
      }
    }),
  }
  out.quality.chapterCount = out.chapters.length
  out.quality.paragraphCount = paragraphCount

  writeFileSync(DEST, JSON.stringify(out, null, 2) + '\n', 'utf8')

  console.log(`\nwrote ${DEST.pathname}`)
  console.log(`  chapters: ${out.quality.chapterCount}`)
  console.log(`  paragraphs: ${out.quality.paragraphCount}`)
  console.log('\nchapter titles:')
  out.chapters.forEach((c, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${c.title} (${c.paragraphs.length} paras)`),
  )
  console.log('\nanchors OK:', ANCHORS.length, 'verified')
}

main().catch((err) => {
  console.error('\n✗ FAILED — not writing file:', err.message)
  process.exit(1)
})
