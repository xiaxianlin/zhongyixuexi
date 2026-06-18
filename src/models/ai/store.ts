/**
 * AI session store (Zustand) — UI/session cache only.
 *
 * Per project rule: persisted data lives in SQLite (via the ai_cache table +
 * IPC), never in store persistence. This store holds: AI availability status,
 * the current degraded-state reason (AI-02), and generation error handling.
 *
 * The store deliberately does NOT cache generated interpretations — those are
 * read by the library view from the active paragraph analysis view. The store
 * only tracks degraded state.
 */
import { create } from 'zustand'
import { aiApi, aiSubCodeFrom } from './api'
import type { AiStatusDTO, DegradedReason } from './types'
import { toDegradedReason } from './types'

interface AiStore {
  status: AiStatusDTO | null
  degraded: boolean
  degradedReason: DegradedReason | null

  // actions
  refreshStatus: () => Promise<void>
  enterDegraded: (reason: DegradedReason) => void
  exitDegraded: () => void
  /** Convenience wrapper: run an AI op, auto-enter degraded on AI errors. */
  run: <T>(op: () => Promise<T>) => Promise<T | null>
}

export const useAiStore = create<AiStore>((set, get) => ({
  status: null,
  degraded: false,
  degradedReason: null,

  refreshStatus: async () => {
    try {
      const s = await aiApi.status()
      set({ status: s })
      if (s.configured && get().degradedReason === 'key_missing') {
        set({ degraded: false, degradedReason: null })
      }
    } catch {
      // status() should never throw (it doesn't call the network), but be safe.
    }
  },

  enterDegraded: (reason) => set({ degraded: true, degradedReason: reason }),
  exitDegraded: () => set({ degraded: false, degradedReason: null }),

  run: async <T,>(op: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await op()
      // A successful call exits any non-key_missing degraded state (the user
      // fixed their key/network). key_missing is only cleared by refreshStatus
      // so we don't flap on a single successful retry.
      const r = get().degradedReason
      if (r && r !== 'key_missing') set({ degraded: false, degradedReason: null })
      return result
    } catch (e) {
      // Map IpcError(code='AI') → degraded reason.
      const sub = aiSubCodeFrom(e)
      if (sub !== 'AI_GUARD_BLOCKED') {
        set({ degraded: true, degradedReason: toDegradedReason(sub) })
      }
      return null
    }
  },
}))
