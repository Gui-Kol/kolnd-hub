import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Ações do OpenOffice ponta a ponta (T16).
 *
 * O "plugin falso" é ESTE teste falando HTTP com a ponte do main: lê o
 * `<userData isolado>/office/bridge.json`, publica eventos em `/office/events`
 * e faz long-poll em `/office/actions` como o plugin real faria. Nenhum
 * processo de plugin é criado e nenhum arquivo do OpenCode é tocado.
 *
 * O OpenCode em si também não roda: o poller usa a fixture de T9
 * (`KOLDND_HUB_OFFICE_FIXTURE` + `KOLDND_HUB_TEST_USERDATA`). Assim o caminho
 * exercitado é o de produção: renderer → IPC → fila da ponte → HTTP.
 */

const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')
const FIXTURES_DIR = join(__dirname, 'fixtures')
/** Epoch base do fixture estático; o teste desloca tudo a partir daqui. */
const BASE_EPOCH = 1_795_000_000_000

/**
 * A fixture de T9 usa ids legíveis (`ses_e2e_office_main`), mas o contrato de
 * ações só aceita o formato real do OpenCode (`ses_[A-Za-z0-9]`, sem `_`). O
 * teste materializa a fixture com ids válidos para exercitar o caminho de
 * produção de ponta a ponta — sem tocar na fixture compartilhada.
 */
const ID_MAP: Record<string, string> = {
  ses_e2e_office_main: 'ses_e2e0a1b2c3d4',
  ses_e2e_office_idle: 'ses_e2e0a1b2c3d5',
  ses_e2e_office_sub: 'ses_e2e0a1b2c3d6'
}
/** Sessão `working` da fixture (a que recebe os pedidos neste spec). */
const SESSION_ID = ID_MAP.ses_e2e_office_main

interface BridgeInfo {
  port: number
  token: string
}

interface TimeFields {
  created?: number
  updated?: number
  busy?: number
  idle?: number
}

interface FixtureFile {
  sessions: Array<{ time?: TimeFields; [key: string]: unknown }>
  messages?: Record<string, Array<{ time?: TimeFields; content?: unknown[] }>>
  delayMs?: number
}

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

function shiftTime(target: { time?: TimeFields }, delta: number): void {
  if (!target.time) return
  for (const key of ['created', 'updated', 'busy', 'idle'] as const) {
    const value = target.time[key]
    if (typeof value === 'number') target.time[key] = value + delta
  }
}

/** Copia a fixture cheia com as datas relativas a agora e ids válidos de ação. */
function materializeFullFixture(ctx: E2eContext): string {
  const fixture = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'office-full.json'), 'utf8')
  ) as FixtureFile & {
    sessions: Array<Record<string, unknown>>
    messages?: Record<string, Array<{ time?: TimeFields; content?: unknown[] }>>
  }
  const delta = Date.now() - BASE_EPOCH

  for (const session of fixture.sessions) {
    shiftTime(session, delta)
    if (typeof session.id === 'string' && ID_MAP[session.id]) session.id = ID_MAP[session.id]
    if (typeof session.parentID === 'string' && ID_MAP[session.parentID]) {
      session.parentID = ID_MAP[session.parentID]
    }
  }
  const messages: typeof fixture.messages = {}
  for (const [sessionID, list] of Object.entries(fixture.messages ?? {})) {
    for (const message of list) shiftTime(message, delta)
    messages[ID_MAP[sessionID] ?? sessionID] = list
  }
  fixture.messages = messages

  const dir = join(ctx.root, 'office-fixtures')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'office-full.actions.json')
  writeFileSync(target, JSON.stringify(fixture), 'utf8')
  return target
}

