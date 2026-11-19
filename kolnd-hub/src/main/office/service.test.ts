import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfficeSessionInput, OfficeSnapshot } from '../../shared/office'
import { OfficeCliError, type OfficeClient } from './client'
import { createOfficeService } from './service'

interface FakeClient {
  client: OfficeClient
  listSessions: ReturnType<typeof vi.fn>
  sessionMessages: ReturnType<typeof vi.fn>
  setCliPath(path: string | null): void
}

function createFakeClient(): FakeClient {
  let cliPath: string | null = 'C:\\tools\\opencode-cli.exe'
  const listSessions = vi.fn<OfficeClient['listSessions']>()
  const sessionMessages = vi.fn<OfficeClient['sessionMessages']>()
  const client: OfficeClient = {
    resolveCli: async () => cliPath,
    cliPath: () => cliPath,
    listSessions,
    sessionMessages,
    listAgents: async () => [],
    listModels: async () => [],
    createSession: async () => 'ses_novo',
    setSessionAgent: async () => {},
    setSessionModel: async () => {},
    archiveSession: async () => {},
    restoreSession: async () => {},
    listArchivedSessions: async () => []
  }
  return {
    client,
    listSessions,
    sessionMessages,
    setCliPath(path) {
      cliPath = path
    }
  }
}

function session(id: string, overrides: Partial<OfficeSessionInput> = {}): OfficeSessionInput {
  return {
    id,
    title: `Sessão ${id}`,
    agent: 'general',
    model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go' },
    cost: 0,
    tokens: { input: 10, output: 5 },
    time: { created: 1, busy: 2 },
    location: { directory: 'C:\\repo\\alpha' },
    ...overrides
  }
}

function toolMessage(command: string, at: number) {
  return [
    {
      time: { created: at },
      content: [
        {
          type: 'tool',
          name: 'shell',
          state: { status: 'running', input: { command } },
          time: { created: at }
        }
      ]
    }
  ]
}

