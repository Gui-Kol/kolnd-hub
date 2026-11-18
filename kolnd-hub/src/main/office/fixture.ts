import { readFileSync } from 'fs'
import type { OfficeSessionInput } from '../../shared/office'
import type { OfficeClient, OfficeMessageInput } from './client'

/**
 * Fixture do Escritório — injeção de dados **somente em teste** (T9).
 *
 * O e2e do Playwright não pode depender do OpenCode real (a máquina pode ter
 * sessões de verdade, o CLI pode demorar ou não existir). Este módulo lê um
 * JSON fixo e devolve um `OfficeClient` falso com a mesma forma do cliente do
 * CLI, então o poller e a derivação do snapshot rodam sem alteração.
 *
 * Nada aqui importa `electron` de propósito: o Vitest roda em `environment:
 * 'node'` e o arquivo precisa ser testável isolado. Quem decide usar a fixture
 * é o IPC (`src/main/ipc/office.ts`), com dupla trava de ambiente.
 *
 * Formato do arquivo:
 * `{ "sessions": OfficeSessionInput[], "messages"?: Record<id, OfficeMessageInput[]>, "delayMs"?: number }`
 */

export const FIXTURE_CLI_PATH = 'fixture'
export const FIXTURE_DEFAULT_DELAY_MS = 0

export interface OfficeFixtureFile {
  sessions: OfficeSessionInput[]
  messages?: Record<string, OfficeMessageInput[]>
  delayMs?: number
}

/** Cliente falso + `delayMs` efetivo (útil no teste do valor padrão). */
export interface OfficeFixtureClient extends OfficeClient {
  readonly delayMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Erro legível em pt-BR — o IPC copia a mensagem para `health.lastError`. */
function fixtureError(message: string): Error {
  return new Error(message)
}

function readFixtureText(filePath: string): string {
  const path = filePath?.trim()
  if (!path) throw fixtureError('O caminho da fixture do escritório não foi informado.')
  try {
    // Leitura síncrona de um arquivo minúsculo, uma única vez por execução.
    // A fixture só existe em teste; não vale a pena abrir mão da API síncrona.
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
  } catch (err) {
    const code = isRecord(err) || err instanceof Error ? (err as NodeJS.ErrnoException).code : null
    if (code === 'ENOENT') {
      throw fixtureError(`Não encontrei a fixture do escritório em "${path}".`)
    }
    const detail = err instanceof Error && err.message ? ` ${err.message}` : ''
    throw fixtureError(`Não consegui ler a fixture do escritório em "${path}".${detail}`)
  }
}

function parseFixture(text: string, filePath: string): OfficeFixtureFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw fixtureError(`A fixture do escritório em "${filePath}" não é um JSON válido.`)
  }
  if (!isRecord(parsed)) {
    throw fixtureError('A fixture do escritório precisa ser um objeto JSON com "sessions".')
  }
  if (!Array.isArray(parsed.sessions)) {
    throw fixtureError('A fixture do escritório precisa de "sessions" como uma lista.')
  }

  const sessions: OfficeSessionInput[] = []
  for (const [index, item] of parsed.sessions.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) {
      throw fixtureError(`A sessão #${index + 1} da fixture não tem um "id" válido.`)
    }
    sessions.push(item as unknown as OfficeSessionInput)
  }

  let messages: Record<string, OfficeMessageInput[]> | undefined
  if (parsed.messages !== undefined) {
    if (!isRecord(parsed.messages)) {
      throw fixtureError('"messages" da fixture precisa ser um objeto de listas por sessão.')
    }
    messages = {}
    for (const [sessionID, list] of Object.entries(parsed.messages)) {
      if (!Array.isArray(list)) {
        throw fixtureError(
          `As mensagens da sessão "${sessionID}" na fixture precisam ser uma lista.`
        )
      }
      messages[sessionID] = list as OfficeMessageInput[]
    }
  }

  let delayMs = FIXTURE_DEFAULT_DELAY_MS
  if (parsed.delayMs !== undefined) {
    if (
      typeof parsed.delayMs !== 'number' ||
      !Number.isFinite(parsed.delayMs) ||
      parsed.delayMs < 0
    ) {
      throw fixtureError('"delayMs" da fixture precisa ser um número maior ou igual a zero.')
    }
    delayMs = Math.floor(parsed.delayMs)
  }

  return messages ? { sessions, messages, delayMs } : { sessions, delayMs }
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Carrega a fixture e devolve um `OfficeClient` falso.
 *
 * Falha de caminho/formato vira `Error` com mensagem pt-BR — o chamador decide
 * como degradar (o IPC usa `health.lastError` e não liga poller nenhum).
 */
export function loadOfficeFixture(filePath: string): OfficeFixtureClient {
  const file = parseFixture(readFixtureText(filePath), filePath)

  return {
    delayMs: file.delayMs ?? FIXTURE_DEFAULT_DELAY_MS,
    resolveCli: async () => FIXTURE_CLI_PATH,
    cliPath: () => FIXTURE_CLI_PATH,
    async listSessions() {
      await wait(file.delayMs ?? FIXTURE_DEFAULT_DELAY_MS)
      return [...file.sessions]
    },
    async sessionMessages(sessionID) {
      await wait(file.delayMs ?? FIXTURE_DEFAULT_DELAY_MS)
      return file.messages?.[sessionID] ?? []
    }
  }
}
