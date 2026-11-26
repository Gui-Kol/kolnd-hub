import { BrowserWindow } from 'electron'
import { join } from 'path'
import type { SettingsSection } from '../shared/ipc'
import { isQuitting, markQuitting } from './quitState'
import { isAllowedNavigationUrl } from './navigation'
import { logger } from './logger'

/**
 * Ciclo de vida da janela principal (Configurações, rota `#settings`).
 *
 * A janela NÃO nasce no `whenReady`: o app começa só na bandeja e a janela é
 * criada sob demanda por `createMainWindow`/`showMainWindow`.
 */
let mainWindow: BrowserWindow | null = null

/** Janela principal viva, ou null antes da primeira abertura. */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * Windows está encerrando a sessão (logoff/desligamento): marca a saída para
 * que o `close` não segure o SO. O motivo fica no log de ciclo de vida.
 */
function onSessionEnd(): void {
  markQuitting()
  logger.info('lifecycle', 'sessão do SO encerrando (motivo: os-session-end)')
}

/**
 * Cria (ou devolve) a janela principal. O handler de `close` vive AQUI dentro,
 * não no `whenReady`, porque naquele momento a janela ainda não existe; era o
 * que deixava o X sem interceptação.
 */
export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  const window = new BrowserWindow({
    // Janela normal de Configurações: 720x560, redimensionável, nunca
    // always-on-top (o overlay é que flutua). O X continua apenas ocultando.
    width: 720,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
    alwaysOnTop: false,
    show: false,
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  // X/Alt+F4 e o close do SO ocultam para a bandeja em vez de encerrar. O
  // fechamento real só passa quando `isQuitting()` foi marcado (Sair via
  // bandeja, app:quit, desligamento do Windows).
  window.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    logger.info('window', 'ocultada para a bandeja')
    window.hide()
  })

  window.on('session-end', onSessionEnd)
  // `query-session-end` existe no runtime do Electron, mas ainda não está nas
  // typings do Electron 28; registra via EventEmitter mínimo.
  ;(window as unknown as NodeJS.EventEmitter).on('query-session-end', onSessionEnd)

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // Bloqueia navegação in-window: seguir para outra origem levaria o preload
  // do Absolem para um contexto remoto. Em dev só a origem do HMR passa.
  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigationUrl(url, process.env['ELECTRON_RENDERER_URL'])) return
    event.preventDefault()
    logger.warn('window', `will-navigate bloqueado: ${url}`)
  })

  // Nenhuma janela nova. Links externos ficam para uma task de UI decidir.
  window.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('window', `window.open bloqueado: ${url}`)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void window.loadURL(`${devUrl}#settings`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  }

  return window
}

/** Mostra/foca a janela, criando-a sob demanda (início é só bandeja). */
export function showMainWindow(section?: SettingsSection): BrowserWindow {
  const window = createMainWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (section) navigateToSection(window, section)
  return window
}

/**
 * Leva a janela já carregada (ou em carregamento) para a aba pedida. O hash é
 * a única fonte de rota do renderer; mudar o hash não recarrega a página.
 */
function navigateToSection(window: BrowserWindow, section: SettingsSection): void {
  const hash = `#settings/${section}`
  const apply = (): void => {
    void window.webContents
      .executeJavaScript(`window.location.hash = ${JSON.stringify(hash)}`)
      .catch(() => undefined)
  }
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', apply)
  } else {
    apply()
  }
}

/** Destrói a janela no encerramento limpo (usado pelo shutdown). */
export function destroyMainWindow(): void {
  const window = mainWindow
  mainWindow = null
  if (window && !window.isDestroyed()) window.destroy()
}

/** Hook exclusivo de teste: esquece a referência viva entre casos. */
export function resetMainWindowForTests(): void {
  mainWindow = null
}
