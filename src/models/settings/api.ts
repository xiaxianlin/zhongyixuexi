/**
 * Settings domain renderer IPC client — settings:* channels (SET module).
 *
 * Unwraps the {__ok} envelope via models/shared/ipc.ts. Mirrors channels
 * registered in electron/ipc/settings.ts.
 *
 * SECURITY: there is NO `getActiveApiKey` method here — the plaintext API key
 * never crosses IPC to the renderer. The AI module calls the settings service
 * in-process from the main side.
 */
import { invokeRaw } from '@/models/shared/ipc'
import type { ProviderConfig, SaveProviderInput } from './types'

/** settings:* — fixed AI provider slots only. */
export const settingsApi = {
  listProviders: () => invokeRaw<ProviderConfig[]>('settings:listProviders'),

  saveProvider: (input: SaveProviderInput) =>
    invokeRaw<{ id: string }>('settings:saveProvider', input),

  setActiveProvider: (id: string) =>
    invokeRaw<{ ok: boolean }>('settings:setActiveProvider', id),
}
