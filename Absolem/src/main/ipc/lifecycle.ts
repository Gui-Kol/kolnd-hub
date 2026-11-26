import type { BrowserWindow } from 'electron'
import type { AbsolemConfig } from '../../shared/config'

/**
 * Contexto compartilhado dos módulos IPC (`src/main/ipc/*.ts`).
 *
 * Os getters existem porque a janela principal (e a futura janela de overlay)
 * são reatribuídas durante o ciclo de vida; o snapshot do store é sempre
 * normalizado na leitura; e a flag de saída é consultada pelo `close`.
 */
export interface IpcContext {
  getMainWindow: () => BrowserWindow | null
  getOverlayWindow: () => BrowserWindow | null
  getStoreSnapshot: () => AbsolemConfig
  isQuitting: () => boolean
}

/**
 * O encerramento explícito vive em `../shutdown` (ganchos best-effort). O
 * re-export mantém os imports históricos de `ipc/app.ts` e dos testes válidos.
 */
export { shutdownApp } from '../shutdown'
export type { ShutdownReason } from '../shutdown'
