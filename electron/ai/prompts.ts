/**
 * Prompt templates + red-line System Prompt (S5.3/S5.4/S5.6 / 07-ai.md §6.2).
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

export interface ModernSentence {
  original: string
  modern: string
  commentary: string
}
export interface ModernJson {
  version: number
  sentences: ModernSentence[]
  summary: string
}

/** Build the chat messages for AI-01 modern-language interpretation. */
export function buildModernPrompt(input: ModernInput): {
  messages: ChatMessage[]
  temperature: number
  response_format: { type: 'json_object' }
} {
  const task = `你的任务：把给定的中医古籍原文逐句翻译为白话，并给出医理点拨。
仅基于原文含义翻译与解释，不得添加原文没有的诊断或用药主张。`
  const user = `原文：
"""
${input.text}
"""

请严格输出如下 JSON（不要输出 JSON 以外的任何文字）：
{
  "version": 1,
  "sentences": [
    {
      "original": "原文单句（按句号/逗号切分，保持顺序）",
      "modern": "对应白话译文，通俗准确",
      "commentary": "医理点拨：解释该句的中医理论背景、关键术语含义（1-2句，不得给出剂量/处方）"
    }
  ],
  "summary": "整段一句话概括（≤40字）"
}

规则：
- sentences 数量与原文句数对应，顺序一致；
- modern 为现代汉语白话，不照搬古文；
- commentary 仅解释医理与术语，禁止诊疗/剂量；
- 若原文为残篇/存疑，commentary 标注"原文存疑"。`
  return {
    messages: [system(task), { role: 'user', content: user }],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  }
}

// ============================================================================
// AI-02 RAG 问答 (qa) — temperature 0.5, natural language + trailing JSON cites
// ============================================================================

export interface QaContext {
  /** 1-based index in the context block, matches the [n] citation convention. */
  n: number
  paragraphId: string
  bookTitle: string
  chapterTitle: string
  snippet: string
}

export interface QaInput {
  query: string
  contexts: QaContext[]
}

export interface QaCite {
  n: number
  paragraph_id: string
  snippet: string
}
export interface QaTrailingJson {
  cites: QaCite[]
}

/** Build the chat messages for AI-02 RAG question answering. */
export function buildQaPrompt(input: QaInput): {
  messages: ChatMessage[]
  temperature: number
} {
  const task = `你是一个基于"检索到的本书段落"回答问题的学习助手。
规则：
1. 仅依据下方【检索段落】作答，不得编造未给出的内容；
2. 每个事实陈述须标注来源序号，形如 [1]、[2]，对应检索段落编号；
3. 若检索段落不足以回答，回答"根据现有内容无法回答该问题"，不要臆测；
4. 严格遵守红线：不诊疗、不处方、不给剂量。`

  const block = input.contexts
    .map(
      (c) =>
        `[${c.n}] （《${c.bookTitle}》${c.chapterTitle}）${c.snippet}（paragraph_id=${c.paragraphId}）`,
    )
    .join('\n')

  const user = `【检索段落】
${block}

【问题】
${input.query}

请输出：
1. 先用 2-4 句自然语言回答（带 [n] 引用）；
2. 末尾另起一行，输出 JSON：{"cites":[{"n":1,"paragraph_id":"...","snippet":"..."}]}`

  return {
    messages: [system(task), { role: 'user', content: user }],
    temperature: 0.5,
  }
}

// ============================================================================
// AI-06 记忆卡批量生成 (cards) — temperature 0.4, JSON mode
// ============================================================================

export interface CardsInput {
  text: string
}

export interface CardDraftJson {
  front: string
  back: string
  tag: string
}
export interface CardsJson {
  cards: CardDraftJson[]
}

/** Build the chat messages for AI-06 card-draft generation. */
export function buildCardsPrompt(input: CardsInput): {
  messages: ChatMessage[]
  temperature: number
  response_format: { type: 'json_object' }
} {
  const task = `任务：从给定原文抽取要点，生成"问答型记忆卡"草稿，供学习者背诵复习。
卡片应为原文知识点的忠实提炼，不得添加剂量/处方类信息。`
  const user = `原文：
"""
${input.text}
"""

输出 JSON：
{
  "cards": [
    {
      "front": "问题/正面提示（如术语、原文上句）",
      "back": "答案/释义（对应原文要点，白话）",
      "tag": "术语|原文|功效|性味|其他"
    }
  ]
}
规则：每段生成 2-5 张卡；front 简洁；back 不超过 60 字；禁止诊疗/剂量。`
  return {
    messages: [system(task), { role: 'user', content: user }],
    temperature: 0.4,
    response_format: { type: 'json_object' },
  }
}

