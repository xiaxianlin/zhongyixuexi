/**
 * Settings IPC (SET-01..SET-05). Thin pass-throughs to the settings + backup
 * services. Every handler returns via the {__ok} envelope from registry.handle.
 * Channel names follow the module:action convention (00-arch §4).
 *
 * SECURITY: `settings:getActiveApiKey` is NOT registered as an IPC channel —
 * the plaintext key never crosses the IPC boundary. The AI module (Phase 5)
 * imports `getActiveApiKey` directly from the settings service in-process.
 *
 * Renderer→main typed wrappers live in src/lib/settings-api.ts.
 */

import { dialog, type IpcMainInvokeEvent, BrowserWindow } from 'electron'
import { handle } from './registry'
import * as settings from '../services/settings'
import * as backup from '../services/backup'
import type { SaveProviderInput } from '../services/settings'
import type { BackupProgressEvent } from '../services/backup'

/**
 * Registers all settings:* IPC channels. Called once on app ready by the
 * main agent's registerAllIpc() wiring.
 *
 * Registration line for the main agent to add to electron/ipc/index.ts:
 *   import { registerSettingsHandlers } from './settings'
 *   registerSettingsHandlers()
 */
export function registerSettingsHandlers(): void {
  // ---- SET-01: Provider CRUD ----
  handle('settings:listProviders', () => settings.listProviders())

  handle('settings:getProvider', (_event, id: unknown) =>
    settings.getProvider(id as string),
  )

  handle('settings:saveProvider', (_event, input: unknown) =>
    settings.saveProvider(input as SaveProviderInput),
  )

  handle('settings:deleteProvider', (_event, id: unknown) =>
    settings.deleteProvider(id as string),
  )

  handle('settings:setActiveProvider', (_event, id: unknown) =>
    settings.activateProvider(id as string),
  )

  // ---- SET-02: Appearance ----
  handle('settings:getAppearance', () => settings.getAppearance())

  handle('settings:setAppearance', (_event, patch: unknown) => {
    const result = settings.setAppearance(patch as Partial<settings.AppearanceSettings>)
    // Broadcast to all windows so they refresh CSS tokens.
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('settings:appearanceChanged', patch)
    }
    return result
  })

  // ---- SET-03: Backup ----
  handle('settings:exportBackup', async (event: IpcMainInvokeEvent, opts: unknown) => {
    const options = (opts || {}) as { outputPath?: string; includeApiKey?: boolean }
    // If no output path, show a save dialog
    let outputPath = options.outputPath
    if (!outputPath) {
      const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, {
        title: '导出备份',
        defaultPath: `backup-${Date.now()}.tcmz`,
        filters: [{ name: 'TCM Backup', extensions: ['tcmz'] }],
      })
      if (result.canceled || !result.filePath) {
        return null
      }
      outputPath = result.filePath
    }

    return backup.exportBackup(
      outputPath,
      options.includeApiKey ?? false,
      (e: BackupProgressEvent) => event.sender.send('settings:backupProgress', e),
    )
  })

  handle('settings:importBackup', async (event: IpcMainInvokeEvent, opts: unknown) => {
    const options = (opts || {}) as { archivePath?: string; mode?: 'replace' | 'merge' }
    let archivePath = options.archivePath
    if (!archivePath) {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
        title: '导入备份',
        filters: [{ name: 'TCM Backup', extensions: ['tcmz'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      archivePath = result.filePaths[0]
    }

    return backup.importBackup(
      archivePath,
      options.mode ?? 'replace',
      (e: BackupProgressEvent) => event.sender.send('settings:backupProgress', e),
    )
  })

  handle('settings:verifyBackup', (_event, opts: unknown) => {
    const options = (opts || {}) as { archivePath?: string }
    if (!options.archivePath) {
      throw new Error('archivePath is required')
    }
    return backup.verifyBackup(options.archivePath)
  })

  // ---- SET-04: Book file management ----
  handle('settings:listBookFiles', () => settings.listBookFiles())

  handle('settings:scanOrphans', () => settings.scanOrphans())

  handle('settings:cleanOrphans', (_event, payload: unknown) => {
    const { paths } = payload as { paths: string[] }
    return settings.cleanOrphans(paths)
  })

  // ---- SET-05: Disclaimer ----
  handle('settings:getDisclaimerStatus', () => settings.getDisclaimerStatus())

  handle('settings:acceptDisclaimer', (_event, payload: unknown) => {
    const { version } = payload as { version: string }
    return settings.acceptDisclaimer(version)
  })
}
