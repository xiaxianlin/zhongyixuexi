/**
 * Window-level bridge exposed by the Electron preload script.
 * preload/index.ts does: contextBridge.exposeInMainWorld('api', {invoke, on}).
 * Renderer code uses models/shared/ipc.ts's invokeRaw/onChannel, not this directly.
 */
interface ApiBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, cb: (payload: unknown) => void) => () => void
}

interface Window {
  api: ApiBridge
}
