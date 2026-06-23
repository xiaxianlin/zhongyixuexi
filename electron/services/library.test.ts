import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildChapterTree, type ChapterRow } from './library'

const row = (
  id: string,
  title: string,
  parent_id: string | null,
  order_index: number,
  level: string | null = null,
): ChapterRow => ({ id, title, parent_id, order_index, level })

describe('buildChapterTree', () => {
  it('returns an empty array for no rows', () => {
    expect(buildChapterTree([])).toEqual([])
  })

  it('treats parent_id=null rows as roots, ordered by order_index', () => {
    const rows = [
      row('b', '中品', null, 2),
      row('a', '上品', null, 1),
    ]
    const tree = buildChapterTree(rows)
    expect(tree.map((n) => n.id)).toEqual(['a', 'b'])
    expect(tree[0]).toMatchObject({ id: 'a', title: '上品', order_index: 1, children: [] })
  })

  it('assembles a 3-level nested tree (卷 → 品 → 篇)', () => {
    // 卷一 (root)
    //   ├─ 品·上 (child)
    //   │    └─ 篇·人参 (grandchild)
    //   └─ 品·中 (child)
    // 卷二 (root)
    const rows = [
      row('vol1', '卷一', null, 1, '卷'),
      row('pin_s', '品·上', 'vol1', 1, '品'),
      row('renshen', '篇·人参', 'pin_s', 1, '篇'),
      row('pin_z', '品·中', 'vol1', 2, '品'),
      row('vol2', '卷二', null, 2, '卷'),
    ]
    const tree = buildChapterTree(rows)

    expect(tree.map((n) => n.id)).toEqual(['vol1', 'vol2'])

    const vol1 = tree[0]!
    expect(vol1.title).toBe('卷一')
    expect(vol1.level).toBe('卷')
    expect(vol1.children.map((c) => c.id)).toEqual(['pin_s', 'pin_z'])

    const pinS = vol1.children[0]!
    expect(pinS.children.map((c) => c.id)).toEqual(['renshen'])
    expect(pinS.children[0]!.title).toBe('篇·人参')

    // deep leaf has empty children
    expect(pinS.children[0]!.children).toEqual([])
  })

  it('keeps sibling order by order_index within a parent', () => {
    const rows = [
      row('root', '卷', null, 1),
      row('c3', '三', 'root', 30),
      row('c1', '一', 'root', 10),
      row('c2', '二', 'root', 20),
    ]
    const tree = buildChapterTree(rows)
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('treats an orphan (parent_id points to a non-existent id) as a root', () => {
    // 'ghost' references parent 'missing' which is absent from the set.
    const rows = [
      row('root', '卷一', null, 1),
      row('ghost', '孤儿', 'missing', 2),
    ]
    const tree = buildChapterTree(rows)
    // both surface at root level; orphan is not dropped
    expect(tree.map((n) => n.id)).toEqual(['root', 'ghost'])
    expect(tree[1]!.children).toEqual([])
  })

  it('does not mutate the input rows', () => {
    const rows = [row('a', 'A', null, 1)]
    const snapshot = JSON.parse(JSON.stringify(rows))
    buildChapterTree(rows)
    expect(rows).toEqual(snapshot)
  })

  it('preserves level metadata on nodes', () => {
    const rows = [row('a', '卷一', null, 1, '卷')]
    const [node] = buildChapterTree(rows)
    expect(node!.level).toBe('卷')
  })
})

describe('getChapterTree analyzed subquery (D2)', () => {
  // better-sqlite3 ABI is Electron's, not Node/Vitest's, so we cannot spin up a
  // real DB here. Static-analyze the SQL source (same approach as fts.test.ts)
  // to lock the v3.1 contract: `analyzed` counts BOTH paragraph-level and
  // chapter-level active analyses.
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(join(__dirname, 'library.ts'), 'utf8')

  it('queries paragraph_analyses (legacy) for the analyzed flag', () => {
    expect(source).toContain('FROM paragraph_analyses pa')
    expect(source).toContain('JOIN paragraphs p ON p.id = pa.paragraph_id')
    expect(source).toContain('pa.is_active = 1')
  })

  it('also queries chapter_analyses (v3.1) so chapter-level analysis lights the dot', () => {
    expect(source).toContain('FROM chapter_analyses ca')
    expect(source).toContain('ca.chapter_id = c.id')
    expect(source).toContain('ca.is_active = 1')
  })

  it('OR-combines the two EXISTS clauses', () => {
    expect(source).toMatch(/is_active = 1\s*\)\s*OR EXISTS/)
  })
})
