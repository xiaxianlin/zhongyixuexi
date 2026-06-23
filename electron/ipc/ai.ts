/**
 * AI IPC. Thin pass-throughs to the ai service.
 * Every handler returns via the {__ok} envelope from registry.handle. Channel
 * names follow the module:action convention.
 */
import { handle } from './registry'
import * as ai from '../services/ai'
import { listChapterAnalysisHistory } from '../services/chapter-analysis'

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
}
