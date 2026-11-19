import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  describeToolActivity,
  maskSecrets,
  PROMPT_TEXT_MAX,
  TRANSCRIPT_MESSAGES_MAX,
  TRANSCRIPT_TEXT_MAX,
  truncateLabel,
  type OfficeActivity,
  type OfficeAgentOption,
  type OfficeArchivedEmployee,
  type OfficeHireInput,
  type OfficeModelOption,
  type OfficePromptDelivery,
  type OfficeSessionInput,
  type OfficeTranscriptEntry
} from '../../shared/office'
import { logger } from '../logger'
import {
  buildCreateSessionBody,
  isValidAgentID,
  isValidSessionID,
  normalizeModelRef,
  parseAgentList,
  parseArchivedList,
  parseModelList
} from './roster'

/**
 * Cliente do CLI do OpenCode (Fase 1 do Escritório).
 *
 * O servidor do OpenCode responde 401 sem credencial; o CLI já é autenticado,
 * então TUDO passa por `opencode-cli api get …`. Este módulo nunca lê
 * `service.json`, nunca abre o SQLite e nunca faz HTTP direto na porta.
 *
 * `execFileFn` é injetável para que os testes não criem processo algum.
 */

const DEFAULT_TIMEOUT_MS = 4000
/** Escritas (criar/arquivar/trocar função) ganham folga: a API abre sessão. */
const WRITE_TIMEOUT_MS = 10_000
const MAX_BUFFER = 8 * 1024 * 1024
const LOCATE_TIMEOUT_MS = 2000
const LOCATE_MAX_BUFFER = 64 * 1024
const MAX_ERROR_DETAIL = 160

/** Códigos de falha do cliente — a UI traduz cada um para uma instrução. */
export type OfficeCliErrorCode = 'cliAusente' | 'timeout' | 'jsonInvalido' | 'falhou'

export class OfficeCliError extends Error {
  readonly code: OfficeCliErrorCode

  constructor(code: OfficeCliErrorCode, message: string) {
    super(message)
    this.name = 'OfficeCliError'
    this.code = code
  }
}

/** Opções repassadas ao `execFile` (sem `shell`, sempre `windowsHide`). */
export interface CliExecOptions {
  windowsHide: boolean
  timeout: number
  maxBuffer: number
  encoding: 'utf8'
}

export interface CliExecError extends Error {
  code?: string | number | null
  killed?: boolean
  signal?: string | null
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: CliExecOptions,
  callback: (error: CliExecError | null, stdout: string, stderr: string) => void
) => void

const defaultExecFileFn: ExecFileFn = (file, args, options, callback) => {
  execFile(file, [...args], options, (error, stdout, stderr) => {
    callback(
      error as CliExecError | null,
      typeof stdout === 'string' ? stdout : String(stdout ?? ''),
      typeof stderr === 'string' ? stderr : String(stderr ?? '')
    )
  })
}

export interface RunApiOptions {
  /** Caminho já resolvido do CLI; sem ele o cliente lança `cliAusente`. */
  cliPath?: string | null
  timeoutMs?: number
  execFileFn?: ExecFileFn
  /** Cabeçalhos repassados como `-H "nome: valor"` (ex.: diretório do projeto). */
  headers?: readonly string[]
  /**
   * Respostas de escrita do OpenCode costumam ser 204 (stdout vazio). Com
   * `allowEmpty`, ausência de corpo resolve `undefined` em vez de `jsonInvalido`.
   */
  allowEmpty?: boolean
}

