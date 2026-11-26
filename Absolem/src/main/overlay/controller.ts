import { screen } from 'electron'
import type { BrowserWindow } from 'electron'
import type { OverlayConfig, OverlayLayout } from '../../shared/config'
import { IPC } from '../../shared/ipc'
import type { OverlayStatus, OverlayStatusResult } from '../../shared/ipc'
import { isOverlayPosition, normalizeOverlayLayout } from '../../shared/overlay'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'
import { registerShutdownHook } from '../shutdown'
import { getStoreValue, setStoreValue } from '../store'
import { watchDisplayChanges } from './displays'
import { getForegroundWindow, shouldHideForFullscreen } from './foreground'
import { isInteractive, setInteractive } from './interactive'
import {
  destroyOverlayWindow,
  getOverlayLayout,
  getOverlayWindow,
  hideOverlayWindow,
  isOverlayVisible,
  reapplyOverlayBounds,
  setOverlayLayout,
  showOverlayWindow
} from './overlayWindow'
import { getShortcutStatus, registerOverlayShortcut } from './shortcut'

/**
 * Controlador do overlay: visibilidade, persistência, atalho global, push de
 * status e auto-hide em tela cheia.
 *
 * Regras de segurança:
 * - o overlay começa oculto; só aparece por ação explícita, atalho ou pela
 *   preferência persistida (`overlay.visible`), exceto no autostart `--hidden`;
 * - hide/show sempre resetam o estado interativo (a janela volta a deixar o
 *   clique atravessar);
 * - auto-hide por tela cheia NÃO persiste `visible:false`: ao sair do
 *   fullscreen o overlay volta e, se o usuário escondeu de propósito, o
 *   watcher já foi parado.
 */

/** Intervalo mínimo de sondagem; não descer abaixo de 2 s (custo/ruído). */
export const FULLSCREEN_POLL_MS = 2000

let context: IpcContext | null = null
let hideOnFullscreen = true
let autoHidden = false
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollBusy = false
let stopDisplayWatch: (() => void) | null = null
let initialized = false

function currentConfig(): OverlayConfig {
  const snapshot = context?.getStoreSnapshot()
  return snapshot ? snapshot.overlay : (getStoreValue('overlay') as OverlayConfig)
}

function persistOverlay(patch: Partial<OverlayConfig>): void {
  const result = setStoreValue('overlay', { ...currentConfig(), ...patch })
  if (!result.success) {
    logger.warn('overlay', `falha ao persistir a configuração: ${result.error ?? 'desconhecida'}`)
  }
}

/** Status atual para o IPC e para o push `overlay:status-changed`. */
export function getOverlayStatus(): OverlayStatus {
  return {
    visible: isOverlayVisible(),
    interactive: isInteractive(),
    autoHidden,
    layout: getOverlayLayout(),
    shortcut: getShortcutStatus(),
    hideOnFullscreen
  }
}

function pushTo(window: BrowserWindow | null, status: OverlayStatus): void {
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send(IPC.overlayStatusChanged, status)
  } catch {
    // Janela fechando entre a checagem e o envio: o próximo evento reenvia.
  }
}

function broadcastStatus(): OverlayStatus {
  const status = getOverlayStatus()
  pushTo(getOverlayWindow(), status)
  pushTo(context?.getMainWindow() ?? null, status)
  return status
}

function startFullscreenWatch(): void {
  if (pollTimer || !hideOnFullscreen) return
  if (!isOverlayVisible() && !autoHidden) return
  pollTimer = setInterval(() => {
    void pollForeground()
  }, FULLSCREEN_POLL_MS)
}

