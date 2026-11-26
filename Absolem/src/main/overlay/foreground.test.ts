import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getForegroundWindow,
  parseForegroundOutput,
  shouldHideForFullscreen,
  type ForegroundWindow
} from './foreground'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Temp\\absolem-test' }
}))

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
const ownPid = 4242

function foreground(bounds: ForegroundWindow['bounds'], pid = 999): ForegroundWindow {
  return { title: 'Jogo', processName: 'game', pid, bounds }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('foreground / tela cheia', () => {
  it('bounds iguais ao monitor conta como tela cheia', () => {
    const window = foreground({ ...workArea })

    expect(shouldHideForFullscreen(window, workArea, ownPid)).toBe(true)
    // A própria janela do Absolem nunca conta, mesmo ocupando a workArea.
    expect(shouldHideForFullscreen(foreground({ ...workArea }, ownPid), workArea, ownPid)).toBe(
      false
    )
  })

  it('janela menor não conta', () => {
    const window = foreground({ x: 0, y: 0, width: 1280, height: 720 })

    expect(shouldHideForFullscreen(window, workArea, ownPid)).toBe(false)
  })

  it('falha do helper retorna desconhecido sem ocultar', async () => {
    const failing = await getForegroundWindow(async () => {
      throw new Error('helper falhou')
    })

    expect(failing).toBeNull()
    expect(shouldHideForFullscreen(failing, workArea, ownPid)).toBe(false)
    expect(parseForegroundOutput('lixo')).toBeNull()
    expect(parseForegroundOutput('null')).toBeNull()
    expect(parseForegroundOutput('')).toBeNull()
  })
})
