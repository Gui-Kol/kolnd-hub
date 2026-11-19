import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Operar o OpenCode pelo OpenOffice: prompt, "entregar agora", Parar,
 * conversa, esforço (variant), visibilidade por sala e contratação.
 *
 * Tudo roda com a fixture em memória (`KOLDND_HUB_OFFICE_FIXTURE` +
 * `KOLDND_HUB_TEST_USERDATA`): nenhum OpenCode real é tocado e o texto do
 * prompt só existe no transcrito da sessão.
 */

const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')
const FIXTURES_DIR = join(__dirname, 'fixtures')
const BASE_EPOCH = 1_795_000_000_000

const MAIN = 'ses_e2e_office_main'
const IDLE = 'ses_e2e_office_idle'
const SUB = 'ses_e2e_office_sub'

interface TimeFields {
  created?: number
  updated?: number
  busy?: number
  idle?: number
}

interface FixtureFile {
  sessions: Array<{ time?: TimeFields; location?: { directory?: string }; [key: string]: unknown }>
  messages?: Record<string, Array<{ time?: TimeFields; content?: Array<{ time?: TimeFields }> }>>
  delayMs?: number
}

interface DepartmentFile {
  id: string
  name: string
  agentID: string
  sessionIDs: string[]
  createdAt: number
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

/** Fixture cheia com datas atuais e pastas reais em %TEMP% (contratar exige). */
function materializeFixture(ctx: E2eContext): string {
  const fixture = JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'office-full.json'), 'utf8')
  ) as FixtureFile
  const delta = Date.now() - BASE_EPOCH

  const rooms = new Map<string, string>([
    ['C:\\projetos\\kolnd-hub', join(ctx.root, 'projetos', 'kolnd-hub')],
    ['C:\\projetos\\api-core', join(ctx.root, 'projetos', 'api-core')]
  ])
  for (const directory of rooms.values()) mkdirSync(directory, { recursive: true })

  for (const session of fixture.sessions) {
    shiftTime(session, delta)
    const directory = session.location?.directory
    if (directory && rooms.has(directory)) session.location = { directory: rooms.get(directory) }
  }
  for (const messages of Object.values(fixture.messages ?? {})) {
    for (const message of messages) {
      shiftTime(message, delta)
      for (const part of message.content ?? []) shiftTime(part, delta)
    }
  }

  const dir = join(ctx.root, 'office-fixtures')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'office-operate.runtime.json')
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

function counter(window: Page, label: string) {
  return window
    .locator('section[aria-label="Contadores do escritório"] > div')
    .filter({ hasText: label })
}

async function expectCounter(window: Page, label: string, value: string): Promise<void> {
  await expect(counter(window, label).locator('span').first()).toHaveText(value)
}

async function selectAgent(window: Page, status: string): Promise<void> {
  const agent = window.getByTestId('office-agent').filter({ hasText: status }).first()
  await expect(agent).toBeVisible({ timeout: 30_000 })
  await agent.click()
}

const ALL_IN_ROOM: DepartmentFile = {
  id: 'dep_0005a001',
  name: 'Geral',
  agentID: 'general',
  sessionIDs: [MAIN, IDLE, SUB],
  createdAt: 1
}

test('operar: prompt, entregar agora, conversa, Parar e esforço', async () => {
  const ctx = loadContext()
  seedDepartments(ctx, [ALL_IN_ROOM])
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-agent')).toHaveCount(3, { timeout: 30_000 })

    // Prompt pelo popover do funcionário (o mesmo caminho do clique no boneco).
    await selectAgent(window, 'Ocioso')
    const popover = window.getByTestId('office-agent-popover')
    await expect(popover).toBeVisible()
    const promptInput = popover.getByTestId('office-prompt-input')
    await expect(promptInput).toBeEnabled()

    await promptInput.fill('Revise o build pelo OpenOffice')
    await promptInput.press('Enter')
    await expect(popover.getByTestId('office-prompt-status')).toContainText('enviado')
    await expect(promptInput).toHaveValue('')
    await expect(popover.getByTestId('office-transcript')).toContainText(
      'Revise o build pelo OpenOffice',
      { timeout: 10_000 }
    )
    await expect(popover.getByTestId('office-transcript')).toContainText(
      'Recebi seu pedido (queue)'
    )

    // Switch "Entregar agora": delivery `steer`.
    await popover.getByTestId('office-prompt-steer').click()
    await expect(popover.getByTestId('office-prompt-steer')).toHaveAttribute('aria-checked', 'true')
    await promptInput.fill('Aplique agora')
    await promptInput.press('Enter')
    await expect(popover.getByTestId('office-transcript')).toContainText(
      'Recebi seu pedido (steer)',
      { timeout: 10_000 }
    )

    // Parar só habilita enquanto a sessão trabalha.
    await selectAgent(window, 'Trabalhando')
    const workingPopover = window.getByTestId('office-agent-popover')
    const stop = workingPopover.getByTestId('office-prompt-stop')
    await expect(stop).toBeEnabled()
    await stop.click()
    await expect(workingPopover.getByTestId('office-prompt-stop-status')).toContainText(
      'execução parada'
    )

    // Esforço (variant) junto com o modelo no painel de detalhes.
    await selectAgent(window, 'Ocioso')
    const role = window.getByTestId('office-role')
    await expect(role).toBeVisible()
    await window.getByTestId('office-role-model').selectOption('opencode-go/qwen4-max')
    const effort = window.getByTestId('office-role-effort')
    await expect(effort).toBeEnabled()
    await effort.selectOption('xhigh')
    await window.getByTestId('office-role-save').click()
    await expect(role).toContainText('atualizada', { timeout: 10_000 })
    await expect(role).toContainText('Atual: Máximo', { timeout: 10_000 })
  } finally {
    await closeApp(app)
  }
})

