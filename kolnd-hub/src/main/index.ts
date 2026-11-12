import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { ProcessManager, resolvePath, setBaseDir } from './processManager'
import { killProcessesForCommand } from './processKiller'
import { ensureKloudGamesInstalled, getKloudGamesStatus } from './kloudGames'
import {
  listStartupItems,
  removeStartupItem,
  addStartupItem,
  removeStartupItemsBatch,
  addStartupItemsBatch,
  getPcName,
  listRunningProcesses
} from './startupManager'
import { isFirstRun, markFirstRunComplete } from './firstRun'
import { registerFirstRunIpc } from './firstRunInstaller'
import { registerConfigIpc } from './store'
import { registerWingetIpc } from './wingetUpdater'
import { registerTempCleanerIpc } from './tempCleaner'
import { registerGamesIpc } from './games'
import { registerSteamIpc } from './steamScanner'
import { seedMarkLviData, getMarkLviDataDir } from './programsDeployer'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const processManager = new ProcessManager()

/**
 * Allowlist de URLs para abrir no navegador externo.
 * https://http://mailto: são os únicos esquemas permitidos — bloqueia
 * file://, javascript:, data: e esquemas de protocolo arbitrários
 * (qualquer XSS no renderer viraria um `app:launch` arbitrário; esta
 * allowlist limita o que o renderer consegue alcançar por fora).
 */
function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    const scheme = parsed.protocol.toLowerCase()
    return scheme === 'https:' || scheme === 'http:' || scheme === 'mailto:'
  } catch {
    return false
  }
}

function createWindow(isFirstRunMode = false): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      shell.openExternal(details.url)
    } else {
      console.warn(`[window] setWindowOpenHandler: bloqueado esquema não permitido: ${details.url}`)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (isFirstRunMode) url.searchParams.set('first-run', '1')
    mainWindow.loadURL(url.toString())
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    if (isFirstRunMode) {
      mainWindow.loadFile(htmlPath, { query: { 'first-run': '1' } })
    } else {
      mainWindow.loadFile(htmlPath)
    }
  }
}

