import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Monitor de hardware (aba Monitor em Meu PC) no Electron real.
 *
 * Confere valores medidos nesta máquina (GPU via nvidia-smi e RAM via CIM) e
 * garante que campos privilegiados degradam para "—" SEM instalar o driver:
 * o teste nunca clica em "Instalar sensores avançados" (nada de UAC/CI).
 *
 * Energia: sem driver o total precisa aparecer (CPU/plataforma estimadas +
 * GPU medida), rotulado como "estimado" e nunca abaixo da GPU.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

/** Extrai watts de um texto pt-BR ("97,1" ou "26,2 W"). NaN se não houver número. */
function parseWatts(text: string): number {
  const normalized = text.replace(/[^\d,.-]/g, '').replace(',', '.')
  return Number(normalized)
}

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

async function launchApp(): Promise<ElectronApplication> {
  const ctx = loadContext()
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
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
  await expect(window.getByRole('heading', { name: 'Monitor de hardware' })).toBeVisible()
}

test('monitor: GPU/RAM reais, specs automáticas e campos privilegiados degradam sem driver', async () => {
  test.setTimeout(180_000)
  const app = await launchApp()

  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })
    await openMonitorTab(window)

    const monitor = window.getByTestId('hw-monitor')
    await expect(monitor).toBeVisible()

    // A ação que instala os sensores avançados precisa estar visível no topo,
    // antes dos cards: o "—" de temperatura/potência da CPU não pode aparecer
    // antes do botão que o resolve (sem rolar a página).
    const advancedSensors = window.getByTestId('hw-advanced-sensors')
    await expect(advancedSensors).toBeInViewport()
    const advancedBox = await advancedSensors.boundingBox()
    const cpuModelBox = await window.getByTestId('hw-cpu-model').boundingBox()
    expect(advancedBox && cpuModelBox && advancedBox.y < cpuModelBox.y).toBe(true)

    // Desempenho/FPS: o card existe desde o primeiro render e, sem clique em
    // "Ativar", tudo fica em "—". O teste NUNCA clica no botão de FPS — ele
    // pede UAC e elevaria privilégio no CI.
    const fpsCard = window.getByTestId('fps-card')
    await expect(fpsCard).toBeVisible()
    await expect(window.getByTestId('fps-badge')).toHaveText('—')
    await expect(window.getByTestId('fps-value')).toHaveText('—')
    await expect(window.getByTestId('fps-frametime')).toHaveText('—')
    await expect(window.getByTestId('fps-process')).toHaveText('—')
    await expect(fpsCard).toContainText('Sem injeção')
    await expect(fpsCard).toContainText(/nada é injetado no jogo/i)
    const fpsStart = window.getByTestId('fps-start')
    await expect(fpsStart).toBeVisible()
    await expect(fpsStart).toContainText('permissão de administrador')
    await expect(window.getByTestId('fps-stop')).toHaveCount(0)

    // GPU e RAM medidas de verdade (nvidia-smi + CIM), sem configuração manual.
    await expect(window.getByTestId('hw-gpu-model')).toContainText('NVIDIA GeForce RTX 5060 Ti', {
      timeout: 45_000
    })
    await expect(window.getByTestId('hw-ram-installed')).toContainText('24,0 GB instalados')
    await expect(window.getByTestId('hw-cpu-model')).toContainText('AMD Ryzen 7 5700X')

    // Especificações automáticas (CPU, GPU, RAM e placa).
    await expect(monitor.getByText(/AMD Ryzen 7 5700X 8-Core Processor · 8 núcleos/)).toBeVisible()
    await expect(monitor.getByText(/NVIDIA GeForce RTX 5060 Ti · 8151 MiB/)).toBeVisible()
    await expect(monitor.getByText(/24 GB · DDR4-3200 · 3 módulos/).first()).toBeVisible()
    await expect(monitor.getByText(/B550M PRO-VDH WIFI/)).toBeVisible()

    // Ventoinha: o RPM vem da NVML (esta GPU é NVIDIA), então a linha mostra um
    // número com unidade — em repouso pode ser "0 RPM" (modo zero-fan), que é
    // leitura válida e não "—".
    await expect(window.getByTestId('hw-gpu-fan-rpm')).toHaveText(/^\d+\s*RPM$/)

    const driverBadge = window.getByTestId('hw-driver-badge')
    const driverText = (await driverBadge.innerText()).toLowerCase()

    if (driverText.includes('ativo')) {
      // Máquina de dev com driver já instalado: valores privilegiados existem.
      await expect(window.getByTestId('hw-cpu-temp')).not.toHaveText('—')
      await expect(window.getByTestId('hw-install-driver')).toHaveCount(0)
      await expect(window.getByTestId('hw-total-power-badge')).toHaveText(/medido|estimado/i)
      await expect
        .poll(async () => parseWatts(await window.getByTestId('hw-total-power').innerText()), {
          timeout: 30_000,
          intervals: [500]
        })
        .toBeGreaterThan(0)
    } else {
      // Sem driver: campos privilegiados mostram "—" e o botão de instalação
      // fica visível — mas NUNCA é clicado neste teste.
      await expect(window.getByTestId('hw-cpu-temp')).toHaveText('—')
      await expect(window.getByTestId('hw-cpu-power')).toHaveText('—')

      // Energia centralizada: total estimado com CPU/plataforma estimadas e
      // GPU medida. O total nunca fica abaixo da GPU (nunca soma um buraco).
      await expect(window.getByTestId('hw-total-power-badge')).toHaveText(/estimado/i)
      await expect
        .poll(async () => parseWatts(await window.getByTestId('hw-total-power').innerText()), {
          timeout: 30_000,
          intervals: [500]
        })
        .toBeGreaterThan(0)

      const totalWatts = parseWatts(await window.getByTestId('hw-total-power').innerText())
      const cpuWatts = parseWatts(await window.getByTestId('hw-power-cpu-value').innerText())
      const gpuWatts = parseWatts(await window.getByTestId('hw-power-gpu-value').innerText())
      const platformWatts = parseWatts(
        await window.getByTestId('hw-power-platform-value').innerText()
      )

      expect(cpuWatts).toBeGreaterThan(0)
      expect(gpuWatts).toBeGreaterThan(0)
      expect(platformWatts).toBe(30)
      expect(totalWatts).toBeGreaterThanOrEqual(gpuWatts)

      await expect(window.getByTestId('hw-power-cpu')).toContainText(/estimado/i)
      await expect(window.getByTestId('hw-power-gpu')).toContainText(/medido/i)
      await expect(window.getByTestId('hw-power-platform')).toContainText(/estimado/i)

      console.log(
        `[e2e/energia] total=${totalWatts} W · cpu=${cpuWatts} W (estimado) · gpu=${gpuWatts} W (medido) · plataforma=${platformWatts} W (estimado)`
      )

      const installButton = window.getByTestId('hw-install-driver')
      await expect(installButton).toBeVisible()
      await expect(installButton).toContainText('Instalar sensores avançados')
      await expect(installButton).toContainText('1 confirmação do Windows')
    }

    // Polling vivo: a última leitura muda sozinha (1 Hz limitado pelos sensores).
    const lastUpdated = window.getByTestId('hw-last-updated')
    const firstReading = await lastUpdated.innerText()
    await expect
      .poll(async () => lastUpdated.innerText(), { timeout: 30_000, intervals: [1000] })
      .not.toBe(firstReading)
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
