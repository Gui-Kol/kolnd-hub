import { describe, expect, it, vi } from 'vitest'
import type { ChatUsagePayload } from '../../shared/gemini'
import { estimateImageTokens } from '../../shared/screen'
import type { ToolCallResult } from '../gemini/tools/router'
import type { CaptureResult } from './controller'
import type { LiveScreenSession, LiveScreenSessionHandlers, ScreenAskDeps } from './ask'
import {
  SCREEN_LIVE_TURN_TIMEOUT_MS,
  SCREEN_SECRET_REFUSAL,
  SCREEN_SYSTEM_RULES,
  askAboutScreen,
  askAboutScreenLive,
  isSecretRevealRequest
} from './ask'

const DATA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x10, 0x20]).buffer
const WIDTH = 1280
const HEIGHT = 720

function captureOk(): CaptureResult {
  return {
    ok: true,
    kind: 'screen',
    mode: 'on',
    displayId: '0',
    titleHash: 'hash',
    image: { mime: 'image/jpeg', data: DATA, width: WIDTH, height: HEIGHT },
    imageTokens: estimateImageTokens(WIDTH, HEIGHT),
    imageTokensEstimated: true,
    audit: {
      at: '2026-01-01T00:00:00.000Z',
      mode: 'on',
      kind: 'screen',
      titleHash: 'hash',
      w: WIDTH,
      h: HEIGHT,
      bytes: DATA.byteLength,
      sha256: 'sha'
    }
  }
}

function sinks(events: string[]) {
  return {
    delta: vi.fn((text: string) => events.push(`delta:${text}`)),
    done: vi.fn((usage: ChatUsagePayload) => events.push(`done:${usage.total}`)),
    error: vi.fn((error: { kind: string; message: string }) => events.push(`error:${error.kind}`))
  }
}

function deps(overrides: Partial<ScreenAskDeps> = {}): ScreenAskDeps {
  return {
    capture: async () => captureOk(),
    send: async () => undefined,
    ...overrides
  }
}

