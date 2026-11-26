import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  packaged: false,
  openAtLogin: false,
  getLoginItemSettings: vi.fn(),
  setLoginItemSettings: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged
    },
    getLoginItemSettings: state.getLoginItemSettings,
    setLoginItemSettings: state.setLoginItemSettings
  }
}))

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: state.logError }
}))

type AutostartModule = typeof import('./autostart')

let mod: AutostartModule

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  state.packaged = false
  state.openAtLogin = false
  state.getLoginItemSettings.mockImplementation(() => ({ openAtLogin: state.openAtLogin }))
  mod = await import('./autostart')
})

describe('autostart', () => {
  it('recusa valor não booleano', () => {
    const result = mod.setAutostart('true')

    expect(result.success).toBe(false)
    expect(result.error).toContain('boolean')
    expect(state.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('em dev retorna supported false sem tocar no registro', () => {
    expect(mod.getAutostart()).toEqual({ enabled: false, supported: false })

    const result = mod.setAutostart(true)

    expect(result.success).toBe(false)
    expect(state.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('ligar passa --hidden e o caminho do executável', () => {
    state.packaged = true

    const result = mod.setAutostart(true)

    expect(result).toEqual({ success: true })
    expect(state.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: process.execPath,
      args: ['--hidden']
    })
  })
})
