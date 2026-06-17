/**
 * AI module renderer-side DTOs (mirror of electron/services/ai.ts DTOs).
 * Kept in the AI module's own types file — NOT in src/lib/types.ts (which this
 * module does not own). The ipc.ts wrapper passes these through opaquely; we
 * re-type them here for the UI components.
 */
import type { ParagraphAnalysisMeta, InterpretationViewDTO } from '@/modules/reading/types'

export interface ModernSentence {
  original: string
  modern: string
  commentary: string
}

export interface ModernResultDTO {
  paragraphId: string
  fromCache: boolean
  analysisMeta: ParagraphAnalysisMeta | null
  interpretation: InterpretationViewDTO
  sentences: ModernSentence[]
  analysis: string
  summary: string
  model: string
  tokens: number
}

export interface AiStatusDTO {
  configured: boolean
  provider: string | null
  model: string | null
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
