import { maskSecrets, truncateLabel } from '../../shared/office'

// Contrato das ações (T13/T14) — reexportado aqui para o teste da fonte gerada
// comparar o parser embutido com a versão tipada.
export { normalizeOfficeAction, parseOfficeAction, pluginActionResult } from './actions'
export type { OfficeAction, OfficeActionCommand } from './actions'

/**
 * Fonte do plugin do OpenCode (fase 2 do Escritório).
 *
 * O plugin roda DENTRO do servidor do OpenCode e é instalado na máquina do
 * usuário só em T12 (instalador da UI). Aqui a fonte vive como string — mesmo
 * padrão do `benchmarkRunnerSource.ts`: nada de arquivo em `resources/`, nada
 * de `extraResources` e nenhuma dependência externa.
 *
 * Contrato com o plugin real:
 * - export default `{ id, setup }` (forma aceita na sonda de T10a — não precisa
 *   importar `@opencode/plugin`);
 * - `setup` assina `ctx.event.subscribe` e publica no Hub via HTTP local;
 * - qualquer falha é silenciosa: o plugin NUNCA lança para dentro do OpenCode.
 *
 * `normalizeEvent` é a versão tipada do normalizador embutido no plugin. As
 * duas cópias precisam andar juntas (o teste unitário cobre esta; o
 * `node --check` cobre a string gerada).
 */

export const OFFICE_PLUGIN_VERSION = '1.1.0'

/** Primeiras tentativas da ponte: rápidas, para o caso "o Hub acabou de abrir". */
export const PLUGIN_RETRY_FAST_MS = 5000

/** Depois disso, re-tenta para sempre em ritmo lento (sem ruído). */
export const PLUGIN_RETRY_SLOW_MS = 30_000

/**
 * Política de retry do plugin. `attempt` é 1-based: as 3 primeiras falhas
 * esperam 5 s; da 4ª em diante, 30 s — e nunca desiste.
 */
export function nextRetryDelayMs(attempt: number): number {
  const safe = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1
  return safe <= 3 ? PLUGIN_RETRY_FAST_MS : PLUGIN_RETRY_SLOW_MS
}

/** Sessão pequena: só o que o Escritório desenha, nunca conteúdo de conversa. */
export interface OfficePluginSession {
  id: string
  parentID?: string
  title?: string
  agent?: string
  model?: { id?: string; providerID?: string }
  time?: { created?: number; updated?: number; busy?: number; idle?: number }
  location?: { directory?: string }
}

export interface OfficePluginTool {
  name: string
  status: 'running' | 'completed' | 'error'
  toolID?: string
  /** Basename do arquivo (mascarado e ≤ 60). */
  filePath?: string
  /** Comando mascarado e ≤ 60 — nunca o comando completo. */
  command?: string
}

export interface OfficePluginPermission {
  id: string
  action: string
  /** Recursos juntados, mascarados e ≤ 200. */
  resources: string
  save?: string[]
}

export type OfficePluginEvent =
  | { type: 'hello'; at: number; version: string }
  | { type: 'sessions'; at: number; sessions: OfficePluginSession[] }
  | { type: 'session'; at: number; session: OfficePluginSession }
  | { type: 'status'; at: number; sessionID: string; status: 'busy' | 'idle' }
  | { type: 'tool'; at: number; sessionID: string; tool: OfficePluginTool }
  | {
      type: 'permissions'
      at: number
      sessionID: string
      requests: OfficePluginPermission[]
    }
  | { type: 'permission'; at: number; sessionID: string; request: OfficePluginPermission }
  | { type: 'permission-replied'; at: number; sessionID: string; requestID: string }

const TOOL_STATUS = new Set(['running', 'completed', 'error'])
const SESSION_TITLE_MAX = 120
const ACTION_MAX = 40
const RESOURCE_MAX = 200
const TOOL_TEXT_MAX = 60
const SNAPSHOT_MAX = 50

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const flat = truncateLabel(maskSecrets(value), max)
  return flat || undefined
}

function basename(value: string): string {
  const unified = value.replace(/\\/g, '/')
  return unified.slice(unified.lastIndexOf('/') + 1) || unified
}

