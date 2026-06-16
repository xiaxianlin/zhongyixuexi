import { app } from 'electron'
import { handle } from './registry'

/** Proves the full IPC envelope round-trip on boot. */
export function registerAppHandlers(): void {
  handle('app:getInfo', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  }))
}
