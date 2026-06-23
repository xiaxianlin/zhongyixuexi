/**
 * AI module error helpers (07-ai.md §8.1).
 *
 * The app has a single coarse-grained ErrorCode union ('DB' | 'PARSE' | 'IO' |
 * 'AI' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'UNKNOWN') in
 * electron/lib/error.ts — this module does NOT own that file, so it cannot add
 * fine-grained codes like 'AI_KEY_NOT_CONFIGURED' to the union.
 *
 * Instead, every AI failure is thrown as `AppError('AI', message, details)`
 * where `details` carries a structured `{ aiCode: AiSubCode, ...safeCtx }`
 * object. The renderer's ai-api wrapper unpacks `details.aiCode` to pick the
 * right degraded-state reason. details NEVER contains the API key plaintext
 * or full response bodies — only HTTP status codes and generic reasons.
 */
import { AppError } from '../lib/error'

/** Fine-grained AI sub-code (carried in AppError.details.aiCode). */
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

export interface AiErrorDetails {
  aiCode: AiSubCode
  /** HTTP status when applicable; never the key or full body. */
  status?: number
  /** Short, generic, non-sensitive context (e.g. attempt count). */
  [k: string]: unknown
}

/** Build an AppError with the AI sub-code embedded in details. */
export function aiError(sub: AiSubCode, message: string, ctx: Omit<AiErrorDetails, 'aiCode'> = {}): AppError {
  return new AppError('AI', message, { aiCode: sub, ...ctx })
}

/** Type-guard: was this thrown value an AI AppError? */
export function isAiError(e: unknown): e is AppError {
  return e instanceof AppError && e.code === 'AI'
}

/** Extract the AI sub-code from an AppError, defaulting to AI_UNKNOWN. */
export function aiSubCode(e: unknown): AiSubCode {
  if (e instanceof AppError && e.code === 'AI') {
    const d = e.details as Partial<AiErrorDetails> | undefined
    return (d?.aiCode as AiSubCode) ?? 'AI_UNKNOWN'
  }
  return 'AI_UNKNOWN'
}
