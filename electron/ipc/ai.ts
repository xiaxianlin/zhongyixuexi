/**
 * AI IPC. Thin pass-throughs to the ai service.
 * Every handler returns via the {__ok} envelope from registry.handle. Channel
 * names follow the module:action convention.
 */
import { handle } from './registry'
import * as ai from '../services/ai'

export function registerAiHandlers(): void {
  // Whether a provider key is configured (no plaintext returned).
  handle('ai:status', () => ai.status())

  // AI-01: per-paragraph modern interpretation (cache-aware, may be instant).
  handle('ai:generateModern', (_event, payload: unknown) => {
    const { paragraphId, force } = payload as { paragraphId: string; force?: boolean }
    return ai.generateModern(paragraphId, { force })
  })
}
