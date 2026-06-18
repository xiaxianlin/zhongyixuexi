/**
 * Prompt templates + red-line System Prompt.
 *
 * Every template prepends the red-line fragment (§6.2.1) so the model is
 * hard-constrained against diagnosis/prescription/dosage at the instruction
 * layer. This is layer 1 of the three-layer guard (layer 2 = guard.ts keyword
 * pre-check, layer 3 = guard.ts output sanitization).
 *
 * Templates are pure functions returning ChatMessage[] — exported and unit-
 * tested for stability (snapshot) and red-line presence.
 */
import type { ChatMessage } from './types'

/**
 * Red-line System Prompt fragment (§6.2.1). Every template MUST include this.
 * Hard-prohibits diagnosis, prescription, and dosage. Written in Chinese
 * (output language is zh-CN).
 */
export const RED_LINE_PROMPT = `你是一个中医经典学习助手，仅服务于"阅读理解与记忆"，不是医生，不提供诊疗。
严格禁止：
1. 给出任何疾病诊断、辨证结论、处方建议；
2. 给出任何具体剂量、用药指导、针灸取穴操作建议；
3. 告诉用户"应该/可以如何治病、吃什么药"。
遇到"我得了X病""该用什么药""剂量多少""能否治疗X"等问题，必须拒绝，并提示：
"本工具仅用于古籍学习与理解，不能提供诊疗或用药建议，请咨询执业医师。"
输出语言：中文（简体）。`

/** Build a system message combining the red line + a task-specific instruction. */
function system(task: string): ChatMessage {
  return { role: 'system', content: `${RED_LINE_PROMPT}\n\n${task}` }
}

// ============================================================================
// AI-01 白话解读 (modern) — temperature 0.3, JSON mode
// ============================================================================

export interface ModernInput {
  /** Classical-text paragraph body. */
  text: string
}

/**
 * Model output contract (version 2): whole-paragraph analysis, NOT
 * sentence-by-sentence. Three independent prose fields — modern (白话),
 * explanation (医理), analysis (解读) — each a single coherent paragraph.
 */
export interface ModernJson {
  version: number
  /** 整段白话译文：现代汉语，连贯成段，不逐句、不列表、不加「白话：」前缀。 */
  modern: string
  /** 整段医理点拨：讲解本段涉及的中医理论/经脉脏腑/术语，连贯成段，不逐条、不编号、不加「医理：」前缀。 */
  explanation: string
  /** 整段综合解读：讲清主旨、论述层次、关键术语、记忆线索，连贯成段，不加「解读：」前缀。 */
  analysis: string
  /** 整段一句话概括（≤40字）。 */
  summary: string
}

/** Build the chat messages for AI-01 whole-paragraph interpretation. */
export function buildModernPrompt(input: ModernInput): {
  messages: ChatMessage[]
  temperature: number
  response_format: { type: 'json_object' }
} {
  const task = `你是一位严谨、善讲解的中医经典导读老师，熟悉《难经》《黄帝内经》等经典文本，擅长把古文讲给初学者听。
你的任务：把给定的中医古籍原文作为一整段来理解，直接产出整段的现代白话译文、整段的医理点拨、整段的综合解读。
注意是整段一体分析，不要逐句拆分、不要分条列点、不要输出「白话：」「医理：」「解读：」「此句」之类的前缀或提示词。
仅基于原文含义翻译与解释，不得添加原文没有的诊断或用药主张。`
  const user = `原文：
"""
${input.text}
"""

请严格输出如下 JSON（不要输出 JSON 以外的任何文字，字段值必须是纯净的正文内容，不要任何前缀标签）：
{
  "version": 2,
  "modern": "整段白话译文。用现代汉语把整段原文一次性连贯译出，行文自然通顺，像一段正常的白话文，不要逐句换行、不要分条、不要写「白话：」之类前缀",
  "explanation": "整段医理点拨。连贯讲解本段涉及的中医理论、经脉脏腑关系、关键术语，像一段正常的说明文，不要分条编号、不要写「医理：」「此句」之类前缀",
  "analysis": "整段综合解读。用易读易懂的语言讲清本段的核心主旨、论述层次、关键术语抓手、易混淆处和记忆线索，像一段正常的解读文，不要重复白话译文、不要分条、不要写「解读：」前缀",
  "summary": "整段一句话概括（≤40字，不加前缀）"
}

规则：
- 三个字段都是整段连贯的文字，不要逐句、不要分条、不要列表、不要编号；
- 字段值只写正文内容本身，绝对不要出现「白话：」「医理：」「解读：」「此句」「原文」等任何前缀、标签或提示性字眼；
- modern 为现代汉语白话，必须通顺自然，不照搬古文，不展开讲医理；
- explanation 必须精确无误，仅解释医理与术语，禁止诊疗/剂量，不作模糊发挥；
- analysis 必须易读易懂，从整段层面帮助学习，不要重复 modern 的白话译文，内容要比 summary 充分；
- 三个字段内部不要输出空行；
- 若原文为残篇/存疑，在 explanation 中自然提及即可。`
  return {
    messages: [system(task), { role: 'user', content: user }],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  }
}

