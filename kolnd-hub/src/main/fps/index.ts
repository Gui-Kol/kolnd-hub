import { app, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { logger } from '../logger'
import {
  FPS_HEARTBEAT_INTERVAL_MS,
  FPS_READ_CACHE_MS,
  fpsReadingWithReason,
  type FpsActivationResult,
  type FpsStatusInfo,
  type HudFpsReading
} from '../../shared/fps'
import {
  installFpsAgent,
  isFpsAgentInstalled,
  isFpsManifestCurrent,
  readFpsManifest
} from './agent'
import { isPresentMonBinary, resolveBundledPresentMon } from './engine'
import {
  captureLatestPath,
  captureManifestPath,
  FPS_CAPTURE_TASK_NAME,
  resolveCaptureDir,
  resolveFpsSinkDir,
  resolveHeartbeatPath
} from './paths'
import { readFpsSinkFile } from './reader'
import { selectFpsTarget } from './target'

/**
 * Ciclo de vida da captura de FPS no main.
 *
 * O Hub aberto escreve `%APPDATA%\kolnd-hub\fps\heartbeat` a cada 2 s. A tarefa
 * elevada fica idle sem heartbeat e só abre o PresentMon enquanto ele existe —
 * Hub fechado = custo ~0 e nenhuma sessão ETW. O main lê o sink a cada 500 ms
 * (cache) e monta a leitura do HUD; nenhuma chamada bloqueia o event loop
 * (`execFileSync` proibido) e nada é logado por `console.*`.
 *
 * Ativação (D1) é separada: só o caminho do atalho chama
 * `ensureFpsActivation()`; o IPC `fps:activate` existe apenas para o retry
 * explícito do Monitor.
 */

let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let readTimer: ReturnType<typeof setInterval> | null = null
let refreshPromise: Promise<HudFpsReading> | null = null
let cachedReading: HudFpsReading = fpsReadingWithReason('warming', 'warming')
let installedCache: boolean | null | undefined
let installedCheckedAt = 0
let activationAttempted = false
let activationRefused = false
let activationBusy = false

/**
 * TTL da consulta real de `schtasks` usada SÓ quando o manifesto não existe.
 * Em regime normal o proxy é a leitura do manifesto (sem spawn); sem ele, o
 * schtasks pode rodar no máximo 1x/min, não a cada 500 ms.
 */
const INSTALLED_CACHE_MS = 60_000

function currentSinkDir(): string {
  return resolveFpsSinkDir(
    process.env.ProgramData ?? 'C:\\ProgramData',
    process.env.KOLDND_HUB_TEST_USERDATA
  )
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
}

function notActivated(): HudFpsReading {
  return fpsReadingWithReason('not-activated', 'not-activated')
}

function engineMissing(): HudFpsReading {
  return fpsReadingWithReason('unavailable', 'engine-missing')
}

async function installedStatus(): Promise<boolean | null> {
  if (installedCache !== undefined && Date.now() - installedCheckedAt < INSTALLED_CACHE_MS) {
    return installedCache
  }
  try {
    const installed = await isFpsAgentInstalled()
    installedCache = installed
    installedCheckedAt = Date.now()
    return installed
  } catch {
    return null
  }
}

async function doRefresh(): Promise<HudFpsReading> {
  const now = Date.now()
  const parsed = await readFpsSinkFile(captureLatestPath(currentSinkDir()), now)

  if (parsed.fresh && parsed.sink) {
    // D3: só o app em primeiro plano; o Hub em foco vira instrução.
    cachedReading = selectFpsTarget(parsed.sink, { selfPid: process.pid })
    return cachedReading
  }
  if (parsed.stale) {
    // Nunca repete o último número: a captura parou.
    cachedReading = fpsReadingWithReason('unavailable', 'stale')
    return cachedReading
  }

  // Proxy de instalação SEM spawn: o manifesto do staging diz se a captura
  // está instalada/atual. O caminho de 500 ms nunca chama `schtasks` quando o
  // manifesto existe; ele só é consultado no fallback (ausente) com TTL 60 s.
  const manifest = await readFpsManifest(
    captureManifestPath(resolveCaptureDir(process.env.ProgramData ?? 'C:\\ProgramData'))
  )
  if (isFpsManifestCurrent(manifest)) {
    cachedReading = fpsReadingWithReason('warming', 'warming')
    return cachedReading
  }
  if (manifest) {
    // Manifesto presente mas de outra versão/hash/script: o Monitor oferece
    // "Atualizar" (1 UAC). Não medimos com uma cópia velha em ProgramData.
    cachedReading = fpsReadingWithReason('outdated', 'outdated')
    return cachedReading
  }
  if (activationRefused) {
    cachedReading = notActivated()
    return cachedReading
  }

  const installed = await installedStatus()
  if (installed === false) {
    const bundled = resolveBundledPresentMon(resourcesDir())
    cachedReading = isPresentMonBinary(bundled) ? notActivated() : engineMissing()
    return cachedReading
  }

  // Instalada (ou estado desconhecido): a primeira janela ainda pode fechar.
  cachedReading = fpsReadingWithReason('warming', 'warming')
  return cachedReading
}

/** Leitura do sink + seleção de alvo; chamadas concorrentes compartilham a mesma promise. */
export function refreshFpsReading(): Promise<HudFpsReading> {
  if (refreshPromise) return refreshPromise
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

/** Leitura em cache (usada pelo push do HUD; não faz I/O). */
export function getCachedFpsReading(): HudFpsReading {
  return cachedReading
}

/** Status para o Monitor: tarefa instalada, captura ativa e leitura corrente. */
export async function getFpsStatus(): Promise<FpsStatusInfo> {
  const installed = await isFpsAgentInstalled()
  installedCache = installed
  installedCheckedAt = Date.now()
  const reading = await refreshFpsReading()
  return { installed, active: reading.state === 'live', reading }
}

/**
 * Ativação (UAC único). `force` só é usado pelo botão do Monitor (retry
 * explícito); o atalho chama `ensureFpsActivation()` uma vez por sessão.
 */
export async function activateFpsCapture(
  options: { force?: boolean } = {}
): Promise<FpsActivationResult> {
  if (activationBusy) {
    return {
      ok: false,
      error: 'A ativação da captura já está em andamento.',
      reading: cachedReading
    }
  }
  if (activationAttempted && !options.force && activationRefused) {
    return {
      ok: false,
      cancelled: true,
      error: 'A captura não foi ativada nesta sessão.',
      reading: notActivated()
    }
  }

  activationAttempted = true
  activationBusy = true
  try {
    const installed = await isFpsAgentInstalled()
    installedCache = installed
    installedCheckedAt = Date.now()

    if (installed === true) {
      // Já instalada: nenhum UAC. Se o sink ainda não está fresco, o Monitor
      // mostra `warming`/`unavailable` — nunca instala de novo à toa.
      const reading = await refreshFpsReading()
      return { ok: true, reading }
    }

    const result = await installFpsAgent()
    if (!result.ok) {
      if (result.cancelled) {
        activationRefused = true
        cachedReading = notActivated()
        return {
          ok: false,
          cancelled: true,
          error: result.error,
          reading: cachedReading
        }
      }
      if (result.engineMissing) {
        cachedReading = engineMissing()
        return { ok: false, error: result.error, reading: cachedReading }
      }
      return { ok: false, error: result.error, reading: cachedReading }
    }

    const reading = await refreshFpsReading()
    if (reading.state === 'live' || reading.state === 'warming') {
      logger.info('fps', `captura de FPS ativa (tarefa ${FPS_CAPTURE_TASK_NAME})`)
    }
    return { ok: true, reading }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('fps', `falha ao ativar a captura: ${message}`)
    return { ok: false, error: 'Não foi possível ativar a captura de FPS.', reading: cachedReading }
  } finally {
    activationBusy = false
  }
}

/**
 * Chamado SÓ pelo caminho do atalho (T5). Uma tentativa por sessão; recusa não
 * reabre o UAC e nunca bloqueia o toggle do HUD (roda em background).
 */
export function ensureFpsActivation(): void {
  if (activationAttempted) return
  void activateFpsCapture().catch((err) => {
    logger.warn('fps', `ativação em segundo plano falhou: ${String(err)}`)
  })
}

/** Escreve o heartbeat de forma atômica o suficiente (o agente lê a mtime). */
export async function writeFpsHeartbeat(path: string, now: number = Date.now()): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, String(now), 'utf8')
}