function stopFullscreenWatch(): void {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

/**
 * Sonda assíncrona (PowerShell com timeout). Falha/JSON inválido = `null`:
 * nunca oculta por leitura ruim. A própria janela do Absolem é ignorada.
 */
async function pollForeground(): Promise<void> {
  if (pollBusy) return
  if (!hideOnFullscreen || (!isOverlayVisible() && !autoHidden)) {
    stopFullscreenWatch()
    return
  }

  pollBusy = true
  try {
    const foreground = await getForegroundWindow()
    if (!foreground) return

    const workArea = screen.getDisplayMatching(foreground.bounds).workArea
    const fullscreen = shouldHideForFullscreen(foreground, workArea, process.pid)

    if (fullscreen && !autoHidden) {
      autoHidden = true
      hideOverlayWindow()
      logger.info('overlay', 'ocultada automaticamente (tela cheia)')
      broadcastStatus()
    } else if (!fullscreen && autoHidden) {
      autoHidden = false
      showOverlayWindow()
      logger.info('overlay', 'reexibida ao sair da tela cheia')
      broadcastStatus()
    }
  } catch (err) {
    logger.warn('overlay', 'falha ao consultar a janela em primeiro plano', err)
  } finally {
    pollBusy = false
  }
}

function applyVisible(next: boolean, persist: boolean): OverlayStatus {
  if (next) {
    autoHidden = false
    showOverlayWindow()
    startFullscreenWatch()
  } else {
    autoHidden = false
    hideOverlayWindow()
    stopFullscreenWatch()
  }

  if (persist) persistOverlay({ visible: next })
  return broadcastStatus()
}

/** Mostra o overlay (não rouba foco: a janela usa `showInactive`). */
export function showOverlay(): OverlayStatus {
  return applyVisible(true, true)
}

/** Oculta por ação do usuário (atalho, bandeja ou IPC). */
export function hideOverlay(): OverlayStatus {
  return applyVisible(false, true)
}

export function toggleOverlay(): OverlayStatus {
  return isOverlayVisible() ? hideOverlay() : showOverlay()
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const LAYOUT_KEYS = ['position', 'offsetX', 'offsetY', 'width', 'height'] as const

/** Valida e aplica um patch de layout; persiste o resultado normalizado. */
export function setOverlayLayoutFromRequest(input: unknown): OverlayStatusResult {
  if (!isPlainRecord(input)) {
    return { ok: false, error: 'Payload inválido para overlay:set-layout.' }
  }

  for (const key of Object.keys(input)) {
    if (!(LAYOUT_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: `Campo desconhecido em overlay:set-layout: ${key}` }
    }
    const value = input[key]
    if (key === 'position') {
      if (typeof value !== 'string' || !isOverlayPosition(value)) {
        return { ok: false, error: 'Posição do overlay inválida.' }
      }
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `Valor inválido em overlay:set-layout: ${key}` }
    }
  }

  const merged: OverlayLayout = normalizeOverlayLayout({ ...getOverlayLayout(), ...input })
  const applied = setOverlayLayout(merged)
  persistOverlay(applied)
  return { ok: true, status: broadcastStatus() }
}

/** Valida e aplica `{ interactive: boolean }`. */
export function setOverlayInteractiveFromRequest(input: unknown): OverlayStatusResult {
  if (!isPlainRecord(input) || typeof input.interactive !== 'boolean') {
    return { ok: false, error: 'Payload inválido para overlay:set-interactive.' }
  }

  setInteractive(input.interactive)
  logger.info('overlay', `interativo: ${input.interactive ? 'sim' : 'não'}`)
  return { ok: true, status: broadcastStatus() }
}

/**
 * Inicializa no `whenReady` (screen/globalShortcut exigem app pronto):
 * aplica o layout persistido, registra o atalho, observa monitores, instala o
 * gancho de encerramento e reexibe se a preferência mandar.
 */
export function initializeOverlay(ctx: IpcContext): void {
  if (initialized) return
  initialized = true

  context = ctx
  const config = ctx.getStoreSnapshot().overlay
  hideOnFullscreen = config.hideOnFullscreen
  setOverlayLayout(config)

  registerOverlayShortcut(config.shortcut, () => {
    toggleOverlay()
  })

  stopDisplayWatch = watchDisplayChanges(() => {
    reapplyOverlayBounds()
    broadcastStatus()
  })

  registerShutdownHook('overlay', shutdownOverlay)

  if (config.visible && !process.argv.includes('--hidden')) {
    applyVisible(true, false)
  }
}

/** Encerramento: para timers, solta os monitores e destrói a janela. */
export function shutdownOverlay(): void {
  stopFullscreenWatch()
  stopDisplayWatch?.()
  stopDisplayWatch = null
  destroyOverlayWindow()
}

/** Hook exclusivo de teste: zera estado e timers. */
export function resetOverlayControllerForTests(): void {
  stopFullscreenWatch()
  stopDisplayWatch?.()
  stopDisplayWatch = null
  context = null
  hideOnFullscreen = true
  autoHidden = false
  pollBusy = false
  initialized = false
}
