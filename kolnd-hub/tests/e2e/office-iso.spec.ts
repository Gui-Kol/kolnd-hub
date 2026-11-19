import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * OpenOffice isométrico no Electron real (T8).
 *
 * Fixture falsa (`KOLDND_HUB_OFFICE_FIXTURE` + `KOLDND_HUB_TEST_USERDATA`) e
 * salas-departamento persistidas no config.json isolado — nenhum OpenCode real
 * é tocado. Os marcadores invisíveis do canvas expõem os alvos do clique para o
 * teste (o canvas em si é `aria-hidden`).
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

/** Fixture cheia com datas relativas a agora e pastas reais em %TEMP%. */
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
  const target = join(dir, 'office-iso.runtime.json')
  writeFileSync(target, JSON.stringify(fixture), 'utf8')
  return target
}

/**
 * Semeia as salas no config.json isolado ANTES de abrir o app. Sem isso o e2e
 * herdaria salas de um teste anterior (o userData é compartilhado na execução).
 */
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

function baseEnv(ctx: E2eContext): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
    PATH: `${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
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

/** Clica no canvas no centro de um marcador invisível do alvo. */
async function clickMarker(window: Page, selector: string): Promise<void> {
  const marker = window.locator(selector).first()
  await expect(marker).toBeVisible({ timeout: 20_000 })
  const box = await marker.boundingBox()
  expect(box).not.toBeNull()
  await window.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

function roomRow(window: Page, name: string) {
  return window.getByTestId('office-department-row').filter({ hasText: name })
}

test('iso: render isométrico, clique no boneco/sala e aparência persiste', async () => {
  const ctx = loadContext()
  seedDepartments(ctx, [])
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)

    // Render isométrico presente + "Sem sala" sintética (nenhum departamento).
    const canvas = window.getByTestId('office-canvas')
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveAttribute('data-iso', 'true')
    await expect(window.getByTestId('office-seat')).toHaveCount(3, { timeout: 20_000 })
    await expect(window.getByTestId('office-room-hit')).toHaveCount(1)
    await expect(roomRow(window, 'Sem sala')).toBeVisible()

    // Clique no boneco → popover ancorado com função/modelo e atalho Aparência.
    await clickMarker(window, `[data-testid="office-seat"][data-session-id="${MAIN}"]`)
    const popover = window.getByTestId('office-agent-popover')
    await expect(popover).toBeVisible({ timeout: 10_000 })
    await expect(popover.getByTestId('office-popover-agent')).toBeVisible()
    await expect(popover.getByTestId('office-popover-model')).toBeVisible()

    await popover.getByTestId('office-popover-appearance').click()
    const editor = window.getByTestId('office-avatar-editor')
    await expect(editor).toBeVisible()
    await expect(window.getByTestId('office-avatar-preview')).toBeVisible()

    // Troca a cor do cabelo (índice 3 — Louro) e salva.
    await window.getByTestId('office-avatar-haircolor-3').click()
    await expect(window.getByTestId('office-avatar-haircolor-3')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await window.getByTestId('office-avatar-save').click()
    await expect(editor).toHaveCount(0, { timeout: 10_000 })

    // Reabre a página: o look vem do store (persistiu no config.json).
    await window.reload()
    await openOfficeFromAiCard(window)
    await clickMarker(window, `[data-testid="office-seat"][data-session-id="${MAIN}"]`)
    await window
      .getByTestId('office-agent-popover')
      .getByTestId('office-popover-appearance')
      .click()
    await expect(window.getByTestId('office-avatar-editor')).toBeVisible()
    await expect(window.getByTestId('office-avatar-haircolor-3')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await window.getByTestId('office-avatar-reset').click()
    await window.getByTestId('office-avatar-save').click()
    await expect(window.getByTestId('office-avatar-editor')).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await closeApp(app)
  }
})

test('iso: clique na sala abre as configurações daquele departamento', async () => {
  const ctx = loadContext()
  seedDepartments(ctx, [
    {
      id: 'dep_0000b001',
      name: 'Gerentes',
      agentID: 'plan',
      sessionIDs: [MAIN],
      createdAt: 1
    }
  ])
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(roomRow(window, 'Gerentes')).toBeVisible({ timeout: 20_000 })

    await clickMarker(window, `[data-testid="office-room-hit"][data-room-id="dep_0000b001"]`)
    const dialog = window.getByTestId('office-room-dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toHaveAttribute('data-room-id', 'dep_0000b001')
    await expect(window.getByTestId('office-room-name')).toHaveValue('Gerentes')
    await expect(window.getByTestId('office-room-agent')).toHaveValue('plan')
    // A lista de membros mostra quem foi designado (main), com status.
    await expect(window.getByTestId('office-room-member')).toHaveCount(1)

    await window.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('iso: criar sala, designar, aplicar função e working fica pendente', async () => {
  const ctx = loadContext()
  seedDepartments(ctx, [])
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-seat')).toHaveCount(3, { timeout: 20_000 })

    // Criar sala com a função build (opções reais da fixture).
    await window.getByTestId('office-department-create').click()
    await window.getByTestId('office-department-name').fill('Build E2E')
    await expect(window.getByTestId('office-department-agent')).toBeEnabled()
    await window.getByTestId('office-department-agent').selectOption('build')
    await window.getByTestId('office-department-submit').click()
    await expect(window.getByTestId('office-department-dialog')).toHaveCount(0, {
      timeout: 10_000
    })
    await expect(roomRow(window, 'Build E2E')).toBeVisible()
    await expect(window.getByTestId('office-room-hit')).toHaveCount(2)

    // Abrir a sala e designar a sessão ociosa já aplicando a função.
    await roomRow(window, 'Build E2E').getByTestId('office-department-open').click()
    const dialog = window.getByTestId('office-room-dialog')
    await expect(dialog).toBeVisible()
    await window.getByTestId('office-room-designate-select').selectOption(IDLE)
    await window.getByTestId('office-room-designate').click()
    await window.getByTestId('office-room-designate-confirm').click()
    await expect(dialog).toContainText('Funcionário designado', { timeout: 10_000 })
    await expect(window.getByTestId('office-room-member')).toHaveCount(1)

    // Aplicar a função a todos: idle recebe build de verdade.
    await window.getByTestId('office-room-apply-all').click()
    await window.getByTestId('office-room-apply-confirm').click()
    await expect(dialog).toContainText('1 função(ões) aplicada(s)', { timeout: 15_000 })
    const idleMember = window.locator(
      `[data-testid="office-room-member"][data-session-id="${IDLE}"]`
    )
    await expect(idleMember).toContainText('build')

    // Designar a sessão que está trabalhando: fica PENDENTE.
    await window.getByTestId('office-room-designate-select').selectOption(MAIN)
    await window.getByTestId('office-room-designate').click()
    await window.getByTestId('office-room-designate-confirm').click()
    const workingMember = window.locator(
      `[data-testid="office-room-member"][data-session-id="${MAIN}"]`
    )
    await expect(workingMember.getByTestId('office-room-pending')).toBeVisible({
      timeout: 10_000
    })
    await expect(workingMember.getByTestId('office-room-pending')).toContainText('pendente')

    // Aplicar de novo não interrompe: continua pendente.
    await window.getByTestId('office-room-apply-all').click()
    await window.getByTestId('office-room-apply-confirm').click()
    await expect(dialog).toContainText('pendente(s) (trabalhando)', { timeout: 15_000 })
    await expect(workingMember.getByTestId('office-room-pending')).toBeVisible()
    await expect(workingMember.getByTestId('office-room-apply-one')).toBeVisible()

    // Excluir a sala devolve todos (inclusive o working) para "Sem sala".
    await window.getByTestId('office-room-delete').click()
    await window.getByTestId('office-room-delete-confirm').click()
    await expect(dialog).toHaveCount(0, { timeout: 10_000 })
    await expect(roomRow(window, 'Build E2E')).toHaveCount(0)
    await expect(roomRow(window, 'Sem sala')).toBeVisible()
    await expect(window.getByTestId('office-room-hit')).toHaveCount(1)
    await expect(window.getByTestId('office-agent-pending')).toHaveCount(0)
    await expect(window.getByTestId('office-seat')).toHaveCount(3)
  } finally {
    await closeApp(app)
  }
})

test('iso: sala com vários funcionários mostra a contagem no chip', async () => {
  const ctx = loadContext()
  // O caso "sala cheia" (8 mesas + "mais N") é coberto pelos testes puros de
  // layout; aqui garantimos que o chip agrega os três funcionários da fixture.
  seedDepartments(ctx, [
    {
      id: 'dep_0000c001',
      name: 'Todos',
      agentID: 'general',
      sessionIDs: [MAIN, IDLE, SUB],
      createdAt: 1
    }
  ])
  const env = baseEnv(ctx)
  env.KOLDND_HUB_OFFICE_FIXTURE = materializeFixture(ctx)
  delete env.KOLDND_HUB_OPENCODE_CLI

  const app = await launchApp(env)
  try {
    const window = await app.firstWindow()
    await openOfficeFromAiCard(window)
    await expect(window.getByTestId('office-seat')).toHaveCount(3, { timeout: 20_000 })
    await expect(window.getByTestId('office-room-hit')).toHaveCount(1)
    await expect(roomRow(window, 'Todos')).toContainText('3 funcionários')
  } finally {
    await closeApp(app)
  }
})
