import type { ChatMessage } from './types'
import { RED_LINE_PROMPT } from '../../../shared/core/ai/red-line'

export { RED_LINE_PROMPT }

const QA_TASK = `你的任务是基于给定的中医经典原文片段回答用户的学习性提问：解释字词含义、讲解医理、辨析术语、指出原文出处与上下文关联。
只依据"参考原文"作答；若参考原文不足以回答，坦诚说明"现有原文片段未直接涉及"，不要编造原文没有的内容。
回答用自然连贯的中文，不要分条列点，不要输出"答："之类前缀。`

/** Builds the message array for one AI-05 turn: system + prior turns + this turn's question with retrieved context. */
export function buildQaPrompt(
  history: ChatMessage[],
  contextParagraphs: string[],
  question: string,
): { messages: ChatMessage[]; temperature: number } {
  const system: ChatMessage = { role: 'system', content: `${RED_LINE_PROMPT}\n\n${QA_TASK}` }
  const context = contextParagraphs.length
    ? contextParagraphs.map((t, i) => `[${i + 1}] ${t}`).join('\n')
    : '（未检索到直接相关的原文片段）'
  const user: ChatMessage = {
    role: 'user',
    content: `参考原文：\n${context}\n\n问题：${question}`,
  }
  return { messages: [system, ...history, user], temperature: 0.5 }
}
