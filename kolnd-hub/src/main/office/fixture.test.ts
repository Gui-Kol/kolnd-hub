import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_CLI_PATH, FIXTURE_DEFAULT_DELAY_MS, loadOfficeFixture } from './fixture'

/**
 * Testes da fixture de teste do Escritório. Nenhum processo e nenhum Electron:
 * só leitura de arquivo temporário + o cliente falso devolvido.
 */

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kolnd-office-fixture-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeFixture(name: string, content: unknown): string {
  const path = join(dir, name)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return path
}

const SESSIONS = [
  {
    id: 'ses_fixture_main',
    title: 'Ajustar verificação',
    agent: 'general',
    model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go' },
    cost: 0.42,
    tokens: { input: 1200, output: 300 },
    time: { created: 1_000, busy: 2_000, idle: 1_500 },
    location: { directory: 'C:\\projetos\\kolnd-hub' }
  },
  {
    id: 'ses_fixture_idle',
    title: 'Revisar contrato',
    agent: 'plan',
    model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go' },
    time: { created: 1_000, busy: 1_500, idle: 2_000 },
    location: { directory: 'C:\\projetos\\api-core' }
  }
]

describe('loadOfficeFixture', () => {
  it('fixture válida: cliente falso com path, sessões e mensagens por sessão', async () => {
    const path = writeFixture('full.json', {
      sessions: SESSIONS,
      messages: {
        ses_fixture_main: [
          {
            time: { created: 2_100 },
            content: [
              {
                type: 'tool',
                name: 'shell',
                state: { status: 'running', input: { command: 'npm run verify' } },
                time: { created: 2_100 }
              }
            ]
          }
        ]
      },
      delayMs: 0
    })

    const client = loadOfficeFixture(path)

    expect(client.cliPath()).toBe(FIXTURE_CLI_PATH)
    await expect(client.resolveCli()).resolves.toBe(FIXTURE_CLI_PATH)
    await expect(client.listSessions()).resolves.toEqual(SESSIONS)
    await expect(client.sessionMessages('ses_fixture_main')).resolves.toHaveLength(1)
    await expect(client.sessionMessages('ses_sem_mensagens')).resolves.toEqual([])
  })

  it('sem "messages": qualquer sessão devolve lista vazia', async () => {
    const client = loadOfficeFixture(writeFixture('sem-mensagens.json', { sessions: SESSIONS }))

    await expect(client.sessionMessages('ses_fixture_main')).resolves.toEqual([])
    await expect(client.sessionMessages('ses_fixture_idle')).resolves.toEqual([])
  })

  it('JSON inválido: erro legível em pt-BR', () => {
    const path = writeFixture('invalido.json', '{ "sessions": [ }')

    expect(() => loadOfficeFixture(path)).toThrow(/não é um JSON válido/i)
  })

  it('arquivo inexistente: erro legível em pt-BR', () => {
    expect(() => loadOfficeFixture(join(dir, 'nao-existe.json'))).toThrow(
      /Não encontrei a fixture do escritório/i
    )
  })

  it('"sessions" não-array: erro legível em pt-BR', () => {
    const path = writeFixture('sessions-objeto.json', { sessions: { id: 'x' } })

    expect(() => loadOfficeFixture(path)).toThrow(/"sessions" como uma lista/i)
  })

  it('"delayMs" omitido usa o padrão 0 e lista sem atraso', async () => {
    const client = loadOfficeFixture(writeFixture('sem-delay.json', { sessions: SESSIONS }))

    expect(client.delayMs).toBe(FIXTURE_DEFAULT_DELAY_MS)
    const started = Date.now()
    await client.listSessions()
    expect(Date.now() - started).toBeLessThan(100)
  })

  it('"delayMs" válido atrasa as respostas do cliente falso', async () => {
    const client = loadOfficeFixture(writeFixture('com-delay.json', { sessions: [], delayMs: 25 }))

    expect(client.delayMs).toBe(25)
    const started = Date.now()
    await client.listSessions()
    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
  })

  it('"messages" com entrada que não é lista e "delayMs" negativo: erros legíveis', () => {
    const mensagens = writeFixture('mensagens-invalidas.json', {
      sessions: [],
      messages: { ses_x: 'nada' }
    })
    expect(() => loadOfficeFixture(mensagens)).toThrow(/precisam ser uma lista/i)

    const delay = writeFixture('delay-negativo.json', { sessions: [], delayMs: -1 })
    expect(() => loadOfficeFixture(delay)).toThrow(/maior ou igual a zero/i)
  })
})

