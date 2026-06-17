/**
 * Dev-only end-to-end check. Triggered by ZYXX_INTEGRATION=1 env var in main.
 *
 * The app ships built-in content, so this check inserts a small transient book
 * directly and verifies the list → tree → FTS → search → cascade-delete chain.
 */
import { randomUUID } from 'node:crypto'
import { listBooks, getChapterTree } from '../services/library'
import { searchParagraphs } from '../services/search'
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
      `INSERT INTO books (id, title, author, source_format, source_file, cover, category,
                          imported_at, parse_version, updated_at, deleted_at)
       VALUES (?, ?, ?, 'manual', 'manual', NULL, NULL, ?, 1, ?, NULL)`,
    ).run(bookId, TEST_TITLE, '佚名', now, now)
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

    const matched = ftsMatchCount()
    assert(matched >= 1, `fts match returned ${matched}`)
    console.log('[integration] fts ok: matched', matched, 'paragraph(s)')

    // SRH search
    const sr = searchParagraphs(FTS_QUERY)
    assert(sr.hits.length >= 1, `search returned ${sr.hits.length} hits`)
    assert(!sr.degraded, 'search unexpectedly degraded')
    console.log('[integration] search ok:', sr.hits.length, 'hits, total', sr.total)
  } finally {
    deleteTestBook(bookId)
  }

  assert(listBooks().filter((b) => b.id === bookId).length === 0, 'book still present after delete')
  assert(ftsMatchCount() === 0, `fts rows survived delete: ${ftsMatchCount()}`)

  console.log('[integration] PASS — insert / list / tree / fts / search / delete verified')
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
