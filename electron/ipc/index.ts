import { registerAppHandlers } from './app'
import { registerImportHandlers } from './import'
import { registerLibraryHandlers } from './library'
import { registerSegmentHandlers } from './segment'

/** Registers every IPC channel. Called once on app ready. */
export function registerAllIpc(): void {
  registerAppHandlers()
  registerImportHandlers()
  registerLibraryHandlers()
  registerSegmentHandlers()
}
