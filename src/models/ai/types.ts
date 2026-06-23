/**
 * AI domain renderer DTOs + degraded-state mapping (mirror of
 * electron/services/ai.ts DTOs and electron/ai/errors.ts). Dependency-free.
 *
 * D4 exposes chapter-level analysis generation (chapters:analyze). Chat lands
 * in D5; for now only status + chapter analysis are exposed.
 */

import type { ChapterAnalysisView } from '@/models/library/types'

export interface AiStatusDTO {
  configured: boolean
  provider: string | null
  model: string | null
}

/** Result of chapters:analyze — the refreshed active analysis view. */
export interface ChapterAnalysisResultDTO {
  chapterId: string
  fromCache: boolean
  analysis: ChapterAnalysisView
}

// ---------- D5: chapter-scoped chat ----------

export interface AiThreadDTO {
  id: string
  book_id: string
  chapter_id: string
  title: string | null
  created_at: number
  updated_at: number
}

export interface AiMessageDTO {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  quote_text: string | null
  quote_start: number | null
  quote_end: number | null
  model: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  created_at: number
}

export interface SendChatResult {
  userMessage: AiMessageDTO
  assistantMessage: AiMessageDTO
}

/** AI error sub-code, mirrored from electron/ai/errors.ts AiSubCode. */
export type AiSubCode =
  | 'AI_KEY_NOT_CONFIGURED'
  | 'AI_STORAGE_UNAVAILABLE'
  | 'AI_AUTH_ERROR'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_TIMEOUT'
  | 'AI_SERVER_ERROR'
  | 'AI_REQUEST_FAILED'
  | 'AI_PARSE_ERROR'
  | 'AI_GUARD_BLOCKED'
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_ABORTED'
  | 'AI_UNKNOWN'

/** User-facing degraded-state reason derived from an AI sub-code. */
export type DegradedReason =
  | 'key_missing'
  | 'auth_or_quota'
  | 'network'
  | 'parse'
  | 'guard'
  | 'unknown'

/** Map a fine-grained AI sub-code to a degraded-state reason for the UI. */
export function toDegradedReason(sub: AiSubCode): DegradedReason {
  switch (sub) {
    case 'AI_KEY_NOT_CONFIGURED':
    case 'AI_STORAGE_UNAVAILABLE':
    case 'AI_PROVIDER_NOT_CONFIGURED':
      return 'key_missing'
    case 'AI_AUTH_ERROR':
    case 'AI_QUOTA_EXCEEDED':
      return 'auth_or_quota'
    case 'AI_TIMEOUT':
    case 'AI_SERVER_ERROR':
    case 'AI_REQUEST_FAILED':
      return 'network'
    case 'AI_PARSE_ERROR':
      return 'parse'
    case 'AI_GUARD_BLOCKED':
      return 'guard'
    default:
      return 'unknown'
  }
}

/** User-facing copy for each degraded reason (zh-CN). */
export const DEGRADED_COPY: Record<DegradedReason, { title: string; hint: string }> = {
  key_missing: {
    title: 'AI 功能未启用',
    hint: '请在「设置 → AI 服务」中配置 API Key 后使用 AI 解读与问答。',
  },
  auth_or_quota: {
    title: 'AI 鉴权或额度异常',
    hint: '请检查 API Key 是否正确、厂商是否匹配，或账户余额是否充足。',
  },
  network: {
    title: 'AI 服务暂时不可用',
    hint: '网络连接异常或 AI 服务繁忙，已切换本地模式，阅读/学习不受影响。',
  },
  parse: {
    title: 'AI 输出解析失败',
    hint: '模型返回格式异常，请稍后重试或重新生成。',
  },
  guard: {
    title: '该问题已依合规要求拦截',
    hint: '本工具仅用于古籍学习，不提供诊疗或用药建议。',
  },
  unknown: {
    title: 'AI 调用失败',
    hint: '发生未知错误，已切换本地模式。',
  },
}
