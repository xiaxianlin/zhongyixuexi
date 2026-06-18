/**
 * AI domain renderer IPC client — ai:* channels.
 *
 * Unwraps the {__ok} envelope via models/shared/ipc.ts and re-throws structured
 * errors as IpcError. Mirrors channels registered in electron/ipc/ai.ts.
 */
import { invokeRaw, type IpcError } from '@/models/shared/ipc'
import type { ModernResultDTO, AiStatusDTO, AiSubCode } from './types'

/** Extract the AI sub-code from an IpcError's details.aiCode. */
export function aiSubCodeFrom(e: unknown): AiSubCode {
  if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'AI') {
    const d = (e as { details?: { aiCode?: AiSubCode } }).details
    return d?.aiCode ?? 'AI_UNKNOWN'
  }
  return 'AI_UNKNOWN'
}

export type { IpcError }

/** ai:* — status and paragraph interpretation. */
export const aiApi = {
  status: () => invokeRaw<AiStatusDTO>('ai:status'),

  generateModern: (paragraphId: string, opts: { force?: boolean } = {}) =>
    invokeRaw<ModernResultDTO>('ai:generateModern', { paragraphId, ...opts }),
}
