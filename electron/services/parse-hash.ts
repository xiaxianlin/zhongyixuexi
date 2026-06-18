/**
 * parse_hash helper — the canonical content fingerprint for paragraphs.
 *
 * parse_hash is sha256(normalized text) truncated to 16 hex chars. It keys the
 * re-parse ID mapping (01-import-parse §7.2.3) and is recomputed whenever a
 * paragraph's text changes so the AI cache (ai_cache.prompt_hash) doesn't
 * mis-hit on stale text. The normalization must match `content-normalize.ts`.
 *
 * Extracted here (from builtin-content.ts) so the editing service reuses the
 * exact same fingerprint the import path produces.
 */
import { createHash } from 'node:crypto'

export function sha256Hex16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}
