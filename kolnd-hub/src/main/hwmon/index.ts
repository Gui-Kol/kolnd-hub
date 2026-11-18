import { app, ipcMain } from 'electron'
import { logger } from '../logger'
import type { IpcContext } from '../ipc/lifecycle'
import { getHwmonIntervalMs, setHwmonIntervalMs } from '../store'
import { HWMON_INTERVAL_DEFAULT_MS, normalizeHwmonIntervalMs } from '../../shared/hwmon'
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
 * Um único polling compartilhado por refcount entre a aba Monitor e a
 * sobreposição (HUD); cada consumidor chama `acquireHwPolling`/`releaseHwPolling`.
 * O renderer da aba usa `hwmon:start`/`hwmon:stop`, que mapeiam para o refcount.
 * O período vem de `hwmonIntervalMs` no store (padrão 0,5 s) e é aplicado ao
 * timer sem criar um segundo polling. Leituras são assíncronas e nunca lançam
 * para o renderer: sensor ausente vira `null` (a UI mostra "—").
 */

/** Período vigente do timer (ms). Sempre normalizado antes de agendar. */
let pollIntervalMs = HWMON_INTERVAL_DEFAULT_MS

/**
 * Intervalo mínimo entre sondas do driver enquanto ele não está `ready`.
 *
 * O usuário pode instalar o PawnIO pelo instalador do Windows com o app aberto;
 * sem esta re-sonda a UI ficaria em "—" até um restart. A cada segundo seria
 * desperdício (com o device acessível a sonda abre o driver e o módulo), então
 * 20 s é o compromisso: detecta a instalação em segundos e custa pouco.
 */
const DRIVER_REPROBE_INTERVAL_MS = 20_000

let context: IpcContext | null = null
let timer: ReturnType<typeof setInterval> | null = null
let polling = false
let driverState: DriverStatus = 'absent'
let driverKnown = false
let statusPromise: Promise<DriverStatusInfo> | null = null
/** Última consulta concluída ao driver (epoch ms); 0 = nunca sondado. */
let lastDriverCheckAt = 0
/** Último estado já logado — evita um `info` por segundo repetindo o mesmo. */
let lastLoggedDriverState: DriverStatus | null = null

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

  // Temperatura: o driver (medida real) vence o ACPI (aproximado). Sem os dois,
  // a origem fica `unavailable` — a UI nunca rotula ACPI como medida.
  const cpuTempC = cpu.tempC ?? native.cpu.tempC

  return {
    ...native,
    cpu: { ...native.cpu, tempC: cpuTempC, watts: cpuW, voltageV: cpu.voltageV },
    power: {
      cpuW,
      gpuW,
      totalMeasuredW,
      cpuEstimatedW,
      platformEstimatedW,
      totalEstimatedW
    },
    sources: {
      ...native.sources,
      driver,
      cpu: cpuW !== null ? 'measured' : cpuEstimatedW !== null ? 'estimated' : 'unavailable',
      gpu: gpuW !== null ? 'measured' : 'unavailable',
      platform: 'estimated',
      cpuTemp: cpu.tempC !== null ? 'measured' : native.sources.cpuTemp
    }
  }
}

/**
 * Decide se o status do driver deve ser re-sondado. Pura, exportada para testes.
 *
 * `ready` é estado estável: reprovar a cada 20 s reabriria o device/módulo sem
 * nada a ganhar. Nos demais estados a consulta é barata sem a DLL (só registro),
 * e repetir é justamente o que detecta uma instalação feita por fora do app.
 */
export function shouldReprobe(lastCheckAt: number, now: number, state: DriverStatus): boolean {
  if (state === 'ready') return false
  if (lastCheckAt <= 0) return true
  return now - lastCheckAt >= DRIVER_REPROBE_INTERVAL_MS
}

/**
 * Entrega um snapshot fora do ritmo do timer quando o driver acabou de virar
 * `ready` (ex.: recheque pelo modal, instalação por fora). Se um tick já está
 * coletando, ele mesmo envia o snapshot novo — disparar outro duplicaria a
 * leitura no mesmo segundo.
 */
function emitSnapshotIfIdle(): void {
  if (polling || !timer) return
  void pollOnce()
}

/** Aplica o resultado de uma sonda: estado, relógio do reprobe e log de transição. */
function applyDriverStatus(info: DriverStatusInfo): void {
  const previous = driverState
  driverState = info.state
  driverKnown = true
  lastDriverCheckAt = Date.now()

  // Um `info` por mudança de estado, silêncio quando repete (o polling roda a cada tick).
  if (lastLoggedDriverState !== info.state) {
    logger.info(
      'hwmon',
      lastLoggedDriverState === null
        ? `driver: ${info.state}`
        : `driver: ${lastLoggedDriverState} -> ${info.state}`
    )
    lastLoggedDriverState = info.state
  }

  if (previous !== 'ready' && info.state === 'ready') emitSnapshotIfIdle()
}

