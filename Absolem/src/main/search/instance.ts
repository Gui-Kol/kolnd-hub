import { BrowserWindow, dialog } from 'electron'
import { IPC } from '../../shared/ipc'
import { effectivePermission } from '../../shared/permissions'
import type { SearchIndicatorPush, SearchKind, SearchStatus } from '../../shared/search'
import type { ToolDefinition } from '../../shared/tools'
import type { GeminiFunctionCall } from '../gemini/transport'
import { createDialogConfirmation } from '../gemini/tools/confirmation'
import type { ToolHandler } from '../gemini/tools/internal'
import { createToolRegistry, type ToolRegistry } from '../gemini/tools/registry'
import { createLoggerAudit, routeToolCall, type ToolCallResult } from '../gemini/tools/router'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'
import { registerShutdownHook } from '../shutdown'
import { getStoreSnapshot } from '../store'
import { createSearchCache, normalizeCacheKey } from './cache'
import { extractReadable } from './extract'
import { fetchPage, type FetchedPage } from './fetchPage'
import { createSearchTurnLimits } from './limits'
import { registerWebTools, type SearchAuditEvent, type WebSearchResultLike } from './tools'
import { validateUrl } from './validateUrl'

/**
 * Composição de produção da pesquisa na internet (task 10, T9).
 *
 * Só este arquivo liga as peças ao Electron/store/logger: validação SSRF,
 * `fetch`, cache LRU, limites por turno, indicador do overlay, auditoria,
 * registro das ferramentas e o roteador da task 05. Os testes de cada módulo
 * recebem fakes; o runtime em si é montado pelo IPC.
 */

export interface SearchRuntimeDeps {
  /** Teto mensal da task 05 (lança `GeminiError` kind quota). */
  checkBudget: () => void
  /** Busca app-side opcional; a produção usa Google Search nativo do Live. */
  search?: (query: string) => Promise<WebSearchResultLike>
}

export interface SearchRuntime {
  listTools: () => readonly ToolDefinition[]
  hasTool: (name: string) => boolean
  route: (call: GeminiFunctionCall) => Promise<ToolCallResult>
  beginTurn: (requestId: string) => void
  /** Cancela a requisição em voo do turno informado (se ainda for o atual). */
  endTurn: (requestId: string) => void
  status: () => SearchStatus
  clearCache: () => void
  shutdown: () => void
}

function broadcast(ctx: IpcContext, channel: string, payload: unknown): void {
  const targets = [ctx.getOverlayWindow(), ctx.getMainWindow()]
  for (let index = 0; index < targets.length; index += 1) {
    const window = targets[index]
    if (!window || window.isDestroyed()) continue
    if (index === 1 && targets[0] === window) continue
    try {
      window.webContents.send(channel, payload)
    } catch {
      // Janela fechando entre a checagem e o envio.
    }
  }
}

export function createSearchRuntime(ctx: IpcContext, deps: SearchRuntimeDeps): SearchRuntime {
  const cache = createSearchCache<FetchedPage>()
  const limits = createSearchTurnLimits({ checkBudget: deps.checkBudget })
  let turnAbort = new AbortController()
  let activeKind: SearchKind | null = null

  const pushIndicator = (active: boolean, kind?: SearchKind): void => {
    activeKind = active ? (kind ?? null) : null
    const push: SearchIndicatorPush = {
      active,
      ...(active && kind ? { kind } : {})
    }
    broadcast(ctx, IPC.searchIndicator, push)
  }

  const audit = (event: SearchAuditEvent): void => {
    logger.info('audit', event)
  }

  const fetchCached = (url: string, signal?: AbortSignal): Promise<FetchedPage> => {
    const key = normalizeCacheKey(url)
    if (!key) {
      return fetchPage(url, {
        validate: (candidate) => validateUrl(candidate),
        fetchImpl: (input, init) => fetch(input, init),
        ...(signal ? { signal } : {})
      })
    }
    return cache.getOrLoad(
      key,
      (requestSignal) =>
        fetchPage(url, {
          validate: (candidate) => validateUrl(candidate),
          fetchImpl: (input, init) => fetch(input, init),
          signal: requestSignal
        }),
      signal
    )
  }

  const confirm = createDialogConfirmation(
    {
      showMessageBox: (window, options) =>
        window
          ? dialog.showMessageBox(window as BrowserWindow, options)
          : dialog.showMessageBox(options)
    },
    () => ctx.getOverlayWindow()
  )

  let registry: ToolRegistry = createToolRegistry()
  let handlers = new Map<string, ToolHandler>()
  let cachedEnabled: boolean | null = null

  const refresh = (): void => {
    const enabled = getStoreSnapshot().web.enabled
    if (cachedEnabled === enabled) return
    cachedEnabled = enabled
    registry = createToolRegistry()
    handlers = new Map()
    const result = registerWebTools(registry, handlers, {
      enabled,
      fetchUrl: {
        isEnabled: () => getStoreSnapshot().web.enabled,
        fetchPage: fetchCached,
        extract: extractReadable,
        limits,
        onActivity: pushIndicator,
        audit
      },
      ...(deps.search
        ? {
            webSearch: {
              isEnabled: () => getStoreSnapshot().web.enabled,
              search: deps.search,
              limits,
              onActivity: pushIndicator,
              audit
            }
          }
        : {})
    })
    for (const error of result.errors) logger.error('search', `registro recusado: ${error}`)
    logger.info('search', 'registro atualizado', {
      enabled,
      tools: result.registered
    })
  }

  const listTools = (): readonly ToolDefinition[] => {
    refresh()
    return registry.listTools()
  }

  const hasTool = (name: string): boolean => {
    refresh()
    return registry.getTool(name) !== null
  }

  const route = (call: GeminiFunctionCall): Promise<ToolCallResult> => {
    refresh()
    return routeToolCall(
      {
        registry,
        getHandler: (name) => handlers.get(name) ?? null,
        getPermission: (category) => effectivePermission(getStoreSnapshot().permissions, category),
        confirm,
        audit: createLoggerAudit(logger),
        now: () => Date.now(),
        signal: turnAbort.signal
      },
      call
    )
  }

  const status = (): SearchStatus => {
    refresh()
    const enabled = getStoreSnapshot().web.enabled
    const turn = limits.snapshot()
    return {
      enabled,
      active: activeKind !== null,
      ...(activeKind ? { kind: activeKind } : {}),
      tools: registry.listTools().map((tool) => tool.name),
      turn,
      cache: cache.snapshot()
    }
  }

  const endTurn = (requestId: string): void => {
    if (limits.getCurrentRequestId() !== requestId) return
    turnAbort.abort()
    turnAbort = new AbortController()
  }

  const shutdown = (): void => {
    turnAbort.abort()
    turnAbort = new AbortController()
    cache.clear()
    limits.reset()
    activeKind = null
  }
  registerShutdownHook('search', shutdown)

  return {
    listTools,
    hasTool,
    route,
    beginTurn: (requestId) => {
      turnAbort.abort()
      turnAbort = new AbortController()
      limits.beginTurn(requestId)
    },
    endTurn,
    status,
    clearCache: () => cache.clear(),
    shutdown
  }
}

let shared: SearchRuntime | null = null

export function ensureSearchRuntime(ctx: IpcContext, deps: SearchRuntimeDeps): SearchRuntime {
  if (!shared) shared = createSearchRuntime(ctx, deps)
  return shared
}

export function getSearchRuntime(): SearchRuntime | null {
  return shared
}

/** Hook de teste/smoke: substitui a instância compartilhada. */
export function setSearchRuntimeForTests(next: SearchRuntime | null): void {
  shared = next
}
