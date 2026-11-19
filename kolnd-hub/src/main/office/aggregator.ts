import {
  describeToolActivity,
  deriveOfficeSnapshot,
  REQUEST_MAX,
  type OfficeActivity,
  type OfficeAgent,
  type OfficeAvatarLook,
  type OfficeDepartment,
  type OfficePermissionRequest,
  type OfficeSessionInput,
  type OfficeSnapshot
} from '../../shared/office'
import {
  parsePluginEvent,
  type OfficePluginEvent,
  type OfficePluginPermission,
  type OfficePluginSession,
  type OfficePluginTool
} from './pluginSource'

/**
 * Agregador do Escritório (T11): mistura o snapshot do poller do CLI com o
 * estado que o plugin publica na ponte.
 *
 * É puro: não abre arquivo, não cria servidor e não lê o relógio sozinho (o
 * `now` é injetável). A única responsabilidade é decidir o que a UI vê:
 * - atividade do plugin vence a do poller (é mais nova e mais granular);
 * - `needsYouSessionIDs`/`requests` saem dos pedidos de permissão pendentes;
 * - sessão que só o plugin conhece também entra (re-derivando o snapshot);
 * - plugin sem ping há 15 s é considerado desconectado e o poller volta a mandar;
 * - emissão limitada a 4/s (rajada é coalescida, o chamador faz o flush).
 */

/** Silêncio máximo do plugin antes de voltar ao poller. */
export const PLUGIN_STALE_MS = 15_000

/** Intervalo mínimo entre emissões (4 snapshots por segundo). */
export const EMIT_MIN_INTERVAL_MS = 250

/** Teto de sessões/atividades que o estado do plugin guarda em memória. */
export const MAX_PLUGIN_SESSIONS = 60
export const MAX_PLUGIN_ACTIVITY = 60
export const MAX_PLUGIN_PERMISSIONS = 60

interface PluginPermissionState {
  /** Pedidos ainda pendentes + o instante em que o Hub soube de cada um. */
  requests: Array<{ request: OfficePluginPermission; at: number }>
}

interface PluginState {
  sessions: Map<string, OfficeSessionInput>
  activity: Map<string, OfficeActivity>
  permissions: Map<string, PluginPermissionState>
  status: Map<string, { status: 'busy' | 'idle'; at: number }>
  lastPingAt: number | null
  version: string | null
}

export interface OfficePluginHealth {
  connected: boolean
  version: string | null
  lastPingAt: number | null
}

export interface OfficeAggregator {
  /** Snapshot do poller (pode ser `null` antes do primeiro tick). */
  setPoller(snapshot: OfficeSnapshot | null): OfficeSnapshot | null
  /** Aplica um evento já validado do plugin; devolve snapshot se for hora de emitir. */
  applyEvent(event: OfficePluginEvent): OfficeSnapshot | null
  /** Emite o estado pendente quando o intervalo de throttle já passou. */
  flush(): OfficeSnapshot | null
  /** Milissegundos até o próximo flush permitido (0 quando não há pendência). */
  msUntilNextEmit(): number
  /** Último snapshot mesclado (não recalcula o relógio). */
  current(): OfficeSnapshot | null
  /** Último snapshot mesclado (recalcula staleness com o relógio atual). */
  getSnapshot(): OfficeSnapshot | null
  /** Health do plugin para o `office:status`. */
  pluginHealth(): OfficePluginHealth
  reset(): void
}

function emptyPluginState(): PluginState {
  return {
    sessions: new Map(),
    activity: new Map(),
    permissions: new Map(),
    status: new Map(),
    lastPingAt: null,
    version: null
  }
}