/** Consulta o status do driver, coalescendo chamadas concorrentes. */
function refreshDriverStatus(): Promise<DriverStatusInfo> {
  if (!statusPromise) {
    statusPromise = getDriverStatus()
      .then((info) => {
        applyDriverStatus(info)
        return info
      })
      .catch((err) => {
        // `getDriverStatus` não lança; se algo escapar, o relógio ainda avança
        // para o polling não virar uma sonda por segundo.
        lastDriverCheckAt = Date.now()
        driverKnown = true
        throw err
      })
      .finally(() => {
        statusPromise = null
      })
  }
  return statusPromise
}

/**
 * Invalida o cache do status e dispara uma sonda nova. Chamado quando o
 * polling começa: o usuário pode ter instalado o driver com o app aberto e só
 * depois aberto a aba Monitor — a resposta precisa refletir o sistema agora.
 */
function forceDriverStatusRefresh(): void {
  driverKnown = false
  lastDriverCheckAt = 0
  void refreshDriverStatus().catch(() => undefined)
}

/**
 * Um snapshot completo. A CPU só é lida quando o sink do agente elevado está
 * fresco (`ready`) — sem ele, temp/potência seguem `null` e a UI mostra "—".
 */
export async function collectHwSnapshot(): Promise<HwSnapshot> {
  // Sem driver conhecido, sonda. Com o estado conhecido e não-`ready`, re-sonda
  // só de 20 em 20 s (o polling chama isto a cada tick, no período escolhido).
  if (!driverKnown || shouldReprobe(lastDriverCheckAt, Date.now(), driverState)) {
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
  return mergeCpuReadings(
    native,
    { available: false, tempC: null, watts: null, voltageV: null },
    driverState
  )
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

/**
 * (Re)agenda o timer único com o período vigente. Não dispara leitura imediata:
 * quem inicia o polling já faz a primeira leitura em `startPolling`, e trocar o
 * intervalo pela UI não pode custar uma coleta extra.
 */
function schedulePolling(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    void pollOnce()
  }, pollIntervalMs)
}

function startPolling(): void {
  if (timer) return
  void pollOnce()
  schedulePolling()
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  polling = false
}

/** Período vigente do polling (ms) — exposto para testes e para o IPC. */
export function getHwPollIntervalMs(): number {
  return pollIntervalMs
}

/**
 * Aplica um intervalo novo ao polling (normaliza e devolve o valor efetivo).
 *
 * Com o timer ativo, reinicia o `setInterval` com o novo período; sem timer,
 * apenas guarda o valor para o próximo `startPolling`. Reiniciar o timer (em
 * vez de manter o antigo) evita esperar até 2 s pela primeira coleta após
 * subir a frequência.
 */
export function applyHwPollIntervalMs(input: unknown): number {
  pollIntervalMs = normalizeHwmonIntervalMs(input)
  if (timer) schedulePolling()
  return pollIntervalMs
}

/**
 * Adquire o polling (aba Monitor com `hwmon:start`, HUD ao ficar visível).
 * Idempotente por consumidor: cada acquire precisa do release correspondente.
 */
export function acquireHwPolling(): void {
  refCount += 1
  // Só agora a UI vai consumir o monitor: revalida o driver para o caso de ele
  // ter sido instalado com o app já aberto (instalador do Windows, por exemplo).
  forceDriverStatusRefresh()
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
  // Intervalo persistido: o app pode ter sido aberto com um valor salvo pela UI.
  pollIntervalMs = getHwmonIntervalMs()

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

  ipcMain.handle('hwmon:get-interval', (_event, ...args: unknown[]): { intervalMs: number } => {
    assertNoArguments(args)
    return { intervalMs: getHwPollIntervalMs() }
  })

  // Exatamente um argumento (o renderer nunca calcula a faixa sozinho): o store
  // normaliza, persiste e o main aplica o MESMO valor no timer da aba e do HUD.
  ipcMain.handle(
    'hwmon:set-interval',
    (_event, ...args: unknown[]): { success: boolean; intervalMs: number } => {
      if (args.length !== 1) throw new Error('Requisição inválida.')
      const result = setHwmonIntervalMs(args[0])
      if (!result.success || result.intervalMs === undefined) {
        throw new Error(result.error ?? 'Não foi possível salvar o intervalo do monitor.')
      }
      return { success: true, intervalMs: applyHwPollIntervalMs(result.intervalMs) }
    }
  )

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
        lastDriverCheckAt = Date.now()
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
  pollIntervalMs = HWMON_INTERVAL_DEFAULT_MS
  driverState = 'absent'
  driverKnown = false
  statusPromise = null
  lastDriverCheckAt = 0
  lastLoggedDriverState = null
  snapshotListeners.clear()
}
