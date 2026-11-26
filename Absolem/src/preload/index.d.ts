import type { AbsolemApi } from '../shared/ipc'

declare global {
  interface Window {
    /** Ponte exposta pelo preload (`contextBridge`). */
    absolem: AbsolemApi
  }
}

export {}
