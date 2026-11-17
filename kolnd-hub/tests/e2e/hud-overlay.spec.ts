import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Sobreposição (HUD) no Electron real.
 *
 * Verifica o caminho completo: atalho global registrado, janela transparente
 * always-on-top criada sem foco, HUD sem título no canto superior esquerdo,
 * largura configurável + altura automática, todas as seções e FPS automático
 * lido de `KOLDND_HUB_FPS_DIR` (sink do agent, sem UAC no teste).
 *
 * O teste NUNCA depende de UAC nem instala driver/tarefa: lê o snapshot nativo
 * do `hwmon` (CPU/RAM sempre disponíveis) e escreve a amostra de FPS direto no
 * arquivo `latest.json` que o agent produziria.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

const TEST_SHORTCUT = 'Control+Alt+Shift+F11'
const ALT_TEST_SHORTCUT = 'Control+Alt+Shift+F12'
const TEST_FPS = 60
const TEST_FRAMETIME = 16.7

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

async function launchApp(fpsDir: string): Promise<ElectronApplication> {
  const ctx = loadContext()
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
      // Sink do agent: o main lê este diretório sem privilégio (o E2E escreve).
      KOLDND_HUB_FPS_DIR: fpsDir,
      PATH: `${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
    }
  })
}

async function openMonitorTab(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Meu PC' }).click()
  await expect(window.getByText('Manutenção e inicialização do seu PC')).toBeVisible({
    timeout: 15_000
  })
  await window.getByRole('tab', { name: 'Monitor' }).click()
  await expect(window.getByTestId('hud-settings')).toBeVisible({ timeout: 15_000 })
}

/** Aguarda a janela `#hud` existir entre as janelas do app. */
async function waitForHudPage(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const hud = app.windows().find((page) => page.url().includes('#hud'))
    if (hud) return hud
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('janela da sobreposição (#hud) não abriu')
}

interface HudWindowInfo {
  visible: boolean
  alwaysOnTop: boolean
  focusable: boolean
  focused: boolean
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
}

async function hudWindowInfo(app: ElectronApplication): Promise<HudWindowInfo | null> {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes('#hud')
    )
    if (!window) return null
    return {
      visible: window.isVisible(),
      alwaysOnTop: window.isAlwaysOnTop(),
      focusable: window.isFocusable(),
      focused: window.isFocused(),
      bounds: window.getBounds(),
      workArea: screen.getPrimaryDisplay().workArea
    }
  })
}

async function shortcutState(
  app: ElectronApplication,
  accelerators: string[]
): Promise<Record<string, boolean>> {
  return app.evaluate(({ globalShortcut }, list) => {
    const out: Record<string, boolean> = {}
    for (const accelerator of list) out[accelerator] = globalShortcut.isRegistered(accelerator)
    return out
  }, accelerators)
}

/** Escreve a amostra que o agent gravaria (atômica o suficiente para o teste). */
function writeFpsSample(fpsDir: string, timestamp: string): void {
  mkdirSync(fpsDir, { recursive: true })
  writeFileSync(
    join(fpsDir, 'latest.json'),
    JSON.stringify({
      pid: 4242,
      name: 'e2e-game.exe',
      fps: TEST_FPS,
      frametimeMs: TEST_FRAMETIME,
      timestamp
    }),
    'utf8'
  )
}

