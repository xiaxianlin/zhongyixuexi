/**
 * Settings service (SET module).
 *
 * Bridges the keystore to a clean service layer for the current fixed AI
 * configuration UI. It exposes safe provider DTOs only; plaintext API keys
 * never cross IPC.
 *
 * Also exports `getActiveApiKey` (re-exported from keystore) so the AI module
 * (Phase 5) imports from a single entry point:
 *   import { getActiveApiKey } from '../services/settings'
 *
 * All DB access goes through the better-sqlite3 singleton from getDb().
 */

import { AppError } from '../lib/error'
import {
  saveProviderCredential,
  setActiveProvider,
  listProviderCredentials,
  getActiveApiKey as keystoreGetActiveApiKey,
  type ProviderCredentialRow,
} from '../lib/keystore'

// Re-export for AI module convenience (stable import path).
// The AI module (Phase 5) imports: import { getActiveApiKey } from '../services/settings'
export type { ActiveApiKeyResult } from '../lib/keystore'

// ============================================================================
// DTOs (self-contained; renderer mirrors in src/modules/settings/types.ts)
// ============================================================================

/** Safe provider config — never contains the API key plaintext. */
export interface ProviderConfigDTO {
  id: string
  provider: string
  label: string
  baseUrl: string
  model: string
  hasKey: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface SaveProviderInput {
  id?: string
  provider: string
  label: string
  baseUrl: string
  model: string
  /** Plaintext key (will be encrypted in main process); omit to keep existing. */
  apiKey?: string | null
}

// ============================================================================
// SET-01: Provider CRUD (returns safe DTOs, never key plaintext)
// ============================================================================

function toDTO(row: ProviderCredentialRow): ProviderConfigDTO {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    baseUrl: row.base_url,
    model: row.model,
    hasKey: !!(row.api_key_enc && row.api_key_enc.length > 0),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listProviders(): ProviderConfigDTO[] {
  return listProviderCredentials().map(toDTO)
}

export function getProvider(id: string): ProviderConfigDTO {
  const all = listProviderCredentials()
  const row = all.find((r) => r.id === id)
  if (!row) throw new AppError('NOT_FOUND', `provider ${id} not found`)
  return toDTO(row)
}

export function saveProvider(input: SaveProviderInput): { id: string } {
  const id = input.id || `custom-${Date.now().toString(36)}`
  saveProviderCredential(id, input.provider, input.label, input.baseUrl, input.model, input.apiKey)
  return { id }
}

export function activateProvider(id: string): { ok: boolean } {
  setActiveProvider(id)
  return { ok: true }
}

// Convenience for internal use (AI module).
export const getActiveApiKey = keystoreGetActiveApiKey
