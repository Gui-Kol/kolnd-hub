import { app, globalShortcut, ipcMain } from 'electron'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'
import {
  acquireHwPolling,
  collectHwSnapshot,
  onHwSnapshot,
  releaseHwPolling,
  setHwPollingHudVisible
} from '../hwmon'
import { getHudConfig, setHudShortcut, setHudSize, setHudVisible } from '../store'
import { ensureFpsActivation, getCachedFpsReading, refreshFpsReading } from '../fps'
import type { HudFpsReading } from '../../shared/fps'
import {
  HUD_DEFAULT_SCALE,
  HUD_DEFAULT_SHORTCUT,
  HUD_DEFAULT_WIDTH,
  normalizeAccelerator,
  normalizeHudHeight,
  type HudConfig,
  type HudSize,
  type HudStatus,
  type HudUpdate
} from '../../shared/hud'
import { HUD_PUSH_MIN_INTERVAL_MS, type HwSnapshot } from '../../shared/hwmon'
import {
  destroyHudWindow,
  getHudWindow,
  hideHudWindow,
  setHudHeight,
  setHudWidth,
  showHudWindow
} from './overlayWindow'

/**
 * Orquestração da sobreposição (HUD): atalho global, visibilidade e push de
 * dados. O atalho é a única entrada do HUD — a janela não recebe foco nem
 * clique, então tudo precisa funcionar estando o Hub em segundo plano.
 *
 * Dados: assina o polling do `hwmon` (refcount) e envia `hud:update` para a
 * janela do HUD. Assim a aba Monitor fechada não deixa a sobreposição vazia e
 * só existe um timer de sensores no app inteiro.
 */

const SHORTCUT_IN_USE_ERROR =
  'Não foi possível registrar o atalho — ele pode estar em uso por outro programa.'
const INVALID_SHORTCUT_ERROR = 'Atalho inválido. Use combinações como Ctrl+Alt+K.'

let shortcut = HUD_DEFAULT_SHORTCUT
let size: HudSize = { width: HUD_DEFAULT_WIDTH, scale: HUD_DEFAULT_SCALE }
let context: IpcContext | null = null
let registered = false
let registerError: string | undefined
let visible = false
let unsubscribeSnapshots: (() => void) | null = null
let pollingAcquired = false
/** Último push aceito (epoch ms); 0 = nenhum desde que o HUD abriu. */
let lastPushAt = 0

/**
 * Folga do throttle de 1 Hz: o `setInterval` do polling pode entregar o tick
 * alguns ms antes do segundo cheio; sem folga, com só o HUD ativo o push seria
 * descartado em ticks alternados e o HUD atualizaria a cada 2 s.
 */
const HUD_PUSH_JITTER_TOLERANCE_MS = 100

function assertNoArguments(args: unknown[]): void {
  if (args.length > 0) throw new Error('Requisição inválida.')
}

function currentStatus(): HudStatus {
  const config: HudConfig = {
    shortcut,
    visible,
    width: size.width,
    scale: size.scale
  }
  const status: HudStatus = { config, registered }
  if (registerError) status.error = registerError
  return status
}

/**
 * Monta o payload do push. A fonte única é a leitura do `hwmon`; o overlay só
 * recebe o snapshot, o tamanho vigente, o instante da captura e a leitura de
 * FPS (aditiva, pode ser omitida quando ainda não há medição).
 */
function buildHudUpdate(snapshot: HwSnapshot, fps: HudFpsReading | null): HudUpdate {
  const update: HudUpdate = {
    snapshot,
    size: { width: size.width, scale: size.scale },
    capturedAt: new Date().toISOString()
  }
  if (fps) update.fps = fps
  return update
}

/**
 * Avisa a janela principal quando o HUD muda por fora da aba Monitor (atalho
 * global, IPC, restaurar ao abrir). Sem isso o switch "Mostrar sobreposição"
 * ficaria com estado velho enquanto o usuário usa o atalho.
 */
function broadcastStatus(): void {
  const window = context?.getMainWindow()
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send('hud:status', currentStatus())
  } catch {
    // Janela fechando entre a checagem e o envio: nada a fazer.
  }
}

/**
 * Push `hud:update` para a sobreposição. O ritmo é limitado a 1 Hz: snapshots
 * mais novos que `HUD_PUSH_MIN_INTERVAL_MS` são descartados (o próximo tick já
 * traz leitura fresca). `force` vale para o push explícito ao mostrar o HUD, que
 * não pode ser engolido por um envio recente.
 */
