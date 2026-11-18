import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  describeToolActivity,
  maskSecrets,
  truncateLabel,
  type OfficeActivity,
  type OfficeSessionInput
} from '../../shared/office'
import { logger } from '../logger'

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
        ['api', ...args],
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
  name?: string
  state?: { status?: string; input?: Record<string, unknown> }
  time?: { created?: number }
}

export interface OfficeMessageInput {
  id?: string
  content?: OfficeMessagePart[]
  time?: { created?: number }
}

export interface ListSessionsOptions {
  limit?: number
  search?: string
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
  return data.filter(isRecord).map((item) => ({
    id: typeof item.id === 'string' ? item.id : undefined,
    content: Array.isArray(item.content)
      ? (item.content.filter(isRecord) as OfficeMessagePart[])
      : [],
    time: isRecord(item.time)
      ? { created: typeof item.time.created === 'number' ? item.time.created : undefined }
      : undefined
  }))
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

  async function api(args: readonly string[]): Promise<unknown> {
    const cliPath = await resolveCli()
    return runApi(args, { cliPath, timeoutMs, execFileFn })
  }

  return {
    resolveCli,
    cliPath: () => cachedCli,
    async listSessions(listOptions = {}) {
      const limit = Math.max(1, Math.min(200, Math.floor(listOptions.limit ?? 50)))
      const search = listOptions.search?.trim()
      const query = `/api/session?limit=${limit}${
        search ? `&search=${encodeURIComponent(search)}` : ''
      }`
      return toSessionList(await api(['get', query]))
    },
    async sessionMessages(sessionID, messageOptions = {}) {
      if (!sessionID.trim()) {
        throw new OfficeCliError('falhou', 'Sessão inválida para buscar mensagens.')
      }
      const limit = Math.max(1, Math.min(50, Math.floor(messageOptions.limit ?? 8)))
      const query = `/api/session/${encodeURIComponent(sessionID)}/message?limit=${limit}`
      return toMessageList(await api(['get', query]))
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
