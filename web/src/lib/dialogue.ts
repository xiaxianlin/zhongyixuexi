export interface Dialogue {
  question: string
  answer: string
}

/**
 * 《难经》体例:段落原文是"曰：...\n然：..."的一问一答（这是原文本身的结构,
 * 不是渲染层编造的)。只对匹配该模式的段落生效——《伤寒论》等非问答体经典的
 * 段落不会匹配,按普通段落原样渲染,不强行拆分。
 */
export function splitDialogue(text: string): Dialogue | null {
  const match = /^曰[:：]([\s\S]*?)\n然[:：]([\s\S]*)$/.exec(text.trim())
  if (!match) return null
  const question = match[1]?.trim()
  const answer = match[2]?.trim()
  if (!question || !answer) return null
  return { question, answer }
}
