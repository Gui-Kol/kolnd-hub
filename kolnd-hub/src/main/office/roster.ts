import type {
  OfficeAgentOption,
  OfficeAgentStatus,
  OfficeArchivedEmployee,
  OfficeHireInput,
  OfficeModelOption,
  OfficeSetRoleInput
} from '../../shared/office'

/**
 * Regras puras da GESTÃO DE FUNCIONÁRIOS do Escritório.
 *
 * Um "funcionário" é uma sessão real do OpenCode. Este módulo traduz o JSON da
 * API (`/api/agent`, `/api/model`, `/api/session`) e valida o que a UI pede —
 * sempre a partir de `unknown`, porque o renderer pode estar comprometido
 * (AGENTS.md: IPC valida tipo, tamanho e formato). Nada aqui faz I/O, lê o
 * relógio ou conhece Electron: o IPC e os testes usam as mesmas funções.
 */

/** Teto do título de um funcionário (validado dos dois lados). */
export const HIRE_TITLE_MAX = 80

/** Formato do id de agente aceito pelo OpenCode. */
export const AGENT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/

/**
 * Id de sessão: o OpenCode usa `ses_...`; a fixture do e2e usa `ses_...` com
 * `_` no meio. `encodeURIComponent` já protege o path, mas o formato é barrado.
 */
export const SESSION_ID_RE = /^ses_[A-Za-z0-9_-]{1,116}$/

/** Provider/modelo: ids reais podem ter `/`, `:` e `@` (ex.: openrouter). */
const PROVIDER_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const MODEL_ID_RE = /^[A-Za-z0-9._:@/-]{1,160}$/

/** Teto defensivo do diretório (bem abaixo do limite de path do Windows). */
export const DIRECTORY_MAX = 512

const MODEL_NAME_MAX = 120
const DESCRIPTION_MAX = 200
const ARCHIVED_TITLE_MAX = 120

// eslint-disable-next-line no-control-regex -- validar controles é o objetivo
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat || CONTROL_CHARS.test(flat)) return null
  return flat.slice(0, max)
}

function token(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return pattern.test(trimmed) ? trimmed : null
}

/** Título de funcionário: 1–80, sem quebras de linha nem controles. */
export function normalizeHireTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat || flat.length > HIRE_TITLE_MAX || CONTROL_CHARS.test(flat)) return null
  return flat
}

export function isValidAgentID(value: unknown): value is string {
  return typeof value === 'string' && AGENT_ID_RE.test(value)
}

export function isValidSessionID(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

/**
 * Diretório absoluto em qualquer plataforma suportada: unidade do Windows,
 * UNC (`\\servidor\share`) ou POSIX (`/...`). Sem controle, sem aspas e com
 * teto de tamanho — a existência é conferida no IPC (que tem `fs`).
 */
export function isValidDirectory(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const path = value.trim()
  if (!path || path.length > DIRECTORY_MAX) return false
  if (CONTROL_CHARS.test(path)) return false
  if (/^[A-Za-z]:[\\/][^\\/]/.test(path)) return true
  if (/^\\\\[^\\/]+[\\/][^\\/]+/.test(path)) return true
  return /^\/(?!\/)/.test(path)
}

/** Referência mínima de modelo aceita pela API (`{ id, providerID }`). */
export function normalizeModelRef(value: unknown): { providerID: string; id: string } | null {
  if (!isRecord(value)) return null
  const providerID = token(value.providerID, PROVIDER_ID_RE)
  const id = token(value.id, MODEL_ID_RE)
  return providerID && id ? { providerID, id } : null
}

/** Lista tolerante: aceita o array cru ou o envelope `{ data }` do CLI. */
function listFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.data)) return value.data
  return []
}

/** `GET /api/agent` → funções visíveis (escondidas ficam fora da UI). */
export function parseAgentList(data: unknown): OfficeAgentOption[] {
  const agents: OfficeAgentOption[] = []
  const seen = new Set<string>()

  for (const raw of listFrom(data)) {
    if (!isRecord(raw) || raw.hidden === true) continue
    const id = token(raw.id, AGENT_ID_RE)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const mode = typeof raw.mode === 'string' ? raw.mode.trim() : ''
    const agent: OfficeAgentOption = {
      id,
      name: cleanText(raw.name, DESCRIPTION_MAX) ?? id,
      mode: mode === 'primary' || mode === 'subagent' || mode === 'all' ? mode : 'all'
    }
    const description = cleanText(raw.description, DESCRIPTION_MAX)
    if (description) agent.description = description
    agents.push(agent)
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id))
}

/** `GET /api/model` → modelos com id/provider válidos (inclusive desabilitados). */
export function parseModelList(data: unknown): OfficeModelOption[] {
  const models: OfficeModelOption[] = []
  const seen = new Set<string>()

  for (const raw of listFrom(data)) {
    if (!isRecord(raw)) continue
    const providerID = token(raw.providerID, PROVIDER_ID_RE)
    const id = token(raw.id, MODEL_ID_RE)
    if (!providerID || !id) continue
    const key = `${providerID}/${id}`
    if (seen.has(key)) continue
    seen.add(key)

    models.push({
      providerID,
      id,
      name: cleanText(raw.name, MODEL_NAME_MAX) ?? key,
      // A API marca `enabled` explicitamente; ausência significa habilitado.
      enabled: raw.enabled !== false
    })
  }

  return models.sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'pt-BR') ||
      a.providerID.localeCompare(b.providerID) ||
      a.id.localeCompare(b.id)
  )
}

/**
 * `GET /api/session?archived=true` → linhas da lista de arquivados.
 * `Session.Info` não traz `archived`; por isso o filtro é só pela query.
 */
