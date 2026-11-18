import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveOfficeSnapshot, type OfficeSnapshot } from '../../shared/office'
import type { IpcContext } from './lifecycle'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  appHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  createBridge: vi.fn(),
  createService: vi.fn(),
  createClient: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  },
  app: {
    once: (event: string, handler: (...args: unknown[]) => unknown) => {
      mocks.appHandlers.set(event, handler)
    }
  }
}))

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('../office/client', () => ({ createOfficeClient: mocks.createClient }))
vi.mock('../office/service', () => ({ createOfficeService: mocks.createService }))
vi.mock('../office/bridge', () => ({ createOfficeBridge: mocks.createBridge }))

function snapshot(title = 'Sessão do poller'): OfficeSnapshot {
  return deriveOfficeSnapshot({
    sessions: [
      {
        id: 'ses_1',
        title,
        agent: 'general',
        model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go' },
        time: { created: 1, busy: 900 },
        location: { directory: 'C:\\repo\\alpha' }
      }
    ],
    now: 1000,
    source: 'poller',
    health: { cliFound: true }
  })
}

function callHandler(channel: string, payload?: unknown): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return payload === undefined ? handler({}) : handler({}, payload)
}

describe('registerOfficeIpc (ciclo de vida)', () => {
  let bridgeEmit: ((event: unknown) => void) | null
  let serviceEmit: ((snapshot: OfficeSnapshot) => void) | null
  let subscribers: number
  let bridgeStop: ReturnType<typeof vi.fn>
  let bridgeStart: ReturnType<typeof vi.fn>
  let serviceStop: ReturnType<typeof vi.fn>
  let bridgeResult: ((result: unknown, meta: unknown) => void) | null
  let enqueueAction: ReturnType<typeof vi.fn>
  let actionCounter: number

  beforeEach(() => {
    vi.resetModules()
    mocks.handlers.clear()
    mocks.appHandlers.clear()
    bridgeEmit = null
    serviceEmit = null
    bridgeResult = null
    actionCounter = 0
    enqueueAction = vi.fn(() => {
      actionCounter += 1
      return { ok: true, id: `act_${actionCounter}` }
    })
    subscribers = 0
    bridgeStop = vi.fn(async () => {})
    bridgeStart = vi.fn(async () => ({
      port: 12345,
      token: 'token',
      version: '1.0.0',
      startedAt: 1000
    }))
    serviceStop = vi.fn(() => {
      if (subscribers > 0) subscribers -= 1
    })

    mocks.createClient.mockReset()
    mocks.createClient.mockReturnValue({
      resolveCli: async () => 'C:\\tools\\opencode-cli.exe',
      cliPath: () => 'C:\\tools\\opencode-cli.exe',
      listSessions: async () => [],
      sessionMessages: async () => []
    })

    mocks.createBridge.mockReset()
    mocks.createBridge.mockImplementation(
      (deps: {
        emit: (event: unknown) => void
        onActionResult?: (result: unknown, meta: unknown) => void
      }) => {
        bridgeEmit = deps.emit
        bridgeResult = deps.onActionResult ?? null
        return {
          start: bridgeStart,
          stop: bridgeStop,
          info: () => null,
          address: () => null,
          ingestEvent: () => true,
          enqueueAction,
          pendingActions: () => 0
        }
      }
    )

    mocks.createService.mockReset()
    mocks.createService.mockImplementation((deps: { emit: (next: OfficeSnapshot) => void }) => {
      serviceEmit = deps.emit
      return {
        start: () => {
          subscribers += 1
        },
        stop: serviceStop,
        dispose: () => {
          subscribers = 0
        },
        getSnapshot: () => null,
        subscribers: () => subscribers
      }
    })
  })

  function mainWindow() {
    return {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
        once: vi.fn(),
        removeListener: vi.fn()
      }
    }
  }

  async function register(window: unknown = null): Promise<void> {
    const { registerOfficeIpc } = await import('./office')
    const context = { getMainWindow: () => window } as unknown as IpcContext
    registerOfficeIpc(context)
  }

  it('inicia a ponte no registro (boot), sem esperar office:subscribe', async () => {
    await register()
    expect(mocks.createBridge).toHaveBeenCalledTimes(1)
    expect(bridgeStart).toHaveBeenCalledTimes(1)
    expect(mocks.createService).not.toHaveBeenCalled()
  })

  it('office:subscribe com a ponte já iniciada devolve o snapshot corrente sem reiniciar', async () => {
    await register(mainWindow())
    expect(callHandler('office:subscribe')).toBeNull()
    expect(mocks.createService).toHaveBeenCalledTimes(1)
    expect(subscribers).toBe(1)

    // Emissão do poller sem janela: não lança e fica guardada no agregador.
    expect(() => serviceEmit?.(snapshot())).not.toThrow()

    const current = callHandler('office:subscribe') as OfficeSnapshot | null
    expect(current?.agents[0].title).toBe('Sessão do poller')
    expect(mocks.createBridge).toHaveBeenCalledTimes(1)
    expect(bridgeStart).toHaveBeenCalledTimes(1)
  })

  it('emissão sem janela não lança e o estado continua disponível no snapshot', async () => {
    await register()
    callHandler('office:subscribe')
    serviceEmit?.(snapshot('Estado guardado'))

    const stored = callHandler('office:snapshot') as OfficeSnapshot | null
    expect(stored?.agents[0].title).toBe('Estado guardado')
    expect(bridgeEmit).not.toBeNull()
  })

  it('unsubscribe para só o poller; a ponte continua no ar', async () => {
    await register(mainWindow())
    callHandler('office:subscribe')
    expect(subscribers).toBe(1)

    callHandler('office:unsubscribe')
    expect(serviceStop).toHaveBeenCalledTimes(1)
    expect(subscribers).toBe(0)
    expect(bridgeStop).not.toHaveBeenCalled()
    expect(mocks.createBridge).toHaveBeenCalledTimes(1)
  })

  it('will-quit encerra a ponte (e só então o bridge.json é apagado)', async () => {
    await register()
    const dispose = mocks.appHandlers.get('will-quit')
    expect(dispose).toBeDefined()
    dispose?.()
    expect(bridgeStop).toHaveBeenCalledTimes(1)
  })

  it('com o modo desligado as três ações são recusadas como somente-leitura', async () => {
    await register()
    const approve = callHandler('office:approve-permission', {
      sessionID: 'ses_1',
      requestID: 'per_1',
      decision: 'once'
    })
    const deny = callHandler('office:deny-permission', {
      sessionID: 'ses_1',
      requestID: 'per_1'
    })
    const send = callHandler('office:send-message', { sessionID: 'ses_1', text: 'oi' })

    expect(approve).toEqual({ ok: false, reason: 'somente-leitura' })
    expect(deny).toEqual({ ok: false, reason: 'somente-leitura' })
    expect(send).toEqual({ ok: false, reason: 'somente-leitura' })
    expect(enqueueAction).not.toHaveBeenCalled()
  })

  it('office:action-mode exige { enabled: boolean } e alterna o modo', async () => {
    await register()
    expect(() => callHandler('office:action-mode')).toThrow()
    expect(() => callHandler('office:action-mode', { enabled: 'sim' })).toThrow()
    expect(() => callHandler('office:action-mode', { enabled: true, persistir: true })).toThrow()

    expect(callHandler('office:action-mode', { enabled: true })).toEqual({
      ok: true,
      enabled: true
    })
    expect(callHandler('office:action-mode', { enabled: false })).toEqual({
      ok: true,
      enabled: false
    })
  })

  it('texto grande, sessionID inválido e chave extra não entram na fila', async () => {
    await register()
    callHandler('office:action-mode', { enabled: true })

    expect(
      callHandler('office:send-message', { sessionID: 'ses_1', text: 'x'.repeat(2001) })
    ).toEqual({ ok: false, reason: 'texto-longo' })
    expect(callHandler('office:send-message', { sessionID: 'sessao', text: 'oi' })).toEqual({
      ok: false,
      reason: 'invalido'
    })
    expect(
      callHandler('office:send-message', { sessionID: 'ses_1', text: 'oi', extra: 1 })
    ).toEqual({
      ok: false,
      reason: 'invalido'
    })
    expect(() => callHandler('office:send-message')).toThrow()
    expect(enqueueAction).not.toHaveBeenCalled()
  })

  it('limita a 10 ações por minuto por sessão', async () => {
    await register()
    callHandler('office:action-mode', { enabled: true })

    for (let index = 0; index < 10; index += 1) {
      expect(
        callHandler('office:send-message', { sessionID: 'ses_1', text: `mensagem ${index}` })
      ).toMatchObject({ ok: true })
    }
    expect(callHandler('office:send-message', { sessionID: 'ses_1', text: 'excedente' })).toEqual({
      ok: false,
      reason: 'limite'
    })
    // Outra sessão continua com a própria cota.
    expect(callHandler('office:send-message', { sessionID: 'ses_2', text: 'oi' })).toMatchObject({
      ok: true
    })
    expect(enqueueAction).toHaveBeenCalledTimes(11)
  })

  it('aprovar/negar montam a ação exata e recusam decisão fora do contrato', async () => {
    await register()
    callHandler('office:action-mode', { enabled: true })

    expect(
      callHandler('office:approve-permission', {
        sessionID: 'ses_1',
        requestID: 'per_1',
        decision: 'always',
        message: 'pode'
      })
    ).toMatchObject({ ok: true })
    expect(enqueueAction).toHaveBeenLastCalledWith({
      action: 'permission.reply',
      sessionID: 'ses_1',
      requestID: 'per_1',
      decision: 'always',
      message: 'pode'
    })

    expect(
      callHandler('office:deny-permission', {
        sessionID: 'ses_1',
        requestID: 'per_1',
        message: 'fora do escopo'
      })
    ).toMatchObject({ ok: true })
    expect(enqueueAction).toHaveBeenLastCalledWith({
      action: 'permission.reply',
      sessionID: 'ses_1',
      requestID: 'per_1',
      decision: 'reject',
      message: 'fora do escopo'
    })

    expect(
      callHandler('office:approve-permission', {
        sessionID: 'ses_1',
        requestID: 'per_1',
        decision: 'reject'
      })
    ).toEqual({ ok: false, reason: 'invalido' })
  })

  it('empurra o resultado da ação para a janela (sem texto de mensagem)', async () => {
    const window = mainWindow()
    await register(window)

    bridgeResult?.(
      { id: 'act_7', ok: false, error: 'a permissão não existe mais' },
      { action: 'permission.reply', sessionID: 'ses_1' }
    )

    expect(window.webContents.send).toHaveBeenCalledWith('office:action-result', {
      id: 'act_7',
      ok: false,
      error: 'a permissão não existe mais'
    })
  })
})