test('visibilidade: fora da sala não aparece; designar traz para o escritório', async () => {
  const ctx = loadContext()
  seedDepartments(ctx, [{ ...ALL_IN_ROOM, sessionIDs: [MAIN] }])
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)

    // Contadores/canvas/sidebar só com a sessão designada.
    await expectCounter(window, 'Salas', '1')
    await expectCounter(window, 'Sessões', '1')
    await expectCounter(window, 'Trabalhando', '1')
    await expect(window.getByTestId('office-agent')).toHaveCount(1, { timeout: 30_000 })
    await expect(window.getByTestId('office-seat')).toHaveCount(1)
    await expect(window.getByTestId('office-request')).toHaveCount(0)

    // Nenhum vestígio das sessões escondidas na página.
    await expect(window.getByText('Revisar contrato de pagamento')).toHaveCount(0)
    await expect(window.getByText('Mapear testes de IPC')).toHaveCount(0)

    // A gestão vê as duas fora e consegue designar sem renderizá-las.
    await expect(window.getByTestId('office-unassigned-count')).toHaveText('2', {
      timeout: 20_000
    })
    await window.getByTestId('office-unassigned-open').click()
    const dialog = window.getByTestId('office-unassigned-dialog')
    await expect(dialog).toBeVisible()
    await expect(window.getByTestId('office-unassigned-session')).toHaveCount(2)
    await expect(window.getByTestId('office-agent')).toHaveCount(1)

    await window
      .locator(`[data-testid="office-unassigned-session"][data-session-id="${IDLE}"]`)
      .getByTestId('office-unassigned-designate')
      .click()

    await expect(window.getByTestId('office-agent')).toHaveCount(2, { timeout: 10_000 })
    await expectCounter(window, 'Sessões', '2')
    await expect(window.getByText('Revisar contrato de pagamento')).toBeVisible()
    // Fecha a gestão: a terceira continua fora e não aparece em lugar nenhum.
    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(window.getByText('Mapear testes de IPC')).toHaveCount(0)
    await expect(window.getByTestId('office-seat')).toHaveCount(2)
  } finally {
    await closeApp(app)
  }
})

test('contratar: a sessão criada já entra na sala escolhida', async () => {
  const ctx = loadContext()
  seedDepartments(ctx, [{ ...ALL_IN_ROOM, sessionIDs: [MAIN] }])
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-agent')).toHaveCount(1, { timeout: 30_000 })

    await window.getByTestId('office-roster-hire').click()
    const dialog = window.getByTestId('office-hire-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Função da sala:')
    await window.getByTestId('office-hire-title').fill('Contratado e2e')
    await expect(window.getByTestId('office-hire-directory')).not.toHaveValue('')
    await window.getByTestId('office-hire-submit').click()
    await expect(dialog).toHaveCount(0, { timeout: 10_000 })

    // Entrou direto na sala: aparece sem nenhuma designação manual.
    await expect(window.getByTestId('office-agent')).toHaveCount(2, { timeout: 10_000 })
    await expect(window.getByTestId('office-roster')).toContainText('Funcionário contratado.')

    // A sessão contratada nasce sem dados de tempo: status "Sem dados".
    const hired = window.getByTestId('office-agent').filter({ hasText: 'Sem dados' })
    await expect(hired).toHaveCount(1)
    await hired.click()
    const details = window.getByTestId('office-details')
    await expect(details).toContainText('Contratado e2e')
    await expect(details).toContainText('general')
    await expect(details).toContainText('Geral')
  } finally {
    await closeApp(app)
  }
})
