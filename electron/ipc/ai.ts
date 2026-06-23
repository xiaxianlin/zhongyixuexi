/**
 * AI IPC. Thin pass-throughs to the ai service.
 * Every handler returns via the {__ok} envelope from registry.handle. Channel
 * names follow the module:action convention.
 */
import type { IpcMainInvokeEvent } from 'electron'
import { handle } from './registry'
import * as ai from '../services/ai'
import { listChapterAnalysisHistory } from '../services/chapter-analysis'
import {
  getOrCreateThreadForChapter,
  getThreadHistory,
  sendChat,
  resetThread,
  abortChapterChat,
} from '../services/ai-chat'

export function registerAiHandlers(): void {
  // Whether a provider key is configured (no plaintext returned).
  handle('ai:status', () => ai.status())

  // D4: generate (or return cached) the active chapter-level analysis.
  handle('chapters:analyze', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { chapterId?: string; force?: boolean }
    return ai.generateChapterAnalysis(p.chapterId ?? '', { force: p.force })
  })

  // D4: list all analysis versions for a chapter (newest first).
  handle('chapters:analysisHistory', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { chapterId?: string }
    return listChapterAnalysisHistory(p.chapterId ?? '')
  })

  // D5: chapter-scoped chat. One thread per chapter (uq_ai_threads_chapter).
  handle('ai:threadForChapter', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { bookId?: string; chapterId?: string }
    return getOrCreateThreadForChapter(p.bookId ?? '', p.chapterId ?? '')
  })

  handle('ai:chatHistory', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { threadId?: string }
    return getThreadHistory(p.threadId ?? '')
  })

  // D5: send a user message + stream the assistant reply. Token deltas are
  // pushed to the renderer via event.sender.send('ai:chat:token', {...}); the
  // resolved value is the two persisted messages.
  handle('ai:sendChat', async (event: IpcMainInvokeEvent, payload: unknown) => {
    const p = (payload ?? {}) as {
      threadId?: string
      content?: string
      quote?: string | null
      quoteStart?: number | null
      quoteEnd?: number | null
    }
    const threadId = p.threadId ?? ''
    return sendChat(
      {
        threadId,
        content: p.content ?? '',
        quote: p.quote ?? null,
        quoteStart: p.quoteStart ?? null,
        quoteEnd: p.quoteEnd ?? null,
      },
      (delta) => {
        event.sender.send('ai:chat:token', { threadId, delta })
      },
    )
  })

  handle('ai:resetThread', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { threadId?: string }
    return resetThread(p.threadId ?? '')
  })

  // W-1: cancel an in-flight chat stream when the user switches chapter / closes
  // the book. Returns { aborted: boolean }.
  handle('ai:abortChapterChat', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { chapterId?: string }
    return { aborted: abortChapterChat(p.chapterId ?? '') }
  })
}
