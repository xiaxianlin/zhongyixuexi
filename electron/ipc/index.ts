import { registerAppHandlers } from './app'
import { registerImportHandlers } from './import'
import { registerLibraryHandlers } from './library'
import { registerSegmentHandlers } from './segment'
import { registerReadingHandlers } from './reading'
import { registerSearchHandlers } from './search'

/** Registers every IPC channel. Called once on app ready. */
export function registerAllIpc(): void {
  registerAppHandlers()
  registerImportHandlers()
  registerLibraryHandlers()
  registerSegmentHandlers()
  registerReadingHandlers()
  registerSearchHandlers()
}
