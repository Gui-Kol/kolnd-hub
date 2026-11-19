import { readFileSync } from 'fs'
import {
  normalizeDirectory,
  TRANSCRIPT_MESSAGES_MAX,
  type OfficeAgentOption,
  type OfficeArchivedEmployee,
  type OfficeHireInput,
  type OfficeModelOption,
  type OfficeSessionInput
} from '../../shared/office'
import { transcriptFromMessages, type OfficeClient, type OfficeMessageInput } from './client'
import { parseAgentList, parseModelList } from './roster'

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

/**
 * Funções/modelos padrão da fixture: o e2e de gestão precisa de opções
 * determinísticas mesmo quando o JSON não declara `agents`/`models`.
 */
export const FIXTURE_DEFAULT_AGENTS: OfficeAgentOption[] = [
  { id: 'build', name: 'Build', description: 'Implementa e verifica', mode: 'primary' },
  { id: 'plan', name: 'Planejador', description: 'Planeja antes de agir', mode: 'primary' },
  { id: 'general', name: 'General', description: 'Tarefas gerais', mode: 'all' },
  { id: 'explore', name: 'Explorar', description: 'Busca no projeto', mode: 'subagent' }
]

export const FIXTURE_DEFAULT_MODELS: OfficeModelOption[] = [
  {
    providerID: 'opencode-go',
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    enabled: true,
    variants: ['none', 'low', 'high']
  },
  {
    providerID: 'opencode-go',
    id: 'qwen4-max',
    name: 'Qwen4 Max',
    enabled: true,
    variants: ['none', 'low', 'high', 'xhigh']
  },
  {
    providerID: 'opencode',
    id: 'tidepool-alpha-free',
    name: 'Tidepool Alpha Free',
    enabled: false,
    variants: []
  }
]

export interface OfficeFixtureFile {
  sessions: OfficeSessionInput[]
  messages?: Record<string, OfficeMessageInput[]>
  delayMs?: number
  /** Opções opcionais: sem elas a fixture usa os defaults acima. */
  agents?: OfficeAgentOption[]
  models?: OfficeModelOption[]
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

  let agents: OfficeAgentOption[] | undefined
  if (parsed.agents !== undefined) {
    if (!Array.isArray(parsed.agents)) {
      throw fixtureError('"agents" da fixture precisa ser uma lista de funções.')
    }
    agents = parseAgentList(parsed.agents)
  }

  let models: OfficeModelOption[] | undefined
  if (parsed.models !== undefined) {
    if (!Array.isArray(parsed.models)) {
      throw fixtureError('"models" da fixture precisa ser uma lista de modelos.')
    }
    models = parseModelList(parsed.models)
  }

  return { sessions, messages, delayMs, agents, models }
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
  const delayMs = file.delayMs ?? FIXTURE_DEFAULT_DELAY_MS
  const agents = file.agents ?? FIXTURE_DEFAULT_AGENTS
  const models = file.models ?? FIXTURE_DEFAULT_MODELS
  // Estado em memória: o e2e contrata/arquiva/restaura e o poller relê daqui.
  const sessions: OfficeSessionInput[] = file.sessions.map((session) => ({ ...session }))
  const archived = new Set<string>()
  // Conversa em memória: o prompt do e2e entra aqui e o transcrito relê.
  const messagesBySession: Record<string, OfficeMessageInput[]> = {}
  for (const [sessionID, list] of Object.entries(file.messages ?? {})) {
    messagesBySession[sessionID] = list.map((message) => ({ ...message }))
  }
  const prompts: Array<{ sessionID: string; text: string; delivery: string }> = []
  let hireCount = 0
  let promptCount = 0
  /** Garante ordem cronológica mesmo com dois prompts no mesmo milissegundo. */
  let lastMessageAt = 0

  const waitFixture = (): Promise<void> => wait(delayMs)

  function findSession(sessionID: string): OfficeSessionInput {
    const found = sessions.find((session) => session.id === sessionID)
    if (!found) {
      throw fixtureError(`A sessão "${sessionID}" não existe na fixture do escritório.`)
    }
    return found
  }

