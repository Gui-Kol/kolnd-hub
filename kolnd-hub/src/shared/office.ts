// Contrato compartilhado da página "OpenOffice" (escritório virtual).
//
// FRONTEIRA: este arquivo não importa nada de `main/`, `preload/` ou
// `renderer/` — é a fonte única do snapshot consumido pela UI e produzido pelo
// coletor. Tipos puros + funções puras, sem I/O, sem `Date.now()` interno e
// sem dependência de plataforma (mesmo padrão de `hwmon.ts`).
//
// O renderer NUNCA fala com a API do OpenCode: o main traduz `Session.Info`
// para este contrato e a UI só conhece o que está aqui.

/** Origem do snapshot: poller do CLI, plugin de tempo real, ou o merge dos dois. */
export type OfficeSource = 'poller' | 'plugin' | 'both'

/** Estados reais expostos pelo OpenCode (não inventar estados). */
export type OfficeAgentStatus = 'working' | 'needsYou' | 'idle' | 'ended' | 'unknown'

/** Categoria da atividade mostrada na bolha do personagem. */
export type OfficeActivityKind = 'read' | 'edit' | 'shell' | 'search' | 'web' | 'think' | 'other'

export interface OfficeModel {
  providerID: string
  id: string
}

export interface OfficeTokens {
  input: number
  output: number
  /** `input + output` — o cache fica de fora para não inflar a métrica. */
  total: number
}

export interface OfficeActivity {
  kind: OfficeActivityKind
  /** Texto curto em pt-BR, já mascarado e truncado (≤ `LABEL_MAX`). */
  label: string
  /** Epoch em ms. */
  at: number
}

export interface OfficeAgent {
  sessionID: string
  /** Presente quando a sessão é subagente de outra. */
  parentID?: string
  title: string
  agent: string
  model: OfficeModel
  status: OfficeAgentStatus
  activity?: OfficeActivity
  cost: number
  tokens: OfficeTokens
  /** Epoch ms de criação da sessão (fallback: `now`). */
  startedAt: number
  /** Epoch ms da última atualização conhecida. */
  lastSeenAt: number
  /** `OfficeRoom.id` da sala em que o personagem senta. */
  roomID: string
  /** Nome determinístico derivado do `sessionID`. */
  name: string
  /** Seed determinística do "look" (mesmo id ⇒ mesmo personagem). */
  seed: number
}

export interface OfficeRoom {
  /** Diretório canônico da sessão (minúsculas, `/`, sem barra final). */
  id: string
  /** Basename legível da pasta do projeto. */
  name: string
  /**
   * Diretório ORIGINAL da primeira sessão da sala (caixa e separadores
   * preservados). O `id` é canônico e não serve para criar sessão no OpenCode;
   * contratar um funcionário usa este caminho.
   */
  path: string
  agentIDs: string[]
}

export interface OfficeTotals {
  working: number
  idle: number
  needsYou: number
  subagents: number
  cost: number
  tokens: number
}

export interface OfficeHealth {
  /** O CLI foi localizado nesta máquina. */
  cliFound: boolean
  cliPath?: string
  /** O plugin de tempo real já falou com a ponte. */
  pluginConnected: boolean
  /** Último erro legível em pt-BR (sem comando/segredo). */
  lastError?: string
}

/**
 * Pedido de permissão pendente no OpenCode (Fase 3).
 *
 * Só o plugin conhece esta fila (D11): o poller do CLI é somente leitura. Os
 * `resources` chegam já mascarados e truncados — a UI nunca precisa (nem deve)
 * receber o comando/texto completo.
 */
export interface OfficePermissionRequest {
  /** Id do pedido no OpenCode (`requestID` da resposta). */
  id: string
  /** Sessão que está esperando. */
  sessionID: string
  /** Ferramenta/ação em pt-BR ou nome do OpenCode (ex.: `shell`, `edit`). */
  action: string
  /** Recursos do pedido (comando, arquivo…), cada um mascarado e ≤ 200 chars. */
  resources: string[]
  /** Regras que o OpenCode sugere salvar (`Aprovar sempre`); vazio = sem sugestão. */
  save: string[]
  /** Observação opcional do pedido, mascarada e ≤ 500 chars. */
  message?: string
  /** Epoch ms em que o pedido chegou ao Hub. */
  at: number
}

