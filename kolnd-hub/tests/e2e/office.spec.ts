import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * OpenOffice no Electron real (T9) — sem o OpenCode da máquina.
 *
 * A página é alimentada por uma **fixture JSON** injetada no main
 * (`KOLDND_HUB_OFFICE_FIXTURE` + `KOLDND_HUB_TEST_USERDATA`, dupla trava em
 * `src/main/ipc/office.ts`). Nenhum dado real de sessão aparece aqui: as salas,
 * títulos, custos e tokens de `tests/e2e/fixtures/office-full.json` são
 * inventados. O e2e roda o poller de verdade, com o cliente falso no lugar do
 * CLI — o caminho da UI é o de produção.
 *
 * Datas: o fixture traz epochs fixos (revisáveis no diff) e o teste os
 * re-baseia para "agora" antes de lançar o app, senão uma sessão "idle recente"
 * cairia fora da janela de 15 min (`IDLE_VISIBLE_MS`) e viraria `ended`.
 */

const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')
const FIXTURES_DIR = join(__dirname, 'fixtures')
/** Epoch base do fixture estático; o teste desloca tudo a partir daqui. */
const BASE_EPOCH = 1_795_000_000_000

interface TimeFields {
  created?: number
  updated?: number
  busy?: number
  idle?: number
}

interface SessionFixture {
  time?: TimeFields
  [key: string]: unknown
}

interface MessageFixture {
  time?: TimeFields
  content?: Array<{ time?: TimeFields; [key: string]: unknown }>
  [key: string]: unknown
}

interface FixtureFile {
  sessions: SessionFixture[]
  messages?: Record<string, MessageFixture[]>
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

/** Copia `office-full.json` com as datas relativas a agora e devolve o caminho. */
function materializeFullFixture(ctx: E2eContext): string {
  const source = join(FIXTURES_DIR, 'office-full.json')
  const fixture = JSON.parse(readFileSync(source, 'utf8')) as FixtureFile
  const delta = Date.now() - BASE_EPOCH

  for (const session of fixture.sessions) shiftTime(session, delta)
  for (const messages of Object.values(fixture.messages ?? {})) {
    for (const message of messages) {
      shiftTime(message, delta)
      for (const part of message.content ?? []) shiftTime(part, delta)
    }
  }

  const dir = join(ctx.root, 'office-fixtures')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'office-full.runtime.json')
  writeFileSync(target, JSON.stringify(fixture), 'utf8')
  return target
}