function sendHudUpdate(snapshot: HwSnapshot, force = false): void {
  const window = getHudWindow()
  if (!window || window.isDestroyed() || !window.isVisible()) return

  const now = Date.now()
  if (!force && now - lastPushAt < HUD_PUSH_MIN_INTERVAL_MS - HUD_PUSH_JITTER_TOLERANCE_MS) {
    return
  }

  try {
    window.webContents.send('hud:update', buildHudUpdate(snapshot, getCachedFpsReading()))
    lastPushAt = now
  } catch {
    // Janela fechando entre a checagem e o envio: o próximo tick não envia.
  }
}

/** Uma leitura imediata ao mostrar — o primeiro push não espera 1 s. */
async function pushHudUpdateNow(): Promise<void> {
  // Atualiza a leitura de FPS antes do primeiro envio; a falha não impede o
  // push dos sensores (o overlay cai em "—" com motivo).
  try {
    await refreshFpsReading()
  } catch (err) {
    logger.warn('hud', `leitura inicial de FPS falhou: ${String(err)}`)
  }
  try {
    sendHudUpdate(await collectHwSnapshot(), true)
  } catch (err) {
    logger.warn('hud', `leitura inicial da sobreposição falhou: ${String(err)}`)
  }
}

function startHudData(): void {
  if (unsubscribeSnapshots) return
  unsubscribeSnapshots = onHwSnapshot((snapshot) => sendHudUpdate(snapshot))
  if (!pollingAcquired) {
    pollingAcquired = true
    acquireHwPolling('hud')
  }
}

function stopHudData(): void {
  unsubscribeSnapshots?.()
  unsubscribeSnapshots = null
  lastPushAt = 0
  if (pollingAcquired) {
    pollingAcquired = false
    releaseHwPolling('hud')
  }
}

/** Aplica visibilidade: janela + polling + (opcionalmente) persistência. */
function applyVisible(next: boolean, persist: boolean): HudStatus {
  visible = next
  // O polling do hwmon só roda com alguém olhando: o HUD visível conta tanto
  // quanto a janela principal (a sobreposição funciona com o Hub na bandeja).
  setHwPollingHudVisible(next)

  if (next) {
    startHudData()
    // Largura persistida antes de exibir; a altura chega pelo `hud:report-size`
    // assim que o renderer mede o conteúdo.
    setHudWidth(size.width)
    const window = showHudWindow()
    // A janela pode estar carregando na primeira exibição: a leitura inicial
    // roda depois do load para o renderer já ter montado o listener.
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => void pushHudUpdateNow())
    } else {
      void pushHudUpdateNow()
    }
  } else {
    hideHudWindow()
    stopHudData()
  }

  if (persist) {
    const result = setHudVisible(next)
    if (!result.success) logger.warn('hud', `falha ao salvar visibilidade: ${result.error}`)
  }

  broadcastStatus()
  return currentStatus()
}

function toggleHud(): HudStatus {
  return applyVisible(!visible, true)
}

/**
 * Caminho do ATALHO (D1): no máximo UMA ativação por sessão, em background.
 * Só este caminho pede UAC; `hud:set-visible` e `hud:toggle` por IPC nunca
 * pedem (é o que mantém o e2e sem elevação). Cancelar não bloqueia o toggle.
 */
function toggleHudFromShortcut(): void {
  ensureFpsActivation()
  toggleHud()
}

/**
 * Registra o atalho, desregistrando o anterior. Em falha (atalho em uso),
 * re-registra o anterior para o usuário não ficar sem nenhum atalho.
 */
function registerShortcut(next: string): boolean {
  if (registered && next === shortcut) return true

  const previous = shortcut
  const hadPrevious = registered
  if (hadPrevious) {
    try {
      globalShortcut.unregister(previous)
    } catch {
      // O atalho anterior pode já ter sido liberado pelo SO.
    }
  }

  let ok = false
  try {
    ok = globalShortcut.register(next, () => {
      toggleHudFromShortcut()
    })
  } catch (err) {
    logger.warn('hud', `registro do atalho lançou: ${err instanceof Error ? err.message : err}`)
  }

  if (!ok) {
    registerError = SHORTCUT_IN_USE_ERROR
    registered = false
    if (hadPrevious) {
      try {
        registered = globalShortcut.register(previous, () => {
          toggleHudFromShortcut()
        })
      } catch {
        registered = false
      }
    }
    return false
  }

  shortcut = next
  registered = true
  registerError = undefined
  logger.info('hud', `atalho global registrado: ${next}`)
  return true
}

