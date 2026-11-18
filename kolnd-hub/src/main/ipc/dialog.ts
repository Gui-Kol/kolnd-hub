import { dialog, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { resolvePath } from '../processManager'
import type { IpcContext } from './lifecycle'

export function registerDialogIpc(ctx: IpcContext): void {
  // ── IPC: Diálogos (Configurações) ───────────────
  // Abre o explorador de arquivos nativo para escolher o executável (file)
  // ou a pasta de instalação (directory) de um app. Cancelar retorna
  // { success: false, canceled: true } e nada é alterado no renderer.
  // `dialogTitle` opcional sobrescreve o título do diálogo (ex.: a
  // Biblioteca pede "Selecione o executável do jogo").
  ipcMain.handle(
    'dialog:pick-path',
    async (
      _event,
      mode: 'file' | 'directory',
      currentValue?: string,
      dialogTitle?: string
    ): Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }> => {
      const mainWindow = ctx.getMainWindow()
      if (!mainWindow) {
        return { success: false, error: 'Janela principal não está disponível.' }
      }

      // Tenta abrir o diálogo já na pasta do caminho atual (se conseguir
      // resolver): expande %VAR%, remove aspas e sobe para o diretório-pai
      // quando aponta para um arquivo.
      let defaultPath: string | undefined
      if (currentValue?.trim()) {
        const cleaned = resolvePath(currentValue.trim().replace(/^"|"$/g, ''))
        if (existsSync(cleaned)) {
          defaultPath =
            mode === 'directory' && !cleaned.toLowerCase().endsWith('.exe')
              ? cleaned
              : dirname(cleaned)
        } else if (existsSync(dirname(cleaned))) {
          defaultPath = dirname(cleaned)
        }
      }

      // Título do diálogo: usa o override validado quando presente, senão o padrão.
      const title =
        typeof dialogTitle === 'string' && dialogTitle.trim()
          ? dialogTitle.trim().slice(0, 120)
          : undefined

      const options: Electron.OpenDialogOptions =
        mode === 'file'
          ? {
              title: title ?? 'Selecionar o executável do programa',
              properties: ['openFile'],
              filters: [
                { name: 'Executáveis', extensions: ['exe', 'bat', 'cmd', 'ps1', 'com'] },
                { name: 'Todos os arquivos', extensions: ['*'] }
              ],
              defaultPath
            }
          : {
              title: title ?? 'Selecionar a pasta de instalação do programa',
              properties: ['openDirectory', 'createDirectory'],
              defaultPath
            }

      try {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, options)
        if (canceled || filePaths.length === 0) {
          return { success: false, canceled: true }
        }
        return { success: true, path: filePaths[0] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    }
  )
}
