import { app, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { randomBytes } from 'crypto'
import { statSync } from 'fs'
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
import {
  normalizeArchiveAllInput,
  normalizeHireInput,
  normalizeRestoreInput,
  normalizeRosterOptionsInput,
  normalizeSetRoleInput,
  pickArchiveTargets
} from '../office/roster'
import {
  buildDepartment,
  canAddDepartment,
  departmentIDFromBytes,
  deleteDepartment as removeDepartment,
  findDepartment,
  isDepartmentNameTaken,
  normalizeAvatarGetInput,
  normalizeAvatarSaveInput,
  normalizeDepartmentAssignInput,
  normalizeDepartmentCreateInput,
  normalizeDepartmentIdInput,
  normalizeDepartmentUnassignInput,
  normalizeDepartmentUpdateInput,
  pickApplyTargets,
  assignSession,
  unassignSession,
  updateDepartment
} from '../office/departments'
import {
  getOfficeAvatars,
  getOfficeDepartments,
  setOfficeAvatar,
  setOfficeDepartments
} from '../store'
import { logger } from '../logger'
import { agentSeedFor, deriveOfficeSnapshot } from '../../shared/office'
import { defaultLookFor, type OfficeAvatarLook } from '../../shared/officeAvatar'
import type {
  OfficeArchiveAllResult,
  OfficeArchivedListResult,
  OfficeAvatarResult,
  OfficeAgentStatus,
  OfficeDepartment,
  OfficeDepartmentApplyResult,
  OfficeDepartmentDeleteResult,
  OfficeDepartmentResult,
  OfficeHealth,
  OfficeManageResult,
  OfficeRosterResult,
  OfficeSnapshot
} from '../../shared/office'

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
/**
 * Gestão de funcionários: uma mutação por vez. Sem isso, dois cliques em
 * "Apagar todos" disparariam duas rajadas de PATCH no OpenCode.
 */
let manageBusy = false

const NO_CLI_MESSAGE =
  'Não encontrei o CLI do OpenCode. Verifique a instalação ou defina KOLDND_HUB_OPENCODE_CLI.'
const BUSY_MESSAGE = 'Já existe uma operação de funcionários em andamento. Espere terminar.'
const WORKING_MESSAGE =
  'Esta sessão está trabalhando. Espere a tarefa terminar para trocar a função.'
const MISSING_ROOM_MESSAGE = 'A pasta desta sala não existe mais no disco.'

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
  if (!aggregator) {
    aggregator = createOfficeAggregator({
      getDepartments: getOfficeDepartments,
      getAvatars: getOfficeAvatars
    })
  }
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
    getDepartments: getOfficeDepartments,
    getAvatars: getOfficeAvatars,
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

// ── Gestão de funcionários (Fase 4) ────────────────────────────────────────

/** Erro legível sem vazar payload: a mensagem do CLI já vem curta/mascarada. */
function managementError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'Não consegui concluir a operação no OpenCode.'
}

