/**
 * AI IPC (S5.1..S5.6 / 07-ai.md §5). Thin pass-throughs to the ai service.
 * Every handler returns via the {__ok} envelope from registry.handle. Channel
 * names follow the module:action convention.
 *
 * Long-task progress: ai:generateModernBatch sends 'ai:progress' events via
 * event.sender.send() as it walks the chapter's paragraphs. Single-segment
 * generation (ai:generateModern, ai:ask, ai:generateCards) completes within one
 * HTTP round-trip and does not emit progress.
 *
 * Renderer→main typed wrappers live in src/lib/ai-api.ts.
 *
 * Registration line for the main agent to add to electron/ipc/index.ts:
 *   import { registerAiHandlers } from './ai'
 *   registerAiHandlers()
 */
import { handle } from './registry'
import * as ai from '../services/ai'

export function registerAiHandlers(): void {
  // Whether a provider key is configured (no plaintext returned).
  handle('ai:status', () => ai.status())

  // AI-01: per-paragraph modern interpretation (cache-aware, may be instant).
  handle('ai:generateModern', (_event, payload: unknown) => {
    const { paragraphId } = payload as { paragraphId: string }
    return ai.generateModern(paragraphId)
  })

  // AI-01 batch: whole-chapter modern interpretation, emitting ai:progress.
  handle('ai:generateModernBatch', async (event, payload: unknown) => {
    const { chapterId } = payload as { chapterId: string }
    return ai.generateModernBatch(chapterId, (p) => event.sender.send('ai:progress', p))
  })

  // AI-06: card batch generation (persists via LRN createCards, source='ai_batch').
  handle('ai:generateCards', (_event, payload: unknown) => {
    const { paragraphIds } = payload as { paragraphIds: string[] }
    return ai.generateCards(paragraphIds)
  })

  // Manual cache invalidation (triggers regenerate on next call).
  handle('ai:invalidate', (_event, payload: unknown) => {
    const { scopeId, kind } = payload as { scopeId: string; kind: 'modern' | 'qa' | 'cards' | 'annotation' }
    return ai.invalidate(scopeId, kind)
  })
}