/** Ambiente padrão do e2e (userData isolado + stubs no PATH, como os outros specs). */
function baseEnv(ctx: E2eContext): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
    PATH: `${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
}

interface DepartmentFile {
  id: string
  name: string
  agentID: string
  sessionIDs: string[]
  createdAt: number
}

/** Semeia as salas-departamento no config.json isolado antes de abrir o app. */
function seedDepartments(ctx: E2eContext, departments: DepartmentFile[]): void {
  const file = join(ctx.userDataDir, 'config.json')
  let current: Record<string, unknown>
  try {
    current = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    current = {}
  }
  current.officeDepartments = departments
  writeFileSync(file, JSON.stringify(current, null, 2), 'utf8')
}

async function launchApp(env: NodeJS.ProcessEnv): Promise<ElectronApplication> {
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

/** Abre a página Ferramentas pelo item da topbar. */
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

/** Vai de Ferramentas → card do grupo Inteligência Artificial → OpenOffice. */
async function openOfficeFromAiCard(window: Page): Promise<void> {
  await openTools(window)

  const aiGroup = window.getByRole('region', { name: 'Inteligência Artificial' })
  await expect(aiGroup).toBeVisible()
  const card = aiGroup.getByTestId('openoffice-card')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Abrir' }).click()

  await expect(window.getByTestId('openoffice-page')).toBeVisible({ timeout: 20_000 })
  await expect(window.getByRole('heading', { name: 'OpenOffice', exact: true })).toBeVisible()
}

/** Valor de um dos contadores do topo (Salas, Sessões, Trabalhando…). */
function counter(window: Page, label: string) {
  return window
    .locator('section[aria-label="Contadores do escritório"] > div')
    .filter({ hasText: label })
}

async function expectCounter(window: Page, label: string, value: string): Promise<void> {
  await expect(counter(window, label).locator('span').first()).toHaveText(value)
}

test('escritório: card de IA abre a página com 2 salas, 3 agentes e atividade', async () => {
  const ctx = loadContext()
  const fixturePath = materializeFullFixture(ctx)
  seedDepartments(ctx, [
    {
      id: 'dep_0002a001',
      name: 'kolnd-hub',
      agentID: 'general',
      sessionIDs: ['ses_e2e_office_main', 'ses_e2e_office_sub'],
      createdAt: 1
    },
    {
      id: 'dep_0002a002',
      name: 'api-core',
      agentID: 'plan',
      sessionIDs: ['ses_e2e_office_idle'],
      createdAt: 2
    }
  ])
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = fixturePath
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)

    // Contadores derivados da fixture: 2 diretórios, 3 sessões, 1 trabalhando.
    await expectCounter(window, 'Salas', '2')
    await expectCounter(window, 'Sessões', '3')
    await expectCounter(window, 'Trabalhando', '1')

    // Salas na sidebar (ordem pt-BR) e um personagem por sessão.
    const rooms = window.getByTestId('office-room')
    await expect(rooms).toHaveCount(2)
    await expect(rooms.nth(0)).toContainText('api-core')
    await expect(rooms.nth(1)).toContainText('kolnd-hub')
    await expect(window.getByTestId('office-agent')).toHaveCount(3)

    // Atividade da mensagem `shell` da sessão working (chega no tick de 3 s).
    const activity = window
      .getByTestId('office-activity')
      .filter({ hasText: 'Executando npm run verify' })
    await expect(activity).toBeVisible({ timeout: 30_000 })

    // Clicar no agente working abre os detalhes com modelo, custo e atividade.
    const working = window.getByTestId('office-agent').filter({ hasText: 'Trabalhando' })
    await expect(working).toHaveCount(1)
    await working.click()

    const details = window.getByTestId('office-details')
    await expect(details).toContainText('Ajustar verificação do build')
    await expect(details).toContainText('deepseek-v4.1-flash')
    await expect(details).toContainText('opencode-go')
    await expect(details).toContainText('US$ 0,42')
    await expect(details).toContainText('Executando npm run verify')
    await expect(details).toContainText('Trabalhando')
  } finally {
    await closeApp(app)
  }
})

test('escritório: fixture sem sessões mostra o estado vazio', async () => {
  const ctx = loadContext()
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = join(FIXTURES_DIR, 'office-empty.json')
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)

    const empty = window.getByTestId('office-empty')
    await expect(empty).toBeVisible({ timeout: 30_000 })
    await expect(empty).toContainText('Nenhuma sessão aberta')
    await expect(empty.getByRole('button', { name: 'Tentar novamente' })).toBeVisible()
    await expectCounter(window, 'Sessões', '0')
  } finally {
    await closeApp(app)
  }
})

test('escritório: CLI ausente explica o estado vazio', async () => {
  const ctx = loadContext()
  const env = baseEnv(ctx)
  // Sem fixture e com o CLI bloqueado nas duas rotas: env inexistente +
  // %LOCALAPPDATA% vazio (nesta máquina o app desktop do OpenCode existe e
  // seria encontrado no caminho padrão, quebrando o determinismo).
  delete env.KOLDND_HUB_OFFICE_FIXTURE
  env.KOLDND_HUB_OPENCODE_CLI = join(ctx.root, 'opencode-cli-inexistente.exe')
  env.LOCALAPPDATA = join(ctx.root, 'local-app-data-vazio')

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)

    const empty = window.getByTestId('office-empty')
    await expect(empty).toBeVisible({ timeout: 30_000 })
    await expect(empty).toContainText('OpenCode não encontrado')
    await expect(empty).toContainText('CLI ausente')
    await expect(empty).toContainText(/não achou o CLI do OpenCode/i)
    await expect(empty.getByRole('button', { name: 'Tentar novamente' })).toBeVisible()
  } finally {
    await closeApp(app)
  }
})
