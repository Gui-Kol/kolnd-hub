/**
 * Temporização pura da aba Aparência.
 *
 * - `createDebounced`: cada edição reinicia a janela; só a última vence. Usado
 *   para enviar o tema ao overlay (100 ms), sem afogar o IPC enquanto o usuário
 *   arrasta um seletor.
 * - `createThrottled`: no máximo uma gravação por janela; a última edição
 *   pendente é gravada no fim da janela. Usado para persistir (300 ms).
 *
 * Sem DOM e sem React: os testes controlam o relógio com fake timers.
 */

export interface Debounced<T> {
  schedule: (value: T) => void
  cancel: () => void
  flush: () => void
  isPending: () => boolean
}

export function createDebounced<T>(callback: (value: T) => void, delayMs: number): Debounced<T> {
  const delay = Math.max(0, delayMs)
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  let lastValue: T

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pending = false
  }

  return {
    schedule(value: T): void {
      lastValue = value
      pending = true
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        pending = false
        callback(lastValue)
      }, delay)
    },
    cancel(): void {
      clear()
    },
    flush(): void {
      if (!pending) return
      clear()
      callback(lastValue)
    },
    isPending(): boolean {
      return pending
    }
  }
}

export interface Throttled<T> {
  schedule: (value: T) => void
  cancel: () => void
  flush: () => void
  isPending: () => boolean
}

export interface ThrottleOptions {
  /** Relógio injetável (padrão: `Date.now`), usado pelo teste e pelo runtime. */
  now?: () => number
}

export function createThrottled<T>(
  callback: (value: T) => void,
  intervalMs: number,
  options: ThrottleOptions = {}
): Throttled<T> {
  const interval = Math.max(0, intervalMs)
  const now = options.now ?? (() => Date.now())
  let lastRun = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let hasPending = false
  let pendingValue: T

  function run(value: T): void {
    lastRun = now()
    callback(value)
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    schedule(value: T): void {
      const elapsed = now() - lastRun
      pendingValue = value
      hasPending = true

      if (elapsed >= interval) {
        clearTimer()
        hasPending = false
        run(value)
        return
      }

      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        if (!hasPending) return
        hasPending = false
        run(pendingValue)
      }, interval - elapsed)
    },
    cancel(): void {
      clearTimer()
      hasPending = false
    },
    flush(): void {
      if (!hasPending) return
      clearTimer()
      hasPending = false
      run(pendingValue)
    },
    isPending(): boolean {
      return hasPending
    }
  }
}