function sessionFromRecord(
  raw: Record<string, unknown>,
  fallbackDirectory?: string
): OfficePluginSession | null {
  const id =
    typeof raw.id === 'string' ? raw.id : typeof raw.sessionID === 'string' ? raw.sessionID : ''
  if (!id) return null

  const session: OfficePluginSession = { id }
  if (typeof raw.parentID === 'string' && raw.parentID) session.parentID = raw.parentID
  const title = text(raw.title, SESSION_TITLE_MAX)
  if (title) session.title = title
  if (typeof raw.agent === 'string' && raw.agent) session.agent = raw.agent

  const model = asRecord(raw.model)
  if (model) {
    const modelID = typeof model.id === 'string' ? model.id : undefined
    const providerID = typeof model.providerID === 'string' ? model.providerID : undefined
    if (modelID || providerID)
      session.model = { ...(modelID ? { id: modelID } : {}), ...(providerID ? { providerID } : {}) }
  }

  const location = asRecord(raw.location)
  const directory =
    (location && typeof location.directory === 'string' ? location.directory : undefined) ??
    fallbackDirectory
  if (directory) session.location = { directory }

  const time = asRecord(raw.time)
  if (time) {
    const partial: NonNullable<OfficePluginSession['time']> = {}
    for (const key of ['created', 'updated', 'busy', 'idle'] as const) {
      const value = finiteNumber(time[key])
      if (value !== undefined) partial[key] = value
    }
    if (Object.keys(partial).length > 0) session.time = partial
  }

  return session
}

function toolFromRecord(
  raw: Record<string, unknown>,
  status: OfficePluginTool['status']
): OfficePluginTool {
  const tool: OfficePluginTool = {
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '',
    status
  }
  if (typeof raw.id === 'string' && raw.id) tool.toolID = raw.id

  const input = asRecord(raw.input)
  if (input) {
    const file = [input.filePath, input.filepath, input.path, input.file].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    )
    if (file) tool.filePath = truncateLabel(maskSecrets(basename(file)), TOOL_TEXT_MAX)
    const command = [input.command, input.cmd, input.script].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    )
    if (command) tool.command = truncateLabel(maskSecrets(command), TOOL_TEXT_MAX)
  }

  return tool
}

function permissionFromRecord(raw: Record<string, unknown>): OfficePluginPermission {
  const resources = Array.isArray(raw.resources)
    ? raw.resources.filter((value): value is string => typeof value === 'string').join(', ')
    : typeof raw.resources === 'string'
      ? raw.resources
      : ''
  const permission: OfficePluginPermission = {
    id: typeof raw.id === 'string' ? raw.id : '',
    action: truncateLabel(
      maskSecrets(typeof raw.action === 'string' ? raw.action : 'permissão'),
      ACTION_MAX
    ),
    resources: truncateLabel(maskSecrets(resources), RESOURCE_MAX)
  }
  if (Array.isArray(raw.save)) {
    const save = raw.save
      .filter((value): value is string => typeof value === 'string')
      .slice(0, 5)
      .map((value) => truncateLabel(maskSecrets(value), 80))
    if (save.length > 0) permission.save = save
  }
  return permission
}

/**
 * Traduz um `V2EventEncoded` em um evento pequeno para a ponte. Devolve `null`
 * para tudo que o Escritório não usa (o stream tem dezenas de tipos) e nunca
 * expõe texto de conversa: só ferramenta, sessão, status e permissão.
 */
