import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../logger'
import { parsePluginEvent, type OfficePluginEvent } from './aggregator'
import {
  normalizeOfficeAction,
  type OfficeAction,
  type OfficeActionEnqueueResult,
  type OfficeActionOutcome
} from './actions'
import { OFFICE_PLUGIN_VERSION } from './pluginSource'

/**
 * Ponte HTTP local entre o plugin do OpenCode e o Escritório (T11).
 *
 * Só escuta em `127.0.0.1` (porta efêmera) e exige o token aleatório desta
 * execução. O `bridge.json` em `<userData>/office` é handshake de RUNTIME — o
 * mesmo tipo de exceção da flag de first-run —, não configuração do app: ele
 * some no `stop()`. Nenhum outro dado além de porta/token/versão/início.
 *
 * Defesas: Host obrigatoriamente local (anti DNS-rebinding), token, corpo
 * ≤ 32 KB e no máximo 200 eventos por minuto. Erro de validação nunca inclui o
 * corpo da mensagem no log.
 */

export const BRIDGE_FILE_NAME = 'bridge.json'
const MAX_BODY_BYTES = 32 * 1024
const RATE_LIMIT_EVENTS = 200
const RATE_WINDOW_MS = 60_000

/** Ação sem resultado do plugin neste prazo é descartada (o terminal decide). */
export const ACTION_TTL_MS = 30_000

/** Teto de ações pendentes (fila + em voo). */
export const ACTION_MAX_PENDING = 20

/** Long-poll máximo aceito do plugin; o plugin usa 20 s. */
export const ACTION_WAIT_MAX_MS = 25_000
export const ACTION_WAIT_DEFAULT_MS = 20_000

export interface OfficeBridgeInfo {
  port: number
  token: string
  version: string
  startedAt: number
}

/** Entrada da fila de ações: uma por vez por sessão, FIFO no restante. */
interface QueuedAction {
  id: string
  action: OfficeAction
  createdAt: number
}

interface ActionWaiter {
  res: ServerResponse
  timer: ReturnType<typeof setTimeout>
}

export interface OfficeBridgeDeps {
  /** Recebe cada evento já validado (o IPC pluga o agregador aqui). */
  emit: (event: OfficePluginEvent) => void
  /** Desfecho de uma ação executada pelo plugin (IPC empurra ao renderer). */
  onActionResult?: (
    result: OfficeActionOutcome,
    meta: { action: string; sessionID: string }
  ) => void
  now?: () => number
  /** `<userData>` do app; injetável nos testes para não tocar no real. */
  userDataDir?: string
  version?: string
}

/** Endereço efetivo do servidor — exposto para o teste de loopback. */
export interface OfficeBridgeAddress {
  address: string
  port: number
}

export interface OfficeBridge {
  start(): Promise<OfficeBridgeInfo>
  stop(): Promise<void>
  info(): OfficeBridgeInfo | null
  address(): OfficeBridgeAddress | null
  /** Ingestão direta (testes/uso interno); devolve `false` se o evento for inválido. */
  ingestEvent(event: unknown): boolean
  /** Enfileira uma ação para o plugin (chamado pelo IPC já validado). */
  enqueueAction(action: unknown): OfficeActionEnqueueResult
  /** Ações pendentes (fila + em voo) — usado por testes e diagnóstico. */
  pendingActions(): number
}