/** O cliente da gestão exige o CLI resolvido; a fixture responde `fixture`. */
async function resolveManagementClient(): Promise<OfficeClient | string> {
  const active = ensureClient()
  if (!active) return fixtureError ?? 'O OpenCode não está disponível nesta execução.'
  const cli = await active.resolveCli()
  return cli ? active : NO_CLI_MESSAGE
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Uma mutação por vez: evita duas rajadas de escrita simultâneas no OpenCode. */
async function withManage<T>(busyValue: T, run: () => Promise<T>): Promise<T> {
  if (manageBusy) return busyValue
  manageBusy = true
  try {
    return await run()
  } finally {
    manageBusy = false
  }
}

/** Após criar/arquivar/restaurar, o poller relê já — a UI reflete em < 3 s. */
function refreshOffice(): void {
  service?.refresh()
}

const DEPARTMENT_LIMIT_MESSAGE =
  'Limite de 30 salas atingido. Exclua uma sala antes de criar outra.'
const DEPARTMENT_MISSING_MESSAGE = 'Sala não encontrada. Atualize a página e tente de novo.'
const DEPARTMENT_FULL_MESSAGE = 'Esta sala já tem 60 funcionários.'
const DEPARTMENT_DUPLICATE_MESSAGE = 'Já existe uma sala com esse nome.'
const SESSION_MISSING_MESSAGE = 'A sessão não está disponível no OpenCode agora.'

/** Grava a lista normalizada; devolve a mensagem de erro (ou `null` no sucesso). */
function persistDepartments(next: readonly OfficeDepartment[]): string | null {
  const result = setOfficeDepartments(next)
  return result.success ? null : (result.error ?? 'Não consegui salvar as salas.')
}

/** Status fresco das sessões (o snapshot pode estar alguns segundos atrasado). */
async function freshAgents(
  client: OfficeClient
): Promise<Array<{ sessionID: string; status: OfficeAgentStatus }>> {
  const sessions = await client.listSessions({ limit: 200 })
  return deriveOfficeSnapshot({ sessions, now: Date.now() }).agents
}

/**
 * Aplica a função de uma sessão respeitando `working`: nesse caso nada é
 * enviado ao OpenCode e a sessão fica pendente (badge + "Aplicar agora").
 */
async function applyRoleToOne(
  client: OfficeClient,
  sessionID: string,
  agentID: string,
  agents: readonly { sessionID: string; status: OfficeAgentStatus }[]
): Promise<'applied' | 'pending'> {
  const status = agents.find((agent) => agent.sessionID === sessionID)?.status
  if (!status) throw new Error(SESSION_MISSING_MESSAGE)
  if (status === 'working') return 'pending'
  await client.setSessionAgent(sessionID, agentID)
  return 'applied'
}

/** `4` bytes aleatórios do main; tenta de novo em caso de colisão (improvável). */
function newDepartmentID(existing: readonly OfficeDepartment[]): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = departmentIDFromBytes([...randomBytes(4)])
    if (!findDepartment(existing, candidate)) return candidate
  }
  // Fallback determinístico por tempo: continua no formato `dep_<8 hex>`.
  return departmentIDFromBytes([
    Date.now() & 0xff,
    (Date.now() >>> 8) & 0xff,
    (Date.now() >>> 16) & 0xff,
    (Date.now() >>> 24) & 0xff
  ])
}

/**
 * `working` não troca de função: o OpenCode mudaria o agente no meio de uma
 * tarefa. Consulta a lista fresca (o snapshot pode estar 2 s atrasado).
 */
async function sessionIsWorking(client: OfficeClient, sessionID: string): Promise<boolean> {
  const sessions = await client.listSessions({ limit: 200 })
  const snapshot = deriveOfficeSnapshot({ sessions, now: Date.now() })
  return snapshot.agents.some(
    (agent) => agent.sessionID === sessionID && agent.status === 'working'
  )
}

