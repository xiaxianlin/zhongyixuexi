import { describe, it, expect } from 'vitest'
import { buildChapterTree, type ChapterRow } from './tree'

function chapter(overrides: Partial<ChapterRow> & Pick<ChapterRow, 'id'>): ChapterRow {
  return {
    bookId: 'book-1',
    parentId: null,
    orderIndex: 0,
    level: null,
    title: overrides.id,
    ...overrides,
  }
}

describe('buildChapterTree', () => {
  it('nests children under their parent', () => {
    const tree = buildChapterTree([
      chapter({ id: 'root', orderIndex: 0 }),
      chapter({ id: 'child-1', parentId: 'root', orderIndex: 0 }),
      chapter({ id: 'child-2', parentId: 'root', orderIndex: 1 }),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('root')
    expect(tree[0].children.map((c) => c.id)).toEqual(['child-1', 'child-2'])
  })

  it('sorts siblings by order_index regardless of input order', () => {
    const tree = buildChapterTree([
      chapter({ id: 'second', orderIndex: 1 }),
      chapter({ id: 'first', orderIndex: 0 }),
      chapter({ id: 'third', orderIndex: 2 }),
    ])
    expect(tree.map((c) => c.id)).toEqual(['first', 'second', 'third'])
  })

  it('sorts nested levels independently', () => {
    const tree = buildChapterTree([
      chapter({ id: 'root', orderIndex: 0 }),
      chapter({ id: 'child-b', parentId: 'root', orderIndex: 1 }),
      chapter({ id: 'child-a', parentId: 'root', orderIndex: 0 }),
      chapter({ id: 'grandchild-2', parentId: 'child-a', orderIndex: 1 }),
      chapter({ id: 'grandchild-1', parentId: 'child-a', orderIndex: 0 }),
    ])
    expect(tree[0].children.map((c) => c.id)).toEqual(['child-a', 'child-b'])
    expect(tree[0].children[0].children.map((c) => c.id)).toEqual(['grandchild-1', 'grandchild-2'])
  })

  it('treats a dangling parent_id (parent not in the set) as a root', () => {
    const tree = buildChapterTree([chapter({ id: 'orphan', parentId: 'missing-parent' })])
    expect(tree.map((c) => c.id)).toEqual(['orphan'])
  })

  it('returns an empty tree for no chapters', () => {
    expect(buildChapterTree([])).toEqual([])
  })
})
