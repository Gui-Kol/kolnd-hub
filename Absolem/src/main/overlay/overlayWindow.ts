import { BrowserWindow } from 'electron'
import { join } from 'path'
import type { OverlayLayout } from '../../shared/config'
import { normalizeOverlayLayout } from '../../shared/overlay'
import { logger } from '../logger'
import { isAllowedNavigationUrl } from '../navigation'
import { SECURE_WEB_PREFERENCES, blockWebviewAttach } from '../security/webPreferences'
import { emitOverlayHidden } from '../voice/overlayEvents'
import { computeBoundsForLayout } from './displays'
import type { OverlayBounds } from './geometry'
import {
  bindOverlayInteractivity,
  resetInteractive,
  resetInteractiveForTests,
  unbindOverlayInteractivity
} from './interactive'

/**
 * Janela do overlay do avatar.
 *
 * É uma BrowserWindow própria renderizando a MESMA origem do renderer com o
 * hash `#overlay` — um único entry no electron-vite, sem segunda página.
 * Requisitos invioláveis: transparente, sem moldura, sempre no topo, fora da
 * barra de tarefas e do Alt+Tab, sem foco e com clique atravessando fora do
 * avatar. Por isso `focusable: false` + `showInactive()` — nunca `show()`, que
 * ativaria a janela e roubaria o foco de um jogo ou campo de texto.
 *
 * Posição/tamanho vêm do store em DIPs e são reaplicados a cada exibição e a
 * cada mudança de monitor (`display-*`).
 */

let overlayWindow: BrowserWindow | null = null
let layout: OverlayLayout = normalizeOverlayLayout(undefined)
let lastBounds: OverlayBounds | null = null

type OverlayWindowListener = (window: BrowserWindow) => void

/**
 * Observadores de criação da janela (usado por `ipc/avatar.ts` para pendurar o
 * reenvio de estado no `did-finish-load`). A janela nasce sob demanda, então um
 * observador registrado antes do primeiro show ainda é chamado na criação.
 */
const createdListeners = new Set<OverlayWindowListener>()

export function onOverlayWindowCreated(listener: OverlayWindowListener): () => void {
  createdListeners.add(listener)
  return () => {
    createdListeners.delete(listener)
  }
}

/** Layout vigente (usado pelo controlador e pelo IPC de status). */
export function getOverlayLayout(): OverlayLayout {
  return { ...layout }
}

/** Aplica um layout já completo (o chamador faz o merge do patch). */
export function setOverlayLayout(input: unknown): OverlayLayout {
  layout = normalizeOverlayLayout(input)
  applyBoundsIfExists()
  return getOverlayLayout()
}

function applyBounds(window: BrowserWindow): void {
  const desired = computeBoundsForLayout(layout, lastBounds)
  const current = window.getBounds()
  if (
    current.x !== desired.x ||
    current.y !== desired.y ||
    current.width !== desired.width ||
    current.height !== desired.height
  ) {
    window.setBounds(desired)
  }
  lastBounds = desired
}

function applyBoundsIfExists(): void {
  const window = getOverlayWindow()
  if (!window) return
  applyBounds(window)
}

/** Recalcula os bounds após `display-added|removed|metrics-changed`. */
export function reapplyOverlayBounds(): void {
  applyBoundsIfExists()
}

/** Janela viva, ou `null` antes da criação/depois do `closed`. */
export function getOverlayWindow(): BrowserWindow | null {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null
  return overlayWindow
}

