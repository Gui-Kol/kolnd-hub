import {
  deriveOfficeSnapshot,
  type OfficeActivity,
  type OfficeAvatarLook,
  type OfficeDepartment,
  type OfficeSnapshot,
  type OfficeSessionInput
} from '../../shared/office'
import { OfficeCliError, latestToolActivity, type OfficeClient } from './client'

/**
 * Coletor do Escritório (Fase 1): poller do CLI com refcount.
 *
 * Só existe polling com a página aberta (D7): cada consumidor chama
 * `start()`/`stop()` e o loop só vive enquanto o refcount for > 0. A lista é
 * consultada a cada 2 s; sessões `working` ganham a última mensagem a cada 3 s,
 * no máximo 6 por tick (rotaciona para não estourar o orçamento de 160 ms por
 * chamada). Falha na lista entra em backoff exponencial 2→4→8→16→30 s.
 *
 * O snapshot só é emitido quando muda de forma significativa — comparar o JSON
 * sem `generatedAt` evita um push por tick com o mesmo conteúdo.
 */

const LIST_INTERVAL_MS = 2000
const MESSAGE_INTERVAL_MS = 3000
const MAX_MESSAGE_FETCHES_PER_TICK = 6
const MESSAGE_LIMIT = 8
const LIST_LIMIT = 50
const BACKOFF_MS = [2000, 4000, 8000, 16_000, 30_000] as const

export interface OfficeServiceDeps {
  client: OfficeClient
  emit: (snapshot: OfficeSnapshot) => void
  /** Relógio injetável (testes); padrão `Date.now`. */
  now?: () => number
  /** Salas-departamento persistidas (lidas a cada snapshot). */
  getDepartments?: () => readonly OfficeDepartment[]
  /** Aparência editada por sessão (lida a cada snapshot). */
  getAvatars?: () => Readonly<Record<string, OfficeAvatarLook | undefined>>
}

export interface OfficeService {
  start(): void
  stop(): void
  dispose(): void
  /** Último snapshot derivado (mesmo que não tenha sido emitido). */
  getSnapshot(): OfficeSnapshot | null
  /** Consumidores ativos do loop — exposto para o teste de refcount. */
  subscribers(): number
  /**
   * Leitura imediata após uma mutação de gestão: a página reflete a mudança em
   * menos de 3 s sem esperar o próximo tick (ou o backoff de uma falha).
   */
  refresh(): void
}

type Timer = ReturnType<typeof setTimeout>