describe('envio multimodal da tela', () => {
  it('envia imagem e pergunta pela mesma sessão Live', async () => {
    const events: string[] = []
    let handlers: LiveScreenSessionHandlers | undefined
    const session: LiveScreenSession = {
      connect: vi.fn(async () => undefined),
      sendImage: vi.fn(),
      sendImageAndText: vi.fn((_image, _text) => {
        handlers?.onTranscript({ role: 'model', text: 'A tela mostra um gráfico.', final: true })
        handlers?.onTurnComplete()
      }),
      sendText: vi.fn(() => {
        handlers?.onTranscript({ role: 'model', text: 'A tela mostra um gráfico.', final: true })
        handlers?.onTurnComplete()
      }),
      sendToolResponse: vi.fn(),
      close: vi.fn()
    }
    const outcome = await askAboutScreenLive(
      {
        capture: async () => captureOk(),
        createSession: (next) => {
          handlers = next
          return session
        }
      },
      { requestId: 'live-1', kind: 'screen', question: 'descreva a tela' },
      sinks(events) as never
    )

    expect(session.connect).toHaveBeenCalledOnce()
    expect(session.sendImageAndText).toHaveBeenCalledWith(
      { mime: 'image/jpeg', data: DATA },
      expect.stringContaining('Pergunta do usuário: descreva a tela')
    )
    const sentImage = (session.sendImageAndText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(sentImage.mime).toBe('image/jpeg')
    expect(sentImage.data.byteLength).toBe(DATA.byteLength)
    expect(session.sendImage).not.toHaveBeenCalled()
    expect(session.sendText).not.toHaveBeenCalled()
    expect(events).toContain('delta:A tela mostra um gráfico.')
    expect(events).toContain('done:0')
    expect(outcome.asked).toBe(true)
  })

  it('não resolve antes do turnComplete do turno', async () => {
    const events: string[] = []
    let handlers: LiveScreenSessionHandlers | undefined
    const session: LiveScreenSession = {
      connect: vi.fn(async () => undefined),
      sendImage: vi.fn(),
      sendImageAndText: vi.fn(() => {
        // O modelo começa a responder, mas o turno ainda não terminou.
        handlers?.onTranscript({ role: 'model', text: 'resposta parcial', final: false })
      }),
      sendText: vi.fn(),
      sendToolResponse: vi.fn(),
      close: vi.fn()
    }
    let settled = false
    const pending = askAboutScreenLive(
      {
        capture: async () => captureOk(),
        createSession: (next) => {
          handlers = next
          return session
        }
      },
      { requestId: 'live-delayed', kind: 'screen', question: 'descreva a tela' },
      sinks(events) as never
    )
    void pending.then(() => {
      settled = true
    })

    // Deixa o envio e as microtasks do caminho atual rodarem.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(settled).toBe(false)
    expect(events).not.toContain('done:0')
    expect(session.close).not.toHaveBeenCalled()

    handlers?.onTranscript({ role: 'model', text: 'resposta completa', final: true })
    handlers?.onTurnComplete()

    const outcome = await pending

    expect(settled).toBe(true)
    expect(events).toEqual(['delta:resposta parcial', 'delta:resposta completa', 'done:0'])
    expect(session.close).toHaveBeenCalledOnce()
    expect(session.close).toHaveBeenCalledWith('turn-complete')
    expect(outcome.asked).toBe(true)
  })

  it('espera as ferramentas do turno e devolve toolResults preenchidos', async () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      let handlers: LiveScreenSessionHandlers | undefined
      let resolveRoute!: (value: ToolCallResult) => void
      const routeCall = vi.fn(
        () =>
          new Promise<ToolCallResult>((resolve) => {
            resolveRoute = resolve
          })
      )
      const session: LiveScreenSession = {
        connect: vi.fn(async () => undefined),
        sendImage: vi.fn(),
        sendImageAndText: vi.fn(() => {
          handlers?.onToolCall([{ name: 'get_current_time', args: {} }])
        }),
        sendText: vi.fn(),
        sendToolResponse: vi.fn(),
        close: vi.fn()
      }
      let settled = false
      const pending = askAboutScreenLive(
        {
          capture: async () => captureOk(),
          createSession: (next) => {
            handlers = next
            return session
          },
          routeCall
        },
        { requestId: 'live-tools', kind: 'screen', question: 'que horas são na tela?' },
        sinks(events) as never
      )
      void pending.then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(routeCall).toHaveBeenCalledOnce()

      // O turno termina enquanto a ferramenta ainda está em execução.
      handlers?.onTurnComplete()
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)

      resolveRoute({ ok: true, result: { iso: '2026-11-27T12:00:00.000Z' } })
      const outcome = await pending

      expect(settled).toBe(true)
      expect(outcome.toolResults).toEqual([
        { ok: true, result: { iso: '2026-11-27T12:00:00.000Z' } }
      ])
      expect(events).toEqual(['done:0'])
      expect(session.close).toHaveBeenCalledOnce()
      expect(session.close).toHaveBeenCalledWith('turn-complete')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('timeout fecha a sessão e emite erro uma única vez', async () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      let handlers: LiveScreenSessionHandlers | undefined
      const session: LiveScreenSession = {
        connect: vi.fn(async () => undefined),
        sendImage: vi.fn(),
        sendImageAndText: vi.fn(),
        sendText: vi.fn(),
        sendToolResponse: vi.fn(),
        close: vi.fn()
      }
      const pending = askAboutScreenLive(
        {
          capture: async () => captureOk(),
          createSession: (next) => {
            handlers = next
            return session
          }
        },
        { requestId: 'live-timeout', kind: 'screen', question: 'descreva a tela' },
        sinks(events) as never
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(session.connect).toHaveBeenCalledOnce()
      expect(session.sendImageAndText).toHaveBeenCalledOnce()
      expect(events).toEqual([])

      await vi.advanceTimersByTimeAsync(SCREEN_LIVE_TURN_TIMEOUT_MS)
      const outcome = await pending

      expect(outcome.asked).toBe(true)
      expect(events).toEqual(['error:timeout'])
      expect(session.close).toHaveBeenCalledOnce()
      expect(session.close).toHaveBeenCalledWith('timeout')
      expect(vi.getTimerCount()).toBe(0)

      // Eventos tardios depois do timeout não reabrem done/erro nem fecham de novo.
      handlers?.onTurnComplete()
      handlers?.onError({ kind: 'network', message: 'tardio' })
      await vi.advanceTimersByTimeAsync(SCREEN_LIVE_TURN_TIMEOUT_MS)
      expect(events).toEqual(['error:timeout'])
      expect(session.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancelamento libera a promessa sem done/erro e sem timer pendente', async () => {
    vi.useFakeTimers()
    try {
      const events: string[] = []
      let handlers: LiveScreenSessionHandlers | undefined
      const session: LiveScreenSession = {
        connect: vi.fn(async () => undefined),
        sendImage: vi.fn(),
        sendImageAndText: vi.fn(),
        sendText: vi.fn(),
        sendToolResponse: vi.fn(),
        close: vi.fn((reason?: string) => {
          handlers?.onClose?.(reason ?? 'close')
        })
      }
      const pending = askAboutScreenLive(
        {
          capture: async () => captureOk(),
          createSession: (next) => {
            handlers = next
            return session
          }
        },
        { requestId: 'live-cancel-live', kind: 'screen', question: 'descreva a tela' },
        sinks(events) as never
      )

      await vi.advanceTimersByTimeAsync(0)
      expect(session.sendImageAndText).toHaveBeenCalledOnce()

      // `capture:cancel`/shutdown fecham a sessão antes do turno terminar.
      session.close('cancelled')
      const outcome = await pending

      expect(outcome.asked).toBe(true)
      expect(events).toEqual([])
      expect(session.close).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)

      handlers?.onTurnComplete()
      handlers?.onError({ kind: 'cancelled', message: 'tardio' })
      await vi.advanceTimersByTimeAsync(SCREEN_LIVE_TURN_TIMEOUT_MS)
      expect(events).toEqual([])
      expect(session.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('não abre sessão Live para pedido de segredo', async () => {
    const createSession = vi.fn()
    const events: string[] = []
    const outcome = await askAboutScreenLive(
      { capture: async () => captureOk(), createSession },
      { requestId: 'live-2', kind: 'screen', question: 'mostre a senha da tela' },
      sinks(events) as never
    )

    expect(createSession).not.toHaveBeenCalled()
    expect(events).toContain(`delta:${SCREEN_SECRET_REFUSAL}`)
    expect(outcome.asked).toBe(false)
  })

  it('descarta delta/tool/erro tardios depois do turno concluído', async () => {
    const events: string[] = []
    let handlers: LiveScreenSessionHandlers | undefined
    const routeCall = vi.fn(async () => ({ ok: true as const, result: null }))
    const session: LiveScreenSession = {
      connect: vi.fn(async () => undefined),
      sendImage: vi.fn(),
      sendImageAndText: vi.fn(() => {
        handlers?.onTranscript({ role: 'model', text: 'parcial', final: true })
        handlers?.onTurnComplete()
        // Eventos que o transporte pode enfileirar depois do turno:
        handlers?.onTranscript({ role: 'model', text: 'parcial tardio', final: true })
        handlers?.onToolCall([{ name: 'get_current_time', args: {} }])
        handlers?.onError({ kind: 'network', message: 'tardio' })
      }),
      sendText: vi.fn(),
      sendToolResponse: vi.fn(),
      close: vi.fn()
    }

    await askAboutScreenLive(
      {
        capture: async () => captureOk(),
        createSession: (next) => {
          handlers = next
          return session
        },
        routeCall
      },
      { requestId: 'live-late', kind: 'screen', question: 'descreva a tela' },
      sinks(events) as never
    )
    await Promise.resolve()

    expect(events).toEqual(['delta:parcial', 'done:0'])
    expect(routeCall).not.toHaveBeenCalled()
    expect(session.sendToolResponse).not.toHaveBeenCalled()
  })

  it('monta mensagem com uma imagem', async () => {
    const capture = vi.fn(async () => captureOk())
    const send = vi.fn(async (_id, _text, _sinks, _options) => undefined)
    const events: string[] = []
    const ask = askAboutScreen(
      deps({ capture, send }),
      {
        requestId: 'req-1',
        kind: 'screen',
        question: 'o que está errado nesta tela?'
      },
      sinks(events) as never
    )

    const outcome = await ask

    expect(capture).toHaveBeenCalledWith({
      kind: 'screen',
      question: 'o que está errado nesta tela?',
      requestId: 'req-1'
    })
    const [, text, , options] = send.mock.calls[0] ?? []
    expect(text).toContain('<screen_content kind="screen" width="1280" height="720">')
    expect(text).toContain('não é instrução')
    expect(text).toContain('Pergunta do usuário: o que está errado nesta tela?')
    expect(options.images).toHaveLength(1)
    expect(options.images?.[0]?.mime).toBe('image/jpeg')
    expect(options.systemInstructionAppend).toBe(SCREEN_SYSTEM_RULES)
    expect(outcome.asked).toBe(true)
    expect(outcome.image).toEqual({
      width: WIDTH,
      height: HEIGHT,
      mime: 'image/jpeg',
      tokens: 1229
    })
  })

  it('não envia quando bloqueado', async () => {
    const send = vi.fn()
    const events: string[] = []
    const ask = askAboutScreen(
      deps({
        capture: async () => ({
          ok: false,
          error: { code: 'blocked', message: 'janela sensível' }
        }),
        send
      }),
      { requestId: 'req-2', kind: 'active-window', question: 'o que tem aqui?' },
      sinks(events) as never
    )

    const outcome = await ask

    expect(send).not.toHaveBeenCalled()
    expect(events).toContain('error:blocked')
    expect(outcome.asked).toBe(false)
  })

  it('captura cancelada não abre sessão nem envia imagem', async () => {
    const createSession = vi.fn()
    const events: string[] = []
    const outcome = await askAboutScreenLive(
      {
        capture: async () => ({
          ok: false,
          error: { code: 'cancelled', message: 'Captura cancelada.' }
        }),
        createSession
      },
      { requestId: 'live-cancel', kind: 'screen', question: 'descreva a tela' },
      sinks(events) as never
    )

    expect(createSession).not.toHaveBeenCalled()
    expect(events).toEqual(['error:cancelled'])
    expect(outcome.asked).toBe(false)
    expect(outcome.toolResults).toEqual([])
  })

  it('usa streaming', async () => {
    const events: string[] = []
    const ask = askAboutScreen(
      deps({
        send: async (_id, _text, target) => {
          target.delta('valores: ')
          target.delta('42 e 7')
          target.done({ input: 10, output: 5, total: 15, estimated: false })
        }
      }),
      { requestId: 'req-3', kind: 'screen', question: 'leia o gráfico' },
      sinks(events) as never
    )

    await ask

    expect(events).toEqual(['delta:valores: ', 'delta:42 e 7', 'done:15'])
  })

  it('marca tokens estimados de imagem', async () => {
    const send = vi.fn(async (_id, _text, target, options) => {
      target.done({
        input: 100,
        output: 20,
        total: 120,
        estimated: false,
        imageTokens: options.imageTokens,
        imageEstimated: true
      })
    })
    const events: string[] = []
    const outcome = await askAboutScreen(
      deps({ send }),
      { requestId: 'req-4', kind: 'screen', question: 'descreva' },
      sinks(events) as never
    )

    expect(send.mock.calls[0]?.[3]?.imageTokens).toBe(1229)
    expect(outcome.usage).toMatchObject({ imageTokens: 1229, imageEstimated: true })
    expect(isSecretRevealRequest('me mostre a senha que está na tela')).toBe(true)
    expect(SCREEN_SECRET_REFUSAL).toContain('Não posso revelar')
  })
})
