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
  AppearanceSettings,
  DisclaimerStatus,
  BookFileEntry,
  OrphanScanResult,
  CleanOrphansResult,
  ExportResult,
  VerifyResult,
  ImportResult,
} from '@/modules/settings/types'
import type { ImportResult as EpubImportResult } from './types'

/** settings:* — SET-01..SET-05 provider CRUD, appearance, backup, file mgmt. */
export const settingsApi = {
  // ---- SET-01: Provider CRUD ----
  listProviders: () => invokeRaw<ProviderConfig[]>('settings:listProviders'),

  getProvider: (id: string) => invokeRaw<ProviderConfig>('settings:getProvider', id),

  saveProvider: (input: SaveProviderInput) =>
    invokeRaw<{ id: string }>('settings:saveProvider', input),

  deleteProvider: (id: string) => invokeRaw<{ ok: boolean }>('settings:deleteProvider', id),

  setActiveProvider: (id: string) =>
    invokeRaw<{ ok: boolean }>('settings:setActiveProvider', id),

  // ---- SET-02: Appearance ----
  getAppearance: () => invokeRaw<AppearanceSettings>('settings:getAppearance'),

  setAppearance: (patch: Partial<AppearanceSettings>) =>
    invokeRaw<{ ok: boolean }>('settings:setAppearance', patch),

  // ---- SET-03: Backup ----
  exportBackup: (opts?: { outputPath?: string; includeApiKey?: boolean }) =>
    invokeRaw<ExportResult | null>('settings:exportBackup', opts ?? {}),

  importBackup: (opts?: { archivePath?: string; mode?: 'replace' | 'merge' }) =>
    invokeRaw<ImportResult | null>('settings:importBackup', opts ?? {}),

  verifyBackup: (archivePath: string) =>
    invokeRaw<VerifyResult>('settings:verifyBackup', { archivePath }),

  // ---- SET-04: Book file management ----
  listBookFiles: () => invokeRaw<BookFileEntry[]>('settings:listBookFiles'),

  triggerReparse: (bookId: string) =>
    invokeRaw<EpubImportResult>('settings:triggerReparse', { bookId }),

  scanOrphans: () => invokeRaw<OrphanScanResult>('settings:scanOrphans'),

  cleanOrphans: (paths: string[]) =>
    invokeRaw<CleanOrphansResult>('settings:cleanOrphans', { paths }),

  // ---- SET-05: Disclaimer ----
  getDisclaimerStatus: () => invokeRaw<DisclaimerStatus>('settings:getDisclaimerStatus'),

  acceptDisclaimer: (version: string) =>
    invokeRaw<{ ok: boolean }>('settings:acceptDisclaimer', { version }),
}
