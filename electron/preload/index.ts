import { contextBridge, ipcRenderer } from 'electron'

/**
 * The ONLY surface exposed to the renderer. Keeps nodeIntegration off and
 * contextIsolation on; the renderer never touches ipcRenderer directly.
 */
const api = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),

  on: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.off(channel, listener)
    }
  },
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] failed to expose api:', error)
  }
} else {
  // @ts-expect-error fallback when context isolation is off
  window.api = api
}
