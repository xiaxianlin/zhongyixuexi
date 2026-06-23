/**
 * AI domain renderer IPC client — ai:* channels.
 *
 * Unwraps the {__ok} envelope via models/shared/ipc.ts and re-throws structured
 * errors as IpcError. Mirrors channels registered in electron/ipc/ai.ts.
 */
import { invokeRaw, type IpcError } from '@/models/shared/ipc'
import type {
  AiStatusDTO,
  AiSubCode,
  ChapterAnalysisResultDTO,
  AiThreadDTO,
  AiMessageDTO,
  SendChatResult,
} from './types'

/** Extract the AI sub-code from an IpcError's details.aiCode. */
export function aiSubCodeFrom(e: unknown): AiSubCode {
  if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'AI') {
    const d = (e as { details?: { aiCode?: AiSubCode } }).details
    return d?.aiCode ?? 'AI_UNKNOWN'
  }
  return 'AI_UNKNOWN'
}

export type { IpcError }

/** ai:* — status + chapter analysis + chapter-scoped chat. */
export const aiApi = {
  status: () => invokeRaw<AiStatusDTO>('ai:status'),

  analyzeChapter: (chapterId: string, opts: { force?: boolean } = {}) =>
    invokeRaw<ChapterAnalysisResultDTO>('chapters:analyze', { chapterId, ...opts }),

  threadForChapter: (bookId: string, chapterId: string) =>
    invokeRaw<AiThreadDTO>('ai:threadForChapter', { bookId, chapterId }),

  chatHistory: (threadId: string) =>
    invokeRaw<AiMessageDTO[]>('ai:chatHistory', { threadId }),

  sendChat: (input: {
    threadId: string
    content: string
    quote?: string | null
    quoteStart?: number | null
    quoteEnd?: number | null
  }) => invokeRaw<SendChatResult>('ai:sendChat', input),

  resetThread: (threadId: string) =>
    invokeRaw<{ ok: true }>('ai:resetThread', { threadId }),

  abortChapterChat: (chapterId: string) =>
    invokeRaw<{ aborted: boolean }>('ai:abortChapterChat', { chapterId }),
}