interface RateState {
  timestamps: number[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function defaultUserDataDir(): string {
  // O e2e redireciona o userData do Electron por env; a ponte acompanha para
  // não escrever no perfil real durante os testes.
  const testUserData = (process.env.KOLDND_HUB_TEST_USERDATA ?? '').trim()
  if (testUserData) return testUserData
  const appData = (process.env.APPDATA ?? '').trim()
  return appData ? join(appData, 'kolnd-hub') : join(homedir(), '.kolnd-hub')
}

function sameToken(expected: string, received: string | undefined): boolean {
  if (!received || received.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'))
  } catch {
    return false
  }
}

function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false
  const normalized = host.trim().toLowerCase()
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`
}

/** Lê o corpo com teto rígido; `null` significa "grande demais". */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }

    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
    req.on('aborted', () => finish(null))
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

export function createOfficeBridge(deps: OfficeBridgeDeps): OfficeBridge {
  const now = deps.now ?? Date.now
  const version = deps.version ?? OFFICE_PLUGIN_VERSION
  const userDataDir = deps.userDataDir ?? defaultUserDataDir()
  const bridgeDir = join(userDataDir, 'office')
  const bridgeFile = join(bridgeDir, BRIDGE_FILE_NAME)

  let server: Server | null = null
  let info: OfficeBridgeInfo | null = null
  let starting: Promise<OfficeBridgeInfo> | null = null
  let pluginSeen = false
  const rate: RateState = { timestamps: [] }
  /** Fila FIFO de ações; expira em 30 s e nunca passa de 20 pendentes. */
  const queue: QueuedAction[] = []
  /** Ações entregues ao plugin aguardando o POST de resultado. */
  const inFlight = new Map<string, QueuedAction>()
  /** Long-polls abertos aguardando uma ação. */
  const waiters: ActionWaiter[] = []

  function writeBridgeFile(value: OfficeBridgeInfo): void {
    try {
      mkdirSync(bridgeDir, { recursive: true })
      writeFileSync(bridgeFile, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      // No Windows o mode é ignorado; nos demais, reforça 0600 best-effort.
      try {
        chmodSync(bridgeFile, 0o600)
      } catch {
        // best-effort
      }
    } catch (err) {
      logger.warn('office', 'Não consegui gravar o bridge.json do Escritório.', err)
    }
  }

  function deleteBridgeFile(): void {
    try {
      unlinkSync(bridgeFile)
    } catch {
      // já não existe (ou está em uso): nada a fazer
    }
  }

  function consumeRate(count: number): boolean {
    const at = now()
    const state = rate.timestamps
    while (state.length > 0 && at - state[0] > RATE_WINDOW_MS) state.shift()
    if (state.length + count > RATE_LIMIT_EVENTS) return false
    for (let index = 0; index < count; index += 1) state.push(at)
    return true
  }

  function authorized(req: IncomingMessage): boolean {
    return (
      Boolean(info) && sameToken(info!.token, req.headers['x-kolnd-token'] as string | undefined)
    )
  }

  /**
   * Descarta ações vencidas. Em voo também vencem: se o plugin sumiu no meio,
   * a sessão não pode ficar travada para sempre.
   */
  function purgeActions(at: number): void {
    while (queue.length > 0 && at - queue[0].createdAt >= ACTION_TTL_MS) queue.shift()
    for (const [id, entry] of inFlight) {
      if (at - entry.createdAt < ACTION_TTL_MS) continue
      inFlight.delete(id)
      deps.onActionResult?.(
        { id, ok: false, error: 'a ação expirou sem resposta' },
        { action: entry.action.action, sessionID: entry.action.sessionID }
      )
    }
  }

  function sessionInFlight(sessionID: string): boolean {
    for (const entry of inFlight.values()) {
      if (entry.action.sessionID === sessionID) return true
    }
    return false
  }

  /** Próxima ação despachável: FIFO, pulando sessões que já têm uma em voo. */
  function takeNext(at: number): QueuedAction | null {
    purgeActions(at)
    for (let index = 0; index < queue.length; index += 1) {
      const entry = queue[index]
      if (sessionInFlight(entry.action.sessionID)) continue
      queue.splice(index, 1)
      return entry
    }
    return null
  }

  function toWire(entry: QueuedAction): Record<string, unknown> {
    return { id: entry.id, ...entry.action }
  }

  /** Entrega ações pendentes aos long-polls abertos (até Acabar). */
  function pumpActions(): void {
    const at = now()
    while (waiters.length > 0) {
      const waiterIndex = waiters.findIndex((waiter) => !waiter.res.destroyed)
      if (waiterIndex < 0) {
        for (const waiter of waiters) clearTimeout(waiter.timer)
        waiters.length = 0
        return
      }
      const entry = takeNext(at)
      if (!entry) return
      const [waiter] = waiters.splice(waiterIndex, 1)
      clearTimeout(waiter.timer)
      inFlight.set(entry.id, entry)
      sendJson(waiter.res, 200, toWire(entry))
    }
  }

  function clampWait(raw: string | null): number {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return ACTION_WAIT_DEFAULT_MS
    return Math.min(ACTION_WAIT_MAX_MS, Math.max(0, Math.floor(parsed)))
  }

  function handleActions(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!authorized(req)) {
      logger.warn('office', 'Long-poll de ações sem token válido recusado pela ponte.')
      sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return
    }

    const at = now()
    const entry = takeNext(at)
    if (entry) {
      inFlight.set(entry.id, entry)
      sendJson(res, 200, toWire(entry))
      return
    }

    const waitMs = clampWait(url.searchParams.get('wait'))
    if (waitMs <= 0) {
      sendJson(res, 204, { ok: true })
      return
    }

    const waiter: ActionWaiter = {
      res,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        // 204 é o "nada nesta janela": o plugin apenas volta a perguntar.
        sendJson(res, 204, { ok: true })
      }, waitMs)
    }
    waiter.timer.unref?.()
    waiters.push(waiter)
    res.on('close', () => {
      const index = waiters.indexOf(waiter)
      if (index < 0) return
      waiters.splice(index, 1)
      clearTimeout(waiter.timer)
    })
  }

  async function handleActionResult(
    req: IncomingMessage,
    res: ServerResponse,
    actionID: string
  ): Promise<void> {
    if (!authorized(req)) {
      logger.warn('office', 'Resultado de ação sem token válido recusado pela ponte.')
      sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return
    }

    const declared = Number(req.headers['content-length'] ?? '')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      logger.warn('office', 'Corpo maior que 32 KB recusado pela ponte do Escritório.')
      sendJson(res, 413, { ok: false, error: 'payload-too-large' })
      return
    }
    const body = await readBody(req)
    if (body === null) {
      sendJson(res, 413, { ok: false, error: 'payload-too-large' })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid-json' })
      return
    }
    if (!isRecord(parsed) || typeof parsed.ok !== 'boolean') {
      sendJson(res, 400, { ok: false, error: 'invalid-result' })
      return
    }

    const entry = inFlight.get(actionID)
    if (!entry) {
      // id desconhecido (ou resultado repetido): nada é emitido ao renderer.
      sendJson(res, 404, { ok: false, error: 'unknown-action' })
      return
    }
    inFlight.delete(actionID)

    const error =
      parsed.ok || typeof parsed.error !== 'string'
        ? undefined
        : parsed.error.replace(/\s+/g, ' ').trim().slice(0, 200) || 'a ação falhou'
    const outcome: OfficeActionOutcome = {
      id: actionID,
      ok: parsed.ok,
      ...(error ? { error } : {})
    }
    deps.onActionResult?.(outcome, {
      action: entry.action.action,
      sessionID: entry.action.sessionID
    })
    sendJson(res, 200, { ok: true })
    pumpActions()
  }

  function handleHello(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!authorized(req)) {
      logger.warn('office', 'Requisição sem token válido recusada pela ponte do Escritório.')
      sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    if (!pluginSeen) {
      pluginSeen = true
      logger.info('office', 'Plugin do OpenCode conectado à ponte do Escritório.')
    }
    const provided = (url.searchParams.get('version') ?? '').trim().slice(0, 32)
    const pluginVersion = provided || version
    deps.emit({ type: 'hello', at: now(), version: pluginVersion })
    sendJson(res, 200, {
      ok: true,
      version: pluginVersion,
      uptimeMs: info ? Math.max(0, now() - info.startedAt) : 0
    })
  }

  async function handleEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!authorized(req)) {
      logger.warn('office', 'Requisição sem token válido recusada pela ponte do Escritório.')
      sendJson(res, 401, { ok: false, error: 'unauthorized' })
      return
    }

    const declared = Number(req.headers['content-length'] ?? '')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      logger.warn('office', 'Corpo maior que 32 KB recusado pela ponte do Escritório.')
      sendJson(res, 413, { ok: false, error: 'payload-too-large' })
      return
    }

    const body = await readBody(req)
    if (body === null) {
      logger.warn('office', 'Corpo maior que 32 KB recusado pela ponte do Escritório.')
      sendJson(res, 413, { ok: false, error: 'payload-too-large' })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      logger.warn('office', 'Corpo inválido recusado pela ponte do Escritório.')
      sendJson(res, 400, { ok: false, error: 'invalid-json' })
      return
    }

    const candidates =
      isRecord(parsed) && Array.isArray(parsed.events)
        ? parsed.events
        : Array.isArray(parsed)
          ? parsed
          : [parsed]
    if (candidates.length === 0 || candidates.length > 100) {
      logger.warn('office', 'Lote inválido recusado pela ponte do Escritório.')
      sendJson(res, 400, { ok: false, error: 'invalid-events' })
      return
    }

    const events: OfficePluginEvent[] = []
    for (const candidate of candidates) {
      const event = parsePluginEvent(candidate)
      if (!event) {
        logger.warn('office', 'Evento inválido recusado pela ponte do Escritório.')
        sendJson(res, 400, { ok: false, error: 'invalid-event' })
        return
      }
      events.push(event)
    }

    if (!consumeRate(events.length)) {
      logger.warn('office', 'Limite de eventos do plugin atingido — excedente descartado.')
      sendJson(res, 429, { ok: false, error: 'rate-limited' })
      return
    }

    for (const event of events) deps.emit(event)
    sendJson(res, 200, { ok: true, accepted: events.length })
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    void (async () => {
      try {
        const port = info?.port ?? 0
        if (!hostAllowed(req.headers.host, port)) {
          logger.warn('office', 'Requisição com Host não-local recusada pela ponte do Escritório.')
          sendJson(res, 403, { ok: false, error: 'forbidden-host' })
          return
        }

        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (req.method === 'GET' && url.pathname === '/office/hello') {
          handleHello(req, res, url)
          return
        }
        if (req.method === 'POST' && url.pathname === '/office/events') {
          await handleEvents(req, res)
          return
        }
        if (req.method === 'GET' && url.pathname === '/office/actions') {
          handleActions(req, res, url)
          return
        }
        const resultMatch = /^\/office\/actions\/([A-Za-z0-9_-]{1,64})\/result$/.exec(url.pathname)
        if (req.method === 'POST' && resultMatch) {
          await handleActionResult(req, res, resultMatch[1])
          return
        }

        sendJson(res, 404, { ok: false, error: 'not-found' })
      } catch (err) {
        logger.warn('office', 'Erro ao tratar requisição da ponte do Escritório.', err)
        sendJson(res, 500, { ok: false, error: 'internal' })
      }
    })()
  }

  async function listen(): Promise<OfficeBridgeInfo> {
    return new Promise((resolve, reject) => {
      const token = randomBytes(24).toString('hex')
      const startedAt = now()
      const nextServer = createServer(handler)
      nextServer.on('error', (err) => {
        logger.warn('office', 'Falha na ponte do Escritório.', err)
        reject(err)
      })
      nextServer.listen(0, '127.0.0.1', () => {
        const address = nextServer.address()
        if (!address || typeof address === 'string') {
          nextServer.close()
          reject(new Error('Endereço da ponte do Escritório indisponível.'))
          return
        }
        server = nextServer
        info = { port: address.port, token, version, startedAt }
        writeBridgeFile(info)
        logger.info('office', `Ponte do Escritório em 127.0.0.1:${address.port}.`)
        resolve(info)
      })
    })
  }

  return {
    start() {
      if (info) return Promise.resolve(info)
      if (starting) return starting
      starting = listen().finally(() => {
        starting = null
      })
      return starting
    },

    async stop() {
      const active = server
      server = null
      info = null
      rate.timestamps = []
      // Long-polls abertos recebem 204; fila e em-voo morrem com a ponte.
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer)
        sendJson(waiter.res, 204, { ok: true })
      }
      queue.length = 0
      inFlight.clear()
      // Apaga o handshake ANTES de esperar o close: `will-quit` não aguarda
      // promises, e o arquivo não pode sobreviver ao processo.
      if (pluginSeen) {
        logger.info('office', 'Plugin do OpenCode desconectado da ponte do Escritório.')
      }
      pluginSeen = false
      deleteBridgeFile()
      if (active) {
        await new Promise<void>((resolve) => {
          try {
            active.closeAllConnections?.()
          } catch {
            // método opcional (Node antigo)
          }
          active.close(() => resolve())
        })
        logger.info('office', 'Ponte do Escritório encerrada.')
      }
    },

    info: () => info,

    address() {
      const address = server?.address()
      return address && typeof address !== 'string'
        ? { address: address.address, port: address.port }
        : null
    },

    ingestEvent(event) {
      const parsed = parsePluginEvent(event)
      if (!parsed) return false
      deps.emit(parsed)
      return true
    },

    enqueueAction(action) {
      const parsed = normalizeOfficeAction(action)
      if (!parsed) return { ok: false, reason: 'invalido' }
      const at = now()
      purgeActions(at)
      if (queue.length + inFlight.size >= ACTION_MAX_PENDING) {
        return { ok: false, reason: 'fila-cheia' }
      }
      const entry: QueuedAction = {
        id: `act_${randomBytes(8).toString('hex')}`,
        action: parsed,
        createdAt: at
      }
      queue.push(entry)
      pumpActions()
      return { ok: true, id: entry.id }
    },

    pendingActions: () => queue.length + inFlight.size
  }
}