  return {
    delayMs,
    resolveCli: async () => FIXTURE_CLI_PATH,
    cliPath: () => FIXTURE_CLI_PATH,
    async listSessions() {
      await waitFixture()
      return sessions
        .filter((session) => !archived.has(session.id))
        .map((session) => ({ ...session }))
    },
    async sessionMessages(sessionID) {
      await waitFixture()
      return (messagesBySession[sessionID] ?? []).map((message) => ({ ...message }))
    },
    async listAgents(_directory?: string) {
      await waitFixture()
      return agents.map((agent) => ({ ...agent }))
    },
    async listModels(_directory?: string) {
      await waitFixture()
      return models.map((model) => ({ ...model }))
    },
    async createSession(input: OfficeHireInput) {
      await waitFixture()
      let sessionID = ''
      do {
        hireCount += 1
        sessionID = `ses_fixture_hire_${hireCount}`
      } while (sessions.some((session) => session.id === sessionID))

      // Sem modelo escolhido, imita o OpenCode usando o padrão da função: o
      // primeiro modelo habilitado da fixture.
      const model = input.model ?? models.find((option) => option.enabled) ?? models[0] ?? null
      const now = Date.now()
      sessions.push({
        id: sessionID,
        title: input.title,
        agent: input.agentID,
        model: model
          ? { id: model.id, providerID: model.providerID }
          : { id: 'desconhecido', providerID: 'desconhecido' },
        cost: 0,
        tokens: { input: 0, output: 0 },
        time: { created: now, updated: now },
        location: { directory: input.directory }
      })
      return sessionID
    },
    async setSessionAgent(sessionID, agentID) {
      await waitFixture()
      findSession(sessionID).agent = agentID
    },
    async setSessionModel(sessionID, model) {
      await waitFixture()
      findSession(sessionID).model = {
        id: model.id,
        providerID: model.providerID,
        ...(model.variant ? { variant: model.variant } : {})
      }
    },
    async sendPrompt(sessionID, input) {
      await waitFixture()
      findSession(sessionID)
      const text = input.text.trim()
      if (!text) throw fixtureError('O prompt não pode ficar vazio.')
      prompts.push({ sessionID, text, delivery: input.delivery })
      promptCount += 1
      const at = Math.max(Date.now(), lastMessageAt + 1)
      lastMessageAt = at + 1
      const list = messagesBySession[sessionID] ?? (messagesBySession[sessionID] = [])
      list.push({
        id: `msg_fixture_prompt_${promptCount}`,
        role: 'user',
        time: { created: at },
        content: [{ type: 'text', text }]
      })
      // A fixture "aceita" o prompt e responde: o transcrito do e2e fica real.
      list.push({
        id: `msg_fixture_reply_${promptCount}`,
        role: 'assistant',
        time: { created: at + 1 },
        content: [{ type: 'text', text: `Recebi seu pedido (${input.delivery}): ${text}` }]
      })
    },
    async interruptSession(sessionID) {
      await waitFixture()
      const session = findSession(sessionID)
      const at = Date.now()
      // Interromper devolve a sessão ao estado ocioso (sem apagar histórico).
      session.time = { ...(session.time ?? {}), updated: at, busy: at - 1, idle: at }
    },
    async sessionTranscript(sessionID, limit = TRANSCRIPT_MESSAGES_MAX) {
      await waitFixture()
      findSession(sessionID)
      return transcriptFromMessages(messagesBySession[sessionID] ?? [], limit)
    },
    async archiveSession(sessionID) {
      await waitFixture()
      findSession(sessionID)
      archived.add(sessionID)
    },
    async restoreSession(sessionID) {
      await waitFixture()
      findSession(sessionID)
      archived.delete(sessionID)
    },
    async listArchivedSessions(directory) {
      await waitFixture()
      const clean = directory?.trim() ?? ''
      return sessions
        .filter((session) => archived.has(session.id))
        .filter(
          (session) =>
            !clean || normalizeDirectory(session.location?.directory) === normalizeDirectory(clean)
        )
        .map((session): OfficeArchivedEmployee => ({
          sessionID: session.id,
          title: session.title?.trim() || 'Sessão sem título',
          agent: session.agent?.trim() || 'desconhecido',
          model: {
            providerID: session.model?.providerID?.trim() || '',
            id: session.model?.id?.trim() || ''
          },
          directory: session.location?.directory?.trim() ?? ''
        }))
    }
  }
}
