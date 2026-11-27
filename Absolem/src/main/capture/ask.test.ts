import { describe, expect, it, vi } from 'vitest'
import type { ChatUsagePayload } from '../../shared/gemini'
import { estimateImageTokens } from '../../shared/screen'
import type { CaptureResult } from './controller'
import type { LiveScreenSession, LiveScreenSessionHandlers, ScreenAskDeps } from './ask'
import {
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
