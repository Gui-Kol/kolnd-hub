import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveOfficeSnapshot, type OfficeSnapshot } from '../../shared/office'
import { logger } from '../logger'
import type { IpcContext } from './lifecycle'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  appHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  createBridge: vi.fn(),
  createService: vi.fn(),
  createClient: vi.fn(),
  storeDepartments: [] as unknown[],
  storeAvatars: {} as Record<string, unknown>
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
vi.mock('../store', () => ({
  getOfficeDepartments: () => mocks.storeDepartments,
  getOfficeAvatars: () => mocks.storeAvatars,
  setOfficeDepartments: (next: unknown) => {
    mocks.storeDepartments = next as unknown[]
    return { success: true }
  },
  setOfficeAvatar: (sessionID: string, look: unknown) => {
    mocks.storeAvatars[sessionID] = look
    return { success: true }
  }
}))

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
  let serviceRefresh: ReturnType<typeof vi.fn>
  let bridgeResult: ((result: unknown, meta: unknown) => void) | null
  let enqueueAction: ReturnType<typeof vi.fn>
  let actionCounter: number
  let clientFns: {
    resolveCli: ReturnType<typeof vi.fn>
    listSessions: ReturnType<typeof vi.fn>
    sessionMessages: ReturnType<typeof vi.fn>
    listAgents: ReturnType<typeof vi.fn>
    listModels: ReturnType<typeof vi.fn>
    createSession: ReturnType<typeof vi.fn>
    setSessionAgent: ReturnType<typeof vi.fn>
    setSessionModel: ReturnType<typeof vi.fn>
    archiveSession: ReturnType<typeof vi.fn>
    restoreSession: ReturnType<typeof vi.fn>
    listArchivedSessions: ReturnType<typeof vi.fn>
  }

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
    serviceRefresh = vi.fn()
    mocks.storeDepartments = []
    mocks.storeAvatars = {}

    mocks.createClient.mockReset()
    clientFns = {
      resolveCli: vi.fn(async () => 'C:\\tools\\opencode-cli.exe'),
      listSessions: vi.fn(async () => []),
      sessionMessages: vi.fn(async () => []),
      listAgents: vi.fn(async () => []),
      listModels: vi.fn(async () => []),
      createSession: vi.fn(async () => 'ses_novo'),
      setSessionAgent: vi.fn(async () => {}),
      setSessionModel: vi.fn(async () => {}),
      archiveSession: vi.fn(async () => {}),
      restoreSession: vi.fn(async () => {}),
      listArchivedSessions: vi.fn(async () => [])
    }
    mocks.createClient.mockReturnValue({
      ...clientFns,
      cliPath: () => 'C:\\tools\\opencode-cli.exe'
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
        subscribers: () => subscribers,
        refresh: serviceRefresh
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

  describe('gestão de funcionários', () => {
    function hireInput() {
      return {
        title: 'Contratar dev',
        agentID: 'build',
        model: null,
        directory: process.cwd()
      }
    }

    it('office:roster-options devolve funções/modelos da sala e valida o diretório', async () => {
      await register()
      clientFns.listAgents.mockResolvedValue([{ id: 'build', name: 'Build', mode: 'primary' }])
      clientFns.listModels.mockResolvedValue([
        { providerID: 'opencode-go', id: 'qwen4-max', name: 'Qwen4', enabled: true }
      ])

      expect(await callHandler('office:roster-options', { directory: process.cwd() })).toEqual({
        ok: true,
        agents: [{ id: 'build', name: 'Build', mode: 'primary' }],
        models: [{ providerID: 'opencode-go', id: 'qwen4-max', name: 'Qwen4', enabled: true }]
      })
      await expect(
        callHandler('office:roster-options', { directory: 'pasta/relativa' })
      ).rejects.toThrow('Requisição inválida.')

      clientFns.listAgents.mockRejectedValue(new Error('sem projeto'))
      const failed = await callHandler('office:roster-options', { directory: process.cwd() })
      expect(failed).toEqual({ ok: false, agents: [], models: [], error: 'sem projeto' })
    })

    it('office:hire recusa payload inválido, pasta inexistente e CLI ausente', async () => {
      await register()
      await expect(callHandler('office:hire')).rejects.toThrow('Requisição inválida.')
      await expect(callHandler('office:hire', { ...hireInput(), extra: 1 })).rejects.toThrow(
        'Requisição inválida.'
      )

      expect(
        await callHandler('office:hire', {
          ...hireInput(),
          directory: 'C:\\__kolnd_pasta_inexistente__'
        })
      ).toEqual({ ok: false, error: 'A pasta desta sala não existe mais no disco.' })

      clientFns.resolveCli.mockResolvedValue(null)
      expect(await callHandler('office:hire', hireInput())).toMatchObject({
        ok: false,
        error: expect.stringContaining('CLI do OpenCode')
      })
      expect(clientFns.createSession).not.toHaveBeenCalled()
    })

    it('office:hire cria a sessão e audita sem o título', async () => {
      await register()
      clientFns.createSession.mockResolvedValue('ses_novo1')

      expect(await callHandler('office:hire', hireInput())).toEqual({ ok: true })
      expect(clientFns.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Contratar dev', agentID: 'build', model: null })
      )
      const logs = JSON.stringify(vi.mocked(logger.info).mock.calls)
      expect(logs).toContain('ses_novo1')
      expect(logs).not.toContain('Contratar dev')
    })

    it('só uma operação de gestão por vez', async () => {
      await register()
      const pending: { resolve: ((id: string) => void) | null } = { resolve: null }
      clientFns.createSession.mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            pending.resolve = resolve
          })
      )

      const first = callHandler('office:hire', hireInput()) as Promise<unknown>
      const second = await callHandler('office:hire', hireInput())
      expect(second).toMatchObject({
        ok: false,
        error: expect.stringContaining('em andamento')
      })
      pending.resolve?.('ses_depois')
      await expect(first).resolves.toEqual({ ok: true })
    })

    it('office:set-role recusa working e troca agente/modelo quando livre', async () => {
      await register()
      clientFns.listSessions.mockResolvedValue([
        { id: 'ses_1', agent: 'general', time: { busy: Date.now() } }
      ])

      expect(
        await callHandler('office:set-role', {
          sessionID: 'ses_1',
          agentID: 'plan',
          model: null
        })
      ).toMatchObject({ ok: false, error: expect.stringContaining('trabalhando') })
      expect(clientFns.setSessionAgent).not.toHaveBeenCalled()

      clientFns.listSessions.mockResolvedValue([
        { id: 'ses_1', agent: 'general', time: { busy: Date.now() - 2000, idle: Date.now() } }
      ])
      expect(
        await callHandler('office:set-role', {
          sessionID: 'ses_1',
          agentID: 'plan',
          model: null
        })
      ).toEqual({ ok: true })
      expect(clientFns.setSessionAgent).toHaveBeenCalledWith('ses_1', 'plan')
      expect(clientFns.setSessionModel).not.toHaveBeenCalled()

      expect(
        await callHandler('office:set-role', {
          sessionID: 'ses_1',
          agentID: 'plan',
          model: { providerID: 'opencode-go', id: 'qwen4-max', name: 'Qwen', enabled: true }
        })
      ).toEqual({ ok: true })
      expect(clientFns.setSessionModel).toHaveBeenCalledWith('ses_1', {
        id: 'qwen4-max',
        providerID: 'opencode-go'
      })
    })

    it('office:archive-all arquiva o snapshot e pula quem está trabalhando', async () => {
      await register(mainWindow())
      callHandler('office:subscribe')
      serviceEmit?.(
        deriveOfficeSnapshot({
          now: Date.now(),
          sessions: [
            { id: 'ses_work', agent: 'general', time: { busy: Date.now() } },
            { id: 'ses_idle', agent: 'plan', time: { busy: Date.now() - 5000, idle: Date.now() } }
          ]
        })
      )

      expect(await callHandler('office:archive-all', {})).toEqual({
        ok: true,
        archived: 1,
        skipped: 1
      })
      expect(clientFns.archiveSession).toHaveBeenCalledWith('ses_idle')
      expect(clientFns.archiveSession).not.toHaveBeenCalledWith('ses_work')

      await expect(callHandler('office:archive-all', { forcar: true })).rejects.toThrow(
        'Requisição inválida.'
      )
      await expect(callHandler('office:archive-all')).rejects.toThrow('Requisição inválida.')
    })

    it('office:archived-list e office:restore usam o cliente e validam o payload', async () => {
      await register()
      const items = [
        {
          sessionID: 'ses_arq',
          title: 'Antiga',
          agent: 'plan',
          model: { providerID: 'opencode-go', id: 'qwen4-max' },
          directory: 'C:\\repo'
        }
      ]
      clientFns.listArchivedSessions.mockResolvedValue(items)
      expect(await callHandler('office:archived-list', {})).toEqual({ ok: true, items })

      expect(await callHandler('office:restore', { sessionID: 'ses_arq' })).toEqual({ ok: true })
      expect(clientFns.restoreSession).toHaveBeenCalledWith('ses_arq')
      await expect(callHandler('office:restore', { sessionID: 'sessao' })).rejects.toThrow(
        'Requisição inválida.'
      )
    })
  })

  describe('aparência e salas-departamento', () => {
    const LOOK = {
      sex: 'feminino',
      hairStyle: 1,
      hairColor: 6,
      skin: 1,
      shirt: 0,
      pants: 0
    }
    const DEPARTMENT = {
      id: 'dep_1a2b3c4d',
      name: 'Gerentes',
      agentID: 'plan',
      sessionIDs: ['ses_idle'],
      createdAt: 1000
    }

    it('office:avatar-get devolve o salvo ou o padrão determinístico', async () => {
      await register()
      const first = callHandler('office:avatar-get', { sessionID: 'ses_sem_look' }) as {
        ok: boolean
        look: unknown
      }
      const second = callHandler('office:avatar-get', { sessionID: 'ses_sem_look' }) as {
        ok: boolean
        look: unknown
      }
      expect(first.ok).toBe(true)
      expect(first.look).toEqual(second.look)

      mocks.storeAvatars = { ses_1: LOOK }
      expect(callHandler('office:avatar-get', { sessionID: 'ses_1' })).toEqual({
        ok: true,
        look: LOOK
      })
      expect(() => callHandler('office:avatar-get', { sessionID: 'x' })).toThrow(
        'Requisição inválida.'
      )
    })

    it('office:avatar-save valida os índices e persiste no store', async () => {
      await register()
      callHandler('office:subscribe')
      expect(await callHandler('office:avatar-save', { sessionID: 'ses_1', look: LOOK })).toEqual({
        ok: true
      })
      expect(mocks.storeAvatars.ses_1).toEqual(LOOK)
      expect(serviceRefresh).toHaveBeenCalled()

      expect(() =>
        callHandler('office:avatar-save', { sessionID: 'ses_1', look: { ...LOOK, shirt: 99 } })
      ).toThrow('Requisição inválida.')
    })

    it('office:department-create gera id dep_…, recusa duplicado e limite', async () => {
      await register()
      const created = (await callHandler('office:department-create', {
        name: 'Gerentes',
        agentID: 'plan'
      })) as { ok: boolean; department: { id: string; name: string; agentID: string } }
      expect(created.ok).toBe(true)
      expect(created.department.id).toMatch(/^dep_[0-9a-f]{8}$/)
      expect(created.department).toMatchObject({ name: 'Gerentes', agentID: 'plan' })

      expect(
        await callHandler('office:department-create', { name: 'gerentes', agentID: 'build' })
      ).toMatchObject({ ok: false })

      mocks.storeDepartments = Array.from({ length: 30 }, (_, index) => ({
        ...DEPARTMENT,
        id: `dep_0000${index.toString(16).padStart(4, '0')}`,
        name: `Sala ${index}`,
        sessionIDs: []
      }))
      expect(
        await callHandler('office:department-create', { name: 'Nova', agentID: 'plan' })
      ).toMatchObject({ ok: false })
    })

    it('office:department-assign aplica no idle e deixa o working pendente', async () => {
      mocks.storeDepartments = [{ ...DEPARTMENT, sessionIDs: [] }]
      await register()
      callHandler('office:subscribe')
      const now = Date.now()
      clientFns.listSessions.mockResolvedValue([
        {
          id: 'ses_idle',
          agent: 'general',
          location: { directory: 'C:\\repo' },
          time: { busy: now - 5000, idle: now - 1000 }
        }
      ])

      expect(
        await callHandler('office:department-assign', {
          sessionID: 'ses_idle',
          departmentID: DEPARTMENT.id,
          applyRole: true
        })
      ).toEqual({ ok: true, applied: 1, pending: 0 })
      expect(clientFns.setSessionAgent).toHaveBeenCalledWith('ses_idle', 'plan')

      clientFns.listSessions.mockResolvedValue([
        {
          id: 'ses_work',
          agent: 'general',
          location: { directory: 'C:\\repo' },
          time: { busy: now - 1000 }
        }
      ])
      expect(
        await callHandler('office:department-assign', {
          sessionID: 'ses_work',
          departmentID: DEPARTMENT.id,
          applyRole: true
        })
      ).toEqual({ ok: true, applied: 0, pending: 1 })
      expect(clientFns.setSessionAgent).not.toHaveBeenCalledWith('ses_work', 'plan')
      expect(serviceRefresh).toHaveBeenCalled()
    })

    it('office:department-apply-role aplica só em quem não está trabalhando', async () => {
      mocks.storeDepartments = [{ ...DEPARTMENT, sessionIDs: ['ses_idle', 'ses_work'] }]
      await register()
      const now = Date.now()
      clientFns.listSessions.mockResolvedValue([
        {
          id: 'ses_idle',
          agent: 'general',
          time: { busy: now - 5000, idle: now - 1000 }
        },
        { id: 'ses_work', agent: 'general', time: { busy: now - 500 } }
      ])

      expect(await callHandler('office:department-apply-role', { id: DEPARTMENT.id })).toEqual({
        ok: true,
        applied: 1,
        pending: 1
      })
      expect(clientFns.setSessionAgent).toHaveBeenCalledTimes(1)
      expect(clientFns.setSessionAgent).toHaveBeenCalledWith('ses_idle', 'plan')
    })

    it('office:department-delete libera membros; update não aplica função sozinho', async () => {
      mocks.storeDepartments = [{ ...DEPARTMENT }]
      await register()

      expect(
        await callHandler('office:department-update', { id: DEPARTMENT.id, agentID: 'build' })
      ).toMatchObject({ ok: true, department: { agentID: 'build' } })
      expect(mocks.storeDepartments[0]).toMatchObject({ agentID: 'build' })
      expect(clientFns.setSessionAgent).not.toHaveBeenCalled()

      expect(await callHandler('office:department-delete', { id: DEPARTMENT.id })).toEqual({
        ok: true,
        released: 1
      })
      expect(mocks.storeDepartments).toEqual([])
      expect(await callHandler('office:department-delete', { id: DEPARTMENT.id })).toMatchObject({
        ok: false
      })
    })

    it('office:department-unassign e payloads inválidos', async () => {
      mocks.storeDepartments = [{ ...DEPARTMENT }]
      await register()
      expect(await callHandler('office:department-unassign', { sessionID: 'ses_idle' })).toEqual({
        ok: true
      })
      expect((mocks.storeDepartments[0] as { sessionIDs: string[] }).sessionIDs).toEqual([])

      await expect(
        callHandler('office:department-assign', {
          sessionID: 'ses_1',
          departmentID: 'dep_xyz',
          applyRole: true
        })
      ).rejects.toThrow('Requisição inválida.')
      await expect(
        callHandler('office:department-create', { name: 'ok', agentID: 'plan', extra: 1 })
      ).rejects.toThrow('Requisição inválida.')
    })
  })
})
