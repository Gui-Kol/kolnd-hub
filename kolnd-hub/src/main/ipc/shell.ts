import { ipcMain, shell } from 'electron'
import { resolvePath } from '../processManager'
import { logger } from '../logger'
import type { IpcContext } from './lifecycle'

/**
 * Allowlist de URLs para abrir no navegador externo.
 * https://http://mailto: são os únicos esquemas permitidos — bloqueia
 * file://, javascript:, data: e esquemas de protocolo arbitrários
 * (qualquer XSS no renderer viraria um `app:launch` arbitrário; esta
 * allowlist limita o que o renderer consegue alcançar por fora).
 */
export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const scheme = parsed.protocol.toLowerCase()
    return scheme === 'https:' || scheme === 'http:' || scheme === 'mailto:'
  } catch {
    return false
  }
}

export function registerShellIpc(_ctx: IpcContext): void {
  ipcMain.handle('shell:openExternal', (_event, url: unknown) => {
    if (typeof url !== 'string' || !isAllowedExternalUrl(url)) {
      logger.warn('shell', `openExternal bloqueado (esquema não permitido): ${String(url)}`)
      return
    }
    void shell.openExternal(url)
  })

  ipcMain.handle('shell:openPath', (_event, path: unknown) => {
    if (typeof path !== 'string' || path.trim().length === 0 || path.length > 1024) return
    // Settings may store relative paths (../Kloud Games) or %VAR% paths.
    void shell.openPath(resolvePath(path))
  })
}