export interface OfficeSnapshot {
  /** Epoch ms em que o snapshot foi derivado. */
  generatedAt: number
  source: OfficeSource
  rooms: OfficeRoom[]
  agents: OfficeAgent[]
  feed: OfficeActivity[]
  /** Pedidos de permissão pendentes, mais recentes primeiro (≤ `REQUEST_MAX`). */
  requests: OfficePermissionRequest[]
  totals: OfficeTotals
  health: OfficeHealth
}

// ── Gestão de funcionários (contratar / dar função / arquivar) ─────────────
//
// "Funcionário" é uma sessão real do OpenCode. Estes tipos descrevem só o que
// atravessa a fronteira main → renderer; a validação de entrada vive em
// `main/office/roster.ts` (pura) e é repetida no IPC.

/** Função que o OpenCode oferece para um diretório (`GET /api/agent`). */
export interface OfficeAgentOption {
  id: string
  name: string
  description?: string
  /** `primary` | `subagent` | `all` (string para tolerar modos novos). */
  mode: string
}

/** Modelo habilitado no OpenCode (`GET /api/model`). */
export interface OfficeModelOption {
  providerID: string
  id: string
  name: string
  enabled: boolean
}

/** Opções da função: agentes e modelos válidos para a sala escolhida. */
export interface OfficeRosterOptions {
  agents: OfficeAgentOption[]
  models: OfficeModelOption[]
}

/** Resposta do IPC de opções (erro legível quando o CLI não responde). */
export interface OfficeRosterResult extends OfficeRosterOptions {
  ok: boolean
  error?: string
}

/** Contratar: cria uma sessão sem prompt na sala informada. */
export interface OfficeHireInput {
  /** Título da sessão (1–80 caracteres). */
  title: string
  agentID: string
  /** `null` = usar o modelo padrão da função. */
  model: OfficeModelOption | null
  /** Diretório original da sala (absoluto e existente, validado no main). */
  directory: string
}

/** Dar função: troca o agente e (quando informado) o modelo da sessão. */
export interface OfficeSetRoleInput {
  sessionID: string
  agentID: string
  /** `null` = manter o modelo atual. */
  model: OfficeModelOption | null
}

/** Linha da lista de arquivados (`GET /api/session?archived=true`). */
export interface OfficeArchivedEmployee {
  sessionID: string
  title: string
  agent: string
  model: OfficeModel
  directory: string
}

/** Desfecho de uma operação de gestão (contratar, dar função, restaurar). */
export interface OfficeManageResult {
  ok: boolean
  error?: string
}

/** Desfecho de "apagar todos" — que na verdade ARQUIVA as sessões ociosas. */
export interface OfficeArchiveAllResult {
  ok: boolean
  archived: number
  /** Sessões `working` puladas de propósito (nunca são arquivadas aqui). */
  skipped: number
  error?: string
}

/** Resposta do IPC da lista de arquivados. */
export interface OfficeArchivedListResult {
  ok: boolean
  items: OfficeArchivedEmployee[]
  error?: string
}

/** Recorte tolerante de `Session.Info` — campos ausentes viram `null`/default. */
export interface OfficeSessionInput {
  id: string
  parentID?: string | null
  title?: string | null
  agent?: string | null
  model?: { id?: string | null; providerID?: string | null } | null
  cost?: number | null
  tokens?: {
    input?: number | null
    output?: number | null
    cache?: { read?: number | null; write?: number | null } | null
  } | null
  outcome?: string | null
  time?: {
    created?: number | null
    updated?: number | null
    busy?: number | null
    idle?: number | null
  } | null
  location?: { directory?: string | null } | null
}

/** Atividade por sessão: aceita `Record` (JSON) ou `Map` (merge do plugin). */
export type OfficeActivityMap =
  Record<string, OfficeActivity | undefined> | ReadonlyMap<string, OfficeActivity>

export interface OfficeDeriveInput {
  sessions: readonly OfficeSessionInput[]
  activityBySession?: OfficeActivityMap
  /** Epoch ms de referência — a função nunca lê o relógio sozinha. */
  now: number
  source?: OfficeSource
  health?: Partial<OfficeHealth>
  /** Sessões com permissão/questão pendente (vem do plugin, nunca do poller). */
  needsYouSessionIDs?: readonly string[]
  /**
   * Pedidos de permissão pendentes. Quando presente (mesmo vazio), o `needsYou`
   * passa a sair deles; `needsYouSessionIDs` continua valendo em paralelo para
   * não quebrar quem só tem a lista antiga.
   */
  requests?: readonly OfficePermissionRequest[]
}

