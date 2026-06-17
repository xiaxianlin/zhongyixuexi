/**
 * Typed renderer-side IPC client. Unwraps the {__ok} envelope produced by
 * electron/ipc/registry.ts and re-throws structured errors as IpcError.
 * Module-specific APIs are added here as slices land.
 */

import type { BookListItem, ChapterNode } from './types'

export type ErrorCode =
  | 'DB'
  | 'PARSE'
  | 'IO'
  | 'AI'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNKNOWN'

export interface SerializedError {
  code: ErrorCode
  message: string
  details?: unknown
}

type IpcResult<T> = { __ok: true; data: T } | { __ok: false; error: SerializedError }

export class IpcError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(error: SerializedError) {
    super(error.message)
    this.name = 'IpcError'
    this.code = error.code
    this.details = error.details
  }
}

export async function invokeRaw<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.api) {
    throw new IpcError({ code: 'UNKNOWN', message: 'API bridge unavailable' })
  }
  const result = (await window.api.invoke(channel, ...args)) as IpcResult<T>
  if (!result.__ok) throw new IpcError(result.error)
  return result.data
}

export function subscribe(channel: string, cb: (payload: unknown) => void): () => void {
  if (!window.api) return () => undefined
  return window.api.on(channel, cb)
}

/** app:* — process metadata, proves the IPC round-trip. */
export const appApi = {
  getInfo: () => invokeRaw<{ version: string; platform: string; electron: string }>('app:getInfo'),
}

/** library:* — book list and chapter tree. */
export const libraryApi = {
  list: () => invokeRaw<BookListItem[]>('library:list'),
  tree: (bookId: string) => invokeRaw<ChapterNode[]>('library:tree', bookId),
}
