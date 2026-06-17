/**
 * Typed renderer-side client for `search:*` channels (SRH module).
 *
 * Lives in its own file (per dev-srh.md ownership) so the search surface is
 * self-contained; src/lib/ipc.ts stays untouched (it is not SRH-owned). The
 * unwrap follows the same {__ok} envelope + IpcError contract as src/lib/ipc.ts
 * (re-declared locally to avoid editing the shared file).
 */

import { IpcError, type SerializedError } from './ipc'
import type { SearchResult } from './types'

type IpcResult<T> = { __ok: true; data: T } | { __ok: false; error: SerializedError }

async function invokeRaw<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.api) {
    throw new IpcError({ code: 'UNKNOWN', message: 'API bridge unavailable' })
  }
  const result = (await window.api.invoke(channel, ...args)) as IpcResult<T>
  if (!result.__ok) throw new IpcError(result.error)
  return result.data
}

export interface FulltextArgs {
  query: string
  limit?: number
  offset?: number
  bookIds?: string[]
}

export const searchApi = {
  fulltext: (args: FulltextArgs) => invokeRaw<SearchResult>('search:fulltext', args),
}