/** Teto do rótulo de atividade exibido na bolha. */
export const LABEL_MAX = 90

/** Máximo de itens no feed inferior. */
export const FEED_MAX = 40

/** Máximo de pedidos de permissão que a UI recebe (mais recentes primeiro). */
export const REQUEST_MAX = 20

/** Teto de cada recurso de um pedido de permissão. */
export const REQUEST_RESOURCE_MAX = 200

/** Teto de observação de um pedido de permissão. */
export const REQUEST_MESSAGE_MAX = 500

/** Teto de recursos por pedido (o plugin já manda poucos; isto é defesa). */
export const REQUEST_RESOURCES_MAX = 8

/** Texto usado no lugar de um segredo mascarado. */
export const MASK = '***'

/**
 * Janela em que um agente ocioso ainda é considerado "no escritório".
 *
 * `GET /api/session?limit=50` devolve sessões de dias atrás; sem esta janela,
 * qualquer sessão antiga com `idle` viraria um personagem "ocioso" eterno.
 * Passados 15 minutos sem atividade, a sessão é tratada como encerrada.
 */
export const IDLE_VISIBLE_MS = 15 * 60_000

const FALLBACK_ROOM_ID = 'sem-projeto'
const FALLBACK_ROOM_NAME = 'Sem projeto'

/**
 * Lista fixa de nomes pt-BR (sem apelidos ofensivos). O nome de cada
 * personagem sai de um hash do `sessionID`: mesmo id ⇒ mesmo nome sempre,
 * sem persistência nova e sem migração de store.
 */
const AGENT_NAMES = [
  'Alice',
  'Ana',
  'Bento',
  'Bruno',
  'Carla',
  'Clara',
  'Davi',
  'Diego',
  'Eduarda',
  'Elisa',
  'Fábio',
  'Felipe',
  'Gabriela',
  'Gustavo',
  'Heitor',
  'Helena',
  'Igor',
  'Isabela',
  'João',
  'Julia',
  'Karina',
  'Kevin',
  'Larissa',
  'Lucas',
  'Marina',
  'Miguel',
  'Natália',
  'Nicolas',
  'Olívia',
  'Otávio',
  'Paulo',
  'Priscila',
  'Queren',
  'Rafael',
  'Renato',
  'Sabrina',
  'Sofia',
  'Thiago',
  'Tomás',
  'Úrsula',
  'Vitor',
  'Vitória',
  'Wesley',
  'Xênia',
  'Yara',
  'Zeca'
] as const

/** Ordem estável de exibição: quem trabalha primeiro, quem não tem dado por último. */
const STATUS_ORDER: Record<OfficeAgentStatus, number> = {
  working: 0,
  needsYou: 1,
  idle: 2,
  ended: 3,
  unknown: 4
}

/**
 * FNV-1a de 32 bits — hash pequeno e determinístico para nome/look.
 * Exportado porque o renderer usa a mesma seed para escolher a paleta.
 */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Nome determinístico do personagem a partir do id da sessão. */
export function agentNameFor(sessionID: string): string {
  const index = fnv1a(sessionID) % AGENT_NAMES.length
  return AGENT_NAMES[index]
}

/** Seed determinística do "look" (paleta/cabelo) a partir do id da sessão. */
export function agentSeedFor(sessionID: string): number {
  return fnv1a(`look:${sessionID}`)
}

/**
 * Diretório canônico: minúsculas, `\` → `/`, sem barra final e sem espaços
 * redundantes. É a chave da sala — `C:\Proj` e `c:/proj/` caem no mesmo id.
 */
export function normalizeDirectory(directory: string | null | undefined): string {
  const raw = (directory ?? '').trim()
  if (!raw) return FALLBACK_ROOM_ID
  const unified = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  const trimmed = unified.length > 1 ? unified.replace(/\/+$/, '') : unified
  return trimmed.toLowerCase() || FALLBACK_ROOM_ID
}

/** Basename legível (preserva a caixa original) — nome da sala na tela. */
export function roomNameFor(directory: string | null | undefined): string {
  const raw = (directory ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!raw) return FALLBACK_ROOM_NAME
  const base = raw.slice(raw.lastIndexOf('/') + 1).trim()
  return base || FALLBACK_ROOM_NAME
}