export interface LocateDeps {
  exists?: (path: string) => boolean
  execFileFn?: ExecFileFn
  platform?: NodeJS.Platform
  /** `%LOCALAPPDATA%` — injetável para testar o caminho padrão do desktop. */
  localAppData?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Localiza o binário do OpenCode: env → instalação do desktop → PATH.
 * `KOLDND_HUB_OPENCODE_CLI` vence (é o gancho de testes/e2e); se apontar
 * para um arquivo inexistente, segue para os candidatos seguintes.
 */
export async function locateOpencodeCli(
  env: NodeJS.ProcessEnv = process.env,
  deps: LocateDeps = {}
): Promise<string | null> {
  const exists = deps.exists ?? existsSync
  const execFileFn = deps.execFileFn ?? defaultExecFileFn
  const platform = deps.platform ?? process.platform

  const override = (env.KOLDND_HUB_OPENCODE_CLI ?? '').trim()
  if (override) {
    if (exists(override)) return override
    // Não interrompe: a variável pode ter sobrado de uma instalação antiga.
  }

  if (platform === 'win32') {
    const localAppData = (deps.localAppData ?? env.LOCALAPPDATA ?? '').trim()
    if (localAppData) {
      const desktopCli = join(
        localAppData,
        'Programs',
        'ai.opencode.desktop',
        'resources',
        'opencode-cli.exe'
      )
      if (exists(desktopCli)) return desktopCli
    }
  }

  const which = platform === 'win32' ? 'where' : 'which'
  const found = await new Promise<string | null>((resolve) => {
    try {
      execFileFn(
        which,
        ['opencode'],
        {
          windowsHide: true,
          timeout: LOCATE_TIMEOUT_MS,
          maxBuffer: LOCATE_MAX_BUFFER,
          encoding: 'utf8'
        },
        (error, stdout) => {
          if (error) {
            resolve(null)
            return
          }
          const first = stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0)
          resolve(first ?? null)
        }
      )
    } catch {
      resolve(null)
    }
  })

  if (!found) return null
  return exists(found) ? found : null
}

/**
 * Recorta o JSON do stdout: o CLI pode emitir uma linha de aviso antes do
 * objeto. Se nem assim der para ler, é `jsonInvalido`.
 */
export function parseApiJson(stdout: string): unknown {
  const text = stdout.trim()
  if (!text) throw new OfficeCliError('jsonInvalido', 'O CLI do OpenCode não respondeu nada.')

  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        // cai no erro tipado abaixo
      }
    }
    throw new OfficeCliError(
      'jsonInvalido',
      'O CLI do OpenCode respondeu em um formato que não consegui ler.'
    )
  }
}

function messageFromJson(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = parseApiJson(trimmed)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  for (const candidate of [parsed.error, parsed.data, parsed]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (isRecord(candidate)) {
      const message = candidate.message ?? candidate.error ?? candidate.detail
      if (typeof message === 'string' && message.trim()) return message.trim()
    }
  }
  return null
}

function failureDetail(error: CliExecError, stdout: string, stderr: string): string {
  const fromStdout = messageFromJson(stdout)
  if (fromStdout) return truncateLabel(maskSecrets(fromStdout), MAX_ERROR_DETAIL)
  const fromStderr = messageFromJson(stderr)
  if (fromStderr) return truncateLabel(maskSecrets(fromStderr), MAX_ERROR_DETAIL)
  const firstStderrLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (firstStderrLine) return truncateLabel(maskSecrets(firstStderrLine), MAX_ERROR_DETAIL)
  const plain = (error.message ?? '').trim()
  // Nunca despeja o comando inteiro: só a primeira linha, curta.
  const line = plain.split(/\r?\n/)[0] ?? ''
  return truncateLabel(maskSecrets(line), MAX_ERROR_DETAIL)
}

/**
 * Executa `opencode-cli api <args>` e devolve o campo `data` (ou o JSON cru).
 * Sem `shell`, com timeout e `maxBuffer` limitado; falhas viram `OfficeCliError`.
 */
