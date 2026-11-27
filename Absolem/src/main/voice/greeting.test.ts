import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGreetingController,
  GREETING_DELAY_MS,
  GREETING_TIMEOUT_MS,
  GREETING_TURN_GRACE_MS,
  shouldSkipGreeting,
  type GreetingSessionHandlers,
  type GreetingSessionLike
} from './greeting'

/**
 * Saudação com fakes: nenhuma rede, nenhum microfone. O relógio e o horário
 * são injetados para o teste ser determinístico.
 */

class FakeSession implements GreetingSessionLike {
  readonly sent: string[] = []
  readonly closes: string[] = []
  connect = vi.fn(async () => undefined)

  constructor(readonly handlers: GreetingSessionHandlers) {}

  sendText(text: string): void {
    this.sent.push(text)
  }

  close(reason: string): void {
    this.closes.push(reason)
    this.handlers.onClose(reason)
  }
}

function setup(
  options: {
    hasKey?: boolean
    budgetThrows?: boolean
    connectFails?: boolean
    hour?: number
  } = {}
) {
  const sessions: FakeSession[] = []
  const pushed: Array<{ data: Uint8Array; sampleRate: number }> = []
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const controller = createGreetingController({
    createSession: (handlers) => {
      const session = new FakeSession(handlers)
      if (options.connectFails) {
        session.connect.mockRejectedValue(Object.assign(new Error('sem rede'), { kind: 'network' }))
      }
      sessions.push(session)
      return session
    },
    hasApiKey: () => options.hasKey !== false,
    checkBudget: () => {
      if (options.budgetThrows) throw new Error('Limite de custo atingido.')
    },
    pushAudio: (push) => pushed.push(push),
    logger,
    now: () => new Date(2026, 0, 1, options.hour ?? 9, 0, 0)
  })
  return { controller, sessions, pushed, logger }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('saudação falada do overlay', () => {
  it('espera o atraso, fala a saudação do horário e emite áudio', async () => {
    const { controller, sessions, pushed } = setup({ hour: 9 })
    controller.speak()

    await advance(GREETING_DELAY_MS - 1)
    expect(sessions).toHaveLength(0)

    await advance(1)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].connect).toHaveBeenCalledTimes(1)
    expect(sessions[0].sent).toEqual(['Diga apenas: "Bom dia". Não acrescente nada.'])

    const data = new Uint8Array([1, 2])
    sessions[0].handlers.onAudio(data, 24_000)
    expect(pushed).toEqual([{ data, sampleRate: 24_000 }])

    await advance(GREETING_TIMEOUT_MS)
    expect(sessions[0].closes).toEqual(['greeting-timeout'])
  })

  it('usa boa tarde e boa noite conforme a hora local', async () => {
    for (const [hour, text] of [
      [15, 'Boa tarde'],
      [22, 'Boa noite'],
      [3, 'Boa noite']
    ] as const) {
      const { controller, sessions } = setup({ hour })
      controller.speak()
      await advance(GREETING_DELAY_MS)
      expect(sessions[0].sent[0]).toBe(`Diga apenas: "${text}". Não acrescente nada.`)
      controller.cancel()
    }
  })

  it('cancel antes do atraso não abre sessão e é idempotente', async () => {
    const { controller, sessions } = setup()
    controller.speak()
    controller.cancel()
    controller.cancel()

    await advance(GREETING_DELAY_MS)
    expect(sessions).toHaveLength(0)
  })

  it('cancel no meio da sessão fecha a sessão uma vez', async () => {
    const { controller, sessions } = setup()
    controller.speak()
    await advance(GREETING_DELAY_MS)

    controller.cancel()
    controller.cancel()

    expect(sessions[0].closes).toEqual(['greeting-cancelled'])
  })

  it('sem chave ou sem budget não cria sessão', async () => {
    const noKey = setup({ hasKey: false })
    noKey.controller.speak()
    await advance(GREETING_DELAY_MS)
    expect(noKey.sessions).toHaveLength(0)

    const noBudget = setup({ budgetThrows: true })
    noBudget.controller.speak()
    await advance(GREETING_DELAY_MS)
    expect(noBudget.sessions).toHaveLength(0)
  })

  it('erro de rede só loga e não propaga', async () => {
    const { controller, sessions, logger } = setup({ connectFails: true })
    controller.speak()

    await expect(advance(GREETING_DELAY_MS)).resolves.toBeUndefined()

    expect(sessions[0].connect).toHaveBeenCalledTimes(1)
    expect(sessions[0].closes).toContain('greeting-error')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('turnComplete agenda o fechamento curto', async () => {
    const { controller, sessions } = setup()
    controller.speak()
    await advance(GREETING_DELAY_MS)

    sessions[0].handlers.onTurnComplete()
    await advance(GREETING_TURN_GRACE_MS)

    expect(sessions[0].closes).toEqual(['greeting-timeout'])
  })

  it('não fala quando desabilitado pelo ambiente do harness', async () => {
    expect(shouldSkipGreeting({ ABSOLEM_SMOKE: '1' } as NodeJS.ProcessEnv)).toBe(true)
    expect(shouldSkipGreeting({ ABSOLEM_VISUAL_DIR: 'tmp' } as NodeJS.ProcessEnv)).toBe(true)
    expect(shouldSkipGreeting({ ABSOLEM_MEMORY_SMOKE: '1' } as NodeJS.ProcessEnv)).toBe(true)
    expect(shouldSkipGreeting({} as NodeJS.ProcessEnv)).toBe(false)

    const sessions: FakeSession[] = []
    const controller = createGreetingController({
      createSession: (handlers) => {
        const session = new FakeSession(handlers)
        sessions.push(session)
        return session
      },
      hasApiKey: () => true,
      checkBudget: () => undefined,
      pushAudio: () => undefined,
      isEnabled: () => false,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    })
    controller.speak()
    await advance(GREETING_DELAY_MS)
    expect(sessions).toHaveLength(0)
  })
})
