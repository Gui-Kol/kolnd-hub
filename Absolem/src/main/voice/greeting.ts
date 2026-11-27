import { greetingForDate } from '../../shared/greeting'
import type { VoiceAudioPush } from '../../shared/voice'
import { logger as defaultLogger } from '../logger'

/**
 * Saudação falada quando o overlay é exibido.
 *
 * Sessão Live curta e **sem microfone**: só envia um pedido de texto ao modelo
 * Live (mesma voz Charon) e empurra o áudio recebido pelo push `voice:audio`,
 * que o overlay já reproduz. Falha de rede/chave/budget apenas loga: a
 * saudação é um extra e nunca vira erro na UI. `cancel()` é idempotente e
 * interrompe tanto o atraso inicial quanto a sessão em andamento.
 *
 * O módulo não importa Electron nem o SDK: a composição de produção injeta a
 * fábrica de sessão (`voice/instance.ts`), os testes usam fakes.
 */

export const GREETING_DELAY_MS = 600
export const GREETING_TIMEOUT_MS = 10_000
/** Depois do `turnComplete`, espera o áudio terminar de circular antes de fechar. */
export const GREETING_TURN_GRACE_MS = 1_000

export const GREETING_SYSTEM_INSTRUCTION =
  'Você é o Absolem, um assistente de IA para Windows. Responda somente com a saudação pedida, em português do Brasil, sem acrescentar nada.'

export interface GreetingSessionHandlers {
  onAudio: (data: Uint8Array, sampleRate: number) => void
  onError: (error: { kind: string; message: string }) => void
  onClose: (reason: string) => void
  onTurnComplete: () => void
}

export interface GreetingSessionLike {
  connect: () => Promise<void>
  sendText: (text: string) => void
  close: (reason: string) => void
}

export interface GreetingLoggerLike {
  debug: (scope: string, message: unknown, ...args: unknown[]) => void
  info: (scope: string, message: unknown, ...args: unknown[]) => void
  warn: (scope: string, message: unknown, ...args: unknown[]) => void
}

export interface GreetingControllerDeps {
  createSession: (handlers: GreetingSessionHandlers) => GreetingSessionLike
  hasApiKey: () => boolean
  checkBudget: () => void
  pushAudio: (push: VoiceAudioPush) => void
  logger?: GreetingLoggerLike
  /** Instante usado para escolher a saudação (default: agora). */
  now?: () => Date
  /** Falso quando o overlay já está oculto ou o harness está ativo. */
  isEnabled?: () => boolean
  delayMs?: number
  timeoutMs?: number
  turnGraceMs?: number
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export interface GreetingController {
  /** Agenda (600 ms) e fala a saudação do horário atual. */
  speak: () => void
  /** Cancela atraso/sessão. Idempotente. */
  cancel: () => void
}

/** Harness visual, smoke e teste de memória não devem falar nem abrir rede. */
export function shouldSkipGreeting(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env['ABSOLEM_SMOKE'] === '1' ||
    Boolean(env['ABSOLEM_VISUAL_DIR']) ||
    env['ABSOLEM_MEMORY_SMOKE'] === '1'
  )
}

export function createGreetingController(deps: GreetingControllerDeps): GreetingController {
  const logger = deps.logger ?? defaultLogger
  const now = deps.now ?? (() => new Date())
  const delayMs = deps.delayMs ?? GREETING_DELAY_MS
  const timeoutMs = deps.timeoutMs ?? GREETING_TIMEOUT_MS
  const turnGraceMs = deps.turnGraceMs ?? GREETING_TURN_GRACE_MS
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer))

  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let session: GreetingSessionLike | null = null

  function clearTimerIfAny(): void {
    if (!timer) return
    clearTimer(timer)
    timer = null
  }

  function closeSession(reason: string): void {
    const current = session
    session = null
    if (!current) return
    try {
      current.close(reason)
    } catch {
      // Sessão já encerrada: o fechamento lógico já aconteceu.
    }
  }

  /** Invalida handlers pendentes, limpa timers e fecha a sessão. */
  function finish(reason: string): void {
    generation += 1
    clearTimerIfAny()
    closeSession(reason)
  }

  function cancel(): void {
    finish('greeting-cancelled')
  }

  function scheduleTimeout(epoch: number, ms: number): void {
    clearTimerIfAny()
    timer = setTimer(() => {
      if (epoch !== generation) return
      finish('greeting-timeout')
    }, ms)
  }

  async function run(epoch: number): Promise<void> {
    if (epoch !== generation) return
    if (deps.isEnabled && !deps.isEnabled()) return
    if (!deps.hasApiKey()) {
      logger.debug('voice', 'saudação ignorada: chave do Gemini ausente')
      return
    }
    try {
      deps.checkBudget()
    } catch (err) {
      logger.debug('voice', 'saudação ignorada: teto de custo atingido', err)
      return
    }
    if (epoch !== generation) return

    const greeting = greetingForDate(now())
    let created: GreetingSessionLike
    try {
      created = deps.createSession({
        onAudio: (data, sampleRate) => {
          if (epoch !== generation) return
          deps.pushAudio({ data, sampleRate })
        },
        onError: (error) => {
          if (epoch !== generation) return
          logger.warn('voice', 'saudação falhou', error)
          finish('greeting-error')
        },
        onClose: (reason) => {
          if (epoch !== generation) return
          logger.debug('voice', 'sessão da saudação encerrada', { reason })
          generation += 1
          clearTimerIfAny()
          session = null
        },
        onTurnComplete: () => {
          if (epoch !== generation) return
          // O áudio já foi entregue; espera só o buffer do renderer.
          scheduleTimeout(epoch, turnGraceMs)
        }
      })
    } catch (err) {
      logger.warn('voice', 'falha ao criar a sessão da saudação', err)
      return
    }

    session = created
    try {
      await created.connect()
    } catch (err) {
      if (epoch !== generation) return
      logger.warn('voice', 'falha ao conectar a saudação', err)
      finish('greeting-error')
      return
    }
    if (epoch !== generation) {
      try {
        created.close('greeting-cancelled')
      } catch {
        // já fechada
      }
      return
    }

    try {
      created.sendText(`Diga apenas: "${greeting}". Não acrescente nada.`)
      logger.info('voice', `saudação enviada: ${greeting}`)
    } catch (err) {
      logger.warn('voice', 'falha ao enviar a saudação', err)
      finish('greeting-error')
      return
    }
    scheduleTimeout(epoch, timeoutMs)
  }

  function speak(): void {
    // Uma nova exibição reinicia a saudação anterior sem somar sessões.
    cancel()
    const epoch = generation
    timer = setTimer(() => {
      timer = null
      void run(epoch)
    }, delayMs)
  }

  return { speak, cancel }
}