export function runApi(args: readonly string[], options: RunApiOptions = {}): Promise<unknown> {
  const cliPath = options.cliPath?.trim()
  if (!cliPath) {
    return Promise.reject(
      new OfficeCliError(
        'cliAusente',
        'Não encontrei o CLI do OpenCode. Verifique a instalação ou defina KOLDND_HUB_OPENCODE_CLI.'
      )
    )
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const execFileFn = options.execFileFn ?? defaultExecFileFn
  // Cabeçalho com CR/LF permitiria injetar linhas na chamada do CLI: descarta.
  const headers = (options.headers ?? [])
    .map((header) => header.trim())
    .filter((header) => header.length > 0 && !/[\r\n]/.test(header))
  const cliArgs = ['api', ...args]
  for (const header of headers) cliArgs.push('-H', header)

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }

    try {
      execFileFn(
        cliPath,
        cliArgs,
        { windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed || error.signal) {
              finish(() =>
                reject(
                  new OfficeCliError(
                    'timeout',
                    `O CLI do OpenCode demorou mais de ${Math.round(timeoutMs / 1000)} s para responder.`
                  )
                )
              )
              return
            }
            if (error.code === 'ENOENT') {
              finish(() =>
                reject(
                  new OfficeCliError(
                    'cliAusente',
                    'O CLI do OpenCode não foi encontrado no caminho configurado.'
                  )
                )
              )
              return
            }
            const detail = failureDetail(error, stdout ?? '', stderr ?? '')
            finish(() =>
              reject(
                new OfficeCliError(
                  'falhou',
                  detail
                    ? `O CLI do OpenCode falhou: ${detail}`
                    : 'O CLI do OpenCode falhou sem detalhes.'
                )
              )
            )
            return
          }

          // stderr sujo não invalida um stdout bom; só registra uma linha curta.
          const noisy = (stderr ?? '').trim()
          if (noisy) {
            logger.warn(
              'office',
              `CLI escreveu no stderr: ${truncateLabel(maskSecrets(noisy), MAX_ERROR_DETAIL)}`
            )
          }

          // 204 do OpenCode: sucesso sem corpo (PATCH/POST de função).
          if (options.allowEmpty && !(stdout ?? '').trim()) {
            finish(() => resolve(undefined))
            return
          }

          let parsed: unknown
          try {
            parsed = parseApiJson(stdout ?? '')
          } catch (err) {
            finish(() =>
              reject(
                err instanceof OfficeCliError
                  ? err
                  : new OfficeCliError('jsonInvalido', 'Resposta ilegível do CLI do OpenCode.')
              )
            )
            return
          }
          const data = isRecord(parsed) && 'data' in parsed ? parsed.data : parsed
          finish(() => resolve(data))
        }
      )
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      finish(() =>
        reject(
          new OfficeCliError(
            'falhou',
            `Não consegui executar o CLI do OpenCode: ${truncateLabel(maskSecrets(detail), MAX_ERROR_DETAIL)}`
          )
        )
      )
    }
  })
}

/** Mensagem da API: só o que o Escritório lê (sem persistir conversa). */
export interface OfficeMessagePart {
  type?: string
  /** Presente nas partes `text` (o único tipo que a conversa exibe). */
  text?: string
  name?: string
  state?: { status?: string; input?: Record<string, unknown> }
  time?: { created?: number }
}

export interface OfficeMessageInput {
  id?: string
  /** Autor da mensagem (`user`/`assistant`), quando o OpenCode informa. */
  role?: string
  content?: OfficeMessagePart[]
  time?: { created?: number }
}

/** Prompt do OpenOffice: texto já validado pelo IPC (aqui é defesa extra). */
export interface OfficePromptInput {
  text: string
  /** `queue` (padrão) espera a sessão; `steer` entrega agora. */
  delivery: OfficePromptDelivery
}

export interface ListSessionsOptions {
  limit?: number
  search?: string
  /** Por padrão só as ativas: arquivada não é funcionário no escritório. */
  includeArchived?: boolean
}

export interface SessionMessagesOptions {
  limit?: number
}

