import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { logger } from '../logger'
import {
  fitHudHeight,
  HUD_DEFAULT_WIDTH,
  HUD_INITIAL_HEIGHT,
  HUD_MARGIN_PX,
  normalizeHudHeight,
  normalizeHudWidth
} from '../../shared/hud'

/**
 * Janela da sobreposição (HUD) — decisão 1/5 da tarefa.
 *
 * É uma BrowserWindow própria do app, renderizando a MESMA origem com o hash
 * `#hud` (sem segundo entry no electron-vite). Requisitos invioláveis:
 * transparente, sempre no topo, sem foco, sem clique, fora da barra de tarefas
 * e do Alt+Tab. Por isso `focusable: false` + `showInactive()` + clique
 * atravessando (`setIgnoreMouseEvents`) — nunca `show()`, que ativaria a janela.
 *
 * Posição: canto superior ESQUERDO da área de trabalho do monitor primário
 * (margem 12 px), recalculada a cada exibição — o usuário pode ter trocado o
 * monitor primário ou a resolução desde a última vez. Largura vem do store;
 * altura vem da medição do renderer (`hud:report-size`) para nunca cortar
 * conteúdo.
 */

let hudWindow: BrowserWindow | null = null
let hudWidth = HUD_DEFAULT_WIDTH
let hudHeight = HUD_INITIAL_HEIGHT

/** Bounds desejados para uma dada área de trabalho — pura, testável. */
export function computeHudBounds(
  workArea: Electron.Rectangle,
  width: number,
  height: number
): Electron.Rectangle {
  return {
    x: workArea.x + HUD_MARGIN_PX,
    y: workArea.y + HUD_MARGIN_PX,
    width: normalizeHudWidth(width),
    // Nunca maior que a área de trabalho: o rodapé ficaria fora do monitor.
    height: fitHudHeight(height, workArea.height)
  }
}

/** Canto superior esquerdo da área de trabalho do monitor primário. */
function hudBounds(): Electron.Rectangle {
  return computeHudBounds(screen.getPrimaryDisplay().workArea, hudWidth, hudHeight)
}

/** Largura persistida (o main chama ao iniciar e em `hud:set-size`). */
export function setHudWidth(width: unknown): number {
  hudWidth = normalizeHudWidth(width)
  applyBoundsIfChanged()
  return hudWidth
}

/**
 * Altura medida pelo overlay. Ignora diferença de 1 px para não entrar em
 * loop de resize com o arredondamento de borda do Chromium.
 */
export function setHudHeight(height: unknown): number {
  const next = normalizeHudHeight(height)
  if (Math.abs(next - hudHeight) < 2) return hudHeight
  hudHeight = next
  applyBoundsIfChanged()
  return hudHeight
}

/** Aplica os bounds quando a janela existe e algo mudou (evita `setBounds` à toa). */
function applyBoundsIfChanged(): void {
  const window = getHudWindow()
  if (!window) return
  const desired = hudBounds()
  const current = window.getBounds()
  if (
    current.x === desired.x &&
    current.y === desired.y &&
    current.width === desired.width &&
    current.height === desired.height
  ) {
    return
  }
  window.setBounds(desired)
}

/** Tamanho atual (usado pelo IPC e pelos testes). */
export function getHudWindowSize(): { width: number; height: number } {
  return { width: hudWidth, height: hudHeight }
}

/** Janela viva (ou `null` quando nunca criada/destruída). */
export function getHudWindow(): BrowserWindow | null {
  if (!hudWindow || hudWindow.isDestroyed()) return null
  return hudWindow
}

/** Cria a janela (idempotente) e carrega a rota `#hud`. */
export function createHudWindow(): BrowserWindow {
  const existing = getHudWindow()
  if (existing) return existing

  const window = new BrowserWindow({
    ...hudBounds(),
    show: false,
    frame: false,
    transparent: true,
    // Fundo totalmente transparente no Windows — sem isso o Chromium pinta
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
    title: 'Kolnd Hub — Sobreposição',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // `screen-saver` fica acima de jogos em janela/borderless na maioria dos
  // casos; tela cheia exclusiva pode cobrir (documentado na UI).
  window.setAlwaysOnTop(true, 'screen-saver')
  // Clique atravessa sem ativar a janela; `forward` mantém eventos de hover.
  window.setIgnoreMouseEvents(true, { forward: true })
  window.setSkipTaskbar(true)

  // Mesmas travas de navegação da janela principal: o preload fica exposto,
  // então nada de abrir janelas ou navegar para outra origem.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      try {
        if (new URL(url).origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin) {
          return
        }
      } catch {
        // URL inválida: cai no bloqueio padrão abaixo.
      }
    }
    event.preventDefault()
    logger.warn('hud', `will-navigate bloqueado na sobreposição: ${url}`)
  })

  const loadPromise =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#hud`)
      : window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'hud' })
  loadPromise.catch((err: unknown) => {
    logger.warn(
      'hud',
      `falha ao carregar a sobreposição: ${err instanceof Error ? err.message : String(err)}`
    )
  })

  window.on('closed', () => {
    hudWindow = null
  })

  hudWindow = window
  logger.info('hud', 'janela da sobreposição criada')
  return window
}

/** Exibe sem roubar foco (nunca `show()`): `showInactive` mantém o app focado. */
export function showHudWindow(): BrowserWindow {
  const window = createHudWindow()
  // Reaplica topo e posição: outras janelas podem ter rebaixado a sobreposição
  // e o monitor primário/área de trabalho pode ter mudado entre as exibições.
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setBounds(hudBounds())
  if (!window.isVisible()) window.showInactive()
  return window
}

/** Oculta sem destruir — reabrir pelo atalho fica instantâneo. */
export function hideHudWindow(): void {
  const window = getHudWindow()
  if (window?.isVisible()) window.hide()
}

/** Precisa do estado real da janela (usado pelo IPC e pelos testes). */
export function isHudWindowVisible(): boolean {
  return getHudWindow()?.isVisible() === true
}

/** Destrói a janela (quit/saída): nada de janela órfã depois do app fechar. */
export function destroyHudWindow(): void {
  const window = getHudWindow()
  hudWindow = null
  if (!window) return
  try {
    window.destroy()
  } catch {
    // Janela já em processo de fechamento — não há o que desfazer.
  }
}
