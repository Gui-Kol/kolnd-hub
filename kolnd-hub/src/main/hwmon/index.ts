import { app, ipcMain } from 'electron'
import { logger } from '../logger'
import type { IpcContext } from '../ipc/lifecycle'
import { readCpuPower, type CpuPowerReading } from './cpuPower'
import {
  getDriverStatus,
  installDriver,
  type DriverStatusInfo,
  type InstallDriverResult
} from './driver'
import { snapshotNative, type DriverStatus, type HwSnapshot } from './nativeSensors'
import { estimatePlatformWatts, estimateTotalWatts } from './powerEstimate'

/**
 * Orquestração do monitor de hardware (Fase A).
 *
 * Um único polling (1 Hz) compartilhado por refcount entre a aba Monitor e a
 * sobreposição (HUD); cada consumidor chama `acquireHwPolling`/`releaseHwPolling`.
 * O renderer da aba usa `hwmon:start`/`hwmon:stop`, que mapeiam para o refcount.
 * Leituras são assíncronas e nunca lançam para o renderer: sensor ausente vira
 * `null` (a UI mostra "—").
 */

const POLL_INTERVAL_MS = 1000

let context: IpcContext | null = null
let timer: ReturnType<typeof setInterval> | null = null
let polling = false
let driverState: DriverStatus = 'absent'
let driverKnown = false
let statusPromise: Promise<DriverStatusInfo> | null = null

/**
 * Refcount de consumidores do polling: a aba Monitor e a sobreposição (HUD)
 * podem querer a mesma leitura ao mesmo tempo. Um único timer atende os dois;
 * ele só para quando o último consumidor solta.
 */
let refCount = 0

/**
 * Assinantes de cada snapshot (push `hud:update`). Ficam separados do envio
 * para a janela principal porque o HUD tem outra janela e outro payload.
 */
const snapshotListeners = new Set<(snapshot: HwSnapshot) => void>()

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Combina CPU (RAPL/SMN) com o snapshot nativo — pura, exportada para testes.
 *
 * Precedência fechada: `cpuW` medido (driver) vence a estimativa, e o total
 * medido vence o estimado. A estimativa da CPU já vem do snapshot nativo
 * (único ponto com núcleos + uso); aqui só recalculamos o total estimado com a
 * GPU medida deste tick. Sem driver, a linha medida fica `null` e a UI usa a
 * estimativa rotulada.
 */
export function mergeCpuReadings(
  native: HwSnapshot,
  cpu: CpuPowerReading,
  driver: DriverStatus
): HwSnapshot {
  const cpuW = cpu.watts
  const gpuW = native.gpu.watts
  const totalMeasuredW = cpuW !== null && gpuW !== null ? round1(cpuW + gpuW) : null

  const cpuEstimatedW = native.power.cpuEstimatedW ?? null
  const platformEstimatedW = native.power.platformEstimatedW ?? estimatePlatformWatts()
  const totalEstimatedW = estimateTotalWatts({ cpuEstimatedW, gpuW, platformW: platformEstimatedW })

  return {
    ...native,
    cpu: { ...native.cpu, tempC: cpu.tempC, watts: cpuW },
    power: {
      cpuW,
      gpuW,
      totalMeasuredW,
      cpuEstimatedW,
      platformEstimatedW,
      totalEstimatedW
    },
    sources: {
      driver,
      cpu: cpuW !== null ? 'measured' : cpuEstimatedW !== null ? 'estimated' : 'unavailable',
      gpu: gpuW !== null ? 'measured' : 'unavailable',
      platform: 'estimated'
    }
  }
}

/** Consulta o status do driver, coalescendo chamadas concorrentes. */
function refreshDriverStatus(): Promise<DriverStatusInfo> {
  if (!statusPromise) {
    statusPromise = getDriverStatus()
      .then((info) => {
        driverState = info.state
        driverKnown = true
        return info
      })
      .finally(() => {
        statusPromise = null
      })
  }
  return statusPromise
}

/**
 * Um snapshot completo. O helper WinRing0 só é chamado com o device
 * acessível (`ready`) — sem driver, CPU temp/potência seguem `null`.
 */
