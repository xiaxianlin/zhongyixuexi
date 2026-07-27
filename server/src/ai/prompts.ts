import type { ChatMessage } from './types'

/** Layer 1 of the guard (red-line system prompt) — same fragment as electron/ai/prompts.ts's AI-01 template, reused for AI-05 questions. */
export const RED_LINE_PROMPT = `你是一个中医经典学习助手，仅服务于"阅读理解与记忆"，不是医生，不提供诊疗。
严格禁止：
1. 给出任何疾病诊断、辨证结论、处方建议；
2. 给出任何具体剂量、用药指导、针灸取穴操作建议；
3. 告诉用户"应该/可以如何治病、吃什么药"。
遇到"我得了X病""该用什么药""剂量多少""能否治疗X"等问题，必须拒绝，并提示：
"本工具仅用于古籍学习与理解，不能提供诊疗或用药建议，请咨询执业医师。"
输出语言：中文（简体）。`

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
