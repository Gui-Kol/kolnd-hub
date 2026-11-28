import { ipcMain } from 'electron'
import type { RamAutoPrefs, RamOptimizeResult } from '../shared/ram'
import { getRamAutoPrefs, setRamAutoPrefs } from './store'
import { trimWorkingSets } from './ramOptimizer'
import { logger } from './logger'

const MINUTE_MS = 60_000

/** Dependências injetáveis (testes não tocam no store nem no PowerShell). */
export interface RamAutoOptimizerDeps {
  getPrefs?: () => RamAutoPrefs
  trim?: () => Promise<RamOptimizeResult>
}

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
// Cada agendamento/execução carrega a geração vigente. Ao cancelar/reagendar,
// uma execução em andamento com geração antiga não volta a agendar sozinha.
let generation = 0
// Fila curta apenas para impedir que dois agendamentos se sobreponham: o
// otimizador reagenda sempre a partir da preferência relida após o trim.
let scheduledIntervalMinutes = 0

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function logTrimResult(result: RamOptimizeResult): void {
  if (!result.ok) {
    logger.warn('ram', `Otimização automática não concluiu: ${result.error ?? 'erro desconhecido'}`)
    return
  }
  logger.info(
    'ram',
    `Otimização automática concluída: ${result.trimmedProcesses ?? 0} programa(s) ajustado(s), ${result.skipped} ignorado(s), ${result.errors} erro(s), ${result.freedBytes} byte(s) liberados`
  )
}

function schedule(deps: RamAutoOptimizerDeps, intervalMinutes: number): void {
  clearTimer()
  scheduledIntervalMinutes = intervalMinutes
  const token = generation

  timer = setTimeout(() => {
    timer = null
    if (token !== generation) return
    void runOnce(deps, token)
  }, intervalMinutes * MINUTE_MS)
}

async function runOnce(deps: RamAutoOptimizerDeps, token: number): Promise<void> {
  if (token !== generation) return

  // Nunca duas execuções simultâneas: um tick que chegue durante um trim
  // apenas reagenda, sem chamar o PowerShell de novo.
  if (running) {
    logger.warn('ram', 'Otimização automática ignorou um tick sobreposto')
    schedule(deps, scheduledIntervalMinutes)
    return
  }

  running = true
  try {
    const trim = deps.trim ?? trimWorkingSets
    const result = await trim()
    logTrimResult(result)
  } catch (err) {
    logger.warn('ram', 'Falha na otimização automática de memória:', err)
  } finally {
    running = false
    // Reagenda sempre com a preferência atual (pode ter mudado durante o trim).
    // Se o agendamento foi cancelado/reconfigurado nesse meio-tempo, não age.
    if (token === generation) {
      const prefs = (deps.getPrefs ?? getRamAutoPrefs)()
      if (prefs.enabled) schedule(deps, prefs.intervalMinutes)
    }
  }
}

/**
 * (Re)agenda a otimização automática conforme a preferência persistida.
 * A primeira execução só acontece depois do intervalo completo; desligado
 * apenas limpa qualquer timer pendente.
 */
export function applyRamAutoPrefs(deps: RamAutoOptimizerDeps = {}): void {
  generation += 1
  clearTimer()
  const prefs = (deps.getPrefs ?? getRamAutoPrefs)()
  if (!prefs.enabled) return
  schedule(deps, prefs.intervalMinutes)
}

/** Aplica a preferência na inicialização e registra o estado no log. */
export function startRamAutoOptimizer(deps: RamAutoOptimizerDeps = {}): void {
  applyRamAutoPrefs(deps)
  const prefs = (deps.getPrefs ?? getRamAutoPrefs)()
  logger.info(
    'ram',
    prefs.enabled
      ? `Otimização automática de RAM ligada (a cada ${prefs.intervalMinutes} min; somente trim, sem UAC)`
      : 'Otimização automática de RAM desligada'
  )
}

/** Cancela o timer pendente (saída do app/desligamento da preferência). */
export function stopRamAutoOptimizer(): void {
  generation += 1
  clearTimer()
}

/** Reseta o estado do módulo entre testes. */
export function resetRamAutoOptimizerForTests(): void {
  generation += 1
  running = false
  scheduledIntervalMinutes = 0
  clearTimer()
}

/** Registra os canais IPC da otimização automática de RAM. */
export function registerRamAutoIpc(): void {
  ipcMain.handle('ram:auto-get', () => getRamAutoPrefs())

  ipcMain.handle('ram:auto-set', (_event, value: unknown, ...args: unknown[]) => {
    if (args.length > 0) {
      logger.warn('ram', 'ram:auto-set ignorou argumentos inesperados')
    }
    const result = setRamAutoPrefs(value)
    if (result.success) applyRamAutoPrefs()
    return result
  })
}
