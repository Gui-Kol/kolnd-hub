// PRIMEIRO import: efeito colateral intencional - inicia o crashReporter local
// (uploadToServer: false) e registra os handlers de crash antes da avaliação de
// qualquer outro módulo do main.
import './crashReporting'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import type { IpcContext } from './ipc'
import { isQuitting, markQuitting } from './quitState'
import { getStoreSnapshot } from './store'
import { isAllowedNavigationUrl } from './navigation'
import { logger } from './logger'

let mainWindow: BrowserWindow | null = null

/**
 * Contexto dos módulos IPC. A janela é lida por getter (reassinalada em
 * createWindow); o overlay entra na task 02 e por isso ainda devolve null.
 */
const ctx: IpcContext = {
  getMainWindow: () => mainWindow,
  getOverlayWindow: () => null,
  getStoreSnapshot,
  isQuitting
}

// Instância única: o lock é pedido antes de qualquer bootstrap. Sem o lock a
// segunda instância encerra sem criar janela, sem IPC e sem tocar no disco.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
} else {
  app.quit()
}

/** Cria a janela principal mínima da fundação (900x600, oculta até pintar). */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Bloqueia navegação in-window: seguir para outra origem levaria o preload
  // do Absolem para um contexto remoto. Em dev só a origem do HMR passa.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigationUrl(url, process.env['ELECTRON_RENDERER_URL'])) return
    event.preventDefault()
    logger.warn('window', `will-navigate bloqueado: ${url}`)
  })

  // Nenhuma janela nova. Links externos ficam para uma task de UI decidir.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('window', `window.open bloqueado: ${url}`)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Lock negado: o app.quit() acima já encerra; nada de bootstrap.
  if (!gotSingleInstanceLock) return

  app.setAppUserModelId('com.kolnd.absolem')
  logger.info('app', `Absolem ${app.getVersion()} iniciando (${process.platform})`)

  registerIpc(ctx)
  createWindow()
})

if (gotSingleInstanceLock) {
  // A bandeja entra na task 01: fechar a janela não encerra o app.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    markQuitting()
  })

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    mainWindow.show()
    mainWindow.focus()
  })
}
