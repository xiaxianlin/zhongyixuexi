/**
 * Typed renderer-side IPC client for the AI module.
 *
 * Each method calls window.api.invoke(channel, ...args) via invokeRaw, which
 * unwraps the {__ok} envelope from electron/ipc/registry.ts and re-throws
 * structured errors as IpcError (src/lib/ipc.ts). Mirrors the channels
 * registered in electron/ipc/ai.ts.
 *
 */
import { invokeRaw, type IpcError } from './ipc'
import type {
  ModernResultDTO,
  AiStatusDTO,
  AiSubCode,
} from '@/modules/ai/types'

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
