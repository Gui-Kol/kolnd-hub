import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'
import { applyAvatarLevel, applyAvatarState } from '../ipc/avatar'
import { setThemeFromRequest } from '../ipc/theme'
import type { IpcContext } from '../ipc/lifecycle'
import { setOverlayLayoutFromRequest, showOverlay } from '../overlay/controller'
import { getOverlayWindow } from '../overlay/overlayWindow'
import {
  VISUAL_STABLE_POLL_MS,
  VISUAL_STABLE_TIMEOUT_MS,
  buildVisualHash,
  parseVisualLook,
  parseVisualSizes,
  parseVisualStates,
  visualFileName,
  type VisualLook,
  type VisualSize
} from './capturePlan'
import type { AvatarState } from '../../shared/avatar'

/**
 * Harness de captura visual (task 23).
 *
 * Só roda em desenvolvimento e apenas quando `ABSOLEM_VISUAL_DIR` aponta para
 * um diretório. O app empacotado nunca entra aqui: `app.isPackaged` é a primeira
 * barreira e não existe caminho de produção que defina a variável. A janela do
 * overlay é aberta pelo mesmo `showOverlay()` da bandeja, então a captura usa o
 * enquadramento, o tema e a área reais do produto.
 *
 * A captura em si é `webContents.capturePage()`; nenhuma dependência entra.
 * Para não herdar o desktop/alfa da janela transparente, o modo injeta um fundo
 * branco controlado no documento APENAS durante a captura. O avatar continua
 * sendo o mesmo desenho; o fundo é evidência de contraste, não uma mudança do
 * personagem.
 *
 * Variáveis:
 * - `ABSOLEM_VISUAL_DIR` (obrigatória para ativar)
 * - `ABSOLEM_VISUAL_STATES` (lista separada por vírgula; default: os 5 estados)
 * - `ABSOLEM_VISUAL_SIZES` (lista `WxH`; default: 320x360,480x560)
 * - `ABSOLEM_VISUAL_LOOK` (`storybook` ou `holo`; default: storybook)
 * - `ABSOLEM_VISUAL_FAKE_VOICE=1` (acrescenta `fakeVoice=1` à rota)
 * - `ABSOLEM_VISUAL_HOLD_MS` (mantém o app aberto após as capturas; usado pela
 *   medição de CPU/memória da task 23)
 */

interface AvatarMetricsSnapshot {
  fps: number
  frameMs: number
  drawCalls: number
  triangles: number
  degradation: number
}

interface CaptureEntry {
  file: string
  look: VisualLook
  state: AvatarState
  size: VisualSize
  pixelWidth: number
  pixelHeight: number
  bytes: number
  metrics: AvatarMetricsSnapshot | null
  error?: string
}

const METRICS_SCRIPT = 'window.__absolemAvatarMetrics ? window.__absolemAvatarMetrics() : null'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isMetrics(value: unknown): value is AvatarMetricsSnapshot {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.fps === 'number' &&
    typeof record.frameMs === 'number' &&
    typeof record.drawCalls === 'number' &&
    typeof record.triangles === 'number' &&
    typeof record.degradation === 'number'
  )
}

async function readMetrics(window: Electron.BrowserWindow): Promise<AvatarMetricsSnapshot | null> {
  try {
    const value: unknown = await window.webContents.executeJavaScript(METRICS_SCRIPT)
    return isMetrics(value) ? value : null
  } catch {
    return null
  }
}

function waitForLoad(window: Electron.BrowserWindow): Promise<void> {
  if (!window.webContents.isLoading()) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, VISUAL_STABLE_TIMEOUT_MS)
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Espera o laço de render produzir frame e desenho, com teto de 2 s. */
async function waitForStableFrame(
  window: Electron.BrowserWindow
): Promise<AvatarMetricsSnapshot | null> {
  const deadline = Date.now() + VISUAL_STABLE_TIMEOUT_MS
  let last: AvatarMetricsSnapshot | null = null
  while (Date.now() < deadline) {
    last = await readMetrics(window)
    if (last && last.frameMs > 0 && last.drawCalls > 0) return last
    await delay(VISUAL_STABLE_POLL_MS)
  }
  return last
}

