/**
 * Typed renderer-side client for `settings:*` channels (SET module).
 *
 * Lives in its own file (per dev-set.md ownership) so the settings surface is
 * self-contained; src/lib/ipc.ts stays untouched. The unwrap follows the same
 * {__ok} envelope + IpcError contract.
 *
 * SECURITY: there is NO `getActiveApiKey` method here — the plaintext API key
 * never crosses IPC to the renderer. The AI module (Phase 5) will call the
 * settings service in-process from the main side.
 */

import { invokeRaw } from './ipc'
import type {
  ProviderConfig,
  SaveProviderInput,
} from '@/modules/settings/types'

/** settings:* — fixed AI provider slots only. */
export const settingsApi = {
  listProviders: () => invokeRaw<ProviderConfig[]>('settings:listProviders'),

  getProvider: (id: string) => invokeRaw<ProviderConfig>('settings:getProvider', id),

  saveProvider: (input: SaveProviderInput) =>
    invokeRaw<{ id: string }>('settings:saveProvider', input),

  setActiveProvider: (id: string) =>
    invokeRaw<{ ok: boolean }>('settings:setActiveProvider', id),
}
