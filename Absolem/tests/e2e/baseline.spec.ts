/// <reference lib="dom" />
import { expect, test, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { AbsolemApi } from '../../src/shared/ipc'

declare global {
  interface Window {
    absolem: AbsolemApi
    __absolemAvatarMetrics?: () => {
      fps: number
      frameMs: number
      drawCalls: number
      triangles: number
      degradation: number
    }
  }
}

const APP_ROOT = resolve(__dirname, '../..')
const PACKAGED_APP = join(APP_ROOT, 'dist', 'win-unpacked', 'Absolem.exe')
const WARMUP_IDLE_MS = 2_000
const WARMUP_OVERLAY_MS = 5_000
const CYCLE_COUNT = 50
const SYNTHETIC_OPERATION_TIMEOUT_MS = 5_000
const VOICE_LISTENING_TIMEOUT_MS = 2_000
const AUDIO_SAMPLES = 3
const BARGE_SAMPLES = 5
const TOKEN_SAMPLES = 3
const CAPTURE_SAMPLES = 3

type Sample = { scenario: string; ms: number }
type ProcessSnapshot = {
  cpu: { user: number; system: number }
  rss: number
  heap: number
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function summarize(samples: Sample[]) {
  return Object.entries(
    samples.reduce<Record<string, number[]>>((groups, sample) => {
      ;(groups[sample.scenario] ??= []).push(sample.ms)
      return groups
    }, {})
  ).map(([scenario, values]) => ({
    scenario,
    samples: values.length,
    p50Ms: Math.round(percentile(values, 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(values, 0.95) * 10) / 10
  }))
}

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), SYNTHETIC_OPERATION_TIMEOUT_MS)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function processSnapshot(electronApp: ElectronApplication): Promise<ProcessSnapshot> {
  return electronApp.evaluate(() => {
    const memory = process.memoryUsage()
    const cpu = process.cpuUsage()
    return {
      cpu,
      rss: memory.rss,
      heap: memory.heapUsed
    }
  })
}

/** Espera o estado de voz sair de `connecting`; `false` em erro/timeout. */
async function waitForVoiceListening(settings: Page): Promise<boolean> {
  const deadline = performance.now() + VOICE_LISTENING_TIMEOUT_MS
  while (performance.now() < deadline) {
    const result = await settings.evaluate(() => window.absolem.voice.status())
    if (!('status' in result) || !result.status) return false
    const state = result.status.state
    if (state === 'listening' || state === 'thinking' || state === 'speaking') return true
    if (state === 'error' || state === 'off') return false
    await settings.waitForTimeout(20)
  }
  return false
}

/** Um turno de chat completo: envio + resposta fake + `chat:done`. */
async function chatRoundTrip(settings: Page, requestId: string): Promise<boolean> {
  return withTimeout(
    settings.evaluate(async (id) => {
      const done = new Promise<void>((resolve) => {
        const off = window.absolem.chat.onDone((event) => {
          if (event.requestId === id) {
            off()
            resolve()
          }
        })
      })
      const sent = await window.absolem.chat.send(id, 'mensagem sintetica de baseline')
      if (!sent.ok) return false
      await done
      return true
    }, requestId),
    false
  )
}

/**
 * Uma captura completa: `capture:ask` -> overlay captura o frame real pelo
 * renderer -> Live fake responde -> `chat:done` com o mesmo requestId. O frame
 * nunca sai da memória local nem toca a rede.
 */
async function captureRoundTrip(settings: Page, requestId: string): Promise<boolean> {
  const completed = await withTimeout(
    settings.evaluate(async (id) => {
      const done = new Promise<void>((resolve) => {
        const off = window.absolem.chat.onDone((event) => {
          if (event.requestId === id) {
            off()
            resolve()
          }
        })
      })
      const asked = await window.absolem.capture.ask({
        requestId: id,
        kind: 'screen',
        question: 'pergunta sintetica de baseline'
      })
      if (!asked.ok) return false
      await done
      return true
    }, requestId),
    false
  )
  if (!completed) {
    await settings.evaluate(
      (id) => window.absolem.capture.cancel({ requestId: id, kind: 'ask' }),
      requestId
    )
  }
  return completed
}

test('baseline local: boot, overlay, voz/captura fake, idle, ciclos e shutdown', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'absolem-baseline-'))
  const samples: Sample[] = []
  const launchedAt = performance.now()
  const electronApp = await electron.launch({
    ...(existsSync(PACKAGED_APP) && process.env.ABSOLEM_BASELINE_PACKAGED === '1'
      ? { executablePath: PACKAGED_APP, args: [] }
      : { args: [APP_ROOT] }),
    cwd: APP_ROOT,
    env: {
      ...process.env,
      ABSOLEM_TEST_USERDATA: userData,
      ABSOLEM_TEST_TRANSPORT: 'fake'
    }
  })

  try {
    const settings = await electronApp.firstWindow()
    await settings.waitForLoadState('domcontentloaded')
    await expect(settings).toHaveURL(/#settings/)
    samples.push({ scenario: 'boot-primeira-janela', ms: performance.now() - launchedAt })

    const idleBefore = await processSnapshot(electronApp)
    await settings.waitForTimeout(WARMUP_IDLE_MS)
    const idleAfter = await processSnapshot(electronApp)
    samples.push({ scenario: 'idle', ms: WARMUP_IDLE_MS })

    const overlayStarted = performance.now()
    const overlayPromise = electronApp.waitForEvent('window')
    await settings.evaluate(() => window.absolem.overlayShow())
    const overlay = await overlayPromise
    await overlay.waitForLoadState('domcontentloaded')
    samples.push({ scenario: 'primeiro-overlay', ms: performance.now() - overlayStarted })
    await overlay.waitForTimeout(WARMUP_OVERLAY_MS)

    const overlayMetrics = await overlay.evaluate(() => window.__absolemAvatarMetrics?.() ?? null)

    // Voz: consentimento persistido no userData temporário (sem diálogo) e
    // sessão Live fake, que conecta sem rede/chave real.
    await settings.evaluate(() => window.absolem.voice.setConsent(true))
    for (let index = 0; index < AUDIO_SAMPLES; index += 1) {
      const audioStarted = performance.now()
      const startStatus = await settings.evaluate(() => window.absolem.voice.start())
      const listening = await waitForVoiceListening(settings)
      if (!listening) {
        const finalStatus = await settings.evaluate(() => window.absolem.voice.status())
        expect(
          listening,
          `voz fake não abriu sessão (start=${JSON.stringify(startStatus)} final=${JSON.stringify(finalStatus)})`
        ).toBe(true)
      }
      samples.push({ scenario: 'primeiro-audio-fake', ms: performance.now() - audioStarted })
      if (index === 0) {
        // Sessão ativa: mede barge-in no caminho real (interrupt no Live).
        for (let barge = 0; barge < BARGE_SAMPLES; barge += 1) {
          const bargeStarted = performance.now()
          await settings.evaluate(() => {
            window.absolem.voice.sendAudioChunk(new Uint8Array(320))
            window.absolem.voice.sendBargeIn()
          })
          samples.push({ scenario: 'barge-in-fake', ms: performance.now() - bargeStarted })
        }
      }
      await settings.evaluate(() => window.absolem.voice.stop())
      await settings.waitForTimeout(150)
    }

    for (let index = 0; index < TOKEN_SAMPLES; index += 1) {
      const chatStarted = performance.now()
      const completed = await chatRoundTrip(settings, `baseline-chat-${index + 1}`)
      expect(completed, `chat fake não concluiu (${index + 1}/${TOKEN_SAMPLES})`).toBe(true)
      samples.push({ scenario: 'primeiro-token-fake', ms: performance.now() - chatStarted })
    }

    for (let index = 0; index < CAPTURE_SAMPLES; index += 1) {
      const captureStarted = performance.now()
      const completed = await captureRoundTrip(settings, `baseline-capture-${index + 1}`)
      expect(completed, `captura fake não concluiu (${index + 1}/${CAPTURE_SAMPLES})`).toBe(true)
      samples.push({ scenario: 'captura-fake', ms: performance.now() - captureStarted })
    }

    const cyclesStarted = performance.now()
    for (let index = 0; index < CYCLE_COUNT; index += 1) {
      await settings.evaluate(async () => {
        await window.absolem.overlayHide()
        await window.absolem.overlayShow()
      })
    }
    samples.push({ scenario: 'ciclos-overlay-50', ms: performance.now() - cyclesStarted })

    const afterCycles = await processSnapshot(electronApp)
    const cpuMs = (idleAfter.cpu.user - idleBefore.cpu.user) / 1000
    const systemCpuMs = (idleAfter.cpu.system - idleBefore.cpu.system) / 1000
    const report = {
      schema: 1,
      generatedBy: 'tests/e2e/baseline.spec.ts',
      contentPolicy:
        'somente metadados agregados; sem prompts, áudio, imagens, URLs, chaves ou tokens',
      measurements: summarize(samples),
      resources: {
        idle: {
          rssMb: Math.round((idleAfter.rss / 1024 / 1024) * 10) / 10,
          heapMb: Math.round((idleAfter.heap / 1024 / 1024) * 10) / 10,
          cpuPercentOneCore: Math.round(((cpuMs + systemCpuMs) / WARMUP_IDLE_MS) * 1000) / 10
        },
        afterCycles: {
          rssMb: Math.round((afterCycles.rss / 1024 / 1024) * 10) / 10,
          heapMb: Math.round((afterCycles.heap / 1024 / 1024) * 10) / 10
        }
      },
      avatar: overlayMetrics
    }
    console.log(`BASELINE_JSON ${JSON.stringify(report)}`)
  } finally {
    await electronApp.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