function agentToSession(agent: OfficeAgent): OfficeSessionInput {
  const time: NonNullable<OfficeSessionInput['time']> = {
    created: agent.startedAt,
    updated: agent.lastSeenAt
  }
  // Reconstrói o suficiente para o derive manter o mesmo status; o nome da
  // sala é preservado depois, a partir das `rooms` do poller.
  if (agent.status === 'working' || agent.status === 'needsYou') time.busy = agent.lastSeenAt
  if (agent.status === 'idle') time.idle = agent.lastSeenAt
  if (agent.status === 'ended') {
    time.busy = 0
    time.idle = 0
  }
  return {
    id: agent.sessionID,
    parentID: agent.parentID,
    title: agent.title,
    agent: agent.agent,
    model: agent.model,
    cost: agent.cost,
    tokens: { input: agent.tokens.input, output: agent.tokens.output },
    ...(agent.status === 'ended' ? { outcome: 'succeeded' } : {}),
    time,
    ...(agent.directory ? { location: { directory: agent.directory } } : {})
  }
}

function mergeSession(
  base: OfficeSessionInput | OfficePluginSession | undefined,
  patch: OfficeSessionInput | OfficePluginSession
): OfficeSessionInput {
  const merged: OfficeSessionInput = {
    ...(base ?? {}),
    id: patch.id
  }
  if (patch.parentID !== undefined) merged.parentID = patch.parentID
  if (patch.title !== undefined) merged.title = patch.title
  if (patch.agent !== undefined) merged.agent = patch.agent
  if (patch.model !== undefined) merged.model = patch.model
  if (patch.location?.directory) merged.location = { directory: patch.location.directory }
  if (patch.time) merged.time = { ...(base?.time ?? {}), ...patch.time }
  return merged
}

function applyStatusTime(
  session: OfficeSessionInput,
  status: 'busy' | 'idle',
  at: number
): OfficeSessionInput {
  const time = session.time ?? {}
  if (status === 'busy') {
    return { ...session, time: { ...time, updated: at, busy: at, idle: undefined } }
  }
  const busy = Math.min(time.busy ?? at - 1, at - 1)
  return { ...session, time: { ...time, updated: at, busy, idle: at } }
}

function activityForTool(tool: OfficePluginTool, at: number): OfficeActivity {
  const input: Record<string, unknown> = {}
  if (tool.filePath) input.filePath = tool.filePath
  if (tool.command) input.command = tool.command
  const described = describeToolActivity(tool.name || 'tool', input)
  return { kind: described.kind, label: described.label, at }
}

/**
 * O plugin junta os recursos com `", "` (string ≤ 200). A UI quer a lista;
 * dividir é suficiente para exibir e não perde nada do contrato (cada item
 * continua mascarado no derive).
 */
