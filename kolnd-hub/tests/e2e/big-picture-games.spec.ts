import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'
import type { GamepadConfig } from '../../src/shared/gamepad'

/**
 * Big Picture: grade de jogos virtualizada + navegação por teclado (D-pad).
 *
 * Electron REAL de `out/` com userData ISOLADO PRÓPRIO (`mkdtemp`, nunca o do
 * contexto global — este spec semeia um config.json com 40 jogos e um gamepad
 * válido). Stubs do contexto e2e entram no PATH (mesmo padrão do smoke).
 *
 * Cobre:
 * (a) grade visível com cards;
 * (b) virtualização: `[role="option"]` montados < total;
 * (c) ArrowRight/ArrowDown mudam o card com `aria-selected="true"` e, quando o
 *     foco passa da dobra, o `scrollTop` do container de jogos aumenta.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

const GAME_COUNT = 40

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

/**
 * Executáveis reais e DISTINTOS do Windows — o store deduplica jogos por
 * `exePath` (case-insensitive), então 40 jogos precisam de 40 caminhos.
 */
function seedExePaths(count: number): string[] {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const dirs = [
    join(systemRoot, 'System32'),
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
  ]
  const paths: string[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (paths.length >= count) break
      if (!name.toLowerCase().endsWith('.exe')) continue
      const full = join(dir, name)
      if (paths.includes(full)) continue
      paths.push(full)
    }
  }
  return paths
}

/** Config de gamepad válida (shape canônico de src/shared/gamepad.ts). */
function seededGamepad(): GamepadConfig {
  return {
    profile: 'xbox',
    controllerId: 'e2e-controller',
    controllerName: 'Controle E2E',
    mapping: {
      confirm: 0,
      back: 1,
      up: 12,
      down: 13,
      left: 14,
      right: 15,
      menu: 9,
      options: 8,
      tab_prev: 4,
      tab_next: 5,
      stick_left: 10,
      stick_right: 11
    },
    autoMapped: true,
    configuredAt: '2026-01-01T00:00:00.000Z'
  }
}

/**
 * Env do Electron: userData isolado + stubs no PATH.
 *
 * `ELECTRON_RENDERER_URL` é REMOVIDO de propósito: se o ambiente que roda o
 * Playwright o exportar (dev server aberto/electron-vite), o app carregaria o
 * Vite em vez do build de `out/` — o E2E precisa do build de produção.
 */
function launchEnv(userDataDir: string, stubsDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: userDataDir,
    PATH: `${stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
  delete env.ELECTRON_RENDERER_URL
  return env
}

test('big picture: grade virtualizada e navegação por D-pad', async () => {
  const ctx = loadContext()
  const exePaths = seedExePaths(GAME_COUNT)
  expect(exePaths.length, 'System32 precisa ter 40 executáveis distintos').toBe(GAME_COUNT)

  const userDataDir = mkdtempSync(join(tmpdir(), 'kolnd-hub-bp-e2e-'))
  // Flag de primeira execução: sem ela o app abre no wizard em vez do Dashboard.
  writeFileSync(join(userDataDir, 'first-run-complete.flag'), '1', 'utf8')
  // Config semeada: 40 jogos + controle configurado (entrada vai direto para a
  // transição ao invés do gate de setup). `projectVersion` = versão do app.
  const games = exePaths.map((exePath, index) => ({
    id: `e2e-game-${index + 1}`,
    name: `Jogo de Teste ${index + 1}`,
    exePath,
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z'
  }))
  writeFileSync(
    join(userDataDir, 'config.json'),
    JSON.stringify({ projectVersion: '1.4.0', games, gamepad: seededGamepad() }, null, 2),
    'utf8'
  )

  const electronApp = await electron.launch({
    args: ['.'],
    env: launchEnv(userDataDir, ctx.stubsDir)
  })

  try {
    const window = await electronApp.firstWindow()

    // O Hub carrega no Dashboard (first-run suprimida pela flag).
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })

    // Entrada pela UI: config válida → transição (2,9 s) → home 'active'.
    await window.getByRole('button', { name: 'Entrar no modo Big Picture' }).click()

    const listbox = window.getByRole('listbox', { name: 'Jogos na sua biblioteca' })
    await expect(listbox).toBeVisible({ timeout: 30_000 })
    // Os 40 jogos semeados chegaram (contador do cabeçalho).
    await expect(window.getByText('40 jogos', { exact: true })).toBeVisible()

    const options = listbox.getByRole('option')
    const selected = listbox.locator('[role="option"][aria-selected="true"]')

    // (a) Grade visível com cards.
    await expect(options.first()).toBeVisible()

    // (b) Virtualização ativa: só a janela (+overscan) está montada.
    const mounted = await options.count()
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(GAME_COUNT)

    // Foco determinístico no primeiro card: hover dispara `focus()` do
    // useFocusable (mesmo caminho do mouse). O foco inicial do modo pode cair
    // no item do rail quando a biblioteca chega depois do primeiro frame — uma
    // seta a partir dali poderia ir para outro grupo; o hover ancora o teste.
    await options.first().hover()
    await expect(selected).toHaveCount(1)
    const firstLabel = await options.first().getAttribute('aria-label')
    expect(await selected.getAttribute('aria-label')).toBe(firstLabel)

    // (c) ArrowRight muda o card focado (mesma linha).
    await window.keyboard.press('ArrowRight')
    await expect
      .poll(() => selected.getAttribute('aria-label'), { timeout: 10_000 })
      .not.toBe(firstLabel)

    // ArrowDown desce uma linha.
    const rowLabel = await selected.getAttribute('aria-label')
    await window.keyboard.press('ArrowDown')
    await expect
      .poll(() => selected.getAttribute('aria-label'), { timeout: 10_000 })
      .not.toBe(rowLabel)

    // Passando da dobra, o scroller da grade rola (sem mexer no <main>).
    // A barra de filtros ocupa altura acima do scroller, então a dobra pode já
    // ter rolado um pouco depois do ArrowDown — o que importa é que ela avance.
    const scroller = window.locator('[data-bp-games-scroller]')
    const scrollTopBefore = await scroller.evaluate((el) => el.scrollTop)
    for (let i = 0; i < 8; i += 1) await window.keyboard.press('ArrowDown')
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(scrollTopBefore)

    // O card focado continua montado e a janela continua menor que o total.
    await expect(selected).toHaveCount(1)
    await expect(selected).toBeVisible()
    expect(await options.count()).toBeLessThan(GAME_COUNT)
  } finally {
    await electronApp.close().catch(() => {
      try {
        electronApp.process().kill()
      } catch {
        // processo já encerrado
      }
    })
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // arquivo ainda preso (log/crashpad) — o SO limpa o tmp depois
    }
  }
})