function baseEnv(ctx: E2eContext): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
    PATH: `${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
}

async function launchApp(env: NodeJS.ProcessEnv): Promise<ElectronApplication> {
  // Ponte de uma execução anterior (teste interrompido) não pode confundir o
  // long-poll deste teste.
  rmSync(join(env.KOLDND_HUB_TEST_USERDATA ?? '', 'office', 'bridge.json'), { force: true })
  return electron.launch({ args: ['.'], env })
}

async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close().catch(() => {
    try {
      app.process().kill()
    } catch {
      // já encerrado
    }
  })
}

async function openTools(window: Page): Promise<void> {
  await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
    timeout: 45_000
  })
  await window
    .locator('nav[aria-label="Navegação principal"]')
    .getByRole('button', { name: 'Ferramentas' })
    .click()
  await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible()
}

async function openOfficeFromAiCard(window: Page): Promise<void> {
  await openTools(window)
  const aiGroup = window.getByRole('region', { name: 'Inteligência Artificial' })
  await expect(aiGroup).toBeVisible()
  const card = aiGroup.getByTestId('openoffice-card')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Abrir' }).click()
  await expect(window.getByTestId('openoffice-page')).toBeVisible({ timeout: 20_000 })
}

/** Seleciona um agente da sidebar pelo rótulo de status (Trabalhando/Ocioso…). */
async function selectAgent(window: Page, status: string): Promise<void> {
  const agent = window.getByTestId('office-agent').filter({ hasText: status }).first()
  await expect(agent).toBeVisible({ timeout: 30_000 })
  await agent.click()
  await expect(window.getByTestId('office-details')).toBeVisible()
}

/** Espera o `bridge.json` do userData isolado (a ponte sobe no boot). */
async function waitForBridge(ctx: E2eContext): Promise<BridgeInfo> {
  const file = join(ctx.userDataDir, 'office', 'bridge.json')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<BridgeInfo>
        if (
          typeof parsed.port === 'number' &&
          parsed.port > 0 &&
          typeof parsed.token === 'string' &&
          parsed.token
        ) {
          return { port: parsed.port, token: parsed.token }
        }
      } catch {
        // arquivo em escrita: tenta de novo no próximo ciclo
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('A ponte do Escritório não apareceu no userData do e2e.')
}

function bridgeURL(bridge: BridgeInfo, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`
}

async function postEvent(bridge: BridgeInfo, event: Record<string, unknown>): Promise<void> {
  const response = await fetch(bridgeURL(bridge, '/office/events'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kolnd-token': bridge.token },
    body: JSON.stringify({ events: [event] })
  })
  expect(response.status, 'POST /office/events').toBe(200)
}

interface QueuedAction {
  id: string
  action: string
  sessionID: string
  requestID?: string
  decision?: string
  text?: string
}

/** Long-poll como o plugin: 200 com a ação, ou `null` em 204 (nada na janela). */
async function nextAction(bridge: BridgeInfo, waitMs = 5000): Promise<QueuedAction | null> {
  const response = await fetch(bridgeURL(bridge, `/office/actions?wait=${waitMs}`), {
    headers: { 'x-kolnd-token': bridge.token }
  })
  if (response.status === 204) return null
  expect(response.status, 'GET /office/actions').toBe(200)
  return (await response.json()) as QueuedAction
}

async function postResult(bridge: BridgeInfo, id: string, ok: boolean): Promise<void> {
  const response = await fetch(bridgeURL(bridge, `/office/actions/${id}/result`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kolnd-token': bridge.token },
    body: JSON.stringify(ok ? { ok: true } : { ok: false, error: 'falha simulada' })
  })
  expect(response.status, 'POST /office/actions/:id/result').toBe(200)
}

function permissionEvent(requestID = 'req_1'): Record<string, unknown> {
  return {
    type: 'permission',
    at: Date.now(),
    sessionID: SESSION_ID,
    request: {
      id: requestID,
      action: 'shell',
      resources: ['npm run verify'],
      save: ['npm run verify']
    }
  }
}