export interface OfficeClient {
  /** Resolve (e memoriza) o caminho do CLI; `null` quando não existe. */
  resolveCli(): Promise<string | null>
  /** Último caminho resolvido — para o `health.cliPath`. */
  cliPath(): string | null
  listSessions(options?: ListSessionsOptions): Promise<OfficeSessionInput[]>
  sessionMessages(
    sessionID: string,
    options?: SessionMessagesOptions
  ): Promise<OfficeMessageInput[]>
  /** Funções (agentes) do OpenCode para um diretório de projeto. */
  listAgents(directory: string): Promise<OfficeAgentOption[]>
  /** Modelos habilitados do OpenCode para o mesmo diretório. */
  listModels(directory: string): Promise<OfficeModelOption[]>
  /** Cria uma sessão sem prompt; devolve o id novo. */
  createSession(input: OfficeHireInput): Promise<string>
  setSessionAgent(sessionID: string, agentID: string): Promise<void>
  setSessionModel(
    sessionID: string,
    model: { id: string; providerID: string; variant?: string }
  ): Promise<void>
  /** Envia um prompt direto pelo CLI (funciona sem o plugin). */
  sendPrompt(sessionID: string, input: OfficePromptInput): Promise<void>
  /** Para a execução em andamento da sessão. */
  interruptSession(sessionID: string): Promise<void>
  /** Últimas falas da conversa (somente partes de texto, mascaradas). */
  sessionTranscript(sessionID: string, limit?: number): Promise<OfficeTranscriptEntry[]>
  /** Arquivar/restaurar é reversível — nunca exclui a sessão. */
  archiveSession(sessionID: string): Promise<void>
  restoreSession(sessionID: string): Promise<void>
  listArchivedSessions(directory?: string): Promise<OfficeArchivedEmployee[]>
}

export interface OfficeClientOptions {
  env?: NodeJS.ProcessEnv
  execFileFn?: ExecFileFn
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
  localAppData?: string
  timeoutMs?: number
}

function toSessionList(data: unknown): OfficeSessionInput[] {
  if (!Array.isArray(data)) {
    throw new OfficeCliError(
      'jsonInvalido',
      'A lista de sessões do OpenCode veio em um formato inesperado.'
    )
  }
  return data.filter(
    (item): item is OfficeSessionInput => isRecord(item) && typeof item.id === 'string' && !!item.id
  )
}

function toMessageList(data: unknown): OfficeMessageInput[] {
  if (!Array.isArray(data)) {
    throw new OfficeCliError(
      'jsonInvalido',
      'As mensagens da sessão do OpenCode vieram em um formato inesperado.'
    )
  }
  return data.filter(isRecord).map((item) => {
    // O OpenCode já expôs o autor em `role` e em `info.role`; aceitamos os dois.
    const info = isRecord(item.info) ? item.info : null
    const role =
      typeof item.role === 'string'
        ? item.role
        : typeof info?.role === 'string'
          ? info.role
          : undefined
    return {
      id: typeof item.id === 'string' ? item.id : undefined,
      ...(role ? { role } : {}),
      content: Array.isArray(item.content)
        ? (item.content.filter(isRecord) as OfficeMessagePart[])
        : [],
      time: isRecord(item.time)
        ? { created: typeof item.time.created === 'number' ? item.time.created : undefined }
        : undefined
    }
  })
}

/** Cabeçalho de projeto usado por `/api/agent` e `/api/model`. */
function directoryHeader(directory: string): string {
  const path = directory.trim()
  if (!path || /[\r\n]/.test(path)) {
    throw new OfficeCliError('falhou', 'Escolha uma sala válida para consultar o OpenCode.')
  }
  return `x-opencode-directory: ${path}`
}

function requireSessionID(value: string): string {
  const sessionID = value?.trim?.() ?? ''
  if (!isValidSessionID(sessionID)) {
    throw new OfficeCliError('falhou', 'Sessão inválida para a operação.')
  }
  return sessionID
}

function requireAgentID(value: string): string {
  const agentID = value?.trim?.() ?? ''
  if (!isValidAgentID(agentID)) {
    throw new OfficeCliError('falhou', 'Função inválida para a operação.')
  }
  return agentID
}

/** C0 perigosos: quebra de linha e tab são permitidos; o resto não. */
// eslint-disable-next-line no-control-regex -- validar controles é o objetivo
const PROMPT_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