// ============================================================================
// AI-04 结构化标注 (annotation) — temperature 0.3, JSON mode (P2 stub)
// ============================================================================

export interface AnnotationInput {
  text: string
}

export interface AnnotationJson {
  keywords: { text: string; type: string }[]
  attributes: {
    entity: string
    nature?: string
    flavor?: string
    meridians?: string[]
    effects?: string[]
  }[]
}

export function buildAnnotationPrompt(input: AnnotationInput): {
  messages: ChatMessage[]
  temperature: number
  response_format: { type: 'json_object' }
} {
  const task = `任务：从给定中医古籍原文中抽取关键词/实体，并尝试标注性味/归经/功效属性（仅作学习参考，非权威）。`
  const user = `原文：
"""
${input.text}
"""

输出 JSON：
{
  "keywords": [{"text": "实体词", "type": "药味|方剂|病症|理论|其他"}],
  "attributes": [{"entity": "人参", "nature": "微寒", "flavor": "甘", "meridians": ["脾","肺"], "effects": ["补五脏","安精神"]}]
}`
  return {
    messages: [system(task), { role: 'user', content: user }],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  }
}

// ============================================================================
// IMP-AI 章节解析 — temperature 0.2, JSON mode
// ============================================================================

export interface ParseChapterInput {
  /** Chapter title from the EPUB TOC / spine. */
  title: string
  /** Chapter body as plain text (HTML stripped, whitespace normalized). */
  text: string
}

export interface ParseChapterJson {
  /** True = this chapter is actual book content (正文/篇章正文). */
  isContent: boolean
  /** Extracted content paragraphs in reading order. Empty when isContent=false. */
  paragraphs: string[]
}

/**
 * Build the chat messages for AI-driven chapter parsing (IMP-AI).
 *
 * The model judges whether a chapter is real content vs. front-matter/TOC/
 * copyright/ad/cover/navigation/acknowledgements, and if it IS content,
 * extracts clean body paragraphs (excluding headers/footers/page-numbers/
 * watermarks/repeated-lines/garbled/pure-punctuation/isolated-numbers).
 *
 * Low temperature (0.2) for deterministic, stable output.
 */
export function buildParseChapterPrompt(input: ParseChapterInput): {
  messages: ChatMessage[]
  temperature: number
  response_format: { type: 'json_object' }
} {
  const task = `你的任务：判断该章节是否为正文内容章节，并提取正文段落。

【判断 isContent】
- 正文 / 篇章正文 = true（包括序言/前言中与正文内容直接相关的部分）
- 以下情况 = false（非正文）：
  - 版权页 / 出版信息 / CIP 数据
  - 目录 / Table of Contents
  - 广告 / 宣传页
  - 封面 / 扉页
  - 纯导航 / 书签页
  - 致谢 / 作者简介 / 后记中非正文内容
  - 空章节 / 仅含封面图的章节

【提取正文段落（仅 isContent=true 时）】
排除以下内容（不纳入 paragraphs）：
- 页眉 / 页脚 / 页码
- 水印 / 版权声明 / 扫描标记
- 重复出现的行（跨段落重复 3 次以上的固定文字）
- 乱码 / 不可读字符
- 纯标点行 / 仅含标点符号
- 孤立数字行

按自然段切分正文，保持原始阅读顺序。每段为有意义的完整语义段落（非单句碎片）。`

  const user = `章节标题：${input.title}

章节正文：
"""
${input.text}
"""

请严格输出如下 JSON（不要输出 JSON 以外的任何文字）：
{
  "isContent": true,
  "paragraphs": ["第一段正文…", "第二段正文…", "..."]
}

当 isContent=false 时 paragraphs 为空数组：{"isContent": false, "paragraphs": []}`

  return {
    messages: [system(task), { role: 'user', content: user }],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  }
}
