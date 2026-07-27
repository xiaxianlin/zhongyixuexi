export interface ChapterRow {
  id: string
  bookId: string
  parentId: string | null
  orderIndex: number
  level: string | null
  title: string
}

export interface ChapterNode extends ChapterRow {
  children: ChapterNode[]
}

/**
 * Nests flat chapter rows (self-referencing parent_id) into a tree, siblings
 * sorted by order_index — an in-memory build, same shape as the old
 * `library:tree` IPC handler, just running against Postgres rows instead of
 * SQLite ones.
 */
export function buildChapterTree(chapters: ChapterRow[]): ChapterNode[] {
  const nodesById = new Map<string, ChapterNode>()
  for (const chapter of chapters) {
    nodesById.set(chapter.id, { ...chapter, children: [] })
  }

  const roots: ChapterNode[] = []
  for (const chapter of chapters) {
    const node = nodesById.get(chapter.id)
    if (!node) continue
    const parent = chapter.parentId ? nodesById.get(chapter.parentId) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortByOrder = (nodes: ChapterNode[]): void => {
    nodes.sort((a, b) => a.orderIndex - b.orderIndex)
    for (const node of nodes) sortByOrder(node.children)
  }
  sortByOrder(roots)

  return roots
}