function splitResources(value: string): string[] {
  if (!value.trim()) return []
  return value
    .split(', ')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Traduz o pedido do plugin para o contrato. `message` ainda não existe no
 * normalizador do plugin; a leitura opcional deixa o agregador pronto para
 * quando existir, sem alterar `pluginSource.ts` nesta rodada.
 */
function requestToContract(
  sessionID: string,
  entry: { request: OfficePluginPermission; at: number }
): OfficePermissionRequest | null {
  if (!entry.request.id) return null
  const message = (entry.request as OfficePluginPermission & { message?: unknown }).message
  return {
    id: entry.request.id,
    sessionID,
    action: entry.request.action,
    resources: splitResources(entry.request.resources),
    save: entry.request.save ?? [],
    ...(typeof message === 'string' && message.trim() ? { message } : {}),
    at: entry.at
  }
}

export function createOfficeAggregator(
  deps: {
    now?: () => number
    /** Salas-departamento persistidas (lidas a cada derivação). */
    getDepartments?: () => readonly OfficeDepartment[]
    /** Aparência editada por sessão (lida a cada derivação). */
    getAvatars?: () => Readonly<Record<string, OfficeAvatarLook | undefined>>
  } = {}
): OfficeAggregator {
  const now = deps.now ?? Date.now
  let pollerSnapshot: OfficeSnapshot | null = null
  let plugin = emptyPluginState()
  let dirty = false
  let lastEmitAt = -Infinity
  let lastSnapshot: OfficeSnapshot | null = null

  function pingFresh(at: number): boolean {
    return plugin.lastPingAt !== null && at - plugin.lastPingAt <= PLUGIN_STALE_MS
  }

  /** Descarta as sessões mais antigas quando o plugin passa do teto. */
  function trimSessions(): void {
    while (plugin.sessions.size > MAX_PLUGIN_SESSIONS) {
      let oldestID: string | null = null
      let oldestAt = Infinity
      for (const [sessionID, session] of plugin.sessions) {
        const at = session.time?.updated ?? session.time?.created ?? 0
        if (at < oldestAt) {
          oldestAt = at
          oldestID = sessionID
        }
      }
      if (!oldestID) return
      plugin.sessions.delete(oldestID)
      plugin.permissions.delete(oldestID)
      plugin.status.delete(oldestID)
      plugin.activity.delete(oldestID)
    }
  }

  /** Mantém o feed/atividade limitado; o derive ainda corta em 40. */
  function trimActivity(): void {
    while (plugin.activity.size > MAX_PLUGIN_ACTIVITY) {
      let oldestID: string | null = null
      let oldestAt = Infinity
      for (const [sessionID, activity] of plugin.activity) {
        if (activity.at < oldestAt) {
          oldestAt = activity.at
          oldestID = sessionID
        }
      }
      if (!oldestID) return
      plugin.activity.delete(oldestID)
    }
  }

  function trimPermissions(): void {
    while (plugin.permissions.size > MAX_PLUGIN_PERMISSIONS) {
      const first = plugin.permissions.keys().next()
      if (first.done) return
      plugin.permissions.delete(first.value)
    }
  }

  function trimStatus(): void {
    while (plugin.status.size > MAX_PLUGIN_SESSIONS) {
      let oldestID: string | null = null
      let oldestAt = Infinity
      for (const [sessionID, entry] of plugin.status) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at
          oldestID = sessionID
        }
      }
      if (!oldestID) return
      plugin.status.delete(oldestID)
    }
  }

  function build(at: number): OfficeSnapshot | null {
    const poller = pollerSnapshot
    if (!poller && plugin.sessions.size === 0 && plugin.activity.size === 0) return null

    const fresh = pingFresh(at)
    const sessions = new Map<string, OfficeSessionInput>()
    if (poller) {
      for (const agent of poller.agents) sessions.set(agent.sessionID, agentToSession(agent))
    }
    if (fresh) {
      for (const patch of plugin.sessions.values()) {
        const current = sessions.get(patch.id)
        sessions.set(patch.id, mergeSession(current, patch))
      }
      for (const [sessionID, entry] of plugin.status) {
        const current = sessions.get(sessionID)
        if (current) sessions.set(sessionID, applyStatusTime(current, entry.status, entry.at))
      }
    }

    const activityBySession = new Map<string, OfficeActivity>()
    if (poller) {
      for (const agent of poller.agents) {
        if (agent.activity) activityBySession.set(agent.sessionID, agent.activity)
      }
    }
    if (fresh) {
      // Evento do plugin vence a atividade do poller.
      for (const [sessionID, activity] of plugin.activity) {
        activityBySession.set(sessionID, activity)
      }
    }

    const needsYouSessionIDs: string[] = []
    const requests: OfficePermissionRequest[] = []
    if (fresh) {
      for (const [sessionID, entry] of plugin.permissions) {
        if (entry.requests.length > 0) needsYouSessionIDs.push(sessionID)
        for (const pending of entry.requests) {
          const request = requestToContract(sessionID, pending)
          if (request) requests.push(request)
        }
      }
    }
    requests.sort((a, b) => (b.at !== a.at ? b.at - a.at : a.id.localeCompare(b.id)))

    const departments = deps.getDepartments?.() ?? []
    const snapshot = deriveOfficeSnapshot({
      sessions: [...sessions.values()],
      activityBySession,
      needsYouSessionIDs,
      requests: requests.slice(0, REQUEST_MAX),
      now: at,
      source: poller && fresh ? 'both' : fresh ? 'plugin' : 'poller',
      departments,
      avatars: deps.getAvatars?.() ?? {},
      health: {
        cliFound: poller?.health.cliFound ?? true,
        ...(poller?.health.cliPath ? { cliPath: poller.health.cliPath } : {}),
        ...(poller?.health.lastError ? { lastError: poller.health.lastError } : {}),
        pluginConnected: fresh
      }
    })

    // O poller conta quem ficou fora das salas, mas o snapshot mesclado é
    // re-derivado só com as sessões visíveis (as escondidas não entram em
    // `agents`). Sem sessões do plugin, carrega o contador do poller; com elas,
    // a própria derivação já conta as sessões do plugin (evita somar duas vezes).
    if (poller && !(fresh && plugin.sessions.size > 0)) {
      snapshot.unassignedCount += poller.unassignedCount
    }

    lastSnapshot = snapshot
    return snapshot
  }

  function due(at: number): OfficeSnapshot | null {
    if (!dirty) return null
    if (at - lastEmitAt < EMIT_MIN_INTERVAL_MS) return null
    dirty = false
    lastEmitAt = at
    return build(at)
  }

  function applyStatus(sessionID: string, status: 'busy' | 'idle', at: number): void {
    plugin.status.set(sessionID, { status, at })
  }

  return {
    setPoller(snapshot) {
      pollerSnapshot = snapshot
      dirty = true
      return due(now())
    },

    applyEvent(event) {
      // Heartbeat é a CHEGADA do evento (não o `created`, que pode vir de um
      // evento antigo): é isso que decide o staleness de 15 s.
      plugin.lastPingAt = now()
      if (event.type !== 'hello') dirty = true

      switch (event.type) {
        case 'hello':
          plugin.version = event.version || plugin.version
          // Um hello sozinho já basta para o `office:status` refletir a ponte,
          // mas não gera snapshot novo se nada mudou.
          break

        case 'sessions': {
          // Snapshot completo: substitui as sessões conhecidas, mantendo a
          // atividade/status mais recentes que já chegaram por evento.
          plugin.sessions = new Map(
            event.sessions.map((session): [string, OfficeSessionInput] => [session.id, session])
          )
          break
        }

        case 'session': {
          const current = plugin.sessions.get(event.session.id)
          plugin.sessions.set(event.session.id, mergeSession(current, event.session))
          break
        }

        case 'status':
          applyStatus(event.sessionID, event.status, event.at)
          break

        case 'tool': {
          // Conclusão de ferramenta não piora o rótulo: o plugin manda só o
          // id no success/failed, então preserva a atividade de execução.
          if (event.tool.status === 'running' || event.tool.command || event.tool.filePath) {
            plugin.activity.set(event.sessionID, activityForTool(event.tool, event.at))
          }
          if (event.tool.status === 'running') applyStatus(event.sessionID, 'busy', event.at)
          break
        }

        case 'permissions': {
          plugin.permissions.set(event.sessionID, {
            requests: event.requests.map((request) => ({ request, at: event.at }))
          })
          break
        }

        case 'permission': {
          const current = plugin.permissions.get(event.sessionID)?.requests ?? []
          const next = current.filter((entry) => entry.request.id !== event.request.id)
          next.push({ request: event.request, at: event.at })
          plugin.permissions.set(event.sessionID, { requests: next })
          break
        }

        case 'permission-replied': {
          const current = plugin.permissions.get(event.sessionID)?.requests ?? []
          plugin.permissions.set(event.sessionID, {
            requests: current.filter((entry) => entry.request.id !== event.requestID)
          })
          break
        }
      }

      trimSessions()
      trimActivity()
      trimPermissions()
      trimStatus()

      return due(now())
    },

    flush() {
      return due(now())
    },

    msUntilNextEmit() {
      if (!dirty) return 0
      const at = now()
      return Math.max(0, EMIT_MIN_INTERVAL_MS - (at - lastEmitAt))
    },

    current() {
      return lastSnapshot
    },

    getSnapshot() {
      const at = now()
      if (pollerSnapshot || plugin.sessions.size > 0 || plugin.activity.size > 0) return build(at)
      return null
    },

    pluginHealth() {
      const at = now()
      return {
        connected: pingFresh(at),
        version: plugin.version,
        lastPingAt: plugin.lastPingAt
      }
    },

    reset() {
      pollerSnapshot = null
      plugin = emptyPluginState()
      dirty = false
      lastEmitAt = -Infinity
      lastSnapshot = null
    }
  }
}

/** Reexport para quem só precisa validar o corpo da ponte. */
export { parsePluginEvent }
export type { OfficePluginEvent }