function normalizePromptText(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : ''
  if (!text || text.length > PROMPT_TEXT_MAX || PROMPT_CONTROL_RE.test(text)) {
    throw new OfficeCliError('falhou', 'Prompt inválido para envio.')
  }
  return text
}

function normalizeDelivery(value: unknown): OfficePromptDelivery {
  return value === 'steer' ? 'steer' : 'queue'
}

function transcriptRole(value: string | undefined): OfficeTranscriptEntry['role'] {
  const role = (value ?? '').trim().toLowerCase()
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  return 'unknown'
}

/**
 * Extrai o transcrito exibível: só partes `text`, mascaradas e truncadas.
 * A conversa é pública na UI, então nada de ferramenta/segredo aqui.
 */
export function transcriptFromMessages(
  messages: readonly OfficeMessageInput[],
  limit: number = TRANSCRIPT_MESSAGES_MAX
): OfficeTranscriptEntry[] {
  const entries: OfficeTranscriptEntry[] = []
  for (const message of messages) {
    const role = transcriptRole(message.role)
    const at = message.time?.created ?? 0
    for (const part of message.content ?? []) {
      if (part.type !== 'text' || typeof part.text !== 'string') continue
      const text = truncateLabel(maskSecrets(part.text), TRANSCRIPT_TEXT_MAX)
      if (!text) continue
      entries.push({
        ...(message.id ? { id: message.id } : {}),
        role,
        at,
        text
      })
    }
  }
  entries.sort((a, b) => (a.at !== b.at ? a.at - b.at : (a.id ?? '').localeCompare(b.id ?? '')))
  const max = Math.max(1, Math.min(TRANSCRIPT_MESSAGES_MAX, Math.floor(limit)))
  return entries.slice(-max)
}

interface ApiExtras {
  headers?: readonly string[]
  allowEmpty?: boolean
  timeoutMs?: number
}