export async function collectHwSnapshot(): Promise<HwSnapshot> {
  if (!driverKnown) {
    await refreshDriverStatus().catch(() => undefined)
  }

  if (driverState === 'ready') {
    const [native, cpu] = await Promise.all([snapshotNative(), readCpuPower()])
    if (!cpu.available) {
      // Driver caiu/serviço parou: reavalia para não insistir a cada tick.
      await refreshDriverStatus().catch(() => undefined)
    }
    return mergeCpuReadings(native, cpu, driverState)
  }

  const native = await snapshotNative()
  return mergeCpuReadings(native, { available: false, tempC: null, watts: null }, driverState)
}

function sendUpdate(snapshot: HwSnapshot): void {
  const window = context?.getMainWindow()
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send('hwmon:update', snapshot)
  } catch {
    // Janela fechando entre a checagem e o envio: o próximo tick simplesmente não envia.
  }
}

/** Notifica os assinantes (HUD) — um listener que falha não derruba o tick. */
function notifySnapshot(snapshot: HwSnapshot): void {
  for (const listener of snapshotListeners) {
    try {
      listener(snapshot)
    } catch (err) {
      logger.warn(
        'hwmon',
        `listener do snapshot falhou: ${err instanceof Error ? err.message : err}`
      )
    }
  }
}

/**
 * Assina cada snapshot produzido pelo polling. Devolve a função de cancelamento.
 * Usado pelo HUD para fazer o push `hud:update` sem criar um segundo timer.
 */
export function onHwSnapshot(listener: (snapshot: HwSnapshot) => void): () => void {
  snapshotListeners.add(listener)
  return () => {
    snapshotListeners.delete(listener)
  }
}

async function pollOnce(): Promise<void> {
  if (polling) return
  polling = true
  try {
    const snapshot = await collectHwSnapshot()
    sendUpdate(snapshot)
    notifySnapshot(snapshot)
  } catch (err) {
    logger.warn('hwmon', `polling falhou: ${err instanceof Error ? err.message : err}`)
  } finally {
    polling = false
  }
}

function startPolling(): void {
  if (timer) return
  void pollOnce()
  timer = setInterval(() => {
    void pollOnce()
  }, POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  polling = false
}

/**
 * Adquire o polling (aba Monitor com `hwmon:start`, HUD ao ficar visível).
 * Idempotente por consumidor: cada acquire precisa do release correspondente.
 */
export function acquireHwPolling(): void {
  refCount += 1
  startPolling()
}

/** Solta o polling; só para quando o último consumidor sair. */
export function releaseHwPolling(): void {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0) stopPolling()
}

/** Para o polling e zera o refcount (chamado no `will-quit`). */
export function stopHwMonitorPolling(): void {
  refCount = 0
  stopPolling()
}

/** Apenas para testes: quantos consumidores estão segurando o polling agora. */
export function getHwPollingRefCountForTests(): number {
  return refCount
}

function assertNoArguments(args: unknown[]): void {
  if (args.length > 0) throw new Error('Requisição inválida.')
}

/** Registra os canais IPC do monitor de hardware. */
export function registerHwMonitorIpc(ctx: IpcContext): void {
  context = ctx

  ipcMain.handle('hwmon:snapshot', async (_event, ...args: unknown[]): Promise<HwSnapshot> => {
    assertNoArguments(args)
    return collectHwSnapshot()
  })

  ipcMain.handle('hwmon:start', (_event, ...args: unknown[]): { ok: boolean } => {
    assertNoArguments(args)
    acquireHwPolling()
    return { ok: true }
  })

  ipcMain.handle('hwmon:stop', (_event, ...args: unknown[]): { ok: boolean } => {
    assertNoArguments(args)
    releaseHwPolling()
    return { ok: true }
  })

  ipcMain.handle(
    'hwmon:driver-status',
    async (_event, ...args: unknown[]): Promise<DriverStatusInfo> => {
      assertNoArguments(args)
      return refreshDriverStatus()
    }
  )

  ipcMain.handle(
    'hwmon:install-driver',
    async (_event, ...args: unknown[]): Promise<InstallDriverResult> => {
      assertNoArguments(args)
      const result = await installDriver()
      if (result.state) {
        driverState = result.state
        driverKnown = true
      }
      return result
    }
  )

  app.once('will-quit', stopHwMonitorPolling)
}

/** Apenas para testes: zera estado de driver e polling entre casos. */
export function resetHwMonitorForTests(): void {
  stopHwMonitorPolling()
  context = null
  driverState = 'absent'
  driverKnown = false
  statusPromise = null
  snapshotListeners.clear()
}
