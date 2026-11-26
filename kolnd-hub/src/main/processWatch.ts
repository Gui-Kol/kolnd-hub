// processWatch — agendador único das consultas de processos do Windows.
//
// Antes cada consumidor (Dashboard, Biblioteca, Big Picture) tinha o próprio
// timer; os intervalos de 4 s/10 s furavam o cache de 5 s e o WMI era
// consultado várias vezes por minuto. Aqui existe UM timer no main, no menor
// intervalo pedido, e o resultado é empurrado para o renderer. O cache e o
// helper persistente continuam em `startupManager.ts` — este módulo só decide
// o ritmo.

import type { BrowserWindow } from 'electron'
import { logger } from './logger'
import { listRunningProcesses } from './startupManager'
import type { RunningProcess } from './startupManager'
import type { IpcContext } from './ipc/lifecycle'

export type ProcessWatchTimer = ReturnType<typeof setTimeout>

export interface ProcessWatchDeps {
  listProcesses: () => Promise<RunningProcess[]>
  emit: (processes: RunningProcess[]) => void
  onError?: (error: unknown) => void
  setTimer?: (callback: () => void, delayMs: number) => ProcessWatchTimer
  clearTimer?: (handle: ProcessWatchTimer) => void
}

export interface ProcessWatch {
  /** Registra/atualiza um consumidor. Idempotente por id. */
  registerConsumer: (id: string, intervalMs: number) => () => void
  /** Para o timer e esquece todos os consumidores (saída do app). */
  stop: () => void
}

interface Consumer {
  intervalMs: number
  token: symbol
}

/**
 * Instância independente (testável) do agendador. O timer roda no menor
 * intervalo ativo; uma consulta em voo faz o tick concorrente ser ignorado.
 */
export function createProcessWatch(deps: ProcessWatchDeps): ProcessWatch {
  const setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle))
  const consumers = new Map<string, Consumer>()
  let timer: ProcessWatchTimer | null = null
  let inFlight = false
  let stopped = false

  function minInterval(): number {
    let min = Number.POSITIVE_INFINITY
    for (const consumer of consumers.values()) {
      if (consumer.intervalMs < min) min = consumer.intervalMs
    }
    return min
  }

  function clearScheduled(): void {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  function schedule(): void {
    clearScheduled()
    if (stopped || consumers.size === 0) return
    timer = setTimer(() => {
      timer = null
      void refresh()
    }, minInterval())
  }

  async function refresh(): Promise<void> {
    if (stopped || consumers.size === 0) return
    // Um ciclo que já está consultando o WMI não pode disparar outro: o cache
    // de 5 s não protege consultas que começam antes da anterior terminar.
    if (inFlight) {
      schedule()
      return
    }
    inFlight = true
    try {
      const items = await deps.listProcesses()
      if (!stopped && consumers.size > 0) deps.emit(items)
    } catch (error) {
      deps.onError?.(error)
    } finally {
      inFlight = false
      // Falha não mata o agendador: o próximo ciclo tenta de novo.
      if (!stopped) schedule()
    }
  }

  function registerConsumer(id: string, intervalMs: number): () => void {
    if (stopped) return () => undefined
    const wasEmpty = consumers.size === 0
    const token = Symbol(id)
    consumers.set(id, { intervalMs, token })
    if (wasEmpty) {
      // Primeiro consumidor: entrega já o primeiro retrato, sem esperar o
      // intervalo (o renderer monta com o estado vazio e quer o badge logo).
      void refresh()
    } else {
      // Consumidor novo/atualizado: reajusta o timer para o novo mínimo.
      schedule()
    }
    return () => {
      // Um unsubscribe antigo não pode remover o registro novo do mesmo id
      // (StrictMode monta/desmonta duas vezes com o mesmo id).
      if (consumers.get(id)?.token !== token) return
      consumers.delete(id)
      if (consumers.size === 0) clearScheduled()
      else schedule()
    }
  }

  function stop(): void {
    stopped = true
    clearScheduled()
    consumers.clear()
  }

  return { registerConsumer, stop }
}

/* ── Instância de produção (uma por processo main) ───────────────── */

let watch: ProcessWatch | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null

/** Liga o agendador ao contexto do main (janela para o push). */
export function startProcessWatch(ctx: Pick<IpcContext, 'getMainWindow'>): void {
  getMainWindow = ctx.getMainWindow
  if (watch) return
  watch = createProcessWatch({
    listProcesses: () => listRunningProcesses(),
    emit: (processes) => {
      const window = getMainWindow?.()
      if (!window || window.isDestroyed()) return
      window.webContents.send('process-watch:update', processes)
    },
    onError: (error) => {
      logger.warn('processWatch', 'falha ao consultar processos do sistema', error)
    }
  })
}

/** Assina/atualiza um consumidor do renderer. */
export function registerProcessConsumer(id: string, intervalMs: number): () => void {
  if (!watch) {
    // Sem `startProcessWatch` não há para onde empurrar; falhar aqui evita um
    // timer consultando o WMI sem nenhum consumidor real.
    throw new Error('agendador de processos não iniciado')
  }
  return watch.registerConsumer(id, intervalMs)
}

/** Encerra o timer no `will-quit` (nenhuma consulta depois disso). */
export function stopProcessWatch(): void {
  watch?.stop()
  watch = null
  getMainWindow = null
}