test('ações: aprovar um pedido entrega permission.reply e resolve o card', async () => {
  const ctx = loadContext()
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFullFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-agent')).toHaveCount(3)

    // Seleciona antes do evento: o pedido transforma o status em needsYou.
    await selectAgent(window, 'Trabalhando')
    const bridge = await waitForBridge(ctx)
    await postEvent(bridge, permissionEvent())

    const card = window.getByTestId('office-request')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText('Executar comando')
    await expect(card).toContainText('npm run verify')
    await expect(window.getByTestId('office-request-approve-always')).toBeVisible()

    // Chave de modo: nasce desligada e liga pelo IPC.
    const mode = window.getByTestId('office-action-mode')
    await expect(mode).toHaveAttribute('aria-checked', 'false')
    await mode.click()
    await expect(mode).toHaveAttribute('aria-checked', 'true')
    await expect(window.getByTestId('office-action-mode-label')).toHaveText('habilitadas')

    // Long-poll aberto como o plugin faria; depois o clique em Aprovar.
    const pending = nextAction(bridge)
    await card.getByTestId('office-request-approve').click()

    const action = await pending
    expect(action).toMatchObject({
      action: 'permission.reply',
      sessionID: SESSION_ID,
      requestID: 'req_1',
      decision: 'once'
    })
    await postResult(bridge, action!.id, true)

    await expect(window.getByTestId('office-request')).toContainText('Aprovado')

    // O OpenCode respondeu: o pedido sai da fila e o card desaparece.
    await postEvent(bridge, {
      type: 'permission-replied',
      at: Date.now(),
      sessionID: SESSION_ID,
      requestID: 'req_1'
    })
    await expect(window.getByTestId('office-request')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('ações: com a chave desligada nada é enfileirado (long-poll 204)', async () => {
  const ctx = loadContext()
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFullFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-agent')).toHaveCount(3)

    await selectAgent(window, 'Trabalhando')
    const bridge = await waitForBridge(ctx)
    await postEvent(bridge, permissionEvent())

    const card = window.getByTestId('office-request')
    await expect(card).toBeVisible({ timeout: 20_000 })
    const mode = window.getByTestId('office-action-mode')
    await expect(mode).toHaveAttribute('aria-checked', 'false')
    await expect(window.getByTestId('office-action-mode-label')).toHaveText('somente leitura')

    // Alvos de toque/acessibilidade: chave e botões com pelo menos 32 px.
    const modeBox = await mode.boundingBox()
    expect(modeBox?.height ?? 0).toBeGreaterThanOrEqual(32)
    const approveBox = await card.getByTestId('office-request-approve').boundingBox()
    expect(approveBox?.height ?? 0).toBeGreaterThanOrEqual(32)

    await expect(card.getByTestId('office-request-approve')).toBeDisabled()
    await expect(card.getByTestId('office-request-deny')).toBeDisabled()
    await expect(card.getByText('Ações em somente leitura')).toBeVisible()

    // Sessão ociosa: a caixa de mensagem aparece, mas o modo a deixa inerte.
    await selectAgent(window, 'Ocioso')
    const box = window.getByTestId('office-message-box')
    await expect(box).toBeVisible()
    await expect(window.getByTestId('office-message-input')).toBeDisabled()
    await expect(window.getByTestId('office-message-send')).toBeDisabled()
    await expect(box.getByText('Ações em somente leitura')).toBeVisible()

    // Nada foi enfileirado na ponte: o long-poll devolve 204.
    expect(await nextAction(bridge, 400)).toBeNull()
  } finally {
    await closeApp(app)
  }
})

test('ações: enviar mensagem mostra na fila e depois entregue, e o texto some', async () => {
  const ctx = loadContext()
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFullFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-agent')).toHaveCount(3)

    await selectAgent(window, 'Trabalhando')
    const bridge = await waitForBridge(ctx)
    // Handshake do plugin real: sem ele o main mantém as ações desabilitadas (D11).
    await postEvent(bridge, { type: 'hello', at: Date.now(), version: '1.1.0' })

    const box = window.getByTestId('office-message-box')
    await expect(box).toBeVisible()
    await expect(window.getByTestId('office-message-input')).toBeDisabled()

    const mode = window.getByTestId('office-action-mode')
    await expect(mode).toBeEnabled({ timeout: 20_000 })
    await mode.click()
    await expect(mode).toHaveAttribute('aria-checked', 'true')

    const input = window.getByTestId('office-message-input')
    await expect(input).toBeEnabled()
    await expect(window.getByTestId('office-message-send')).toBeDisabled()

    await input.fill('Revise o build, por favor')
    const pending = nextAction(bridge)
    // Enter envia (Shift+Enter é o que quebra linha).
    await input.press('Enter')

    const action = await pending
    expect(action).toMatchObject({
      action: 'session.prompt',
      sessionID: SESSION_ID,
      text: 'Revise o build, por favor'
    })

    await expect(box.getByText('na fila')).toBeVisible()

    await postResult(bridge, action!.id, true)
    await expect(window.getByTestId('office-message-status')).toContainText('entregue')
    // Privacidade: entregue ⇒ o texto não fica nem no campo.
    await expect(input).toHaveValue('')
  } finally {
    await closeApp(app)
  }
})