/** Encerramento do app: só aqui a ponte morre e o `bridge.json` é apagado. */
function disposeOffice(): void {
  releaseAll()
  stopBridge()
  actionMode = false
  manageBusy = false
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

  // ── Funcionários (contratar / dar função / arquivar) ──────────────
  // Todos exigem exatamente UM objeto validado; nada de texto livre no log.
  ipcMain.handle('office:roster-options', async (_event, ...args: unknown[]) => {
    const input = normalizeRosterOptionsInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    const active = await resolveManagementClient()
    if (typeof active === 'string') {
      return { ok: false, agents: [], models: [], error: active } satisfies OfficeRosterResult
    }
    if (!isExistingDirectory(input.directory)) {
      return {
        ok: false,
        agents: [],
        models: [],
        error: MISSING_ROOM_MESSAGE
      } satisfies OfficeRosterResult
    }

    try {
      const [agents, models] = await Promise.all([
        active.listAgents(input.directory),
        active.listModels(input.directory)
      ])
      return { ok: true, agents, models } satisfies OfficeRosterResult
    } catch (err) {
      return {
        ok: false,
        agents: [],
        models: [],
        error: managementError(err)
      } satisfies OfficeRosterResult
    }
  })

  ipcMain.handle('office:hire', async (_event, ...args: unknown[]) => {
    const input = normalizeHireInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeManageResult>({ ok: false, error: BUSY_MESSAGE }, async () => {
      const active = await resolveManagementClient()
      if (typeof active === 'string') return { ok: false, error: active }
      if (!isExistingDirectory(input.directory)) {
        return { ok: false, error: MISSING_ROOM_MESSAGE }
      }

      try {
        const sessionID = await active.createSession(input)
        // Auditoria sem título: só sessão/cargo/modelo (a mensagem nunca entra).
        const model = input.model ? `${input.model.providerID}/${input.model.id}` : 'padrão'
        logger.info(
          'office',
          `Funcionário contratado: sessão ${sessionID}, agente ${input.agentID}, modelo ${model}.`
        )
        refreshOffice()
        return { ok: true }
      } catch (err) {
        logger.warn('office', `Falha ao contratar funcionário (agente ${input.agentID}).`)
        return { ok: false, error: managementError(err) }
      }
    })
  })

  ipcMain.handle('office:set-role', async (_event, ...args: unknown[]) => {
    const input = normalizeSetRoleInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeManageResult>({ ok: false, error: BUSY_MESSAGE }, async () => {
      const active = await resolveManagementClient()
      if (typeof active === 'string') return { ok: false, error: active }

      try {
        if (await sessionIsWorking(active, input.sessionID)) {
          return { ok: false, error: WORKING_MESSAGE }
        }
        await active.setSessionAgent(input.sessionID, input.agentID)
        if (input.model) {
          await active.setSessionModel(input.sessionID, {
            id: input.model.id,
            providerID: input.model.providerID
          })
        }
        const model = input.model ? `${input.model.providerID}/${input.model.id}` : 'mantido'
        logger.info(
          'office',
          `Função da sessão ${input.sessionID} atualizada: agente ${input.agentID}, modelo ${model}.`
        )
        refreshOffice()
        return { ok: true }
      } catch (err) {
        logger.warn('office', `Falha ao trocar a função da sessão ${input.sessionID}.`)
        return { ok: false, error: managementError(err) }
      }
    })
  })

  ipcMain.handle('office:archive-all', async (_event, ...args: unknown[]) => {
    if (!normalizeArchiveAllInput(singleArgument(args))) {
      throw new Error('Requisição inválida.')
    }

    return withManage<OfficeArchiveAllResult>(
      { ok: false, archived: 0, skipped: 0, error: BUSY_MESSAGE },
      async () => {
        const active = await resolveManagementClient()
        if (typeof active === 'string') {
          return { ok: false, archived: 0, skipped: 0, error: active }
        }

        const snapshot = aggregator?.getSnapshot() ?? service?.getSnapshot() ?? null
        if (!snapshot) return { ok: true, archived: 0, skipped: 0 }

        const { targetIDs, skippedIDs } = pickArchiveTargets(snapshot.agents)
        let archived = 0
        let error: string | undefined
        for (const sessionID of targetIDs) {
          try {
            await active.archiveSession(sessionID)
            archived += 1
          } catch (err) {
            // Para no primeiro erro: insistir nos seguintes só pioraria a fila.
            error = managementError(err)
            break
          }
        }

        if (archived > 0) refreshOffice()
        logger.info(
          'office',
          `Arquivamento em lote: ${archived} arquivada(s), ${skippedIDs.length} pulada(s) por estar trabalhando.`
        )
        return {
          ok: !error,
          archived,
          skipped: skippedIDs.length,
          ...(error ? { error } : {})
        }
      }
    )
  })

  ipcMain.handle('office:archived-list', async (_event, ...args: unknown[]) => {
    if (!normalizeArchiveAllInput(singleArgument(args))) {
      throw new Error('Requisição inválida.')
    }

    const active = await resolveManagementClient()
    if (typeof active === 'string') {
      return { ok: false, items: [], error: active } satisfies OfficeArchivedListResult
    }
    try {
      return {
        ok: true,
        items: await active.listArchivedSessions()
      } satisfies OfficeArchivedListResult
    } catch (err) {
      return {
        ok: false,
        items: [],
        error: managementError(err)
      } satisfies OfficeArchivedListResult
    }
  })

  ipcMain.handle('office:restore', async (_event, ...args: unknown[]) => {
    const input = normalizeRestoreInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeManageResult>({ ok: false, error: BUSY_MESSAGE }, async () => {
      const active = await resolveManagementClient()
      if (typeof active === 'string') return { ok: false, error: active }

      try {
        await active.restoreSession(input.sessionID)
        logger.info('office', `Funcionário restaurado: sessão ${input.sessionID}.`)
        refreshOffice()
        return { ok: true }
      } catch (err) {
        logger.warn('office', `Falha ao restaurar a sessão ${input.sessionID}.`)
        return { ok: false, error: managementError(err) }
      }
    })
  })

  // ── Aparência dos personagens ─────────────────────────────────────
  ipcMain.handle('office:avatar-get', (_event, ...args: unknown[]) => {
    const input = normalizeAvatarGetInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')
    const saved = getOfficeAvatars()[input.sessionID]
    const look: OfficeAvatarLook = saved ?? defaultLookFor(agentSeedFor(input.sessionID))
    return { ok: true, look } satisfies OfficeAvatarResult
  })

  ipcMain.handle('office:avatar-save', (_event, ...args: unknown[]) => {
    const input = normalizeAvatarSaveInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    const result = setOfficeAvatar(input.sessionID, input.look)
    if (!result.success) {
      return {
        ok: false,
        error: result.error ?? 'Não consegui salvar a aparência.'
      } satisfies OfficeManageResult
    }
    logger.info('office', `Aparência da sessão ${input.sessionID} salva.`)
    refreshOffice()
    return { ok: true } satisfies OfficeManageResult
  })

  // ── Salas-departamento ────────────────────────────────────────────
  ipcMain.handle('office:department-create', async (_event, ...args: unknown[]) => {
    const input = normalizeDepartmentCreateInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeDepartmentResult>({ ok: false, error: BUSY_MESSAGE }, async () => {
      const current = getOfficeDepartments()
      if (!canAddDepartment(current)) return { ok: false, error: DEPARTMENT_LIMIT_MESSAGE }
      if (isDepartmentNameTaken(current, input.name)) {
        return { ok: false, error: DEPARTMENT_DUPLICATE_MESSAGE }
      }

      const department = buildDepartment(
        newDepartmentID(current),
        input.name,
        input.agentID,
        Date.now()
      )
      if (!department) return { ok: false, error: 'Sala inválida.' }

      const error = persistDepartments([...current, department])
      if (error) return { ok: false, error }
      logger.info('office', `Sala criada: ${department.name} (função ${department.agentID}).`)
      refreshOffice()
      return { ok: true, department } satisfies OfficeDepartmentResult
    })
  })

  ipcMain.handle('office:department-update', async (_event, ...args: unknown[]) => {
    const input = normalizeDepartmentUpdateInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeDepartmentResult>({ ok: false, error: BUSY_MESSAGE }, async () => {
      const current = getOfficeDepartments()
      if (!findDepartment(current, input.id)) {
        return { ok: false, error: DEPARTMENT_MISSING_MESSAGE }
      }
      if (input.name && isDepartmentNameTaken(current, input.name, input.id)) {
        return { ok: false, error: DEPARTMENT_DUPLICATE_MESSAGE }
      }

      const next = updateDepartment(current, input)
      if (!next) return { ok: false, error: DEPARTMENT_MISSING_MESSAGE }
      const error = persistDepartments(next)
      if (error) return { ok: false, error }

      const department = findDepartment(next, input.id) ?? undefined
      // Trocar a função NÃO aplica sozinho: quem aplica é a ação explícita.
      logger.info(
        'office',
        `Sala ${input.id} atualizada${input.agentID ? ` (função ${input.agentID})` : ''}.`
      )
      refreshOffice()
      return { ok: true, department } satisfies OfficeDepartmentResult
    })
  })

  ipcMain.handle('office:department-delete', async (_event, ...args: unknown[]) => {
    const input = normalizeDepartmentIdInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeDepartmentDeleteResult>(
      { ok: false, released: 0, error: BUSY_MESSAGE },
      async () => {
        const current = getOfficeDepartments()
        const removed = removeDepartment(current, input.id)
        if (!removed) return { ok: false, released: 0, error: DEPARTMENT_MISSING_MESSAGE }

        const error = persistDepartments(removed.departments)
        if (error) return { ok: false, released: 0, error }
        logger.info(
          'office',
          `Sala ${input.id} excluída; ${removed.released.length} funcionário(s) voltaram para "Sem sala".`
        )
        refreshOffice()
        return {
          ok: true,
          released: removed.released.length
        } satisfies OfficeDepartmentDeleteResult
      }
    )
  })

  ipcMain.handle('office:department-assign', async (_event, ...args: unknown[]) => {
    const input = normalizeDepartmentAssignInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeDepartmentApplyResult>(
      { ok: false, applied: 0, pending: 0, error: BUSY_MESSAGE },
      async () => {
        const current = getOfficeDepartments()
        const target = findDepartment(current, input.departmentID)
        if (!target) return { ok: false, applied: 0, pending: 0, error: DEPARTMENT_MISSING_MESSAGE }
        if (!target.sessionIDs.includes(input.sessionID) && target.sessionIDs.length >= 60) {
          return { ok: false, applied: 0, pending: 0, error: DEPARTMENT_FULL_MESSAGE }
        }

        const next = assignSession(current, input.sessionID, input.departmentID)
        if (!next) return { ok: false, applied: 0, pending: 0, error: DEPARTMENT_FULL_MESSAGE }
        const persistError = persistDepartments(next)
        if (persistError) return { ok: false, applied: 0, pending: 0, error: persistError }

        if (!input.applyRole) {
          logger.info(
            'office',
            `Sessão ${input.sessionID} designada para a sala ${input.departmentID} (sem aplicar função).`
          )
          refreshOffice()
          return { ok: true, applied: 0, pending: 0 }
        }

        const active = await resolveManagementClient()
        if (typeof active === 'string') {
          refreshOffice()
          return { ok: false, applied: 0, pending: 0, error: active }
        }

        try {
          const agents = await freshAgents(active)
          const outcome = await applyRoleToOne(active, input.sessionID, target.agentID, agents)
          logger.info(
            'office',
            `Sessão ${input.sessionID} designada para a sala ${input.departmentID}; função ${
              outcome === 'applied' ? 'aplicada' : 'pendente (trabalhando)'
            }.`
          )
          refreshOffice()
          return outcome === 'applied'
            ? { ok: true, applied: 1, pending: 0 }
            : { ok: true, applied: 0, pending: 1 }
        } catch (err) {
          logger.warn(
            'office',
            `Falha ao aplicar a função da sala ${input.departmentID} na sessão ${input.sessionID}.`
          )
          refreshOffice()
          return { ok: false, applied: 0, pending: 0, error: managementError(err) }
        }
      }
    )
  })

  ipcMain.handle('office:department-unassign', async (_event, ...args: unknown[]) => {
    const input = normalizeDepartmentUnassignInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeManageResult>({ ok: false, error: BUSY_MESSAGE }, async () => {
      const current = getOfficeDepartments()
      const error = persistDepartments(unassignSession(current, input.sessionID))
      if (error) return { ok: false, error }
      logger.info('office', `Sessão ${input.sessionID} devolvida para "Sem sala".`)
      refreshOffice()
      return { ok: true }
    })
  })

  ipcMain.handle('office:department-apply-role', async (_event, ...args: unknown[]) => {
    const input = normalizeDepartmentIdInput(singleArgument(args))
    if (!input) throw new Error('Requisição inválida.')

    return withManage<OfficeDepartmentApplyResult>(
      { ok: false, applied: 0, pending: 0, error: BUSY_MESSAGE },
      async () => {
        const department = findDepartment(getOfficeDepartments(), input.id)
        if (!department) {
          return { ok: false, applied: 0, pending: 0, error: DEPARTMENT_MISSING_MESSAGE }
        }

        const active = await resolveManagementClient()
        if (typeof active === 'string') {
          return { ok: false, applied: 0, pending: 0, error: active }
        }

        try {
          const agents = await freshAgents(active)
          const { targetIDs, pendingIDs } = pickApplyTargets(department, agents)
          let applied = 0
          let error: string | undefined
          for (const sessionID of targetIDs) {
            try {
              await active.setSessionAgent(sessionID, department.agentID)
              applied += 1
            } catch (err) {
              // Para no primeiro erro: insistir nos seguintes só pioraria a fila.
              error = managementError(err)
              break
            }
          }

          logger.info(
            'office',
            `Função ${department.agentID} aplicada na sala ${department.id}: ${applied} aplicada(s), ${pendingIDs.length} pendente(s).`
          )
          refreshOffice()
          return {
            ok: !error,
            applied,
            pending: pendingIDs.length,
            ...(error ? { error } : {})
          } satisfies OfficeDepartmentApplyResult
        } catch (err) {
          logger.warn('office', `Falha ao aplicar a função da sala ${department.id}.`)
          return { ok: false, applied: 0, pending: 0, error: managementError(err) }
        }
      }
    )
  })

  logger.info('office', 'IPC do escritório registrado.')
}