export function parseArchivedList(data: unknown): OfficeArchivedEmployee[] {
  const employees: OfficeArchivedEmployee[] = []
  const seen = new Set<string>()

  for (const raw of listFrom(data)) {
    if (!isRecord(raw)) continue
    const sessionID = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!isValidSessionID(sessionID) || seen.has(sessionID)) continue
    seen.add(sessionID)

    employees.push({
      sessionID,
      title: cleanText(raw.title, ARCHIVED_TITLE_MAX) ?? 'Sessão sem título',
      agent: cleanText(raw.agent, 64) ?? 'desconhecido',
      model: {
        providerID: token(isRecord(raw.model) ? raw.model.providerID : null, PROVIDER_ID_RE) ?? '',
        id: token(isRecord(raw.model) ? raw.model.id : null, MODEL_ID_RE) ?? ''
      },
      directory:
        cleanText(isRecord(raw.location) ? raw.location.directory : null, DIRECTORY_MAX) ?? ''
    })
  }

  return employees.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
}

function parseModelOption(value: unknown): OfficeModelOption | null {
  if (!isRecord(value)) return null
  if (!onlyKeys(value, ['providerID', 'id', 'name', 'enabled'])) return null
  const providerID = token(value.providerID, PROVIDER_ID_RE)
  const id = token(value.id, MODEL_ID_RE)
  if (!providerID || !id) return null
  return {
    providerID,
    id,
    name: cleanText(value.name, MODEL_NAME_MAX) ?? `${providerID}/${id}`,
    enabled: value.enabled !== false
  }
}

/**
 * Valida o pedido de contratação. `model: null` é legítimo (padrão da função);
 * chave extra, título longo ou caminho relativo invalidam o pedido inteiro.
 */
export function normalizeHireInput(input: unknown): OfficeHireInput | null {
  if (!isRecord(input)) return null
  if (!onlyKeys(input, ['title', 'agentID', 'model', 'directory'])) return null

  const title = normalizeHireTitle(input.title)
  const agentID = token(input.agentID, AGENT_ID_RE)
  const directory = typeof input.directory === 'string' ? input.directory.trim() : ''
  if (!title || !agentID || !isValidDirectory(directory)) return null

  let model: OfficeModelOption | null = null
  if (input.model !== null) {
    model = parseModelOption(input.model)
    if (!model) return null
  }

  return { title, agentID, model, directory }
}

/** Valida a troca de função. `model: null` mantém o modelo atual da sessão. */
export function normalizeSetRoleInput(input: unknown): OfficeSetRoleInput | null {
  if (!isRecord(input)) return null
  if (!onlyKeys(input, ['sessionID', 'agentID', 'model'])) return null

  const sessionID = typeof input.sessionID === 'string' ? input.sessionID.trim() : ''
  const agentID = token(input.agentID, AGENT_ID_RE)
  if (!isValidSessionID(sessionID) || !agentID) return null

  let model: OfficeModelOption | null = null
  if (input.model !== null && input.model !== undefined) {
    model = parseModelOption(input.model)
    if (!model) return null
  }

  return { sessionID, agentID, model }
}

/** `{ sessionID }` para restaurar uma sessão arquivada. */
export function normalizeRestoreInput(input: unknown): { sessionID: string } | null {
  if (!isRecord(input) || !onlyKeys(input, ['sessionID'])) return null
  const sessionID = typeof input.sessionID === 'string' ? input.sessionID.trim() : ''
  return isValidSessionID(sessionID) ? { sessionID } : null
}

/** `{ directory }` para buscar agentes/modelos da sala. */
export function normalizeRosterOptionsInput(input: unknown): { directory: string } | null {
  if (!isRecord(input) || !onlyKeys(input, ['directory'])) return null
  const directory = typeof input.directory === 'string' ? input.directory.trim() : ''
  return isValidDirectory(directory) ? { directory } : null
}

/**
 * "Apagar todos" não tem payload. Só o objeto vazio passa — qualquer chave
 * extra é tratada como pedido inválido (nada de filtros escondidos).
 */
export function normalizeArchiveAllInput(input: unknown): Record<string, never> | null {
  if (!isRecord(input) || Object.keys(input).length > 0) return null
  return {}
}

/** Corpo de `POST /api/session`: modelo só quando o usuário escolheu um. */
export interface OfficeCreateSessionBody {
  title: string
  agent: string
  location: { directory: string }
  model?: { id: string; providerID: string }
}

export function buildCreateSessionBody(input: OfficeHireInput): OfficeCreateSessionBody {
  const body: OfficeCreateSessionBody = {
    title: input.title,
    agent: input.agentID,
    location: { directory: input.directory }
  }
  if (input.model) body.model = { id: input.model.id, providerID: input.model.providerID }
  return body
}

/** Alvos do "apagar todos": `working` NUNCA é arquivado (só contado). */
export interface OfficeArchiveTargets {
  targetIDs: string[]
  skippedIDs: string[]
}

export function pickArchiveTargets(
  agents: readonly Pick<{ sessionID: string; status: OfficeAgentStatus }, 'sessionID' | 'status'>[]
): OfficeArchiveTargets {
  const targetIDs: string[] = []
  const skippedIDs: string[] = []
  const seen = new Set<string>()

  for (const agent of agents) {
    const sessionID = typeof agent?.sessionID === 'string' ? agent.sessionID.trim() : ''
    if (!sessionID || seen.has(sessionID)) continue
    seen.add(sessionID)
    if (agent.status === 'working' || !isValidSessionID(sessionID)) {
      skippedIDs.push(sessionID)
      continue
    }
    targetIDs.push(sessionID)
  }

  return { targetIDs, skippedIDs }
}
