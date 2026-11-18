import { app, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { IpcContext } from './lifecycle'
import { createOfficeClient, type OfficeClient } from '../office/client'
import { createOfficeService, type OfficeService } from '../office/service'
import { createOfficeAggregator, type OfficeAggregator } from '../office/aggregator'
import { createOfficeBridge, type OfficeBridge } from '../office/bridge'
import {
  buildApprovePermission,
  buildDenyPermission,
  buildSendMessage,
  createActionLimiter,
  parseActionMode,
  type OfficeActionDecision,
  type OfficeActionEnqueueResult,
  type OfficeActionOutcome
} from '../office/actions'
import {
  installPlugin,
  pluginSnippet,
  pluginStatus,
  removePlugin,
  resolveInstallerPaths
} from '../office/pluginInstaller'
import { loadOfficeFixture } from '../office/fixture'
import { logger } from '../logger'
import type { OfficeHealth, OfficeSnapshot } from '../../shared/office'

/**
 * IPC do Escritório (OpenOffice) — Fase 1 (poller) + Fase 2 (ponte/plugin).
 *
 * Ciclo de vida: a PONTE e o AGREGADOR nascem no registro do IPC (boot do app).
 * O plugin do OpenCode carrega quando o OpenCode inicia — normalmente antes de
 * o usuário abrir a página —, então esperar o primeiro `office:subscribe` para
 * subir a ponte fazia o plugin desistir para sempre. O poller continua
 * preguiçoso e com refcount: só roda com a página aberta (D7). Fechar a janela
 * ou desassinar para SÓ o poller; a ponte segue como inbox do plugin e o
 * agregador guarda o último snapshot mesclado com limites de memória.
 * `will-quit` encerra a ponte (apaga o `bridge.json`).
 *
 * O push usa `office:snapshot`; o canal de mesmo nome é reservado ao evento — a
 * leitura pontual também usa `office:snapshot` via invoke, o que é seguro
 * porque o Electron separa invoke (reply channel) de `webContents.send`.
 *
 * Nenhum handler aceita argumentos: são todos "sem payload" e qualquer
 * requisição com argumento é recusada (IPC valida tudo — AGENTS.md).
 */

let context: IpcContext | null = null
let client: OfficeClient | null = null
let service: OfficeService | null = null
let aggregator: OfficeAggregator | null = null
let bridge: OfficeBridge | null = null
let pumpTimer: ReturnType<typeof setTimeout> | null = null
let registered = false
let watched: WebContents | null = null
let watchedListener: (() => void) | null = null
/** Fixture de teste configurada e inválida: sem poller e sem nova tentativa. */
let clientUnavailable = false
let fixtureError: string | null = null
/**
 * Modo de ações (Fase 3): desligado por padrão e só em memória. Sem store e
 * sem migração nesta rodada — reiniciar o app volta ao somente leitura (D11).
 */
let actionMode = false
const actionLimiter = createActionLimiter()

function assertNoArguments(args: readonly unknown[]): void {
  if (args.length > 0) throw new Error('Requisição inválida.')
}

/** Handlers de ação recebem exatamente UM objeto validado na sequência. */
function singleArgument(args: readonly unknown[]): unknown {
  if (args.length !== 1) throw new Error('Requisição inválida.')
  return args[0]
}

/**
 * Caminho da fixture quando o modo de teste está ligado.
 *
 * Dupla trava (`KOLDND_HUB_OFFICE_FIXTURE` **e** `KOLDND_HUB_TEST_USERDATA`):
 * a fixture só existe em execução de e2e, nunca em produção, e o isolamento do
 * userData é a prova de que a execução é de teste. Sem as duas, nada muda.
 */
function officeFixturePath(): string | null {
  if (!process.env.KOLDND_HUB_TEST_USERDATA) return null
  const path = (process.env.KOLDND_HUB_OFFICE_FIXTURE ?? '').trim()
  return path || null
}

/** Cria o cliente sob demanda (localizar o CLI é caro e só acontece uma vez). */
function ensureClient(): OfficeClient | null {
  if (client) return client
  if (clientUnavailable) return null

  const fixture = officeFixturePath()
  if (!fixture) {
    client = createOfficeClient()
    return client
  }

  try {
    client = loadOfficeFixture(fixture)
    logger.info('office', `Escritório em modo de teste: fixture "${fixture}".`)
    return client
  } catch (err) {
    // Fixture ilegível é erro de teste: registra, não liga poller e devolve um
    // snapshot vazio com a mensagem — a página explica em vez de ficar girando.
    clientUnavailable = true
    fixtureError =
      err instanceof Error && err.message ? err.message : 'A fixture do escritório é inválida.'
    logger.warn('office', `Fixture do escritório inválida: ${fixtureError}`)
    return null
  }
}

/** Envia o snapshot só para uma janela viva — bandeja/destruída não recebe. */
function emit(snapshot: OfficeSnapshot): void {
  const window = context?.getMainWindow() ?? null
  if (!window || window.isDestroyed()) return
  const contents = window.webContents
  if (!contents || contents.isDestroyed()) return
  contents.send('office:snapshot', snapshot)
}

/** Push do desfecho de uma ação para a janela viva (nunca para a bandeja). */
function emitActionResult(result: OfficeActionOutcome): void {
  const window = context?.getMainWindow() ?? null
  if (!window || window.isDestroyed()) return
  const contents = window.webContents
  if (!contents || contents.isDestroyed()) return
  contents.send('office:action-result', result)
}

function ensureAggregator(): OfficeAggregator {
  if (!aggregator) aggregator = createOfficeAggregator()
  return aggregator
}

/**
 * Flush do throttle do agregador. O agregador é puro (sem timers), então quem
 * garante que a última rajada chegue à UI é este pump de 250 ms — sem ele, um
 * evento descartado pelo limite de 4/s ficaria só no estado.
 */
function schedulePump(): void {
  if (pumpTimer || !aggregator) return
  const wait = aggregator.msUntilNextEmit()
  if (wait <= 0) return
  pumpTimer = setTimeout(() => {
    pumpTimer = null
    const snapshot = aggregator?.flush() ?? null
    if (snapshot) emit(snapshot)
  }, wait)
  pumpTimer.unref?.()
}

function stopBridge(): void {
  if (pumpTimer) {
    clearTimeout(pumpTimer)
    pumpTimer = null
  }
  const active = bridge
  bridge = null
  if (active) {
    void active.stop().catch((err) => {
      logger.warn('office', 'Falha ao encerrar a ponte do Escritório.', err)
    })
  }
  aggregator?.reset()
}

function ensureBridge(): OfficeBridge {
  if (bridge) return bridge
  const merged = ensureAggregator()
  const created = createOfficeBridge({
    emit: (event) => {
      const snapshot = merged.applyEvent(event)
      if (snapshot) emit(snapshot)
      schedulePump()
    },
    // Auditoria sem conteúdo: ação, sessão e desfecho. O texto da mensagem e o
    // motivo da negação nunca passam por aqui.
    onActionResult: (result, meta) => {
      logger.info(
        'office',
        `Resultado de ${meta.action} da sessão ${meta.sessionID}: ${result.ok ? 'ok' : 'falhou'}.`
      )
      emitActionResult(result)
    }
  })
  bridge = created
  void created.start().catch((err) => {
    logger.warn('office', 'Não consegui iniciar a ponte do Escritório.', err)
  })
  return created
}

function ensureService(): OfficeService | null {
  if (service) return service
  const activeClient = ensureClient()
  if (!activeClient) return null
  const merged = ensureAggregator()
  service = createOfficeService({
    client: activeClient,
    emit: (snapshot) => {
      const next = merged.setPoller(snapshot) ?? null
      if (next) emit(next)
      schedulePump()
    }
  })
  return service
}

/**
 * Portão único das três ações: modo ligado, payload válido, 10/min por sessão
 * e fila da ponte. Recusa sempre com motivo legível — nunca lança para o
 * renderer por conteúdo inválido.
 */
function runAction(
  input: unknown,
  build: (value: unknown) => OfficeActionDecision
): OfficeActionEnqueueResult {
  if (!actionMode) return { ok: false, reason: 'somente-leitura' }
  const decision = build(input)
  if (!decision.ok) return { ok: false, reason: decision.reason }
  const action = decision.action
  if (!actionLimiter.take(action.sessionID)) {
    logger.warn('office', `Limite de ações atingido para a sessão ${action.sessionID}.`)
    return { ok: false, reason: 'limite' }
  }
  const result = ensureBridge().enqueueAction(action)
  if (result.ok) {
    logger.info('office', `Ação ${action.action} enfileirada para a sessão ${action.sessionID}.`)
  } else {
    logger.warn(
      'office',
      `Ação ${action.action} recusada (${result.reason}) para a sessão ${action.sessionID}.`
    )
  }
  return result
}

/**
 * Para o coletor até o refcount zerar. Um refresh da página pode ter deixado
 * assinaturas pendentes; quando a janela morre não existe consumidor, mas a
 * ponte continua no ar (o plugin não pode perder o inbox).
 */
function releaseAll(): void {
  const active = service
  if (!active) return
  while (active.subscribers() > 0) active.stop()
}

/** Encerramento do app: só aqui a ponte morre e o `bridge.json` é apagado. */
function disposeOffice(): void {
  releaseAll()
  stopBridge()
  actionMode = false
  actionLimiter.reset()
}

function unwatchWindow(): void {
  if (!watched) return
  try {
    if (watchedListener) watched.removeListener('destroyed', watchedListener)
  } catch {
    // O emitter pode já ter sido destruído junto com a webContents.
  }
  watched = null
  watchedListener = null
}

/** Observa a webContents que consome o escritório; destruída ⇒ para a coleta. */
function watchWindow(contents: WebContents): void {
  if (!contents || contents.isDestroyed()) return
  if (watched === contents) return
  unwatchWindow()
  const listener = (): void => {
    watched = null
    watchedListener = null
    releaseAll()
    logger.info('office', 'Janela do escritório destruída — coleta pausada.')
  }
  contents.once('destroyed', listener)
  watched = contents
  watchedListener = listener
}

/** Registra os canais do escritório uma única vez (bootstrap do main). */
export function registerOfficeIpc(ipcContext: IpcContext): void {
  context = ipcContext
  if (registered) return
  registered = true

  // Ponte no BOOT: o plugin do OpenCode pode carregar antes de a página abrir.
  const pipeline = ensureAggregator()
  ensureBridge()
  app.once('will-quit', disposeOffice)

  ipcMain.handle('office:subscribe', (_event, ...args: unknown[]) => {
    assertNoArguments(args)
    const active = ensureService()
    if (!active) return pipeline.current()
    const window = context?.getMainWindow() ?? null
    if (!window || window.isDestroyed()) return pipeline.current()
    watchWindow(window.webContents)
    active.start()
    return pipeline.current()
  })

  ipcMain.handle('office:unsubscribe', (_event, ...args: unknown[]) => {
    assertNoArguments(args)
    // Refcount do poller apenas: a ponte e o estado continuam vivos.
    service?.stop()
    if (!service || service.subscribers() === 0) unwatchWindow()
    return { ok: true }
  })

  ipcMain.handle('office:snapshot', (_event, ...args: unknown[]) => {
    assertNoArguments(args)
    // Leitura pura: nunca inicia a coleta por conta própria.
    return pipeline.current()
  })

  ipcMain.handle('office:status', async (_event, ...args: unknown[]) => {
    assertNoArguments(args)
    const pluginConnected = aggregator?.pluginHealth().connected ?? false
    const snapshot = aggregator?.getSnapshot() ?? service?.getSnapshot()
    if (snapshot) return { ...snapshot.health, pluginConnected }
    const activeClient = ensureClient()
    if (!activeClient) {
      return {
        cliFound: false,
        pluginConnected,
        ...(fixtureError ? { lastError: fixtureError } : {})
      } satisfies OfficeHealth
    }
    // Sem coleta ainda: resolve/memoiza o CLI apenas para dizer se ele existe.
    const resolved = (await activeClient.resolveCli()) ?? undefined
    return {
      cliFound: Boolean(resolved),
      pluginConnected,
      ...(resolved ? { cliPath: resolved } : {})
    } satisfies OfficeHealth
  })

  // ── Ações (Fase 3) ────────────────────────────────────────────────
  // Todos exigem exatamente UM objeto; o retorno nunca inclui texto enviado.
  ipcMain.handle('office:approve-permission', (_event, ...args: unknown[]) =>
    runAction(singleArgument(args), buildApprovePermission)
  )

  ipcMain.handle('office:deny-permission', (_event, ...args: unknown[]) =>
    runAction(singleArgument(args), buildDenyPermission)
  )

  ipcMain.handle('office:send-message', (_event, ...args: unknown[]) =>
    runAction(singleArgument(args), buildSendMessage)
  )

  ipcMain.handle('office:action-mode', (_event, ...args: unknown[]) => {
    const parsed = parseActionMode(singleArgument(args))
    if (!parsed) throw new Error('Requisição inválida.')
    actionMode = parsed.enabled
    logger.info('office', `Modo de ações do Escritório ${actionMode ? 'ligado' : 'desligado'}.`)
    return { ok: true, enabled: actionMode }
  })

  ipcMain.handle('office:plugin-status', (_event, ...args: unknown[]) => {
    assertNoArguments(args)
    // Estado do instalador (arquivos + config). Nunca escreve nada.
    return pluginStatus(resolveInstallerPaths())
  })

  ipcMain.handle('office:plugin-install', (_event, ...args: unknown[]) => {
    assertNoArguments(args)
    const result = installPlugin(resolveInstallerPaths())
    // Log sem conteúdo do config: só o desfecho (e o motivo, se falhou).
    if (result.ok) {
      logger.info(
        'office',
        result.changed
          ? 'Plugin do OpenCode instalado e entrada adicionada ao config.'
          : 'Plugin do OpenCode atualizado (a entrada já estava no config).'
      )
    } else {
      logger.warn(
        'office',
        `Instalação do plugin do OpenCode não concluída: ${result.reason ?? 'desconhecido'}.`
      )
    }
    return result
  })

  ipcMain.handle('office:plugin-remove', (_event, ...args: unknown[]) => {
    assertNoArguments(args)
    const result = removePlugin(resolveInstallerPaths())
    if (!result.ok) {
      logger.warn(
        'office',
        `Remoção do plugin do OpenCode não concluída: ${result.reason ?? 'desconhecido'}.`
      )
    } else {
      logger.info(
        'office',
        result.removed
          ? 'Entrada do plugin do OpenCode removida do config.'
          : 'Remoção do plugin do OpenCode: não havia entrada para remover.'
      )
    }
    return result
  })

  ipcMain.handle('office:plugin-snippet', (_event, ...args: unknown[]) => {
    assertNoArguments(args)
    // Só monta o trecho para o usuário colar — não escreve arquivo.
    return pluginSnippet(resolveInstallerPaths())
  })

  logger.info('office', 'IPC do escritório registrado.')
}