export function createOfficeService(deps: OfficeServiceDeps): OfficeService {
  const { client, emit } = deps
  const now = deps.now ?? Date.now

  let refCount = 0
  let disposed = false
  let listTimer: Timer | null = null
  let messageTimer: Timer | null = null
  let running = false
  let listInFlight = false
  /** Uma mutação pediu leitura fresca enquanto o poll anterior estava em voo. */
  let refreshQueued = false

  let sessions: OfficeSessionInput[] = []
  const activityBySession = new Map<string, OfficeActivity>()
  let lastSnapshot: OfficeSnapshot | null = null
  let lastSignature = ''

  let failures = 0
  let rotation = 0
  let cliFound = true
  let cliPath: string | undefined
  let lastError: string | undefined
  const pluginConnected = false

  const active = (): boolean => running && refCount > 0

  function buildSnapshot(): OfficeSnapshot {
    if (cliPath === undefined) {
      const known = client.cliPath()
      if (known) cliPath = known
    }
    return deriveOfficeSnapshot({
      sessions,
      activityBySession,
      now: now(),
      source: 'poller',
      departments: deps.getDepartments?.() ?? [],
      avatars: deps.getAvatars?.() ?? {},
      health: { cliFound, cliPath, pluginConnected, lastError }
    })
  }

  /** Emite só quando o conteúdo (sem `generatedAt`) muda. */
  function publish(): void {
    const snapshot = buildSnapshot()
    lastSnapshot = snapshot
    const signature = JSON.stringify({ ...snapshot, generatedAt: 0 })
    if (signature === lastSignature) return
    lastSignature = signature
    emit(snapshot)
  }

  function clearListTimer(): void {
    if (listTimer) {
      clearTimeout(listTimer)
      listTimer = null
    }
  }

  function clearMessageTimer(): void {
    if (messageTimer) {
      clearInterval(messageTimer)
      messageTimer = null
    }
  }

  function scheduleList(delayMs: number): void {
    clearListTimer()
    if (!active()) return
    listTimer = setTimeout(() => {
      listTimer = null
      void pollList()
    }, delayMs)
  }

  function readError(err: unknown): string {
    if (err instanceof OfficeCliError) return err.message
    if (err instanceof Error && err.message) return err.message
    return 'Falha ao consultar o OpenCode.'
  }

  function handleFailure(err: unknown): void {
    failures += 1
    lastError = readError(err)
    if (err instanceof OfficeCliError && err.code === 'cliAusente') {
      cliFound = false
      cliPath = undefined
    } else {
      cliFound = true
      cliPath = client.cliPath() ?? cliPath
    }
  }

  async function pollList(): Promise<void> {
    if (!active() || listInFlight) return
    listInFlight = true
    try {
      const next = await client.listSessions({ limit: LIST_LIMIT })
      sessions = next
      failures = 0
      lastError = undefined
      cliFound = true
      cliPath = client.cliPath() ?? cliPath
    } catch (err) {
      handleFailure(err)
    } finally {
      listInFlight = false
    }

    if (!active()) return
    publish()
    // Mutação chegou durante o poll: a resposta acima pode ser anterior a ela.
    if (refreshQueued) {
      refreshQueued = false
      clearListTimer()
      void pollList()
      return
    }
    const delay =
      failures === 0 ? LIST_INTERVAL_MS : BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]
    scheduleList(delay)
  }

  /** Sessões `working` do último snapshot, na ordem estável já derivada. */
  function workingSessionIDs(): string[] {
    if (!lastSnapshot) return []
    return lastSnapshot.agents
      .filter((agent) => agent.status === 'working')
      .map((agent) => agent.sessionID)
  }

  async function messageTick(): Promise<void> {
    if (!active()) return
    // Lista em backoff ⇒ o CLI está com problema: não insiste em detalhes.
    if (failures > 0) return
    const working = workingSessionIDs()
    if (working.length === 0) return

    const count = Math.min(MAX_MESSAGE_FETCHES_PER_TICK, working.length)
    const start = rotation % working.length
    const selected: string[] = []
    for (let index = 0; index < count; index++) {
      selected.push(working[(start + index) % working.length])
    }
    // Próximo tick continua de onde este parou (rotação justa em muitas sessões).
    rotation = (start + count) % working.length

    let changed = false
    for (const sessionID of selected) {
      if (!active()) return
      try {
        const messages = await client.sessionMessages(sessionID, { limit: MESSAGE_LIMIT })
        const activity = latestToolActivity(messages, now())
        if (!activity) continue
        const previous = activityBySession.get(sessionID)
        if (previous && previous.at > activity.at) continue
        if (
          previous &&
          previous.at === activity.at &&
          previous.kind === activity.kind &&
          previous.label === activity.label
        ) {
          continue
        }
        activityBySession.set(sessionID, activity)
        changed = true
      } catch (err) {
        // Falha pontual de detalhe não derruba a lista; só reporta no health.
        lastError = readError(err)
        if (err instanceof OfficeCliError && err.code === 'cliAusente') {
          cliFound = false
          cliPath = undefined
        }
      }
    }

    if (!active()) return
    if (changed || lastError !== undefined) publish()
  }

  function startLoop(): void {
    if (running) return
    running = true
    rotation = 0
    failures = 0
    clearListTimer()
    clearMessageTimer()
    // Primeira lista já: a página não espera 2 s para sair do vazio.
    void pollList()
    messageTimer = setInterval(() => {
      void messageTick()
    }, MESSAGE_INTERVAL_MS)
  }

  function stopLoop(): void {
    running = false
    refreshQueued = false
    clearListTimer()
    clearMessageTimer()
  }

  return {
    start() {
      if (disposed) return
      refCount += 1
      if (refCount === 1) startLoop()
    },
    stop() {
      if (refCount === 0) return
      refCount -= 1
      if (refCount === 0) stopLoop()
    },
    dispose() {
      disposed = true
      refCount = 0
      stopLoop()
      activityBySession.clear()
      sessions = []
      lastSnapshot = null
      lastSignature = ''
    },
    getSnapshot: () => lastSnapshot,
    subscribers: () => refCount,
    refresh() {
      if (!active()) return
      if (listInFlight) {
        refreshQueued = true
        return
      }
      // Uma nova leitura logo após a mutação não deve herdar o backoff antigo.
      failures = 0
      clearListTimer()
      void pollList()
    }
  }
}