/** Inicia heartbeat (2 s) + leitura (500 ms) e para tudo no `will-quit`. */
export function startFpsCapture(): void {
  if (heartbeatTimer) return
  const heartbeat = resolveHeartbeatPath(app.getPath('userData'))
  const beat = (): void => {
    void writeFpsHeartbeat(heartbeat).catch((err) => {
      logger.warn('fps', `falha ao escrever o heartbeat: ${String(err)}`)
    })
  }
  beat()
  heartbeatTimer = setInterval(beat, FPS_HEARTBEAT_INTERVAL_MS)
  readTimer = setInterval(() => {
    void refreshFpsReading().catch(() => undefined)
  }, FPS_READ_CACHE_MS)
  void refreshFpsReading().catch(() => undefined)
  app.once('will-quit', stopFpsCapture)
}

/** Para timers e remove o heartbeat: a tarefa encerra o PresentMon em ~5 s. */
export function stopFpsCapture(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (readTimer) {
    clearInterval(readTimer)
    readTimer = null
  }
  const heartbeat = resolveHeartbeatPath(app.getPath('userData'))
  void fs.rm(heartbeat, { force: true }).catch(() => undefined)
}

function assertNoArguments(args: unknown[]): void {
  if (args.length > 0) throw new Error('Requisição inválida.')
}

/** Canais do Monitor: `fps:status` e `fps:activate` (sem argumentos). */
export function registerFpsIpc(): void {
  ipcMain.handle('fps:status', (_event, ...args: unknown[]): Promise<FpsStatusInfo> => {
    assertNoArguments(args)
    return getFpsStatus()
  })

  ipcMain.handle('fps:activate', (_event, ...args: unknown[]): Promise<FpsActivationResult> => {
    assertNoArguments(args)
    return activateFpsCapture({ force: true })
  })
}

/** Apenas para testes: zera timers, cache e guardas de ativação. */
export function resetFpsForTests(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  if (readTimer) {
    clearInterval(readTimer)
    readTimer = null
  }
  refreshPromise = null
  cachedReading = fpsReadingWithReason('warming', 'warming')
  installedCache = undefined
  installedCheckedAt = 0
  activationAttempted = false
  activationRefused = false
  activationBusy = false
}
