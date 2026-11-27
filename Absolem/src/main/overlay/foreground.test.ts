import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ensureForegroundScript,
  getForegroundWindow,
  parseForegroundOutput,
  resetForegroundScriptCacheForTests,
  shouldHideForFullscreen,
  type ForegroundWindow
} from './foreground'

const userData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userData.dir }
}))

// Cenário real desta máquina: monitor 1280x720 e workArea 1280x672.
const monitor = { x: 0, y: 0, width: 1280, height: 720 }
const workArea = { x: 0, y: 0, width: 1280, height: 672 }
const ownPid = 4242

function foreground(
  bounds: ForegroundWindow['bounds'],
  pid = 999,
  zoomed?: boolean
): ForegroundWindow {
  return { title: 'Jogo', processName: 'game', pid, bounds, zoomed }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('foreground / tela cheia', () => {
  it('bounds iguais ao monitor conta como tela cheia', () => {
    const window = foreground({ ...monitor }, 999, false)

    expect(shouldHideForFullscreen(window, monitor, ownPid)).toBe(true)
    // A própria janela do Absolem nunca conta, mesmo ocupando o monitor.
    expect(shouldHideForFullscreen(foreground({ ...monitor }, ownPid), monitor, ownPid)).toBe(false)
  })

  it('maximizada que cobre a workArea mas não o monitor não conta', () => {
    // Cobre a workArea inteira (sem a barra de tarefas), mas não o monitor.
    const maximized = foreground({ ...workArea }, 999, false)
    // Bounds reais medidos de uma janela maximizada nesta máquina.
    const measured = foreground({ x: -7, y: -7, width: 1295, height: 687 }, 999, true)

    expect(shouldHideForFullscreen(maximized, monitor, ownPid)).toBe(false)
    expect(shouldHideForFullscreen(measured, monitor, ownPid)).toBe(false)
  })

  it('zoomed:true nunca conta, mesmo cobrindo o monitor inteiro', () => {
    const maximized = foreground({ ...monitor }, 999, true)

    expect(shouldHideForFullscreen(maximized, monitor, ownPid)).toBe(false)
  })

  it('janela menor não conta', () => {
    const window = foreground({ x: 0, y: 0, width: 1024, height: 600 }, 999, false)

    expect(shouldHideForFullscreen(window, monitor, ownPid)).toBe(false)
  })

  it('falha do helper retorna desconhecido sem ocultar', async () => {
    const failing = await getForegroundWindow(async () => {
      throw new Error('helper falhou')
    })

    expect(failing).toBeNull()
    expect(shouldHideForFullscreen(failing, monitor, ownPid)).toBe(false)
    expect(parseForegroundOutput('lixo')).toBeNull()
    expect(parseForegroundOutput('null')).toBeNull()
    expect(parseForegroundOutput('')).toBeNull()
  })
})

describe('foreground / parse da sonda', () => {
  it('lê zoomed quando booleano e assume false quando ausente ou inválido', () => {
    const base = {
      title: 'Jogo',
      processName: 'game',
      pid: 10,
      bounds: { x: 0, y: 0, width: 1280, height: 720 }
    }

    expect(parseForegroundOutput(JSON.stringify({ ...base, zoomed: true }))?.zoomed).toBe(true)
    expect(parseForegroundOutput(JSON.stringify(base))?.zoomed).toBe(false)
    expect(parseForegroundOutput(JSON.stringify({ ...base, zoomed: 'sim' }))?.zoomed).toBe(false)
  })
})

describe('foreground / script da sonda', () => {
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'absolem-foreground-'))
    userData.dir = dir
    resetForegroundScriptCacheForTests()
  })

  afterEach(() => {
    resetForegroundScriptCacheForTests()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('reescreve um script antigo e não regrava quando o conteúdo já bate', async () => {
    const scriptsDir = join(dir, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    const scriptPath = join(scriptsDir, 'foreground.ps1')
    writeFileSync(scriptPath, "# script antigo, sem IsZoomed\nWrite-Output 'null'", 'utf8')

    expect(ensureForegroundScript()).toBe(scriptPath)
    const updated = readFileSync(scriptPath, 'utf8')
    expect(updated).toContain('IsZoomed')

    const mtime = statSync(scriptPath).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(ensureForegroundScript()).toBe(scriptPath)
    expect(readFileSync(scriptPath, 'utf8')).toBe(updated)
    expect(statSync(scriptPath).mtimeMs).toBe(mtime)
  })
})