test('sobreposição (HUD): sem título, canto superior esquerdo, tamanho e FPS automático', async () => {
  test.setTimeout(300_000)
  const ctx = loadContext()
  const fpsDir = join(ctx.root, 'fps-auto')
  mkdirSync(fpsDir, { recursive: true })
  const app = await launchApp(fpsDir)

  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })
    await openMonitorTab(window)

    // Seção de configuração visível. O userData do E2E é compartilhado entre
    // execuções; o botão "Restaurar padrão" valida o fluxo e, se o padrão
    // estiver ocupado na máquina, o app precisa avisar SEM ficar sem atalho.
    await expect(window.getByTestId('hud-visible-switch')).toBeVisible()
    await expect(window.getByTestId('hud-settings')).toContainText(/borderless/i)
    await window.getByTestId('hud-shortcut-reset').click()
    await expect(window.getByTestId('hud-shortcut-reset')).toBeEnabled()

    const afterReset = await window.evaluate(() => window.api.hudGet())
    expect(afterReset.registered).toBe(true)
    if (afterReset.config.shortcut === 'Shift+Insert') {
      await expect(window.getByTestId('hud-shortcut-value')).toHaveText('Shift + Insert')
      await expect(window.getByTestId('hud-status')).toHaveText('atalho registrado')
    } else {
      // Padrão em uso por outro programa: erro amigável e atalho anterior mantido.
      await expect(window.getByTestId('hud-error')).toContainText(/em uso/i)
      console.log(
        `[e2e/hud] padrão indisponível nesta máquina - mantido ${afterReset.config.shortcut}`
      )
    }

    // Configuração de tamanho na UI (T4): largura, escala e restaurar.
    await expect(window.getByTestId('hud-width-select')).toBeVisible()
    await expect(window.getByTestId('hud-position')).toContainText(/canto superior esquerdo/i)

    // (a) IPC cria a janela visível (nunca `show()`) com a amostra fresca.
    writeFpsSample(fpsDir, new Date().toISOString())
    await window.evaluate(() => window.api.hudSetVisible(true))
    const hud = await waitForHudPage(app)
    await expect(hud.getByTestId('hud-overlay')).toBeVisible({ timeout: 30_000 })

    // (b) Sem título ("KOLND HUB · MONITOR") e com todas as seções.
    const overlayText = await hud.getByTestId('hud-overlay').innerText()
    expect(overlayText.toLowerCase()).not.toContain('kolnd hub')
    for (const testId of [
      'hud-fps',
      'hud-frametime',
      'hud-cpu',
      'hud-gpu',
      'hud-ram',
      'hud-energy'
    ]) {
      await expect(hud.getByTestId(testId)).toBeVisible()
    }

    const info = await hudWindowInfo(app)
    expect(info, 'janela do HUD não encontrada no main').not.toBeNull()
    expect(info!.visible).toBe(true)
    expect(info!.alwaysOnTop).toBe(true)
    expect(info!.focusable).toBe(false)
    expect(info!.focused).toBe(false)

    // (c) Canto superior ESQUERDO (margem 12), largura padrão 300 e altura
    // automática (medida do conteúdo, longe dos 240 fixos antigos).
    expect(info!.bounds.x).toBe(info!.workArea.x + 12)
    expect(info!.bounds.y).toBe(info!.workArea.y + 12)
    expect(info!.bounds.x - info!.workArea.x).toBeLessThanOrEqual(16)
    expect(info!.bounds.y - info!.workArea.y).toBeLessThanOrEqual(16)
    expect(info!.bounds.width).toBe(300)
    expect(info!.bounds.height).toBeGreaterThanOrEqual(120)
    expect(info!.bounds.height).toBeLessThanOrEqual(900)

    const contentHeight = await hud.evaluate(
      () =>
        document.querySelector('[data-testid="hud-overlay"]')?.getBoundingClientRect().height ?? 0
    )
    expect(Math.abs(info!.bounds.height - contentHeight)).toBeLessThanOrEqual(2)

    // (d) FPS automático via `latest.json` (sem UAC, sem tarefa).
    writeFpsSample(fpsDir, new Date().toISOString())
    await expect
      .poll(async () => hud.getByTestId('hud-fps').innerText(), {
        timeout: 20_000,
        intervals: [500]
      })
      .toBe('60')
    await expect(hud.getByTestId('hud-frametime')).toContainText('16,7')
    await expect(hud.getByTestId('hud-cpu-usage')).not.toHaveText('—')
    await expect(hud.getByTestId('hud-ram')).not.toHaveText('—')

    console.log(
      `[e2e/hud] visível · alwaysOnTop=${info!.alwaysOnTop} · focusable=${info!.focusable}` +
        ` · bounds=${info!.bounds.width}×${info!.bounds.height}@${info!.bounds.x},${info!.bounds.y}` +
        ` · conteúdo=${contentHeight}px · fps=${await hud.getByTestId('hud-fps').innerText()}` +
        ` · frametime=${await hud.getByTestId('hud-frametime').innerText()}`
    )

    // (e) Largura configurável via IPC: janela acompanha na hora.
    const resized = await window.evaluate(() => window.api.hudSetSize({ width: 420 }))
    expect(resized.success).toBe(true)
    expect(resized.status.config.width).toBe(420)
    await expect
      .poll(async () => (await hudWindowInfo(app))?.bounds.width ?? 0, {
        timeout: 10_000,
        intervals: [200]
      })
      .toBe(420)

    // Escala também persiste e não corta: a altura é remedida após a mudança.
    const scaled = await window.evaluate(() => window.api.hudSetSize({ scale: 'grande' }))
    expect(scaled.success).toBe(true)
    expect(scaled.status.config.scale).toBe('grande')
    await expect
      .poll(
        async () => {
          const current = await hudWindowInfo(app)
          const height = await hud.evaluate(
            () =>
              document.querySelector('[data-testid="hud-overlay"]')?.getBoundingClientRect()
                .height ?? 0
          )
          return current ? Math.abs(current.bounds.height - height) : 999
        },
        { timeout: 10_000, intervals: [300] }
      )
      .toBeLessThanOrEqual(2)

    // "Restaurar tamanho padrão" volta para 300 px / normal pela UI.
    await window.getByTestId('hud-size-reset').click()
    await expect
      .poll(async () => (await hudWindowInfo(app))?.bounds.width ?? 0, {
        timeout: 10_000,
        intervals: [200]
      })
      .toBe(300)
    const restored = await window.evaluate(() => window.api.hudGet())
    expect(restored.config.scale).toBe('normal')

    // (f) Amostra velha (> 3 s) vira "—": nunca inventa FPS.
    writeFpsSample(fpsDir, new Date(Date.now() - 10_000).toISOString())
    await expect
      .poll(async () => hud.getByTestId('hud-fps').innerText(), {
        timeout: 15_000,
        intervals: [500]
      })
      .toBe('—')
    await expect(hud.getByTestId('hud-frametime')).toHaveText('—')

    // (g) Ocultar pelo IPC esconde a janela.
    await window.evaluate(() => window.api.hudSetVisible(false))
    await expect
      .poll(async () => (await hudWindowInfo(app))?.visible ?? false, {
        timeout: 20_000,
        intervals: [250]
      })
      .toBe(false)

    // Configuração pela UI: switch mostra e esconde (respostas atualizam o estado).
    await window.getByTestId('hud-visible-switch').click()
    await expect
      .poll(async () => (await hudWindowInfo(app))?.visible ?? false, {
        timeout: 20_000,
        intervals: [250]
      })
      .toBe(true)
    await window.getByTestId('hud-visible-switch').click()
    await expect
      .poll(async () => (await hudWindowInfo(app))?.visible ?? false, {
        timeout: 20_000,
        intervals: [250]
      })
      .toBe(false)

    // (h) Gravador da UI troca o atalho: o antigo é desregistrado e o novo entra.
    const current = await window.evaluate(() => window.api.hudGet())
    const currentShortcut = current.config.shortcut
    const targetShortcut = currentShortcut === TEST_SHORTCUT ? ALT_TEST_SHORTCUT : TEST_SHORTCUT
    const targetLabel =
      targetShortcut === TEST_SHORTCUT ? 'Ctrl + Alt + Shift + F11' : 'Ctrl + Alt + Shift + F12'

    await window.getByTestId('hud-shortcut-record').click()
    await window.keyboard.press(targetShortcut)
    await expect(window.getByTestId('hud-shortcut-value')).toHaveText(targetLabel)

    await expect
      .poll(async () => shortcutState(app, [currentShortcut, targetShortcut]), {
        timeout: 15_000,
        intervals: [250]
      })
      .toEqual({ [currentShortcut]: false, [targetShortcut]: true })

    // (i) Encerrar o app não deixa atalho nem janela órfãos: reabrir registra o
    // atalho e o tamanho persistidos (se o processo anterior segurasse o hotkey,
    // falharia).
    await app.close()
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const reopened = await launchApp(fpsDir)
    try {
      const main = await reopened.firstWindow()
      await expect(main.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
        timeout: 45_000
      })
      const status = await main.evaluate(() => window.api.hudGet())
      expect(status.config.shortcut).toBe(targetShortcut)
      expect(status.config.visible).toBe(false)
      expect(status.config.width).toBe(300)
      expect(status.config.scale).toBe('normal')
      expect(status.registered).toBe(true)
      expect(reopened.windows().filter((page) => page.url().includes('#hud'))).toHaveLength(0)
      console.log(
        `[e2e/hud] reabertura: atalho=${status.config.shortcut} registrado=${status.registered}` +
          ` visível=${status.config.visible} tamanho=${status.config.width}px/${status.config.scale}`
      )

      // Devolve o padrão para as próximas execuções não herdarem o atalho de teste.
      await main.evaluate(() => window.api.hudSetShortcut('Shift+Insert'))
    } finally {
      await reopened.close().catch(() => undefined)
    }
  } finally {
    await app.close().catch(() => {
      try {
        app.process().kill()
      } catch {
        // já encerrado
      }
    })
  }
})