describe('loadOfficeFixture — gestão de funcionários', () => {
  it('sem agents/models no JSON usa os defaults embutidos', async () => {
    const client = loadOfficeFixture(writeFixture('defaults.json', { sessions: [] }))

    const agents = await client.listAgents('C:\\projetos\\kolnd-hub')
    const models = await client.listModels('C:\\projetos\\kolnd-hub')
    expect(agents.map((agent) => agent.id)).toContain('build')
    expect(models.some((model) => model.enabled)).toBe(true)
    expect(models.some((model) => !model.enabled)).toBe(true)
    expect(models.find((model) => model.id === 'qwen4-max')?.variants).toEqual([
      'none',
      'low',
      'high',
      'xhigh'
    ])
    expect(models.find((model) => model.id === 'deepseek-v4.1-flash')?.variants).toEqual([
      'none',
      'low',
      'high'
    ])
  })

  it('sendPrompt registra texto/delivery e aparece no transcrito', async () => {
    const client = loadOfficeFixture(writeFixture('prompt.json', { sessions: SESSIONS }))

    await client.sendPrompt('ses_fixture_main', { text: 'Revise o build', delivery: 'queue' })
    await client.sendPrompt('ses_fixture_main', { text: 'Agora', delivery: 'steer' })

    const transcript = await client.sessionTranscript('ses_fixture_main')
    expect(transcript.map((entry) => entry.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant'
    ])
    expect(transcript[0].text).toBe('Revise o build')
    expect(transcript[1].text).toContain('queue')
    expect(transcript[2].text).toBe('Agora')
    expect(transcript[3].text).toContain('steer')

    await expect(
      client.sendPrompt('ses_inexistente', { text: 'oi', delivery: 'queue' })
    ).rejects.toThrow(/não existe na fixture/i)
  })

  it('setSessionModel guarda o esforço e interruptSession volta ao ocioso', async () => {
    const client = loadOfficeFixture(writeFixture('variant.json', { sessions: SESSIONS }))

    await client.setSessionModel('ses_fixture_main', {
      providerID: 'opencode-go',
      id: 'qwen4-max',
      variant: 'xhigh'
    })
    const changed = (await client.listSessions()).find(
      (session) => session.id === 'ses_fixture_main'
    )
    expect(changed?.model).toEqual({
      providerID: 'opencode-go',
      id: 'qwen4-max',
      variant: 'xhigh'
    })

    await client.interruptSession('ses_fixture_main')
    const interrupted = (await client.listSessions()).find(
      (session) => session.id === 'ses_fixture_main'
    )
    expect(interrupted?.time?.idle).toBeGreaterThan(interrupted?.time?.busy ?? 0)
  })

  it('createSession acrescenta uma sessão ativa com função, modelo e sala', async () => {
    const client = loadOfficeFixture(writeFixture('hire.json', { sessions: SESSIONS }))

    const sessionID = await client.createSession({
      title: 'Contratar dev',
      agentID: 'build',
      model: null,
      directory: 'C:\\projetos\\kolnd-hub',
      departmentID: 'dep_0000a001'
    })
    expect(sessionID).toBe('ses_fixture_hire_1')

    const sessions = await client.listSessions()
    expect(sessions).toHaveLength(SESSIONS.length + 1)
    expect(sessions[sessions.length - 1]).toMatchObject({
      id: sessionID,
      title: 'Contratar dev',
      agent: 'build',
      model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go' },
      location: { directory: 'C:\\projetos\\kolnd-hub' }
    })
  })

  it('createSession respeita o modelo escolhido e ids não colidem', async () => {
    const client = loadOfficeFixture(writeFixture('hire2.json', { sessions: SESSIONS }))

    const first = await client.createSession({
      title: 'Um',
      agentID: 'plan',
      model: {
        providerID: 'opencode-go',
        id: 'qwen4-max',
        name: 'Qwen4',
        enabled: true,
        variants: ['none', 'low', 'high', 'xhigh']
      },
      directory: 'C:\\projetos\\kolnd-hub',
      departmentID: 'dep_0000a001'
    })
    const second = await client.createSession({
      title: 'Dois',
      agentID: 'plan',
      model: null,
      directory: 'C:\\projetos\\kolnd-hub',
      departmentID: 'dep_0000a001'
    })
    expect(first).not.toBe(second)

    const sessions = await client.listSessions()
    const hired = sessions.find((session) => session.id === first)
    expect(hired?.model).toEqual({ providerID: 'opencode-go', id: 'qwen4-max' })
  })

  it('setSessionAgent/setSessionModel atualizam a sessão contratada', async () => {
    const client = loadOfficeFixture(writeFixture('role.json', { sessions: SESSIONS }))
    const sessionID = await client.createSession({
      title: 'Contratar dev',
      agentID: 'build',
      model: null,
      directory: 'C:\\projetos\\kolnd-hub',
      departmentID: 'dep_0000a001'
    })

    await client.setSessionAgent(sessionID, 'plan')
    await client.setSessionModel(sessionID, { providerID: 'opencode-go', id: 'qwen4-max' })

    const hired = (await client.listSessions()).find((session) => session.id === sessionID)
    expect(hired?.agent).toBe('plan')
    expect(hired?.model).toEqual({ providerID: 'opencode-go', id: 'qwen4-max' })
  })

  it('arquivar tira da lista ativa, lista em arquivados e restaurar devolve', async () => {
    const client = loadOfficeFixture(writeFixture('archive.json', { sessions: SESSIONS }))

    await client.archiveSession('ses_fixture_idle')
    expect((await client.listSessions()).map((session) => session.id)).toEqual(['ses_fixture_main'])

    const archived = await client.listArchivedSessions()
    expect(archived).toHaveLength(1)
    expect(archived[0]).toMatchObject({
      sessionID: 'ses_fixture_idle',
      title: 'Revisar contrato',
      agent: 'plan',
      directory: 'C:\\projetos\\api-core'
    })

    // Filtro por sala: outra sala não aparece.
    expect(await client.listArchivedSessions('C:\\projetos\\kolnd-hub')).toEqual([])

    await client.restoreSession('ses_fixture_idle')
    expect(await client.listSessions()).toHaveLength(SESSIONS.length)
    expect(await client.listArchivedSessions()).toEqual([])
  })

  it('usa agents/models declarados no arquivo e recusa sessão inexistente', async () => {
    const client = loadOfficeFixture(
      writeFixture('custom.json', {
        sessions: SESSIONS,
        agents: [{ id: 'gerente', name: 'Gerente', mode: 'primary', hidden: false }],
        models: [{ providerID: 'opencode-go', id: 'qwen4-max', name: 'Qwen4', enabled: true }]
      })
    )
    expect((await client.listAgents('C:\\projetos\\kolnd-hub')).map((agent) => agent.id)).toEqual([
      'gerente'
    ])
    expect((await client.listModels('C:\\projetos\\kolnd-hub')).map((model) => model.id)).toEqual([
      'qwen4-max'
    ])

    await expect(client.archiveSession('ses_inexistente')).rejects.toThrow(/não existe na fixture/i)
    await expect(client.setSessionAgent('ses_inexistente', 'plan')).rejects.toThrow(
      /não existe na fixture/i
    )
  })

  it('"agents"/"models" fora de lista: erro legível', () => {
    expect(() =>
      loadOfficeFixture(writeFixture('agents.json', { sessions: [], agents: 'x' }))
    ).toThrow(/"agents" da fixture precisa ser uma lista/i)
    expect(() =>
      loadOfficeFixture(writeFixture('models.json', { sessions: [], models: {} }))
    ).toThrow(/"models" da fixture precisa ser uma lista/i)
  })
})