export function normalizeEvent(input: unknown): OfficePluginEvent | null {
  const event = asRecord(input)
  if (!event || typeof event.type !== 'string') return null
  const at = finiteNumber(event.created) ?? Date.now()
  const data = asRecord(event.data) ?? {}
  const location = asRecord(event.location)
  const fallbackDirectory =
    location && typeof location.directory === 'string' ? location.directory : undefined

  switch (event.type) {
    case 'session.created':
    case 'session.renamed':
    case 'session.metadata.updated':
    case 'session.moved':
    case 'session.agent.selected':
    case 'session.model.selected':
    case 'session.permissions': {
      const session = sessionFromRecord(data, fallbackDirectory)
      return session ? { type: 'session', at, session } : null
    }

    case 'session.execution.started':
    case 'session.idle': {
      const sessionID = typeof data.sessionID === 'string' ? data.sessionID : ''
      if (!sessionID) return null
      return {
        type: 'status',
        at,
        sessionID,
        status: event.type === 'session.idle' ? 'idle' : 'busy'
      }
    }

    case 'session.tool.called':
    case 'session.tool.input.started':
    case 'session.tool.success':
    case 'session.tool.failed': {
      const sessionID = typeof data.sessionID === 'string' ? data.sessionID : ''
      if (!sessionID) return null
      const status: OfficePluginTool['status'] =
        event.type === 'session.tool.success'
          ? 'completed'
          : event.type === 'session.tool.failed'
            ? 'error'
            : 'running'
      return { type: 'tool', at, sessionID, tool: toolFromRecord(data, status) }
    }

    case 'permission.asked': {
      const sessionID = typeof data.sessionID === 'string' ? data.sessionID : ''
      if (!sessionID) return null
      return { type: 'permission', at, sessionID, request: permissionFromRecord(data) }
    }

    case 'permission.replied': {
      const sessionID = typeof data.sessionID === 'string' ? data.sessionID : ''
      const requestID = typeof data.requestID === 'string' ? data.requestID : ''
      if (!sessionID || !requestID) return null
      return { type: 'permission-replied', at, sessionID, requestID }
    }

    default:
      return null
  }
}

/**
 * Validação de entrada da ponte (IPC/HTTP não confiam em ninguém). Reaproveita
 * o mesmo recorte do `normalizeEvent`, mas exige um evento já normalizado.
 * Devolve `null` para qualquer coisa fora do contrato.
 */
export function parsePluginEvent(input: unknown): OfficePluginEvent | null {
  const event = asRecord(input)
  if (!event || typeof event.type !== 'string') return null
  const at = finiteNumber(event.at)
  if (at === undefined) return null

  switch (event.type) {
    case 'hello': {
      const version = typeof event.version === 'string' ? event.version.slice(0, 32) : ''
      return { type: 'hello', at, version }
    }

    case 'sessions': {
      if (!Array.isArray(event.sessions)) return null
      const sessions: OfficePluginSession[] = []
      for (const item of event.sessions.slice(0, SNAPSHOT_MAX)) {
        const record = asRecord(item)
        if (!record) return null
        const session = sessionFromRecord(record)
        if (!session) return null
        sessions.push(session)
      }
      return { type: 'sessions', at, sessions }
    }

    case 'session': {
      const record = asRecord(event.session)
      if (!record) return null
      const session = sessionFromRecord(record)
      return session ? { type: 'session', at, session } : null
    }

    case 'status': {
      const sessionID = typeof event.sessionID === 'string' ? event.sessionID : ''
      if (!sessionID) return null
      if (event.status !== 'busy' && event.status !== 'idle') return null
      return { type: 'status', at, sessionID, status: event.status }
    }

    case 'tool': {
      const sessionID = typeof event.sessionID === 'string' ? event.sessionID : ''
      const tool = asRecord(event.tool)
      if (!sessionID || !tool) return null
      const status = typeof tool.status === 'string' ? tool.status : ''
      if (!TOOL_STATUS.has(status)) return null
      return {
        type: 'tool',
        at,
        sessionID,
        tool: {
          name: typeof tool.name === 'string' ? tool.name.slice(0, 40) : '',
          status: status as OfficePluginTool['status'],
          ...(typeof tool.toolID === 'string' ? { toolID: tool.toolID.slice(0, 120) } : {}),
          ...(typeof tool.filePath === 'string'
            ? { filePath: truncateLabel(maskSecrets(tool.filePath), TOOL_TEXT_MAX) }
            : {}),
          ...(typeof tool.command === 'string'
            ? { command: truncateLabel(maskSecrets(tool.command), TOOL_TEXT_MAX) }
            : {})
        }
      }
    }

    case 'permissions': {
      const sessionID = typeof event.sessionID === 'string' ? event.sessionID : ''
      if (!sessionID || !Array.isArray(event.requests)) return null
      const requests: OfficePluginPermission[] = []
      for (const item of event.requests.slice(0, 20)) {
        const record = asRecord(item)
        if (!record) return null
        requests.push(permissionFromRecord(record))
      }
      return { type: 'permissions', at, sessionID, requests }
    }

    case 'permission': {
      const sessionID = typeof event.sessionID === 'string' ? event.sessionID : ''
      const record = asRecord(event.request)
      if (!sessionID || !record) return null
      return { type: 'permission', at, sessionID, request: permissionFromRecord(record) }
    }

    case 'permission-replied': {
      const sessionID = typeof event.sessionID === 'string' ? event.sessionID : ''
      const requestID = typeof event.requestID === 'string' ? event.requestID : ''
      if (!sessionID || !requestID) return null
      return { type: 'permission-replied', at, sessionID, requestID }
    }

    default:
      return null
  }
}