/** Cria o cliente com dependências injetáveis (testes) e cache do caminho. */
export function createOfficeClient(options: OfficeClientOptions = {}): OfficeClient {
  const execFileFn = options.execFileFn ?? defaultExecFileFn
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let cachedCli: string | null = null

  async function resolveCli(): Promise<string | null> {
    if (cachedCli) return cachedCli
    const located = await locateOpencodeCli(options.env ?? process.env, {
      exists: options.exists,
      execFileFn,
      platform: options.platform,
      localAppData: options.localAppData
    })
    if (located) cachedCli = located
    return located
  }

  async function api(args: readonly string[], extras: ApiExtras = {}): Promise<unknown> {
    const cliPath = await resolveCli()
    return runApi(args, {
      cliPath,
      timeoutMs: extras.timeoutMs ?? timeoutMs,
      execFileFn,
      ...(extras.headers ? { headers: extras.headers } : {}),
      ...(extras.allowEmpty ? { allowEmpty: true } : {})
    })
  }

  async function fetchMessages(sessionID: string, limit: number): Promise<OfficeMessageInput[]> {
    if (!sessionID.trim()) {
      throw new OfficeCliError('falhou', 'Sessão inválida para buscar mensagens.')
    }
    const max = Math.max(1, Math.min(50, Math.floor(limit)))
    const query = `/api/session/${encodeURIComponent(sessionID)}/message?limit=${max}`
    return toMessageList(await api(['get', query]))
  }

  /** Escrita numa sessão: valida o id e aceita 204 (sem corpo). */
  async function writeSession(
    method: 'post' | 'patch',
    sessionID: string,
    suffix: string,
    body?: unknown
  ): Promise<void> {
    const id = requireSessionID(sessionID)
    const args = [method, `/api/session/${encodeURIComponent(id)}${suffix}`]
    if (body !== undefined) args.push('--data', JSON.stringify(body))
    await api(args, { allowEmpty: true, timeoutMs: WRITE_TIMEOUT_MS })
  }

  return {
    resolveCli,
    cliPath: () => cachedCli,
    async listSessions(listOptions = {}) {
      const limit = Math.max(1, Math.min(200, Math.floor(listOptions.limit ?? 50)))
      const search = listOptions.search?.trim()
      // `archived=false` é explícito: sem o filtro a API devolve arquivadas e o
      // escritório mostraria funcionário que o usuário já tirou da lista.
      const archived = listOptions.includeArchived ? 'true' : 'false'
      const query = `/api/session?limit=${limit}&archived=${archived}${
        search ? `&search=${encodeURIComponent(search)}` : ''
      }`
      return toSessionList(await api(['get', query]))
    },
    async sessionMessages(sessionID, messageOptions = {}) {
      return fetchMessages(sessionID, messageOptions.limit ?? 8)
    },
    async listAgents(directory) {
      const data = await api(['get', '/api/agent'], { headers: [directoryHeader(directory)] })
      return parseAgentList(data)
    },
    async listModels(directory) {
      const data = await api(['get', '/api/model'], { headers: [directoryHeader(directory)] })
      return parseModelList(data)
    },
    async createSession(input) {
      const body = buildCreateSessionBody(input)
      const data = await api(['post', '/api/session', '--data', JSON.stringify(body)], {
        headers: [directoryHeader(input.directory)],
        timeoutMs: WRITE_TIMEOUT_MS
      })
      const sessionID = isRecord(data) && typeof data.id === 'string' ? data.id.trim() : ''
      if (!isValidSessionID(sessionID)) {
        throw new OfficeCliError(
          'jsonInvalido',
          'O OpenCode criou a sessão, mas não devolveu um identificador válido.'
        )
      }
      return sessionID
    },
    async setSessionAgent(sessionID, agentID) {
      await writeSession('post', sessionID, '/agent', { agent: requireAgentID(agentID) })
    },
    async setSessionModel(sessionID, model) {
      const ref = normalizeModelRef(model)
      if (!ref) throw new OfficeCliError('falhou', 'Modelo inválido para a operação.')
      await writeSession('post', sessionID, '/model', { model: ref })
    },
    async sendPrompt(sessionID, input) {
      // Texto nunca vai para log; a validação aqui repete a do IPC.
      const text = normalizePromptText(input?.text)
      const delivery = normalizeDelivery(input?.delivery)
      await writeSession('post', sessionID, '/prompt', { text, delivery })
    },
    async interruptSession(sessionID) {
      await writeSession('post', sessionID, '/interrupt')
    },
    async sessionTranscript(sessionID, limit = TRANSCRIPT_MESSAGES_MAX) {
      if (!isValidSessionID(sessionID?.trim?.() ?? '')) {
        throw new OfficeCliError('falhou', 'Sessão inválida para buscar a conversa.')
      }
      const max = Math.max(1, Math.min(TRANSCRIPT_MESSAGES_MAX, Math.floor(limit)))
      const messages = await fetchMessages(sessionID, max)
      return transcriptFromMessages(messages, max)
    },
    async archiveSession(sessionID) {
      await writeSession('patch', sessionID, '', { archived: true })
    },
    async restoreSession(sessionID) {
      await writeSession('patch', sessionID, '', { archived: false })
    },
    async listArchivedSessions(directory) {
      const clean = directory?.trim() ?? ''
      const data = await api(['get', '/api/session?archived=true&limit=100'], {
        ...(clean ? { headers: [directoryHeader(clean)] } : {})
      })
      return parseArchivedList(data)
    }
  }
}

/**
 * Extrai a atividade mais recente de uma lista de mensagens. Percorre de trás
 * para frente e devolve a primeira parte de ferramenta conhecida; o rótulo já
 * sai mascarado/truncado pelo shared.
 */
export function latestToolActivity(
  messages: readonly OfficeMessageInput[],
  now: number
): OfficeActivity | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]
    const parts = message.content ?? []
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex]
      if (part.type !== 'tool' || !part.name) continue
      const { kind, label } = describeToolActivity(part.name, part.state?.input)
      return { kind, label, at: part.time?.created ?? message.time?.created ?? now }
    }
  }
  return undefined
}