describe('createOfficeService', () => {
  let fake: FakeClient

  beforeEach(() => {
    vi.useFakeTimers()
    fake = createFakeClient()
    fake.listSessions.mockResolvedValue([])
    fake.sessionMessages.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('refcount: 2 start = 1 loop; 1 stop não para; refcount 0 limpa os timers', async () => {
    const service = createOfficeService({ client: fake.client, emit: () => {} })

    service.start()
    service.start()
    expect(service.subscribers()).toBe(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.listSessions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2000)
    expect(fake.listSessions).toHaveBeenCalledTimes(2)

    // Ainda há um consumidor: o loop continua.
    service.stop()
    expect(service.subscribers()).toBe(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fake.listSessions).toHaveBeenCalledTimes(3)

    // Último consumidor saiu: nenhum timer sobra.
    service.stop()
    expect(service.subscribers()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fake.listSessions).toHaveBeenCalledTimes(3)
  })

  it('backoff da lista: 2→4→8→16→30 s e reset no sucesso', async () => {
    const failure = new OfficeCliError('falhou', 'CLI falhou')
    fake.listSessions.mockRejectedValue(failure)
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.start()

    await vi.advanceTimersByTimeAsync(0)
    expect(fake.listSessions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1999)
    expect(fake.listSessions).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1) // 2 s
    expect(fake.listSessions).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(3999) // +4 s
    expect(fake.listSessions).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.listSessions).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(7999) // +8 s
    expect(fake.listSessions).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.listSessions).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(15_999) // +16 s
    expect(fake.listSessions).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.listSessions).toHaveBeenCalledTimes(5)

    await vi.advanceTimersByTimeAsync(29_999) // +30 s
    expect(fake.listSessions).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.listSessions).toHaveBeenCalledTimes(6)

    // Sucesso zera o backoff: o próximo tick volta a 2 s.
    fake.listSessions.mockResolvedValue([])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fake.listSessions).toHaveBeenCalledTimes(7)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fake.listSessions).toHaveBeenCalledTimes(8)

    service.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('busca mensagens só de sessões working, no máximo 6 por tick, rotacionando', async () => {
    const sessions = Array.from({ length: 8 }, (_, index) => session(`ses_w${index}`))
    fake.listSessions.mockResolvedValue(sessions)
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(3000)
    const firstTick = fake.sessionMessages.mock.calls.map((call) => call[0])
    expect(firstTick).toHaveLength(6)
    expect(firstTick).toEqual(sessions.slice(0, 6).map((item) => item.id))

    await vi.advanceTimersByTimeAsync(3000)
    const secondTick = fake.sessionMessages.mock.calls.slice(6).map((call) => call[0])
    expect(secondTick).toHaveLength(6)
    expect(secondTick.slice(0, 2)).toEqual(['ses_w6', 'ses_w7'])

    service.stop()
  })

  it('não busca mensagens quando nenhuma sessão está working', async () => {
    fake.listSessions.mockResolvedValue([session('ses_idle', { time: { busy: 1, idle: 2 } })])
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(9000)
    expect(fake.sessionMessages).not.toHaveBeenCalled()
    service.stop()
  })

  it('pausa buscas de mensagem enquanto a lista está em backoff', async () => {
    fake.listSessions.mockResolvedValue([session('ses_1')])
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    fake.listSessions.mockRejectedValue(new OfficeCliError('falhou', 'CLI falhou'))
    await vi.advanceTimersByTimeAsync(2000) // lista falha e entra no backoff
    await vi.advanceTimersByTimeAsync(1000) // tick de mensagens é ignorado

    expect(fake.sessionMessages).not.toHaveBeenCalled()
    service.stop()
  })

  it('dedupe de emissão: snapshot igual não emite; mudança de título emite', async () => {
    const emitted: number[] = []
    fake.listSessions.mockResolvedValue([session('ses_1')])
    const service = createOfficeService({
      client: fake.client,
      emit: () => emitted.push(1)
    })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emitted).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(4000)
    expect(emitted).toHaveLength(1)

    fake.listSessions.mockResolvedValue([session('ses_1', { title: 'Mudou o título' })])
    await vi.advanceTimersByTimeAsync(2000)
    expect(emitted).toHaveLength(2)
    expect(service.getSnapshot()?.agents[0].title).toBe('Mudou o título')

    service.stop()
  })

  it('health reflete CLI ausente e volta a ficar saudável no sucesso', async () => {
    const emitted: OfficeSnapshot[] = []
    fake.setCliPath(null)
    fake.listSessions.mockRejectedValue(
      new OfficeCliError('cliAusente', 'Não encontrei o CLI do OpenCode.')
    )
    const service = createOfficeService({
      client: fake.client,
      emit: (snapshot) => emitted.push(snapshot)
    })
    service.start()
    await vi.advanceTimersByTimeAsync(0)

    const unhealthy = service.getSnapshot()
    expect(unhealthy?.health.cliFound).toBe(false)
    expect(unhealthy?.health.pluginConnected).toBe(false)
    expect(unhealthy?.health.cliPath).toBeUndefined()
    expect(unhealthy?.health.lastError).toBe('Não encontrei o CLI do OpenCode.')
    expect(unhealthy?.rooms).toEqual([])

    // CLI volta (instalado/reconhecido): o próximo tick (backoff de 2 s) limpa o erro.
    fake.setCliPath('C:\\tools\\opencode-cli.exe')
    fake.listSessions.mockResolvedValue([session('ses_1')])
    await vi.advanceTimersByTimeAsync(2000)

    const healthy = service.getSnapshot()
    expect(healthy?.health.cliFound).toBe(true)
    expect(healthy?.health.cliPath).toBe('C:\\tools\\opencode-cli.exe')
    expect(healthy?.health.lastError).toBeUndefined()
    expect(emitted.length).toBeGreaterThanOrEqual(2)

    service.stop()
  })

  it('atividade da última mensagem entra no snapshot e no feed', async () => {
    fake.listSessions.mockResolvedValue([session('ses_1')])
    fake.sessionMessages.mockResolvedValue(toolMessage('npm run verify', 5000))
    const emitted: string[] = []
    const service = createOfficeService({
      client: fake.client,
      emit: (snapshot) => emitted.push(snapshot.agents[0]?.activity?.label ?? '')
    })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)

    const snapshot = service.getSnapshot()
    expect(snapshot?.agents[0].activity).toEqual({
      kind: 'shell',
      label: 'Executando npm run verify',
      at: 5000
    })
    expect(snapshot?.feed[0].label).toBe('Executando npm run verify')
    expect(emitted).toContain('Executando npm run verify')

    service.stop()
  })

  it('falha ao buscar mensagens não derruba a lista (só reporta no health)', async () => {
    fake.listSessions.mockResolvedValue([session('ses_1')])
    fake.sessionMessages.mockRejectedValue(new OfficeCliError('timeout', 'Demorou demais.'))
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)

    expect(fake.sessionMessages).toHaveBeenCalledTimes(1)
    expect(service.getSnapshot()?.health.cliFound).toBe(true)
    expect(service.getSnapshot()?.health.lastError).toBe('Demorou demais.')

    await vi.advanceTimersByTimeAsync(2000)
    expect(fake.listSessions).toHaveBeenCalledTimes(3)

    service.stop()
  })

  it('refresh busca na hora e repete quando o poll anterior estava em voo', async () => {
    const pending: Array<(sessions: OfficeSessionInput[]) => void> = []
    fake.listSessions.mockImplementation(
      () =>
        new Promise<OfficeSessionInput[]>((resolve) => {
          pending.push(resolve)
        })
    )
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.listSessions).toHaveBeenCalledTimes(1)

    // Mutação durante o poll em voo: a resposta em curso pode estar antiga.
    service.refresh()
    expect(fake.listSessions).toHaveBeenCalledTimes(1)
    pending[0]?.([])
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.listSessions).toHaveBeenCalledTimes(2)

    pending[1]?.([])
    await vi.advanceTimersByTimeAsync(0)
    service.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refresh sem assinatura não inicia a coleta', async () => {
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.listSessions).not.toHaveBeenCalled()
  })

  it('dispose para tudo, limpa o snapshot e ignora start posterior', async () => {
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getSnapshot()).not.toBeNull()

    service.dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(service.getSnapshot()).toBeNull()
    expect(service.subscribers()).toBe(0)

    service.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fake.listSessions).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop durante um poll em voo não reagenda nem deixa timer', async () => {
    const pending: Array<(sessions: OfficeSessionInput[]) => void> = []
    fake.listSessions.mockImplementation(
      () =>
        new Promise<OfficeSessionInput[]>((resolve) => {
          pending.push(resolve)
        })
    )
    const service = createOfficeService({ client: fake.client, emit: () => {} })
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.listSessions).toHaveBeenCalledTimes(1)

    service.stop()
    pending[0]?.([session('ses_1')])
    await vi.advanceTimersByTimeAsync(20_000)

    expect(fake.listSessions).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
