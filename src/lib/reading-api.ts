/**
 * Typed renderer-side IPC client for the reading module.
 *
 * Each method calls window.api.invoke(channel, ...args) via invokeRaw, which
 * unwraps the {__ok} envelope from electron/ipc/registry.ts and re-throws
 * structured errors as IpcError (src/lib/ipc.ts). Mirrors the channels
 * registered in electron/ipc/reading.ts.
 */
import { invokeRaw } from './ipc'
import type {
  ChapterContent,
} from '@/modules/reading/types'

/** reading:* — chapter content for the library detail page. */
export const readingApi = {
  getChapter: (bookId: string, chapterId: string) =>
    invokeRaw<ChapterContent | null>('reading:getChapter', bookId, chapterId),
}