function createTray(): void {
  // 32x32 lightning icon (generated from resources/icon.png)
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAM+SURBVFhHvddLTxNRFAfwLln6EVy6ZOnSJV8AUCidaTutWEBAIIA8WrBY6gNFAgUEeWiigqELTWpiVAQfiQESWeACEkQT42PRdu6dmb6PnukD24S2dxo8ydnO7z+3Z85Mdbo8ZRP85Y1CkG8yBx3YzaluVZs42ozJ7jASR2equ1Pdg80RRy8X5O0cLc+99pFltYqnbELQ2yCI0CiI0CSIcFEQodksQotZhFazCJfMBNpMBNpNBDpMBDpNBLqMBLqNBC4bCfQYCfTyBPp4Av08ATtPwcFRGDAQn50Lns41M3Ve8PM2S1A5FpyjMMhRcHIUrhokl52DsizcKgTqbRYRjhsfMmAACi4D9RzieOwl3vmkU2bBYbiOgquWnFED2Czi61Jwu5XAzmaUCXfXUbimp/s6joOyUnA89o+vImoARhyu6yno6oXg6VLw2WEZsNaehZnxG3oJdA1CsEUr7rRRIIGEGmDZE2LGb9ZKoMMFowXHgdtaj6g41sygzIyPpANowZc8SgbHcl+QmPFbGABXKyvubqagSMmjx8KfQQt+Ox2ABcdHbXc7lnX3e9sxTfhojQQ6fLGw4E8XQlk41o+DOKx5I7Ce6rcryX63EoEHDvlI/E4yAHEUi4+0SxA9nLuCFfidgDGrfCQ+hgHwdVoMjkvm214818hbj4dCefHxGjkZoBj8xXI49/p56/1KpCA+cU4GnfoxUQD39MtMR/99Nw6jfGHcgwHwKyYfjuv1yUQIVr0ReOONqMOWHriDz9lPAxYGnetQisIn0wHy4fnW69bLaK4Pz6fCReNTGAC/37Tg+Jz/PMgeyt2NGBM+fTYVQAuOS+bfuaCBBIxbZCb8LgbAr1ct+HxP8jWcriVniBmfUQNwxMGK43r1TR1uxE1fVBM+iwH6OLGLFcfdvuFLDuCvL3EY47Xh96rVEwhUsOK427/uxNQZWOhQNONzGMDO+U+w4rjhQlICVu+HS8LnMQDWgIHus+AzLTLsf4qVjC9WyYoa4ApHK4rF8Tl/ZFdg2iaXhlcrsFApd2X+nAwZpLlicK3TnosvViofMjgWzoLLQHz/C39YrZzMCpAul57y7lrqPxa8Slayjv1v/QHnqTkMuvP76QAAAABJRU5ErkJggg==',
      'base64'
    )
  )

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Kolnd Hub',
      click: (): void => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: (): void => {
        processManager.killAll()
        app.quit()
      }
    }
  ])

  tray.setToolTip('Kolnd Hub')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.kolnd.hub')

  // Relative paths in Settings resolve from the project root in dev and from
  // the installation directory once packaged (never from an inherited cwd).
  setBaseDir(is.dev ? process.cwd() : dirname(app.getPath('exe')))

  // Registra os canais IPC da tela de primeira execução.
  registerFirstRunIpc(() => mainWindow)

  // Registra os canais IPC da config persistente (electron-store).
  registerConfigIpc()

  // Registra os canais IPC do winget (listagem de atualizações).
  registerWingetIpc()

  // Registra os canais IPC da limpeza de arquivos temporários.
  registerTempCleanerIpc()

  // Registra os canais IPC da biblioteca de jogos.
  registerGamesIpc()

  // Registra os canais IPC da importação de jogos da Steam.
  registerSteamIpc()

  // Seed dos dados do Mark LVI para %APPDATA%/kolnd-hub/mark-lvi
  // (migração transparente para quem já tinha config/memory ao lado do exe).
  seedMarkLviData()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ── IPC: Kloud Games ─────────────────────────────
  // Abrir: procura o .exe (estado salvo → pasta do Hub → Program Files).
  // Se não encontrar, abre o MSI embutido para instalação (UAC), detecta o
  // caminho do .exe e salva tudo em resources/programs/kloud-games/kloud-games.paths.json.
  ipcMain.handle('kloud-games:launch', async () => {
    const ensured = await ensureKloudGamesInstalled()
    if (!ensured.success || !ensured.exePath) {
      return { success: false, error: ensured.error ?? 'Kloud Games não está disponível.' }
    }

    const exePath = ensured.exePath
    const cwd = dirname(exePath)
    const launch = processManager.launch('kloud-games', `"${exePath}"`, cwd)
    return {
      success: launch.success,
      error: launch.error,
      exePath,
      cwd,
      installedNow: ensured.installedNow ?? false
    }
  })

  // Status: revalida e retorna os caminhos salvos (usado pelo renderer ao abrir).
  ipcMain.handle('kloud-games:status', () => {
    return getKloudGamesStatus()
  })

  // ── IPC: App management ─────────────────────────
  ipcMain.handle(
    'app:launch',
    async (_event, appId: unknown, command: unknown, cwd: unknown, useShell?: unknown) => {
      // O renderer pode estar comprometido (XSS) — valide tudo que chega por IPC.
      if (typeof appId !== 'string' || typeof command !== 'string' || typeof cwd !== 'string') {
        return { success: false, error: 'Parâmetros inválidos para app:launch' }
      }
      const trimmedId = appId.trim()
      const trimmedCommand = command.trim()
      const trimmedCwd = cwd.trim()
      if (!trimmedId || trimmedId.length > 100) {
        return { success: false, error: 'appId inválido' }
      }
      if (!trimmedCommand || trimmedCommand.length > 4096) {
        return { success: false, error: 'Comando vazio ou longo demais' }
      }
      if (trimmedCwd.length > 1024) {
        return { success: false, error: 'Diretório de trabalho longo demais' }
      }

      // Mark LVI: dados do usuário (chave de API, memória) ficam em
      // %APPDATA%/kolnd-hub/mark-lvi, não ao lado do .exe empacotado.
      const env = trimmedId === 'mark-lvi' ? { MARK_LVI_HOME: getMarkLviDataDir() } : undefined

      return processManager.launch(trimmedId, trimmedCommand, trimmedCwd, {
        shell: useShell !== false,
        env
      })
    }
  )

  ipcMain.handle('app:stop', async (_event, appId: unknown, command?: unknown) => {
    if (typeof appId !== 'string' || (command !== undefined && typeof command !== 'string')) {
      return { success: false, error: 'Parâmetros inválidos para app:stop' }
    }
    const result = await processManager.stop(appId)
    if (result.success || !command) return result
    // O Hub só conhece processos que ele mesmo iniciou nesta sessão. Se o
    // programa está rodando em segundo plano (ex.: Hub reiniciado e o
    // processo ficou órfão), encerra pelo executável do comando.
    return killProcessesForCommand(command)
  })

  ipcMain.handle('app:status', async (_event, appId: unknown) => {
    if (typeof appId !== 'string') return { status: 'stopped', logCount: 0 }
    return processManager.getStatus(appId)
  })

  ipcMain.handle('app:all-status', async () => {
    return processManager.getAllStatus()
  })

  // ── Sistema ─────────────────────────────────────
  ipcMain.handle('system:pc-name', () => {
    return getPcName()
  })

  ipcMain.handle('system:running-processes', () => {
    return listRunningProcesses()
  })

  // ── Inicialização do PC (startup) ───────────────
  ipcMain.handle('startup:list', () => {
    return listStartupItems()
  })

  ipcMain.handle(
    'startup:remove',
    (_event, item: { location: string; scope: string; name: string }) => {
      return removeStartupItem(item as Parameters<typeof removeStartupItem>[0])
    }
  )

  ipcMain.handle('startup:add', (_event, item: { name: string; path: string }) => {
    return addStartupItem(item as Parameters<typeof addStartupItem>[0])
  })

  ipcMain.handle(
    'startup:removeBatch',
    (_event, items: Array<{ location: string; scope: string; name: string }>) => {
      return removeStartupItemsBatch(items as Parameters<typeof removeStartupItemsBatch>[0])
    }
  )

  ipcMain.handle('startup:addBatch', (_event, items: Array<{ name: string; path: string }>) => {
    return addStartupItemsBatch(items as Parameters<typeof addStartupItemsBatch>[0])
  })

  ipcMain.handle('app:logs', async (_event, appId: unknown) => {
    if (typeof appId !== 'string') return ''
    return processManager.getLogs(appId)
  })

  // ── IPC: Primeira execução ──────────────────────
  ipcMain.handle('firstRun:check', () => {
    return isFirstRun()
  })

  ipcMain.handle('firstRun:markComplete', () => {
    markFirstRunComplete()
    return { success: true }
  })

  // ── IPC: Window controls ────────────────────────
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  /**
   * Encerra completamente o Kolnd Hub: mata todos os processos lançados pelo
   * Hub (incluindo servidores e processos em segundo plano) e fecha a janela
   * e o próprio Electron (app.quit). Garante que nada do Hub fique aberto.
   */
  async function shutdownHub(): Promise<void> {
    try {
      processManager.killAll()
    } catch {
      // Ignora erros ao matar processos; ainda assim queremos sair.
    }
    if (mainWindow) {
      mainWindow.destroy()
    }
    app.quit()
  }

  ipcMain.handle('app:shutdown', async () => {
    await shutdownHub()
    return { success: true }
  })

  /**
   * Exibe o popup de confirmação "Você quer encerrar o Hub?". Se o usuário
   * confirmar, encerra todos os processos e sai do aplicativo. Se cancelar,
   * nada acontece e a janela permanece aberta.
   */
  async function confirmAndQuit(): Promise<void> {
    if (!mainWindow) return
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Encerrar Kolnd Hub',
      message: 'Você quer encerrar o Hub?',
      detail:
        'Todos os programas e servidores iniciados pelo Kolnd Hub serão fechados, ' +
        'incluindo o que estiver rodando em segundo plano.',
      buttons: ['Sim', 'Não'],
      defaultId: 1,
      cancelId: 1
    })
    if (response === 0) {
      await shutdownHub()
    }
  }

  ipcMain.handle('window:close', async () => {
    await confirmAndQuit()
  })

  // Intercepta o evento de fechamento da janela (X do SO, Alt+F4, etc.) para
  // também exibir o popup de confirmação em vez de apenas esconder a janela.
  mainWindow?.on('close', (event) => {
    event.preventDefault()
    void confirmAndQuit()
  })

  // ── IPC: Diálogos (Configurações) ───────────────
  // Abre o explorador de arquivos nativo para escolher o executável (file)
  // ou a pasta de instalação (directory) de um app. Cancelar retorna
  // { success: false, canceled: true } e nada é alterado no renderer.
  ipcMain.handle(
    'dialog:pick-path',
    async (
      _event,
      mode: 'file' | 'directory',
      currentValue?: string
    ): Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }> => {
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

      const options: Electron.OpenDialogOptions =
        mode === 'file'
          ? {
              title: 'Selecionar o executável do programa',
              properties: ['openFile'],
              filters: [
                { name: 'Executáveis', extensions: ['exe', 'bat', 'cmd', 'ps1', 'com'] },
                { name: 'Todos os arquivos', extensions: ['*'] }
              ],
              defaultPath
            }
          : {
              title: 'Selecionar a pasta de instalação do programa',
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

  // ── IPC: Shell ──────────────────────────────────
  ipcMain.handle('shell:openExternal', (_event, url: unknown) => {
    if (typeof url !== 'string' || !isAllowedExternalUrl(url)) {
      console.warn(`[shell] openExternal bloqueado (esquema não permitido): ${String(url)}`)
      return
    }
    void shell.openExternal(url)
  })

  ipcMain.handle('shell:openPath', (_event, path: unknown) => {
    if (typeof path !== 'string' || path.trim().length === 0 || path.length > 1024) return
    // Settings may store relative paths (../Kloud Games) or %VAR% paths.
    void shell.openPath(resolvePath(path))
  })

  // ── Forward process events to renderer ──────────
  processManager.on('status-change', (appId: string, status: string) => {
    mainWindow?.webContents.send('app:status-changed', appId, status)
  })

  processManager.on('output', (appId: string, data: string) => {
    mainWindow?.webContents.send('app:output', appId, data)
  })

  const firstRun = isFirstRun()
  createWindow(firstRun)
  createTray()
})

app.on('window-all-closed', () => {
  // Don't quit — hide to system tray
})

app.on('before-quit', () => {
  processManager.killAll()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
