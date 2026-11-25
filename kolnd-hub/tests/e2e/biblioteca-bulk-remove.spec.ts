import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Biblioteca — remoção de jogos em lote.
 *
 * Electron REAL de `out/` com userData ISOLADO PRÓPRIO (`mkdtemp`), mesmo
 * padrão do big-picture-games.spec.ts: flag de first-run, 3 jogos semeados com
 * executáveis reais e distintos do Windows e `ELECTRON_RENDERER_URL` removido
 * do env (o E2E tem que rodar o build de produção).
 *
 * Cobre: navegar até a Biblioteca, entrar no modo de seleção, selecionar 2,
 * cancelar a confirmação (nada muda) e confirmar → resta 1 card e o
 * `config.json` fica com 1 jogo.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

const GAME_COUNT = 3

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

/** Nomes (sem `.exe`, minúsculos) dos processos em execução agora. */
function runningExeNames(): Set<string> {
  const names = new Set<string>()
  try {
    const output = execFileSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' })
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^"([^"]+)"/)
      if (match) names.add(match[1].replace(/\.exe$/i, '').toLowerCase())
    }
  } catch {
    // Sem tasklist, segue sem filtro — melhor esforço só para o teste.
  }
  return names
}

/**
 * Executáveis reais e DISTINTOS do Windows (o store deduplica por `exePath`).
 * Ignora processos já em execução: um jogo "aberto" mudaria a grade (shelf
 * "Em execução agora") e duplicaria o nome do card para os seletores.
 */
function seedExePaths(count: number): string[] {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const running = runningExeNames()
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
      if (running.has(name.replace(/\.exe$/i, '').toLowerCase())) continue
      const full = join(dir, name)
      if (paths.includes(full)) continue
      paths.push(full)
    }
  }
  return paths
}

/** Env do Electron: remove `ELECTRON_RENDERER_URL` para carregar o build de `out/`. */
function launchEnv(userDataDir: string, stubsDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: userDataDir,
    PATH: `${stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
  delete env.ELECTRON_RENDERER_URL
  return env
}

test('biblioteca: remover jogos em lote com confirmação', async () => {
  const ctx = loadContext()
  const exePaths = seedExePaths(GAME_COUNT)
  expect(exePaths.length, 'System32 precisa ter 3 executáveis distintos').toBe(GAME_COUNT)

  const userDataDir = mkdtempSync(join(tmpdir(), 'kolnd-hub-bulk-e2e-'))
  // Flag de primeira execução: sem ela o app abre no wizard em vez do Dashboard.
  writeFileSync(join(userDataDir, 'first-run-complete.flag'), '1', 'utf8')

  const games = exePaths.map((exePath, index) => ({
    id: `e2e-bulk-${index + 1}`,
    name: `Jogo de Teste ${index + 1}`,
    exePath,
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z'
  }))
  writeFileSync(
    join(userDataDir, 'config.json'),
    JSON.stringify({ projectVersion: '1.4.0', games }, null, 2),
    'utf8'
  )

  const electronApp = await electron.launch({
    args: ['.'],
    env: launchEnv(userDataDir, ctx.stubsDir)
  })

  try {
    const window = await electronApp.firstWindow()

    // 1) Shell abre no Dashboard; mega menu → Biblioteca.
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })
    await window.getByRole('button', { name: 'Mais' }).click()
    await window
      .locator('#topbar-mais-menu')
      .getByRole('button', { name: /Biblioteca/ })
      .click()
    await expect(window.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible()

    // Cards só existem depois da lista carregar. Fora do modo de seleção o
    // card é descrito por "Jogar <nome>"; dentro dele o aria-label manda.
    await expect(window.getByRole('button', { description: /^Jogar Jogo de Teste/ })).toHaveCount(
      GAME_COUNT,
      { timeout: 30_000 }
    )
    const card = (index: number) =>
      window.getByRole('button', {
        name: new RegExp(`^(Selecionar|Desmarcar) Jogo de Teste ${index}$`)
      })

    // 2) Entra no modo de seleção e marca 2 jogos.
    await window.locator('[data-testid="biblioteca-select-toggle"]').click()
    const selectionBar = window.locator('[data-testid="biblioteca-selection-bar"]')
    await expect(selectionBar).toBeVisible()
    await card(1).click()
    await card(2).click()
    await expect(selectionBar).toContainText('2 selecionados')
    await expect(card(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(card(3)).toHaveAttribute('aria-pressed', 'false')

    // 3) Abre o modal e CANCELA: os 3 continuam na biblioteca.
    await window.locator('[data-testid="biblioteca-remove-selected"]').click()
    const modal = window.locator('[data-testid="biblioteca-remove-modal"]')
    await expect(modal).toBeVisible()
    await expect(
      window.getByRole('dialog', { name: 'Remover 2 jogos da biblioteca?' })
    ).toBeVisible()
    await expect(modal).toContainText('Os arquivos dos jogos NÃO serão apagados do computador.')
    await window.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(modal).toHaveCount(0)
    await expect(
      window.getByRole('button', { name: /^(Selecionar|Desmarcar) Jogo de Teste \d$/ })
    ).toHaveCount(GAME_COUNT)

    // 4) Reabre e confirma a remoção dos 2 selecionados.
    await window.locator('[data-testid="biblioteca-remove-selected"]').click()
    await expect(modal).toBeVisible()
    await window.locator('[data-testid="biblioteca-remove-confirm"]').click()

    // Sai do modo, resta só o jogo não selecionado e o toast confirma o lote.
    await expect(window.getByRole('button', { description: /^Jogar Jogo de Teste/ })).toHaveCount(1)
    await expect(window.getByText('Jogo de Teste 3', { exact: true })).toBeVisible()
    await expect(window.getByText('Jogo de Teste 1', { exact: true })).toHaveCount(0)
    await expect(selectionBar).toHaveCount(0)
    await expect(window.getByText('2 jogos removidos da biblioteca')).toBeVisible()

    // 5) O store persistiu a remoção numa única escrita (config.json com 1 jogo).
    await expect
      .poll(
        () => {
          const config = JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8')) as {
            games?: Array<{ id: string }>
          }
          return config.games?.map((game) => game.id)
        },
        { timeout: 15_000 }
      )
      .toEqual(['e2e-bulk-3'])
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
