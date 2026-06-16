export {}

declare global {
  interface Window {
    api?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, cb: (payload: unknown) => void) => () => void
      getAppInfo: () => Promise<unknown>
    }
  }
}