/**
 * Espelho tipado do gatilho embutido: `permission.asked`/`permission.replied`
 * forçam snapshot de permissões da sessão (o teste cobra a concordância).
 */
export function shouldSnapshotPermissions(type: string): boolean {
  return type === 'permission' || type === 'permission-replied'
}

/**
 * Plugin gerado (ESM, só `node:fs`/`node:path`). O Hub reescreve o arquivo
 * quando esta string muda; `version` permite detectar cópia velha.
 */
export const OFFICE_PLUGIN_SOURCE = String.raw`// Plugin do Kolnd Hub para o OpenCode — gerado pelo app; não editar à mão.
//
// Objetivo: publicar eventos pequenos (sessão, ferramenta, status, permissão)
// em http://127.0.0.1:<porta>/office/events. Sem conteúdo de conversa, sem
// dependências e sem nunca lançar para dentro do OpenCode.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const version = '${OFFICE_PLUGIN_VERSION}'

const RETRY_FAST_MS = 5000
const RETRY_SLOW_MS = 30000
const FLUSH_MS = 100
const SNAPSHOT_MS = 30000
const TIMEOUT_MS = 1000
const MASK = '***'
const TITLE_MAX = 120
const ACTION_MAX = 40
const RESOURCE_MAX = 200
const TOOL_TEXT_MAX = 60
const ACTION_WAIT_MS = 20000
const ACTION_TIMEOUT_MS = 25000
const ACTION_RETRY_MS = 2000
const ACTION_TEXT_MAX = 2000
const ACTION_MESSAGE_MAX = 500
const ACTION_ID = /^[A-Za-z0-9_-]{1,64}$/
const SESSION_ID = /^ses_[A-Za-z0-9]{1,116}$/
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

// Mesma política de nextRetryDelayMs do app: 5 s nas 3 primeiras tentativas,
// 30 s depois — para sempre. O plugin pode carregar antes da ponte existir.
export function nextRetryDelayMs(attempt) {
  const safe = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1
  return safe <= 3 ? RETRY_FAST_MS : RETRY_SLOW_MS
}

function truncate(value, max) {
  const flat = String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
  if (max <= 0) return ''
  if (flat.length <= max) return flat
  if (max === 1) return '…'
  return flat.slice(0, max - 1) + '…'
}

// Cópia fiel do maskSecrets de src/shared/office.ts: o plugin não pode importar
// o código do Hub (roda no servidor do OpenCode). Mantenha as duas em sincronia.
function maskSecrets(value) {
  let out = String(value === null || value === undefined ? '' : value)
  out = out.replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, '//' + MASK + ':' + MASK + '@')
  out = out.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-' + MASK)
  out = out.replace(/\bghp_[A-Za-z0-9]{6,}/g, 'ghp_' + MASK)
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{6,}/g, 'github_pat_' + MASK)
  out = out.replace(/\bAKIA[A-Z0-9]{8,}/g, 'AKIA' + MASK)
  out = out.replace(/\bASIA[A-Z0-9]{8,}/g, 'ASIA' + MASK)
  out = out.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ' + MASK)
  out = out.replace(/(-u|--user)\s+\S+:\S+/gi, '$1 ' + MASK + ':' + MASK)
  out = out.replace(
    /\b(api[-_]?key|token|secret|password|passwd|pwd|senha|chave)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    '$1$2' + MASK
  )
  return out
}

function basename(value) {
  const unified = String(value).replace(/\\/g, '/')
  return unified.slice(unified.lastIndexOf('/') + 1) || unified
}

function bridgeCandidates() {
  const list = []
  const override = (process.env.KOLDND_HUB_OFFICE_BRIDGE || '').trim()
  if (override) list.push(override)
  if (process.env.APPDATA) {
    list.push(join(process.env.APPDATA, 'kolnd-hub', 'office', 'bridge.json'))
  }
  return list
}

function readBridge() {
  for (const path of bridgeCandidates()) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (
        parsed &&
        Number.isInteger(parsed.port) &&
        parsed.port > 0 &&
        parsed.port < 65536 &&
        typeof parsed.token === 'string' &&
        parsed.token
      ) {
        return { port: parsed.port, token: parsed.token }
      }
    } catch {
      // arquivo ausente/ilegível: tenta o próximo candidato
    }
  }
  return null
}

function sessionFrom(raw, fallbackDirectory) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id : typeof raw.sessionID === 'string' ? raw.sessionID : ''
  if (!id) return null
  const session = { id }
  if (typeof raw.parentID === 'string' && raw.parentID) session.parentID = raw.parentID
  if (typeof raw.title === 'string' && raw.title.trim()) {
    session.title = truncate(maskSecrets(raw.title), TITLE_MAX)
  }
  if (typeof raw.agent === 'string' && raw.agent) session.agent = raw.agent
  if (raw.model && typeof raw.model === 'object') {
    const model = {}
    if (typeof raw.model.id === 'string') model.id = raw.model.id
    if (typeof raw.model.providerID === 'string') model.providerID = raw.model.providerID
    if (Object.keys(model).length > 0) session.model = model
  }
  const directory =
    (raw.location && typeof raw.location.directory === 'string' ? raw.location.directory : null) ||
    fallbackDirectory
  if (directory) session.location = { directory }
  if (raw.time && typeof raw.time === 'object') {
    const time = {}
    for (const key of ['created', 'updated', 'busy', 'idle']) {
      if (typeof raw.time[key] === 'number' && Number.isFinite(raw.time[key])) {
        time[key] = raw.time[key]
      }
    }
    if (Object.keys(time).length > 0) session.time = time
  }
  return session
}

function toolFrom(data, status) {
  const tool = { name: typeof data.name === 'string' ? data.name.trim().slice(0, 40) : '', status }
  if (typeof data.id === 'string' && data.id) tool.toolID = data.id
  const input = data.input && typeof data.input === 'object' ? data.input : {}
  const file = [input.filePath, input.filepath, input.path, input.file].find(
    (value) => typeof value === 'string' && value.trim()
  )
  if (file) tool.filePath = truncate(maskSecrets(basename(file)), TOOL_TEXT_MAX)
  const command = [input.command, input.cmd, input.script].find(
    (value) => typeof value === 'string' && value.trim()
  )
  if (command) tool.command = truncate(maskSecrets(command), TOOL_TEXT_MAX)
  return tool
}

function permissionFrom(data) {
  const resources = Array.isArray(data.resources)
    ? data.resources.filter((value) => typeof value === 'string').join(', ')
    : typeof data.resources === 'string'
      ? data.resources
      : ''
  const permission = {
    id: typeof data.id === 'string' ? data.id : '',
    action: truncate(maskSecrets(typeof data.action === 'string' ? data.action : 'permissão'), ACTION_MAX),
    resources: truncate(maskSecrets(resources), RESOURCE_MAX)
  }
  if (Array.isArray(data.save)) {
    const save = data.save
      .filter((value) => typeof value === 'string')
      .slice(0, 5)
      .map((value) => truncate(maskSecrets(value), 80))
    if (save.length > 0) permission.save = save
  }
  return permission
}

// Mensagem/observação opcional: devolve null para conteúdo inválido.
function cleanMessage(value) {
  if (typeof value !== 'string') return null
  const flat = value.trim()
  if (!flat) return ''
  if (flat.length > ACTION_MESSAGE_MAX || CONTROL_CHARS.test(flat)) return null
  return flat
}

// Valida o comando vindo da ponte. Qualquer coisa fora do contrato vira null —
// o plugin nunca executa payload parcial ou com sessão de outro formato.
export function parseAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  if (typeof input.id !== 'string' || !ACTION_ID.test(input.id)) return null
  if (typeof input.sessionID !== 'string' || !SESSION_ID.test(input.sessionID)) return null

  if (input.action === 'permission.reply') {
    if (typeof input.requestID !== 'string' || !ACTION_ID.test(input.requestID)) return null
    if (input.decision !== 'once' && input.decision !== 'always' && input.decision !== 'reject') {
      return null
    }
    const command = {
      id: input.id,
      action: 'permission.reply',
      sessionID: input.sessionID,
      requestID: input.requestID,
      decision: input.decision
    }
    if (input.message !== undefined && input.message !== null) {
      const message = cleanMessage(input.message)
      if (message === null) return null
      if (message) command.message = message
    }
    return command
  }

  if (input.action === 'session.prompt') {
    if (typeof input.text !== 'string') return null
    const text = input.text.trim()
    if (!text || text.length > ACTION_TEXT_MAX || CONTROL_CHARS.test(text)) return null
    const command = {
      id: input.id,
      action: 'session.prompt',
      sessionID: input.sessionID,
      text: text
    }
    if (input.delivery === 'steer' || input.delivery === 'queue') command.delivery = input.delivery
    return command
  }

  return null
}

// permission.asked/replied pedem snapshot imediato daquela sessão — o Hub não
// pode esperar o ciclo de 30 s para mostrar "precisa de você".
export function shouldSnapshotPermissions(type) {
  return type === 'permission' || type === 'permission-replied'
}

// Resultado curto: nunca carrega texto de mensagem, só o desfecho.
export function actionResult(ok, error) {
  if (ok) return { ok: true }
  const text = truncate(String(error === null || error === undefined ? '' : error), 200)
  return { ok: false, error: text || 'a ação falhou' }
}

// Executa UMA ação por vez: o flag busy impede duas chamadas concorrentes e o
// laço só busca a próxima depois de responder o resultado da atual.
export function createActionLoop(options) {
  let busy = false
  return async function run() {
    if (busy) return false
    busy = true
    try {
      let item = null
      try {
        item = await options.next()
      } catch {
        return true
      }
      if (!item) return true
      const command = parseAction(item)
      if (!command) {
        if (typeof item.id === 'string' && ACTION_ID.test(item.id)) {
          try {
            await options.report(item.id, actionResult(false, 'ação não reconhecida'))
          } catch {
            // Hub sumiu: nada a fazer
          }
        }
        return true
      }
      let result
      try {
        await options.execute(command)
        result = actionResult(true)
      } catch {
        result = actionResult(false, 'a ação falhou no OpenCode')
      }
      try {
        await options.report(command.id, result)
      } catch {
        // Hub sumiu: o resultado morre junto com a fila do Hub
      }
      return true
    } finally {
      busy = false
    }
  }
}

// Função pura: recebe um evento do OpenCode e devolve o recorte pequeno ou null.
export function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') return null
  const at = typeof event.created === 'number' && Number.isFinite(event.created)
    ? event.created
    : Date.now()
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  const fallback =
    event.location && typeof event.location.directory === 'string'
      ? event.location.directory
      : undefined

  switch (event.type) {
    case 'session.created':
    case 'session.renamed':
    case 'session.metadata.updated':
    case 'session.moved':
    case 'session.agent.selected':
    case 'session.model.selected':
    case 'session.permissions': {
      const session = sessionFrom(data, fallback)
      return session ? { type: 'session', at: at, session: session } : null
    }
    case 'session.execution.started':
    case 'session.idle': {
      if (typeof data.sessionID !== 'string' || !data.sessionID) return null
      return {
        type: 'status',
        at: at,
        sessionID: data.sessionID,
        status: event.type === 'session.idle' ? 'idle' : 'busy'
      }
    }
    case 'session.tool.called':
    case 'session.tool.input.started':
    case 'session.tool.success':
    case 'session.tool.failed': {
      if (typeof data.sessionID !== 'string' || !data.sessionID) return null
      const status =
        event.type === 'session.tool.success'
          ? 'completed'
          : event.type === 'session.tool.failed'
            ? 'error'
            : 'running'
      return { type: 'tool', at: at, sessionID: data.sessionID, tool: toolFrom(data, status) }
    }
    case 'permission.asked': {
      if (typeof data.sessionID !== 'string' || !data.sessionID) return null
      return {
        type: 'permission',
        at: at,
        sessionID: data.sessionID,
        request: permissionFrom(data)
      }
    }
    case 'permission.replied': {
      if (typeof data.sessionID !== 'string' || !data.sessionID) return null
      if (typeof data.requestID !== 'string' || !data.requestID) return null
      return { type: 'permission-replied', at: at, sessionID: data.sessionID, requestID: data.requestID }
    }
    default:
      return null
  }
}

export default {
  id: 'kolnd.office',
  async setup(ctx) {
    let bridge = null
    let controller = null
    let flushTimer = null
    let snapshotTimer = null
    let retryTimer = null
    let attempts = 0
    let stopped = false
    let actionsStarted = false
    const pending = new Map()
    const toolNames = new Map()

    function endpoint(path) {
      return 'http://127.0.0.1:' + bridge.port + path
    }

    function enqueue(event) {
      if (stopped || !bridge || !event) return
      const key = event.sessionID ? event.type + ':' + event.sessionID : event.type
      pending.set(key, event)
      if (pending.size > 40) {
        const first = pending.keys().next().value
        pending.delete(first)
      }
      if (!flushTimer) {
        flushTimer = setTimeout(function () {
          void flush()
        }, FLUSH_MS)
      }
    }

    async function flush() {
      flushTimer = null
      if (stopped || !bridge || pending.size === 0) return
      const events = []
      // ~10 eventos/s: um evento por flush de 100 ms; o excedente fica na fila
      // e o coalescing por sessão garante que só o último estado importa.
      const first = pending.entries().next()
      if (!first.done) {
        events.push(first.value[1])
        pending.delete(first.value[0])
      }
      try {
        await fetch(endpoint('/office/events'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-kolnd-token': bridge.token
          },
          body: JSON.stringify({ events: events }),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
      } catch {
        // Hub fechado/porta morta: silêncio total, o OpenCode segue normal.
      }
      if (!stopped && pending.size > 0) {
        flushTimer = setTimeout(function () {
          void flush()
        }, FLUSH_MS)
      }
    }

    async function hello() {
      if (stopped || !bridge) return
      try {
        await fetch(endpoint('/office/hello?version=' + encodeURIComponent(version)), {
          headers: { 'x-kolnd-token': bridge.token },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
      } catch {
        // silencioso
      }
    }

    // Snapshot de permissões de UMA sessão: o Hub não pode esperar 30 s quando
    // chega permission.asked/permission.replied.
    async function sendPermissions(sessionID) {
      if (stopped || !bridge) return
      try {
        const result = await ctx.permission.list({ sessionID: sessionID })
        const list = Array.isArray(result) ? result : result && Array.isArray(result.data) ? result.data : []
        enqueue({
          type: 'permissions',
          at: Date.now(),
          sessionID: sessionID,
          requests: list.map((request) => permissionFrom(request || {}))
        })
      } catch {
        // permissão indisponível para esta sessão: ignora
      }
    }

    async function sendSnapshot() {
      if (stopped || !bridge) return
      let sessions = []
      try {
        const page = await ctx.session.list({ limit: 50 })
        const list = Array.isArray(page) ? page : page && Array.isArray(page.data) ? page.data : []
        sessions = list
          .slice(0, 50)
          .map((item) => sessionFrom(item, ctx.location && ctx.location.directory))
          .filter((item) => item !== null)
        enqueue({ type: 'sessions', at: Date.now(), sessions: sessions })
      } catch {
        return
      }
      for (const session of sessions) {
        await sendPermissions(session.id)
      }
    }

    // Ação pedida pelo Hub: executa com o contexto tipado e devolve o desfecho.
    async function executeAction(command) {
      if (command.action === 'permission.reply') {
        const input = {
          sessionID: command.sessionID,
          requestID: command.requestID,
          decision: command.decision
        }
        if (command.message) input.message = command.message
        await ctx.permission.reply(input)
        return
      }
      const input = { sessionID: command.sessionID, text: command.text }
      if (command.delivery) input.delivery = command.delivery
      await ctx.session.prompt(input)
    }

    async function postActionResult(id, result) {
      if (stopped || !bridge) return
      try {
        await fetch(endpoint('/office/actions/' + encodeURIComponent(id) + '/result'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-kolnd-token': bridge.token
          },
          body: JSON.stringify(result),
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
      } catch {
        // Hub fechado: o resultado é descartado junto com a fila do Hub.
      }
    }

    function wait(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms)
      })
    }

    // Long-poll da fila: 204 é "nada nesta janela"; erro de rede espera 2 s.
    async function fetchAction() {
      if (stopped || !bridge) return null
      try {
        const response = await fetch(endpoint('/office/actions?wait=' + ACTION_WAIT_MS), {
          headers: { 'x-kolnd-token': bridge.token },
          signal: AbortSignal.timeout(ACTION_TIMEOUT_MS)
        })
        if (response.status === 204) return null
        if (!response.ok) {
          await wait(ACTION_RETRY_MS)
          return null
        }
        const body = await response.json()
        return body && typeof body === 'object' ? body : null
      } catch {
        await wait(ACTION_RETRY_MS)
        return null
      }
    }

    async function pollActions() {
      const loop = createActionLoop({
        next: fetchAction,
        execute: executeAction,
        report: postActionResult
      })
      while (!stopped && bridge) {
        try {
          await loop()
        } catch {
          await wait(ACTION_RETRY_MS)
        }
      }
    }

    async function connect() {
      if (stopped) return
      const found = readBridge()
      if (!found) {
        attempts += 1
        retryTimer = setTimeout(function () {
          void connect()
        }, nextRetryDelayMs(attempts))
        return
      }
      bridge = found
      void hello()
      controller = new AbortController()
      void (async function () {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            try {
              const data = event && event.data && typeof event.data === 'object' ? event.data : {}
              const key =
                typeof data.id === 'string' && typeof data.sessionID === 'string'
                  ? data.sessionID + ':' + data.id
                  : ''
              if (
                key &&
                (event.type === 'session.tool.called' || event.type === 'session.tool.input.started') &&
                typeof data.name === 'string'
              ) {
                toolNames.set(key, data.name)
              }
              const normalized = normalizeEvent(event)
              if (normalized) {
                if (normalized.type === 'tool' && !normalized.tool.name && key) {
                  normalized.tool.name = toolNames.get(key) || ''
                }
                enqueue(normalized)
                if (shouldSnapshotPermissions(normalized.type)) {
                  void sendPermissions(normalized.sessionID)
                }
              }
            } catch {
              // evento estranho nunca derruba o loop
            }
          }
        } catch {
          // assinatura encerrada (cleanup ou servidor caiu)
        }
      })()
      void sendSnapshot()
      // Fila de ações: só depois da ponte descoberta, um loop para a vida toda
      // da instância (1 ação por vez, sem paralelismo).
      if (!actionsStarted) {
        actionsStarted = true
        void pollActions()
      }
      snapshotTimer = setInterval(function () {
        void hello()
        void sendSnapshot()
      }, SNAPSHOT_MS)
    }

    void connect()

    return function cleanup() {
      stopped = true
      try {
        if (controller) controller.abort()
      } catch {
        // já encerrado
      }
      if (flushTimer) clearTimeout(flushTimer)
      if (snapshotTimer) clearInterval(snapshotTimer)
      if (retryTimer) clearTimeout(retryTimer)
      pending.clear()
      toolNames.clear()
    }
  }
}
`