/** Valida + registra + persiste; devolve erro amigável quando qualquer etapa falha. */
function applyShortcut(input: unknown): { success: boolean; status: HudStatus; error?: string } {
  const normalized = normalizeAccelerator(input)
  if (!normalized) {
    return { success: false, status: currentStatus(), error: INVALID_SHORTCUT_ERROR }
  }

  if (!registerShortcut(normalized)) {
    return { success: false, status: currentStatus(), error: registerError }
  }

  const saved = setHudShortcut(normalized)
  if (!saved.success) {
    return {
      success: false,
      status: currentStatus(),
      error: saved.error ?? 'Não foi possível salvar o atalho.'
    }
  }

  return { success: true, status: currentStatus() }
}

/** Estado atual (IPC `hud:get` e UI da aba Monitor). */
export function getHudStatus(): HudStatus {
  return currentStatus()
}

/** Registra os canais IPC, restaura a preferência e para tudo no quit. */
export function registerHudIpc(ctx: IpcContext): void {
  context = ctx
  const config = getHudConfig()
  shortcut = config.shortcut
  size = { width: config.width, scale: config.scale }
  setHudWidth(size.width)
  registered = false
  registerError = undefined

  if (!registerShortcut(config.shortcut)) {
    logger.warn('hud', registerError ?? SHORTCUT_IN_USE_ERROR)
  }
  if (config.visible) applyVisible(true, false)

  ipcMain.handle('hud:get', (_event, ...args: unknown[]): HudStatus => {
    assertNoArguments(args)
    return currentStatus()
  })

  ipcMain.handle(
    'hud:set-shortcut',
    (
      _event,
      value: unknown,
      ...args: unknown[]
    ): { success: boolean; status: HudStatus; error?: string } => {
      assertNoArguments(args)
      return applyShortcut(value)
    }
  )

  ipcMain.handle('hud:set-visible', (_event, value: unknown, ...args: unknown[]): HudStatus => {
    assertNoArguments(args)
    if (typeof value !== 'boolean') throw new Error('Requisição inválida.')
    return applyVisible(value, true)
  })

  ipcMain.handle('hud:toggle', (_event, ...args: unknown[]): HudStatus => {
    assertNoArguments(args)
    return toggleHud()
  })

  ipcMain.handle(
    'hud:set-size',
    (
      _event,
      value: unknown,
      ...args: unknown[]
    ): { success: boolean; status: HudStatus; error?: string } => {
      assertNoArguments(args)
      const result = setHudSize(value)
      if (!result.success || !result.size) {
        return {
          success: false,
          status: currentStatus(),
          error: result.error ?? 'Não foi possível salvar o tamanho da sobreposição.'
        }
      }
      size = result.size
      setHudWidth(size.width)
      // Reenvia já com a nova escala; a altura é remedida pelo overlay.
      if (visible) void pushHudUpdateNow()
      return { success: true, status: currentStatus() }
    }
  )

  // Só a própria janela do HUD pode informar a altura do conteúdo: qualquer
  // outro renderer (XSS) não deve redimensionar a sobreposição.
  ipcMain.handle(
    'hud:report-size',
    (event, value: unknown, ...args: unknown[]): { height: number } => {
      assertNoArguments(args)
      const window = getHudWindow()
      if (!window || window.webContents !== event.sender) throw new Error('Requisição inválida.')
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Requisição inválida.')
      }
      const height = (value as Record<string, unknown>).height
      if (typeof height !== 'number' || !Number.isFinite(height)) {
        throw new Error('Requisição inválida.')
      }
      return { height: setHudHeight(normalizeHudHeight(height)) }
    }
  )

  app.once('will-quit', shutdownHud)
}

/** Quit: sem atalho registrado sobrando e sem janela órfã. */
function shutdownHud(): void {
  stopHudData()
  destroyHudWindow()
  try {
    globalShortcut.unregisterAll()
  } catch {
    // Processo já saindo: o SO libera os atalhos de qualquer forma.
  }
  registered = false
}

/** Apenas para testes: zera estado, assinatura e janela entre casos. */
export function resetHudForTests(): void {
  stopHudData()
  setHwPollingHudVisible(false)
  destroyHudWindow()
  context = null
  shortcut = HUD_DEFAULT_SHORTCUT
  size = { width: HUD_DEFAULT_WIDTH, scale: HUD_DEFAULT_SCALE }
  registered = false
  registerError = undefined
  visible = false
}
