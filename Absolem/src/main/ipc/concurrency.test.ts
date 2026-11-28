import { describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../../shared/config'
import { createFrameGrabService } from '../capture/grabService'
import type { CaptureGrabRequest } from '../capture/controller'
import { createDefaultToolRegistry } from '../gemini/tools/internal'
import { routeToolCall } from '../gemini/tools/router'
import { VoiceController, type VoiceSessionLike } from '../voice/controller'
import { registerShutdownHook, resetShutdownHooksForTests, shutdownApp } from '../shutdown'

/**
 * Matriz integrada (task 05): voz, captura, ferramentas e encerramento rodando
 * ao mesmo tempo, com fakes determinísticos. Nenhuma rede/Electron real.
 */

const electron = vi.hoisted(() => ({ quit: vi.fn() }))

vi.mock('electron', () => ({
  app: { quit: electron.quit }
}))

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const FRAME = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).buffer

class FakeSession implements VoiceSessionLike {
  closes: string[] = []
  connect = vi.fn(async () => undefined)
  sendAudio = vi.fn()
  sendText = vi.fn()
  sendToolResponse = vi.fn()
  interrupt = vi.fn()
  appendHistory = vi.fn()
  close(reason: string): void {
    if (this.closes.length === 0) this.closes.push(reason)
  }
}

function voiceConfig(): VoiceConfig {
  return {
    enabled: false,
    inputDeviceId: null,
    outputDeviceId: null,
    outputVolume: 1,
    maxSessionMinutes: 60,
    silenceTimeoutSeconds: 60
  }
}

function createVoice() {
  const sessions: FakeSession[] = []
  const controller = new VoiceController({
    getConfig: voiceConfig,
    updateConfig: () => ({ success: true }),
    hasConsent: () => true,
    persistConsent: () => ({ ok: true }),
    requestConsent: async () => true,
    hasApiKey: () => true,
    checkBudget: () => undefined,
    createSession: () => {
      const session = new FakeSession()
      sessions.push(session)
      return session
    },
    setAvatarState: () => undefined,
    pushState: () => undefined,
    pushAudio: () => undefined,
    pushTranscript: () => undefined,
    isOverlayVisible: () => true,
    showOverlay: () => undefined,
    notify: () => undefined,
    memoryEnabled: () => false,
    history: { append: vi.fn() }
  })
  return { controller, sessions }
}

function grabRequest(requestId: string): CaptureGrabRequest {
  return { requestId, sourceId: 'screen:0:0', pixelWidth: 1280, pixelHeight: 720, lossless: false }
}

describe('matriz concorrente integrada', () => {
  it('voz + captura + ferramentas em paralelo terminam sem deadlock', async () => {
    const { controller, sessions } = createVoice()
    const grab = createFrameGrabService({ sendRequest: () => true })
    const { registry, handlers } = createDefaultToolRegistry({ includeEcho: true })
    const routerOptions = {
      registry,
      getHandler: (name: string) => handlers.get(name) ?? null,
      getPermission: () => 'allow' as const,
      confirm: async () => true,
      confirmTimeoutMs: 100,
      audit: () => undefined
    }
    const startedAt = performance.now()
    const operations: Array<Promise<unknown>> = []

    // Um único ciclo de voz serial, em paralelo com captura/ferramentas.
    operations.push(
      (async () => {
        for (let cycle = 0; cycle < 25; cycle += 1) {
          controller.start()
          await Promise.resolve()
          await Promise.resolve()
          controller.stop()
          await Promise.resolve()
        }
      })()
    )

    for (let index = 0; index < 25; index += 1) {
      operations.push(
        (async () => {
          const requestId = `frame-${index}`
          const pending = grab.request(grabRequest(requestId))
          grab.handleResult({
            requestId,
            ok: true,
            mime: 'image/jpeg',
            data: FRAME,
            width: 1280,
            height: 720
          })
          await pending
        })()
      )
      operations.push(
        routeToolCall(routerOptions, { name: 'echo', args: { text: `texto-${index}` } })
      )
      operations.push(
        (async () => {
          // Um "show/hide" barato no meio das operações: estado local puro.
          let visible = false
          visible = !visible
          visible = !visible
          await Promise.resolve()
          expect(visible).toBe(false)
        })()
      )
    }

    const results = await Promise.all(operations)

    expect(performance.now() - startedAt).toBeLessThan(2_000)
    expect(results).toHaveLength(76)
    expect(sessions).toHaveLength(25)
    for (const session of sessions) expect(session.closes).toEqual(['user'])
    expect(grab.pendingCount()).toBe(0)
    expect(controller.getState()).toBe('off')
  })

  it('shutdown durante operações roda os hooks uma vez e não trava', () => {
    resetShutdownHooksForTests()
    electron.quit.mockClear()
    const { controller, sessions } = createVoice()
    controller.start()
    const hook = vi.fn(() => controller.shutdown())
    registerShutdownHook('voice', hook)
    registerShutdownHook('voice', hook)

    shutdownApp({ getMainWindow: () => null, getOverlayWindow: () => null }, 'os-session-end')
    shutdownApp({ getMainWindow: () => null, getOverlayWindow: () => null }, 'tray')
    controller.stop()

    expect(hook).toHaveBeenCalledTimes(1)
    expect(electron.quit).toHaveBeenCalledTimes(1)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.closes.length).toBe(1)
    expect(controller.getState()).toBe('off')
  })
})
