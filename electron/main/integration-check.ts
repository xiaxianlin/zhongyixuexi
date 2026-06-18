/**
 * Dev-only end-to-end check. Triggered by ZYXX_INTEGRATION=1 env var in main.
 *
 * The app ships built-in content, so this check inserts a small transient book
 * directly and verifies the list → tree → FTS → search → cascade-delete chain.
 */
import { randomUUID } from 'node:crypto'
import { listBooks, getChapterTree } from '../services/library'
import { searchParagraphs } from '../services/search'
import { getChapter } from '../services/reading'
import { createNote, deleteNote, getNotesByParagraph } from '../services/notes'
import { getDashboard } from '../services/learning'
import { getActiveApiKey } from '../services/settings'
import { deepseek } from '../ai/deepseek'
import { getDb } from '../db'

const TEST_TITLE = '神农本草经（集成测试）'
const FTS_QUERY = '久服轻身延年'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[integration] FAIL: ${msg}`)
}

function ftsMatchCount(term: string = FTS_QUERY): number {
  const row = getDb()
    .prepare('SELECT count(*) AS c FROM fts_paragraphs WHERE fts_paragraphs MATCH ?')
    .get(term) as { c: number }
  return row.c
}

/** Insert a minimal test book (2 chapters, 3 paragraphs) directly, bypassing AI. */
function insertTestBook(): string {
  const db = getDb()
  const bookId = randomUUID()
  const ch1 = randomUUID()
  const ch2 = randomUUID()
  const now = Date.now()
  const insP = db.prepare(
    `INSERT INTO paragraphs
       (id, chapter_id, order_index, text, edited, parse_hash, is_noise,
        quality_flag, created_at, deleted_at)
     VALUES (?, ?, ?, ?, 0, NULL, 0, 'ok', ?, NULL)`,
  )
  db.transaction(() => {
    db.prepare(
      `INSERT INTO books (id, title, author, cover, category, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL, NULL, ?, NULL)`,
    ).run(bookId, TEST_TITLE, '佚名', now)
    db.prepare(
      `INSERT INTO chapters (id, book_id, parent_id, order_index, level, title, content_hash, created_at, deleted_at)
       VALUES (?, ?, NULL, 0, NULL, '上品', NULL, ?, NULL)`,
    ).run(ch1, bookId, now)
    db.prepare(
      `INSERT INTO chapters (id, book_id, parent_id, order_index, level, title, content_hash, created_at, deleted_at)
       VALUES (?, ?, NULL, 1, NULL, '中品', NULL, ?, NULL)`,
    ).run(ch2, bookId, now)
    insP.run(randomUUID(), ch1, 0, '人参，味甘微寒。主补五脏，安精神，定魂魄。', now)
    insP.run(randomUUID(), ch1, 1, '久服轻身延年。一名人衔。', now)
    insP.run(randomUUID(), ch2, 0, '甘草，味甘平。主五脏六腑寒热邪气。', now)
  })()
  // The ai trigger fires on INSERT and indexes paragraphs into FTS; rebuild as a safety net.
  db.exec("INSERT INTO fts_paragraphs(fts_paragraphs) VALUES('rebuild')")
  return bookId
}

function deleteTestBook(bookId: string): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM books WHERE id = ?').run(bookId)
    db.exec("INSERT INTO fts_paragraphs(fts_paragraphs) VALUES('rebuild')")
  })()
}

export async function runIntegrationCheck(): Promise<void> {
  const aiDebug = process.env.ZYXX_AI_DEBUG
  if (aiDebug === 'short') {
    await runAiDebug()
    return
  }

  const builtinBooks = listBooks()
  assert(builtinBooks.length >= 3, `builtin books missing: ${builtinBooks.length}`)
  assert(
    builtinBooks.some((book) => book.title === '难经' && book.chapter_count === 81),
    'builtin 难经 missing or invalid',
  )
  assert(
    builtinBooks.some((book) => book.title === '素问' && book.chapter_count === 79),
    'builtin 素问 missing or invalid',
  )
  assert(
    builtinBooks.some((book) => book.title === '灵枢' && book.chapter_count === 81),
    'builtin 灵枢 missing or invalid',
  )
  console.log('[integration] builtin ok:', builtinBooks.map((book) => book.title).join(', '))

  // pre-clean leftover test books
  for (const b of listBooks().filter((x) => x.title === TEST_TITLE)) {
    deleteTestBook(b.id)
  }
  assert(ftsMatchCount() === 0, `fts not clean before insert: ${ftsMatchCount()}`)

  const bookId = insertTestBook()
  try {
    const book = listBooks().find((b) => b.id === bookId)
    assert(!!book, 'inserted book not in list')
    assert(book!.chapter_count === 2, `chapter_count=${book!.chapter_count}`)
    console.log('[integration] insert ok:', bookId)

    const tree = getChapterTree(bookId)
    assert(tree.length === 2, `tree roots=${tree.length}`)
    assert(tree[0].title === '上品', `tree[0]=${tree[0].title}`)

    const chapterContent = getChapter(bookId, tree[0].id)
    assert(!!chapterContent, 'reading chapter returned null')
    assert(chapterContent!.paragraphs.length === 2, `chapter paragraphs=${chapterContent!.paragraphs.length}`)
    const paragraphId = chapterContent!.paragraphs[0]!.id
    console.log('[integration] reading ok:', chapterContent!.paragraphs.length, 'paragraphs')

    const matched = ftsMatchCount()
    assert(matched >= 1, `fts match returned ${matched}`)
    console.log('[integration] fts ok: matched', matched, 'paragraph(s)')

    // SRH search
    const sr = searchParagraphs(FTS_QUERY)
    assert(sr.hits.length >= 1, `search returned ${sr.hits.length} hits`)
    assert(!sr.degraded, 'search unexpectedly degraded')
    console.log('[integration] search ok:', sr.hits.length, 'hits, total', sr.total)

    const note = createNote({ paragraph_id: paragraphId, content: '测试笔记：甘温补虚。' })
    let notes = getNotesByParagraph(paragraphId)
    assert(notes.length === 1, `note count after create=${notes.length}`)
    assert(notes[0]!.content === note.content, 'created note content mismatch')
    deleteNote(note.id)
    notes = getNotesByParagraph(paragraphId)
    assert(notes.length === 0, `note count after delete=${notes.length}`)
    console.log('[integration] notes ok: create / list / delete')

    const dashboard = getDashboard()
    assert(dashboard.totalBooks >= 3, `dashboard totalBooks=${dashboard.totalBooks}`)
    assert(dashboard.totalChapters >= 240, `dashboard totalChapters=${dashboard.totalChapters}`)
    assert(dashboard.totalParagraphs >= 1000, `dashboard totalParagraphs=${dashboard.totalParagraphs}`)
    console.log('[integration] dashboard ok:', {
      books: dashboard.totalBooks,
      chapters: dashboard.totalChapters,
      paragraphs: dashboard.totalParagraphs,
    })
  } finally {
    deleteTestBook(bookId)
  }

  assert(listBooks().filter((b) => b.id === bookId).length === 0, 'book still present after delete')
  assert(ftsMatchCount() === 0, `fts rows survived delete: ${ftsMatchCount()}`)

  console.log('[integration] PASS — insert / list / tree / reading / fts / search / notes / dashboard / delete verified')
}

async function runAiDebug(): Promise<void> {
  const cfg = getActiveApiKey()
  if (!cfg) throw new Error('[ai-debug] no active provider')
  console.log(
    `[ai-debug] provider=${cfg.provider} baseUrl=${cfg.baseUrl} model=${cfg.model} mode=short`,
  )

  const started = Date.now()
  const req = {
    model: cfg.model,
    messages: [
      { role: 'system' as const, content: '你只输出 JSON。' },
      { role: 'user' as const, content: '输出 {"ok":true,"name":"难经"}' },
    ],
    temperature: 0,
    max_tokens: 1024,
    response_format: { type: 'json_object' as const },
    stream: false as const,
  }

  const chatResp = await deepseek.chat(req, cfg, { timeoutMs: 10 * 60_000 })
  const raw = chatResp.choices[0]?.message?.content ?? ''
  const finish = chatResp.choices[0]?.finish_reason
  const usage = chatResp.usage
  console.log(
    `[ai-debug] ok elapsedMs=${Date.now() - started} finish=${finish} chars=${raw.length} usage=${JSON.stringify(usage)}`,
  )
  try {
    const parsed = JSON.parse(raw) as unknown
    console.log(
      `[ai-debug] json ok keys=${Object.keys((parsed as Record<string, unknown>) ?? {}).join(',')}`,
    )
  } catch (e) {
    console.log(`[ai-debug] json failed: ${(e as Error).message}`)
    console.log(`[ai-debug] head=${raw.slice(0, 200).replace(/\s+/g, ' ')}`)
    console.log(`[ai-debug] tail=${raw.slice(-200).replace(/\s+/g, ' ')}`)
  }
}
