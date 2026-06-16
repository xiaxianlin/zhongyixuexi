import { useEffect, useState } from 'react'
import { libraryApi } from '@/lib/ipc'
import type { ChapterNode } from '@/lib/types'

function Tree({
  nodes,
  depth = 0,
  onSelect,
}: {
  nodes: ChapterNode[]
  depth?: number
  onSelect?: (id: string) => void
}) {
  return (
    <ul className="tree" style={{ marginLeft: depth * 16 }}>
      {nodes.map((n) => (
        <li key={n.id}>
          <span
            className="tree__node"
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
            onClick={() => onSelect?.(n.id)}
          >
            {n.title}
          </span>
          {n.children.length > 0 && <Tree nodes={n.children} depth={depth + 1} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  )
}

export function ChapterTree({
  bookId,
  onSelect,
}: {
  bookId: string
  onSelect?: (id: string) => void
}) {
  const [tree, setTree] = useState<ChapterNode[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    libraryApi
      .tree(bookId)
      .then((t) => {
        if (alive) {
          setTree(t)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [bookId])

  if (loading) return <p className="lib__progress">加载目录…</p>
  if (tree.length === 0) return <p className="lib__empty">无章节。</p>
  return <Tree nodes={tree} onSelect={onSelect} />
}
