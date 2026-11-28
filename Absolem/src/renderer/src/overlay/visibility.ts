/**
 * Loop de intervalo que só roda enquanto a janela está observável.
 *
 * O overlay pode ficar oculto (atalho, bandeja, captura de tela) sem parar a
 * sessão de voz; timers de nível, HUD e driver de demonstração continuariam
 * acordando o renderer à toa. O loop abaixo centraliza a pausa: um único timer
 * por consumidor, criado sob demanda e limpo quando escondido ou no unmount.
 *
 * É um helper puro (recebe apenas `isVisible` e o callback) para poder ser
 * testado com timers falsos, sem Electron/React.
 */

export interface PausableLoop {
  /** Liga/desliga o consumidor; só cria timer se a janela estiver visível. */
  setEnabled: (enabled: boolean) => void
  /** Reavalia visibilidade (chamar em `visibilitychange`/status do overlay). */
  sync: () => void
  /** Desliga de vez: limpa o timer e impede nova criação até `setEnabled`. */
  stop: () => void
  isRunning: () => boolean
  isEnabled: () => boolean
}

export interface PausableLoopOptions {
  run: () => void
  intervalMs: number
  isVisible: () => boolean
}

export function createPausableLoop(options: PausableLoopOptions): PausableLoop {
  let timer: ReturnType<typeof setInterval> | null = null
  let enabled = false

  const clear = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const sync = (): void => {
    const shouldRun = enabled && options.isVisible()
    if (shouldRun && timer === null) {
      timer = setInterval(options.run, options.intervalMs)
      return
    }
    if (!shouldRun) clear()
  }

  return {
    setEnabled(next: boolean): void {
      enabled = next
      sync()
    },
    sync,
    stop(): void {
      enabled = false
      clear()
    },
    isRunning(): boolean {
      return timer !== null
    },
    isEnabled(): boolean {
      return enabled
    }
  }
}

/** `true` quando a página está oculta (janela minimizada/oculta). */
export function isPageHidden(doc: Document | undefined): boolean {
  return doc !== undefined && doc.visibilityState === 'hidden'
}
