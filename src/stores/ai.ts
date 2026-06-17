/**
 * AI module session store (Zustand) — UI/session cache only.
 *
 * Per CLAUDE.md: persisted data lives in SQLite (via the ai_cache table + IPC),
 * never in store persistence. This store holds: AI availability status, the
 * current degraded-state reason (AI-07), per-job generation progress, and the
 * last Q&A answer (so the side panel keeps its content across re-renders).
 *
 * The store deliberately does NOT cache generated interpretations — those are
 * read by the RD module from the active paragraph analysis view. The store only
 * tracks generation triggers and degraded state.
 */
import { create } from 'zustand'
import { aiApi, aiSubCodeFrom } from '@/lib/ai-api'
import type { AiStatusDTO, AiProgressPayload, DegradedReason } from '@/modules/ai/types'
import { toDegradedReason } from '@/modules/ai/types'

interface AiStore {
  status: AiStatusDTO | null
  degraded: boolean
  degradedReason: DegradedReason | null
  /** jobId → latest progress payload. */
  progress: Record<string, AiProgressPayload>
  /** Unsubscribe handle for the progress listener. */
  _unsubProgress: (() => void) | null

  // actions
  refreshStatus: () => Promise<void>
  enterDegraded: (reason: DegradedReason) => void
  exitDegraded: () => void
  onProgress: (p: AiProgressPayload) => void
  /** Convenience wrapper: run an AI op, auto-enter degraded on AI errors. */
  run: <T>(op: () => Promise<T>) => Promise<T | null>
}

export const useAiStore = create<AiStore>((set, get) => ({
  status: null,
  degraded: false,
  degradedReason: null,
  progress: {},
  _unsubProgress: null,

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

  onProgress: (p) => set((s) => ({ progress: { ...s.progress, [p.jobId]: p } })),

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
        // Guard blocks are shown inline in the Q&A answer, not as a degraded banner.
        set({ degraded: true, degradedReason: toDegradedReason(sub) })
      }
      return null
    }
  },
}))

/**
 * Wire up the ai:progress IPC listener once (call from App mount). Returns an
 * unsubscribe for tests/HMR.
 */
export function attachAiProgressListener(): () => void {
  const store = useAiStore.getState()
  if (store._unsubProgress) return store._unsubProgress
  const unsub = aiApi.onProgress((p) => useAiStore.getState().onProgress(p))
  useAiStore.setState({ _unsubProgress: unsub })
  return unsub
}
