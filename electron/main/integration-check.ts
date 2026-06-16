/**
 * Dev-only end-to-end check (Phase 1 exit verification). Triggered by
 * ZYXX_INTEGRATION=1 env var in main: imports a fixture EPUB, then asserts the
 * import → list → chapter-tree → FTS → cascade-delete chain. Runs against the
 * real userData app.db. Pre-cleans any leftover test books and always deletes
 * the one it imports (try/finally) so a failed assertion can't orphan data.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { importEpubFile } from '../services/import'
import { listBooks, getChapterTree, deleteBook } from '../services/library'
import { getChapterParagraphs, updateParagraphText, splitParagraph } from '../services/segment'
import { getDb } from '../db'

const TEST_TITLE_PREFIX = '神农本草经'
const FTS_QUERY = '久服轻身延年'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[integration] FAIL: ${msg}`)
}

function ftsMatchCount(): number {
  const row = getDb()
    .prepare('SELECT count(*) AS c FROM fts_paragraphs WHERE fts_paragraphs MATCH ?')
    .get(FTS_QUERY) as { c: number }
  return row.c
}

export async function runIntegrationCheck(): Promise<void> {
  const fixture = join(app.getAppPath(), 'fixtures', 'sample.epub')
  assert(existsSync(fixture), `fixture missing: ${fixture}`)

  // remove leftover test books from prior (possibly failed) runs
  for (const b of listBooks().filter((x) => x.title.startsWith(TEST_TITLE_PREFIX))) {
    deleteBook(b.id)
  }
  assert(ftsMatchCount() === 0, `fts not clean before import: ${ftsMatchCount()}`)

  const res = await importEpubFile(fixture)
  try {
    assert(res.chapterCount === 2, `expected 2 chapters, got ${res.chapterCount}`)
    assert(res.paragraphCount >= 3, `expected >=3 paragraphs, got ${res.paragraphCount}`)
    console.log('[integration] import ok:', JSON.stringify(res))

    const book = listBooks().find((b) => b.id === res.bookId)
    assert(!!book, 'imported book not in list')
    assert(book!.chapter_count === 2, `list chapter_count=${book!.chapter_count}`)

    const tree = getChapterTree(res.bookId)
    assert(tree.length === 2, `tree roots=${tree.length}`)
    assert(tree[0].title === '上品', `tree[0]=${tree[0].title}`)

    const matched = ftsMatchCount()
    assert(matched >= 1, `fts match returned ${matched}`)
    console.log('[integration] fts ok: matched', matched, 'paragraph(s)')

    // IMP-03 segment editing: editing a paragraph must keep FTS in sync (au trigger)
    const firstChapterId = tree[0].id
    const paras = getChapterParagraphs(firstChapterId)
    assert(paras.length >= 1, 'first chapter has no paragraphs')
    const MARKER = '独一无二的校对测试标记'
    updateParagraphText(paras[0].id, `${paras[0].text}${MARKER}`)
    const marked = getDb()
      .prepare('SELECT count(*) AS c FROM fts_paragraphs WHERE fts_paragraphs MATCH ?')
      .get(MARKER) as { c: number }
    assert(marked.c === 1, `segment edit did not reindex FTS (got ${marked.c})`)
    splitParagraph(paras[0].id, 4)
    assert(
      getChapterParagraphs(firstChapterId).length >= paras.length,
      'split shrank paragraph count',
    )
    console.log('[integration] segment edit/split ok: FTS reindexed via trigger')
  } finally {
    // always clean up the imported book, even if an assertion threw
    deleteBook(res.bookId)
  }

  const after = listBooks().filter((b) => b.id === res.bookId)
  assert(after.length === 0, 'book still present after delete')

  assert(ftsMatchCount() === 0, `fts rows survived delete: ${ftsMatchCount()}`)

  console.log('[integration] PASS — import / list / tree / fts / delete verified')
}
