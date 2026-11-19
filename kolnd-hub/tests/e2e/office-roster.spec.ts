import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Gestão de funcionários do OpenOffice (T6) — sem OpenCode real.
 *
 * A fixture é a mesma de `office.spec.ts`, mas com as salas reescritas para
 * pastas temporárias DE VERDADE: o IPC recusa contratar numa pasta que não
 * existe (a validação roda também no e2e, como em produção). Contratar,
 * arquivar/restaurar e dar função exercitam o caminho renderer → IPC →
 * cliente falso → poller.
 */

const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')
const FIXTURES_DIR = join(__dirname, 'fixtures')
const BASE_EPOCH = 1_795_000_000_000

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

/**
 * Materializa a fixture cheia com datas relativas a agora e salas reais em
 * `%TEMP%` (o IPC exige diretório existente para contratar).
 */
function materializeRosterFixture(ctx: E2eContext): string {
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
    if (directory && rooms.has(directory)) {
      session.location = { directory: rooms.get(directory) }
    }
  }
  for (const messages of Object.values(fixture.messages ?? {})) {
    for (const message of messages) {
      shiftTime(message, delta)
      for (const part of message.content ?? []) shiftTime(part, delta)
    }
  }

  const dir = join(ctx.root, 'office-fixtures')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'office-roster.runtime.json')
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

const DEPARTMENTS: DepartmentFile[] = [
  {
    id: 'dep_0003a001',
    name: 'kolnd-hub',
    agentID: 'general',
    sessionIDs: ['ses_e2e_office_main', 'ses_e2e_office_sub'],
    createdAt: 1
  },
  {
    id: 'dep_0003a002',
    name: 'api-core',
    agentID: 'plan',
    sessionIDs: ['ses_e2e_office_idle'],
    createdAt: 2
  }
]

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

async function selectAgentByStatus(window: Page, status: string): Promise<void> {
  const agent = window.getByTestId('office-agent').filter({ hasText: status }).first()
  await expect(agent).toBeVisible({ timeout: 30_000 })
  await agent.click()
  await expect(window.getByTestId('office-details')).toBeVisible()
}

test('funcionários: contratar cria a sessão com a função e o modelo escolhidos', async () => {
  const ctx = loadContext()
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeRosterFixture(ctx)
  seedDepartments(ctx, DEPARTMENTS)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-roster')).toBeVisible()
    await expect(window.getByTestId('office-agent')).toHaveCount(3)

    await window.getByTestId('office-roster-hire').click()
    const dialog = window.getByTestId('office-hire-dialog')
    await expect(dialog).toBeVisible()

    await window.getByTestId('office-hire-title').fill('Contratar dev e2e')

    const agentSelect = window.getByTestId('office-hire-agent')
    await expect(agentSelect).toBeEnabled()
    await agentSelect.selectOption('build')
    await window.getByTestId('office-hire-model').selectOption('opencode-go/qwen4-max')

    await window.getByTestId('office-hire-submit').click()
    await expect(dialog).toHaveCount(0)

    // O poller relê o cliente falso logo após criar: 4 personagens.
    await expect(window.getByTestId('office-agent')).toHaveCount(4, { timeout: 10_000 })

    // A sessão nova é a única com o modelo escolhido; detalhes mostram o nome.
    const hired = window.getByTestId('office-agent').filter({ hasText: 'qwen4-max' })
    await expect(hired).toHaveCount(1)
    await hired.click()

    const details = window.getByTestId('office-details')
    await expect(details).toContainText('Contratar dev e2e')
    await expect(details).toContainText('build')
    await expect(details).toContainText('qwen4-max')
    await expect(window.getByTestId('office-roster')).toContainText('Funcionário contratado.')
  } finally {
    await closeApp(app)
  }
})

test('funcionários: apagar todos arquiva, pula quem trabalha e permite restaurar', async () => {
  const ctx = loadContext()
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeRosterFixture(ctx)
  seedDepartments(ctx, DEPARTMENTS)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-agent')).toHaveCount(3)

    await window.getByTestId('office-roster-archive-all').click()
    const dialog = window.getByTestId('office-archive-dialog')
    await expect(dialog).toBeVisible()
    // Fixture: 1 trabalhando + 2 ociosos (um deles subagente).
    await expect(window.getByTestId('office-archive-targets')).toHaveText('2')
    await expect(window.getByTestId('office-archive-skipped')).toHaveText('1')

    await window.getByTestId('office-archive-confirm-input').fill('APAGAR')
    await window.getByTestId('office-archive-confirm').click()

    const result = window.getByTestId('office-archive-result')
    await expect(result).toContainText('2 arquivado(s)')
    await expect(result).toContainText('1 mantido(s)')
    await window.getByTestId('office-archive-close').click()

    // Só quem estava trabalhando continua no escritório.
    await expect(window.getByTestId('office-agent')).toHaveCount(1)
    await expect(window.getByTestId('office-agent').first()).toContainText('Trabalhando')

    const archivedButton = window.getByTestId('office-roster-archived')
    await expect(archivedButton).toContainText('Arquivados (2)')
    await archivedButton.click()

    const rows = window.getByTestId('office-archived-row')
    await expect(rows).toHaveCount(2)
    await rows.first().getByTestId('office-archived-restore').click()
    await expect(window.getByTestId('office-archived-row')).toHaveCount(1)
    await window.getByTestId('office-archived-close').click()

    // Restaurado volta a ser personagem no escritório.
    await expect(window.getByTestId('office-agent')).toHaveCount(2, { timeout: 10_000 })
  } finally {
    await closeApp(app)
  }
})

test('funcionários: dar função troca agente/modelo e working bloqueia a troca', async () => {
  const ctx = loadContext()
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeRosterFixture(ctx)
  seedDepartments(ctx, DEPARTMENTS)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-agent')).toHaveCount(3)

    // Sessão ociosa: troca de função liberada.
    await selectAgentByStatus(window, 'Ocioso')
    const role = window.getByTestId('office-role')
    await expect(role).toBeVisible()

    const agentSelect = window.getByTestId('office-role-agent')
    await expect(agentSelect).toBeEnabled()
    await agentSelect.selectOption('build')
    await window.getByTestId('office-role-model').selectOption('opencode-go/qwen4-max')
    await window.getByTestId('office-role-save').click()

    await expect(role).toContainText('atualizada')
    // O snapshot atualizado passa a mostrar o novo modelo na lista lateral.
    await expect(window.getByTestId('office-agent').filter({ hasText: 'qwen4-max' })).toHaveCount(
      1,
      { timeout: 10_000 }
    )

    // Sessão trabalhando: a UI bloqueia com explicação.
    await selectAgentByStatus(window, 'Trabalhando')
    await expect(window.getByTestId('office-role-working')).toBeVisible()
    await expect(window.getByTestId('office-role-working')).toContainText(
      'espere a tarefa terminar'
    )
    await expect(window.getByTestId('office-role-agent')).toBeDisabled()
    await expect(window.getByTestId('office-role-save')).toBeDisabled()
  } finally {
    await closeApp(app)
  }
})
