import { registerLibraryHandlers } from './library'
import { registerReadingHandlers } from './reading'
import { registerSearchHandlers } from './search'
import { registerSettingsHandlers } from './settings'
import { registerLearningHandlers } from './learning'
import { registerNotesHandlers } from './notes'
import { registerAiHandlers } from './ai'

/** Registers every IPC channel. Called once on app ready. */
export function registerAllIpc(): void {
  registerLibraryHandlers()
  registerReadingHandlers()
  registerSearchHandlers()
  registerSettingsHandlers()
  registerLearningHandlers()
  registerNotesHandlers()
  registerAiHandlers()
}