/**
 * Mapa ferramenta → categoria da atividade. Nomes exatos do OpenCode; o que
 * não estiver na lista vira `other` (nunca "explode" uma ferramenta nova).
 */
export function toolActivityKind(toolName: string): OfficeActivityKind {
  switch (toolName.trim().toLowerCase()) {
    case 'read':
    case 'glob':
      return 'read'
    case 'grep':
    case 'search':
      return 'search'
    case 'edit':
    case 'write':
    case 'apply_patch':
      return 'edit'
    case 'shell':
    case 'bash':
      return 'shell'
    case 'webfetch':
    case 'websearch':
      return 'web'
    case 'task':
    case 'agent':
      return 'think'
    default:
      return 'other'
  }
}

/**
 * Máscara pura de segredos para rótulos de atividade. NÃO é a `redactSecrets`
 * do main (aquela é privada do processo e cobre logs): aqui o alvo é o texto
 * curto que aparece na bolha/feed, e o shared não pode importar do main.
 */
export function maskSecrets(text: string): string {
  let out = text
  // URL com credencial embutida: `https://user:senha@host` → `https://***:***@host`.
  out = out.replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, `//${MASK}:${MASK}@`)
  // Tokens com prefixo conhecido.
  out = out.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, `sk-${MASK}`)
  out = out.replace(/\bghp_[A-Za-z0-9]{6,}/g, `ghp_${MASK}`)
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{6,}/g, `github_pat_${MASK}`)
  out = out.replace(/\bAKIA[A-Z0-9]{8,}/g, `AKIA${MASK}`)
  out = out.replace(/\bASIA[A-Z0-9]{8,}/g, `ASIA${MASK}`)
  // Cabeçalho HTTP.
  out = out.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`)
  // Credencial de CLI: `-u usuario:senha`.
  out = out.replace(/(-u|--user)\s+\S+:\S+/gi, `$1 ${MASK}:${MASK}`)
  // `token=...`, `password: ...`, `senha=...` (com ou sem aspas).
  out = out.replace(
    /\b(api[-_]?key|token|secret|password|passwd|pwd|senha|chave)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    `$1$2${MASK}`
  )
  return out
}

/** Rótulo curto e seguro: sem quebras de linha, mascarado e truncado. */
export function truncateLabel(text: string, max: number = LABEL_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (max <= 0) return ''
  if (flat.length <= max) return flat
  if (max === 1) return '…'
  return `${flat.slice(0, max - 1)}…`
}

function pickFile(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null
  for (const key of ['filePath', 'filepath', 'path', 'file']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) {
      const base = value.trim().replace(/\\/g, '/')
      return base.slice(base.lastIndexOf('/') + 1) || base
    }
  }
  return null
}

function pickText(input: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!input) return null
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * Descreve uma parte de ferramenta em pt-BR curto. O binário/arquivo citado
 * passa por `maskSecrets` e `truncateLabel` — a bolha nunca mostra segredo.
 */
export function describeToolActivity(
  toolName: string,
  input?: Record<string, unknown>
): { kind: OfficeActivityKind; label: string } {
  const kind = toolActivityKind(toolName)
  const name = toolName.trim().toLowerCase()
  let raw: string
  switch (kind) {
    case 'read': {
      const file = pickFile(input)
      raw = file ? `Lendo ${file}` : 'Lendo arquivos'
      break
    }
    case 'edit': {
      const file = pickFile(input)
      raw = file ? `Editando ${file}` : 'Editando arquivos'
      break
    }
    case 'shell': {
      const command = pickText(input, ['command', 'cmd', 'script', 'description'])
      raw = command ? `Executando ${truncateLabel(command, 60)}` : 'Executando comando'
      break
    }
    case 'search': {
      const query = pickText(input, ['pattern', 'query', 'search'])
      raw = query ? `Buscando ${truncateLabel(query, 50)}` : 'Buscando no projeto'
      break
    }
    case 'web':
      raw = 'Pesquisando na web'
      break
    case 'think': {
      const description = pickText(input, ['description', 'prompt'])
      raw = description ? `Delegando: ${truncateLabel(description, 50)}` : 'Planejando a tarefa'
      break
    }
    default:
      raw = name ? `Usando ${name}` : 'Outra atividade'
      break
  }
  return { kind, label: truncateLabel(maskSecrets(raw)) }
}

function readActivity(
  map: OfficeActivityMap | undefined,
  sessionID: string
): OfficeActivity | undefined {
  if (!map) return undefined
  if (map instanceof Map) return map.get(sessionID)
  return (map as Record<string, OfficeActivity | undefined>)[sessionID]
}

/**
 * Decide o status de uma sessão. `now` vem de fora — nada de relógio aqui.
 *
 * Ocioso tem prazo: `IDLE_VISIBLE_MS` depois do `idle`, a sessão sai do
 * escritório como `ended` (senão o limite de 50 sessões da API encheria a
 * cena de personagens parados há dias). `outcome` com `busy` antigo e sem
 * `idle` é dado inconsistente de sessão já concluída — também encerra.
 */
function statusFor(
  session: OfficeSessionInput,
  needsYou: ReadonlySet<string>,
  now: number
): OfficeAgentStatus {
  if (needsYou.has(session.id)) return 'needsYou'
  const busy = session.time?.busy ?? null
  const idle = session.time?.idle ?? null
  const visible = (at: number): OfficeAgentStatus =>
    now - at <= IDLE_VISIBLE_MS ? 'idle' : 'ended'

  if (busy !== null && idle !== null) return busy > idle ? 'working' : visible(idle)
  if (busy !== null) {
    if (session.outcome && now - busy > IDLE_VISIBLE_MS) return 'ended'
    return 'working'
  }
  if (idle !== null) return visible(idle)
  if (session.outcome) return 'ended'
  return 'unknown'
}

function toNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Teto de cada regra de `save` (o plugin já corta em 80). */
const REQUEST_SAVE_MAX = 80

function sanitizeRequest(raw: unknown, now: number): OfficePermissionRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id.trim().slice(0, 64) : ''
  const sessionID = typeof value.sessionID === 'string' ? value.sessionID.trim() : ''
  if (!id || !sessionID) return null

  const clean = (text: string, max: number): string => truncateLabel(maskSecrets(text), max)
  const cleanList = (input: unknown, max: number, limit: number): string[] => {
    if (!Array.isArray(input)) return []
    return input
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, limit)
      .map((item) => clean(item, max))
      .filter(Boolean)
  }

  const request: OfficePermissionRequest = {
    id,
    sessionID,
    action:
      clean(typeof value.action === 'string' ? value.action : 'permissão', LABEL_MAX) ||
      'permissão',
    resources: cleanList(value.resources, REQUEST_RESOURCE_MAX, REQUEST_RESOURCES_MAX),
    save: cleanList(value.save, REQUEST_SAVE_MAX, 5),
    at: typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : now
  }
  const message = typeof value.message === 'string' ? clean(value.message, REQUEST_MESSAGE_MAX) : ''
  if (message) request.message = message
  return request
}

/**
 * Normaliza a fila de permissões: descarta inválidos, deduplica por id (o mais
 * novo vence), ordena do mais recente para o mais antigo e corta em `REQUEST_MAX`.
 */
function normalizeRequests(
  input: readonly OfficePermissionRequest[] | undefined,
  now: number
): OfficePermissionRequest[] {
  if (!input || input.length === 0) return []
  const byID = new Map<string, OfficePermissionRequest>()
  for (const raw of input) {
    const request = sanitizeRequest(raw, now)
    if (!request) continue
    const known = byID.get(request.id)
    if (!known || request.at >= known.at) byID.set(request.id, request)
  }
  return [...byID.values()]
    .sort((a, b) => (b.at !== a.at ? b.at - a.at : a.id.localeCompare(b.id)))
    .slice(0, REQUEST_MAX)
}

/**
 * Derivação pura do snapshot (sem I/O, sem relógio). Recebe `now` para que o
 * resultado seja testável e estável.
 *
 * Regras fechadas: status pelos `time.*` da sessão (com a janela
 * `IDLE_VISIBLE_MS` para o ocioso não virar personagem eterno); sala pelo
 * diretório normalizado; subagente por `parentID`; ordem working → needsYou →
 * idle → ended (empate por `sessionID`) e feed com as 40 atividades mais
 * recentes. A fila de permissões (`requests`) entra mascarada, ordenada do mais
 * recente para o mais antigo e limitada a `REQUEST_MAX`.
 */
export function deriveOfficeSnapshot(input: OfficeDeriveInput): OfficeSnapshot {
  const requests = normalizeRequests(input.requests, input.now)
  const needsYou = new Set([
    ...(input.needsYouSessionIDs ?? []),
    ...requests.map((request) => request.sessionID)
  ])
  const rooms = new Map<string, OfficeRoom>()
  const agents: OfficeAgent[] = []
  const seen = new Set<string>()

  for (const session of input.sessions) {
    if (!session || typeof session.id !== 'string' || !session.id || seen.has(session.id)) continue
    seen.add(session.id)

    const directory = session.location?.directory ?? null
    const roomID = normalizeDirectory(directory)
    const startedAt = session.time?.created ?? input.now
    const tokensInput = toNumber(session.tokens?.input)
    const tokensOutput = toNumber(session.tokens?.output)
    const activity = readActivity(input.activityBySession, session.id)

    const agent: OfficeAgent = {
      sessionID: session.id,
      title: session.title?.trim() || 'Sessão sem título',
      agent: session.agent?.trim() || 'general',
      model: {
        providerID: session.model?.providerID?.trim() || 'desconhecido',
        id: session.model?.id?.trim() || 'desconhecido'
      },
      status: statusFor(session, needsYou, input.now),
      cost: toNumber(session.cost),
      tokens: { input: tokensInput, output: tokensOutput, total: tokensInput + tokensOutput },
      startedAt,
      lastSeenAt: session.time?.updated ?? session.time?.idle ?? session.time?.busy ?? startedAt,
      roomID,
      name: agentNameFor(session.id),
      seed: agentSeedFor(session.id)
    }
    if (activity) {
      agent.activity = { ...activity, label: truncateLabel(maskSecrets(activity.label)) }
    }
    if (session.parentID) agent.parentID = session.parentID
    agents.push(agent)

    const existing = rooms.get(roomID)
    if (existing) {
      existing.agentIDs.push(session.id)
    } else {
      rooms.set(roomID, {
        id: roomID,
        name: roomNameFor(directory),
        // Primeira sessão define o caminho original: contratar usa este valor
        // (o `id` canônico não é aceito pelo OpenCode como diretório).
        path: (directory ?? '').trim(),
        agentIDs: [session.id]
      })
    }
  }

  agents.sort((a, b) => {
    const delta = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    return delta !== 0 ? delta : a.sessionID.localeCompare(b.sessionID)
  })

  const sortedRooms = [...rooms.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, 'pt-BR')
    return byName !== 0 ? byName : a.id.localeCompare(b.id)
  })
  for (const room of sortedRooms) {
    room.agentIDs.sort((a, b) => {
      const left = agents.findIndex((agent) => agent.sessionID === a)
      const right = agents.findIndex((agent) => agent.sessionID === b)
      return left - right
    })
  }

  const feed: OfficeActivity[] = []
  if (input.activityBySession instanceof Map) {
    for (const activity of input.activityBySession.values()) feed.push(activity)
  } else if (input.activityBySession) {
    for (const activity of Object.values(input.activityBySession)) {
      if (activity) feed.push(activity)
    }
  }
  feed.sort((a, b) => (b.at !== a.at ? b.at - a.at : a.label.localeCompare(b.label, 'pt-BR')))
  const recentFeed = feed.slice(0, FEED_MAX).map((activity) => ({
    ...activity,
    label: truncateLabel(maskSecrets(activity.label))
  }))

  const totals: OfficeTotals = {
    working: agents.filter((agent) => agent.status === 'working').length,
    idle: agents.filter((agent) => agent.status === 'idle').length,
    needsYou: agents.filter((agent) => agent.status === 'needsYou').length,
    subagents: agents.filter((agent) => Boolean(agent.parentID)).length,
    cost: agents.reduce((sum, agent) => sum + agent.cost, 0),
    tokens: agents.reduce((sum, agent) => sum + agent.tokens.total, 0)
  }

  return {
    generatedAt: input.now,
    source: input.source ?? 'poller',
    rooms: sortedRooms,
    agents,
    feed: recentFeed,
    requests,
    totals,
    health: {
      cliFound: input.health?.cliFound ?? true,
      pluginConnected: input.health?.pluginConnected ?? false,
      ...(input.health?.cliPath ? { cliPath: input.health.cliPath } : {}),
      ...(input.health?.lastError ? { lastError: input.health.lastError } : {})
    }
  }
}
