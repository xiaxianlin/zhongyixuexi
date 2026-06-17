/**
 * Settings IPC. The current settings UI exposes two fixed AI configuration
 * slots only; no import/export, appearance, file cleanup, or provider deletion
 * channels are registered.
 *
 * SECURITY: `settings:getActiveApiKey` is NOT registered as an IPC channel —
 * the plaintext key never crosses the IPC boundary. The AI module (Phase 5)
 * imports `getActiveApiKey` directly from the settings service in-process.
 *
 * Renderer→main typed wrappers live in src/lib/settings-api.ts.
 */

import { handle } from './registry'
import * as settings from '../services/settings'
import type { SaveProviderInput } from '../services/settings'

/**
 * Registers all settings:* IPC channels. Called once on app ready by the
 * main agent's registerAllIpc() wiring.
 *
 * Registration line for the main agent to add to electron/ipc/index.ts:
 *   import { registerSettingsHandlers } from './settings'
 *   registerSettingsHandlers()
 */
export function registerSettingsHandlers(): void {
  handle('settings:listProviders', () => settings.listProviders())

  handle('settings:saveProvider', (_event, input: unknown) =>
    settings.saveProvider(input as SaveProviderInput),
  )

  handle('settings:setActiveProvider', (_event, id: unknown) =>
    settings.activateProvider(id as string),
  )
}
