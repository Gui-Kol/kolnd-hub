import { describe, expect, it, vi } from 'vitest'
import { createProcessWatch } from './processWatch'
import type { ProcessWatchTimer } from './processWatch'
import type { RunningProcess } from './startupManager'

interface FakeScheduler {
  setTimer: (callback: () => void, delayMs: number) => ProcessWatchTimer
  clearTimer: (handle: ProcessWatchTimer) => void
  delays: () => number[]
  pendingCount: () => number
  /** Executa todos os timers pendentes agora (como um relógio que avança). */
  fire: () => Promise<void>
}

function createScheduler(): FakeScheduler {
  let nextId = 1
  const pending = new Map<number, { callback: () => void; delayMs: number }>()
  return {
    setTimer: (callback, delayMs) => {
      const id = nextId++
      pending.set(id, { callback, delayMs })
      return id as unknown as ProcessWatchTimer
    },
    clearTimer: (handle) => {
      pending.delete(handle as unknown as number)
    },
    delays: () => [...pending.values()].map((timer) => timer.delayMs),
    pendingCount: () => pending.size,
    fire: async () => {
      const due = [...pending.values()]
      pending.clear()
      for (const timer of due) timer.callback()
      await flush()
    }
  }
}

/** Deixa as promessas do refresh (microtasks) assentarem. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const PROCESSES: RunningProcess[] = [{ name: 'jogo', id: 42, path: 'C:\\jogo.exe' }]

describe('processWatch — agendador único', () => {
  it('dois consumidores (4 s e 10 s) geram uma consulta por ciclo de 4 s', async () => {
    const scheduler = createScheduler()
    const listProcesses = vi.fn(async () => PROCESSES)
    const emit = vi.fn()
    const watch = createProcessWatch({
      listProcesses,
      emit,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer
    })

    watch.registerConsumer('app:dashboard', 4000)
    watch.registerConsumer('games:running', 10000)
    await flush()

    // Primeiro retrato imediato + timer no menor intervalo.
    expect(listProcesses).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(PROCESSES)
    expect(scheduler.delays()).toEqual([4000])

    await scheduler.fire()
    expect(listProcesses).toHaveBeenCalledTimes(2)
    await scheduler.fire()
    expect(listProcesses).toHaveBeenCalledTimes(3)
    expect(scheduler.delays()).toEqual([4000])
  })

  it('saída de um consumidor reajusta o timer para o próximo menor intervalo', async () => {
    const scheduler = createScheduler()
    const listProcesses = vi.fn(async () => PROCESSES)
    const watch = createProcessWatch({
      listProcesses,
      emit: vi.fn(),
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer
    })

    const unsubscribeFast = watch.registerConsumer('app:dashboard', 4000)
    watch.registerConsumer('games:running', 10000)
    await flush()
    expect(scheduler.delays()).toEqual([4000])

    unsubscribeFast()
    expect(scheduler.delays()).toEqual([10000])
    expect(scheduler.pendingCount()).toBe(1)
  })

  it('sem consumidores não cria timer nem consulta', async () => {
    const scheduler = createScheduler()
    const listProcesses = vi.fn(async () => PROCESSES)
    const watch = createProcessWatch({
      listProcesses,
      emit: vi.fn(),
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer
    })

    const unsubscribe = watch.registerConsumer('games:running', 10000)
    await flush()
    unsubscribe()

    expect(scheduler.pendingCount()).toBe(0)
    const calls = listProcesses.mock.calls.length
    await scheduler.fire()
    expect(listProcesses).toHaveBeenCalledTimes(calls)
  })

  it('refresh em voo não empilha uma segunda consulta', async () => {
    const scheduler = createScheduler()
    const first = deferred<RunningProcess[]>()
    const listProcesses = vi.fn(() => first.promise)
    const emit = vi.fn()
    const watch = createProcessWatch({
      listProcesses,
      emit,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer
    })

    watch.registerConsumer('app:dashboard', 4000)
    // Consumidor novo reajusta o timer enquanto a primeira consulta pende.
    watch.registerConsumer('games:running', 10000)
    expect(scheduler.pendingCount()).toBe(1)

    await scheduler.fire()
    expect(listProcesses).toHaveBeenCalledTimes(1)
    // O tick concorrente foi ignorado, mas o timer não morre.
    expect(scheduler.pendingCount()).toBe(1)

    first.resolve(PROCESSES)
    await flush()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(listProcesses).toHaveBeenCalledTimes(1)
  })

  it('falha na consulta não mata o timer e o próximo ciclo tenta de novo', async () => {
    const scheduler = createScheduler()
    const listProcesses = vi
      .fn<() => Promise<RunningProcess[]>>()
      .mockRejectedValueOnce(new Error('WMI indisponível'))
      .mockResolvedValueOnce(PROCESSES)
    const onError = vi.fn()
    const emit = vi.fn()
    const watch = createProcessWatch({
      listProcesses,
      emit,
      onError,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer
    })

    watch.registerConsumer('games:running', 10000)
    await flush()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(scheduler.delays()).toEqual([10000])

    await scheduler.fire()
    expect(listProcesses).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledWith(PROCESSES)
    expect(scheduler.delays()).toEqual([10000])
  })

  it('re-registrar o mesmo id atualiza o intervalo e o unsubscribe antigo é inerte', async () => {
    const scheduler = createScheduler()
    const listProcesses = vi.fn(async () => PROCESSES)
    const watch = createProcessWatch({
      listProcesses,
      emit: vi.fn(),
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer
    })

    const first = watch.registerConsumer('app:dashboard', 4000)
    const second = watch.registerConsumer('app:dashboard', 15000)
    await flush()
    expect(scheduler.delays()).toEqual([15000])

    // O cleanup da primeira assinatura (StrictMode) não pode remover a nova.
    first()
    expect(scheduler.pendingCount()).toBe(1)

    second()
    expect(scheduler.pendingCount()).toBe(0)
  })

  it('stop cancela o timer e ignora registros posteriores', async () => {
    const scheduler = createScheduler()
    const listProcesses = vi.fn(async () => PROCESSES)
    const watch = createProcessWatch({
      listProcesses,
      emit: vi.fn(),
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer
    })

    watch.registerConsumer('games:running', 10000)
    await flush()
    watch.stop()
    expect(scheduler.pendingCount()).toBe(0)

    watch.registerConsumer('app:dashboard', 4000)
    await flush()
    expect(scheduler.pendingCount()).toBe(0)
    expect(listProcesses).toHaveBeenCalledTimes(1)
  })
})
