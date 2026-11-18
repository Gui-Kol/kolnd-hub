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