async function loadRoute(window: Electron.BrowserWindow, hash: string): Promise<void> {
  await window.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(hash)}`)
  const loaded = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, VISUAL_STABLE_TIMEOUT_MS * 3)
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  window.webContents.reload()
  await loaded
}

/**
 * Prepara uma superficie opaca e sem a UI conversacional para a captura. O
 * fundo branco e a remocao dos baloes sao so do harness: o personagem, o
 * enquadramento e os materiais nao mudam. Sem isso o capturePage de uma janela
 * transparente herda o desktop e os cartoes da task 11 cobrem o avatar.
 */
async function prepareCaptureSurface(window: Electron.BrowserWindow): Promise<string> {
  return window.webContents.executeJavaScript(`(() => {
    if (!document.getElementById('absolem-visual-surface')) {
      const style = document.createElement('style')
      style.id = 'absolem-visual-surface'
      style.textContent = [
        'html, body, #root { background: #ffffff !important; }',
        '.overlay-root { background: #ffffff !important; }',
        '.voice-indicator, .conversation-layer, .first-run-card, .overlay-debug,',
        '.capture-indicator, .search-indicator { display: none !important; }'
      ].join('\\n')
      document.head.appendChild(style)
    }
    const read = (element) => (element ? getComputedStyle(element).backgroundColor : 'ausente')
    return JSON.stringify({
      body: read(document.body),
      html: read(document.documentElement),
      root: read(document.getElementById('root'))
    })
  })()`)
}

/**
 * Aplica o fundo controlado e captura. Falha devolve o motivo em vez de
 * inventar uma imagem: o relatorio precisa registrar a pendencia honesta.
 */
async function captureFrame(
  window: Electron.BrowserWindow,
  logSurface: boolean
): Promise<{ png: Buffer; pixelWidth: number; pixelHeight: number } | { error: string }> {
  try {
    const surface = await prepareCaptureSurface(window)
    if (logSurface) logger.info('visual', 'fundo da captura', surface)
    // O compositor do Electron entrega o ultimo frame pintado; sem esperar o
    // repaint a captura sai com a UI/fundo anteriores a injecao.
    await delay(250)
  } catch {
    // Sem a superficie o capturePage ainda pode devolver a pagina; a variancia
    // e validada depois pelo script e denuncia uma imagem vazia.
  }

  try {
    const image = await window.webContents.capturePage()
    if (image.isEmpty()) return { error: 'capturePage devolveu imagem vazia' }
    const png = image.toPNG()
    if (png.length === 0) return { error: 'PNG da captura tem 0 byte' }
    const size = image.getSize()
    return { png, pixelWidth: size.width, pixelHeight: size.height }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function writeReport(
  dir: string,
  look: VisualLook,
  entries: CaptureEntry[],
  error: string | null,
  holdMs: number,
  finalMetrics: AvatarMetricsSnapshot | null
): void {
  const report = {
    look,
    generatedAt: new Date().toISOString(),
    holdMs,
    error,
    finalMetrics,
    captures: entries
  }
  writeFileSync(join(dir, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(
    join(dir, 'done.json'),
    `${JSON.stringify({ ok: error === null, captureCount: entries.length, generatedAt: report.generatedAt }, null, 2)}\n`,
    'utf8'
  )
}

export function scheduleVisualCapture(ctx: IpcContext, onDone: () => void): void {
  const dir = process.env.ABSOLEM_VISUAL_DIR
  if (app.isPackaged || !dir) return

  const states = parseVisualStates(process.env.ABSOLEM_VISUAL_STATES)
  const sizes = parseVisualSizes(process.env.ABSOLEM_VISUAL_SIZES)
  const look = parseVisualLook(process.env.ABSOLEM_VISUAL_LOOK)
  const fakeVoice = process.env.ABSOLEM_VISUAL_FAKE_VOICE === '1'
  // No build de produção as flags do renderer estão desligadas (DEV=false). O
  // harness usa os mesmos canais de IPC do produto para aplicar estado/nível;
  // a rota com as flags continua sendo montada para o modo dev.
  const driveFakeVoice = fakeVoice && !process.env['ELECTRON_RENDERER_URL']
  const holdMs = Math.max(0, Number.parseInt(process.env.ABSOLEM_VISUAL_HOLD_MS ?? '0', 10) || 0)

  logger.info('visual', 'captura agendada', {
    dir,
    states,
    sizes,
    look,
    fakeVoice,
    holdMs
  })

  setTimeout(() => {
    void (async () => {
      const entries: CaptureEntry[] = []
      let error: string | null = null
      let fakeVoiceTimer: ReturnType<typeof setInterval> | null = null
      try {
        mkdirSync(dir, { recursive: true })

        // Mesmo caminho da bandeja: o overlay nasce e aparece como no produto.
        showOverlay()
        const window = getOverlayWindow()
        if (!window) throw new Error('overlay indisponível para a captura')
        await waitForLoad(window)

        // Acabamento pedido (o push de tema é o mesmo caminho da aba Aparência).
        const themeResult = setThemeFromRequest(ctx, { theme: { look }, persist: false })
        if (!themeResult.ok) throw new Error(themeResult.error ?? 'tema recusado')

        if (driveFakeVoice) {
          fakeVoiceTimer = setInterval(() => {
            const time = performance.now() / 1000
            const level = 0.18 + 0.5 * Math.abs(Math.sin(time * 2.4) * Math.sin(time * 3.3))
            applyAvatarLevel(level)
          }, 60)
        }

        try {
          window.setBackgroundColor('#ffffff')
        } catch {
          // A cor de fundo pode ser ignorada em janela transparente; o CSS do
          // documento cobre o caso no momento da captura.
        }

        // Descarta a primeira pintura (fontes/GPU frias) antes dos arquivos.
        const warmHash = buildVisualHash(look, states[0] ?? 'idle', fakeVoice)
        await loadRoute(window, warmHash)
        applyAvatarState(states[0] ?? 'idle')
        await waitForStableFrame(window)
        await delay(300)
        await captureFrame(window, false)

        for (const size of sizes) {
          const layout = setOverlayLayoutFromRequest({
            width: size.width,
            height: size.height
          })
          if (!layout.ok) throw new Error(layout.error ?? 'layout recusado')
          await delay(250)

          for (const state of states) {
            const hash = buildVisualHash(look, state, fakeVoice)
            await loadRoute(window, hash)
            applyAvatarState(state)
            const stable = await waitForStableFrame(window)
            // Um respiro curto depois do frame estável para a pálpebra/pose
            // convergirem antes do clique virtual da captura.
            await delay(350)

            const file = visualFileName(look, state, size)
            const captured = await captureFrame(window, entries.length === 0)
            if ('error' in captured) {
              entries.push({
                file,
                look,
                state,
                size,
                pixelWidth: 0,
                pixelHeight: 0,
                bytes: 0,
                metrics: stable,
                error: captured.error
              })
              logger.warn('visual', `captura falhou: ${file}`, captured.error)
              continue
            }

            const path = join(dir, file)
            writeFileSync(path, captured.png)
            entries.push({
              file,
              look,
              state,
              size,
              pixelWidth: captured.pixelWidth,
              pixelHeight: captured.pixelHeight,
              bytes: captured.png.length,
              metrics: stable ?? (await readMetrics(window))
            })
            logger.info('visual', `captura gravada: ${file}`, {
              bytes: captured.png.length,
              pixels: `${captured.pixelWidth}x${captured.pixelHeight}`
            })
          }
        }

        if (entries.length !== states.length * sizes.length) {
          error = `capturas incompletas: ${entries.length} de ${states.length * sizes.length}`
        } else if (entries.every((entry) => entry.error)) {
          error = 'nenhuma captura foi gravada'
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        logger.error('visual', 'captura visual falhou', err)
      }

      if (holdMs > 0) {
        await delay(holdMs)
      }

      if (fakeVoiceTimer) clearInterval(fakeVoiceTimer)
      const window = getOverlayWindow()
      const finalMetrics = window ? await readMetrics(window) : null
      try {
        writeReport(dir, look, entries, error, holdMs, finalMetrics)
      } catch (err) {
        logger.error('visual', 'falha ao gravar o relatório da captura', err)
        error = error ?? (err instanceof Error ? err.message : String(err))
      }

      if (error) process.exitCode = 1
      onDone()
    })()
  }, 700)
}