/** Cria a janela (idempotente) e carrega a rota `#overlay`. */
export function createOverlayWindow(): BrowserWindow {
  const existing = getOverlayWindow()
  if (existing) return existing

  const bounds = computeBoundsForLayout(layout, lastBounds)
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    // Fundo totalmente transparente no Windows: sem isso o Chromium pinta
    // preto atrás do conteúdo mesmo com `transparent: true`.
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Absolem',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // A saudação chega sem clique do usuário; sem esta política o Chromium
      // suspende o áudio até o primeiro gesto na janela.
      autoplayPolicy: 'no-user-gesture-required',
      ...SECURE_WEB_PREFERENCES
    }
  })
  overlayWindow = window
  lastBounds = bounds

  blockWebviewAttach(window.webContents)

  for (const listener of createdListeners) listener(window)

  // `screen-saver` fica acima de jogos em janela/borderless; fullscreen
  // exclusivo pode cobrir, e é justamente o caso do auto-hide.
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setSkipTaskbar(true)
  // Estado padrão: clique atravessa sem ativar a janela; `forward` mantém os
  // eventos de hover para o renderer detectar a entrada no avatar.
  window.setIgnoreMouseEvents(true, { forward: true })
  bindOverlayInteractivity((isInteractive) => {
    if (window.isDestroyed()) return
    if (isInteractive) window.setIgnoreMouseEvents(false)
    else window.setIgnoreMouseEvents(true, { forward: true })
  })

  // Mesmas travas de navegação da janela principal: o preload fica exposto,
  // então nada de abrir janelas ou navegar para outra origem.
  window.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('overlay', `window.open bloqueado: ${url}`)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigationUrl(url, process.env['ELECTRON_RENDERER_URL'])) return
    event.preventDefault()
    logger.warn('overlay', `will-navigate bloqueado: ${url}`)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const loadPromise = devUrl
    ? window.loadURL(`${devUrl}#overlay`)
    : window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
  loadPromise.catch((err: unknown) => {
    logger.warn(
      'overlay',
      `falha ao carregar o overlay: ${err instanceof Error ? err.message : String(err)}`
    )
  })

  window.on('closed', () => {
    if (overlayWindow === window) overlayWindow = null
    unbindOverlayInteractivity()
  })

  logger.info('overlay', 'janela criada')
  return window
}

/** Exibe sem roubar foco (nunca `show()`). */
export function showOverlayWindow(): BrowserWindow {
  const window = createOverlayWindow()
  // Qualquer exibição começa não interativa: o renderer pede o contrário ao
  // entrar no avatar. Assim uma janela recriada nunca nasce capturando cliques.
  resetInteractive()
  window.setAlwaysOnTop(true, 'screen-saver')
  applyBounds(window)
  if (!window.isVisible()) window.showInactive()
  logger.info('overlay', 'exibida com showInactive')
  return window
}

/** Oculta sem destruir — reabrir pelo atalho fica instantâneo. */
export function hideOverlayWindow(): void {
  hideOverlayWindowForCapture()
  emitOverlayHidden()
}

/**
 * Oculta temporariamente para uma captura de tela sem emitir o evento que
 * encerra a sessão normal de voz.
 */
export function hideOverlayWindowForCapture(): void {
  const window = getOverlayWindow()
  resetInteractive()
  if (window && window.isVisible()) {
    window.hide()
    logger.info('overlay', 'ocultada')
  }
}

/** Alterna e devolve o estado resultante. */
export function toggleOverlayWindow(): boolean {
  if (isOverlayVisible()) {
    hideOverlayWindow()
    return false
  }
  showOverlayWindow()
  return true
}

/** Estado real da janela (não a preferência persistida). */
export function isOverlayVisible(): boolean {
  return getOverlayWindow()?.isVisible() === true
}

/** Destrói no encerramento: nada de janela órfã depois do app fechar. */
export function destroyOverlayWindow(): void {
  const window = getOverlayWindow()
  overlayWindow = null
  resetInteractive()
  unbindOverlayInteractivity()
  if (!window) return
  try {
    window.destroy()
    logger.info('overlay', 'janela destruída')
  } catch {
    // Janela já em processo de fechamento: não há o que desfazer.
  }
}

/** Hook exclusivo de teste: esquece janela, layout e estado interativo. */
export function resetOverlayWindowForTests(): void {
  overlayWindow = null
  layout = normalizeOverlayLayout(undefined)
  lastBounds = null
  createdListeners.clear()
  resetInteractiveForTests()
}
