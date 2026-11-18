import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Testes leves do autostart do Hub (task 07-7.3). O SO é mockado — nenhum
 * registro real é tocado. Cobertura: leitura com falha → false, escrita com os
 * argumentos certos e a validação booleana estrita do handler.
 */

const mocks = vi.hoisted(() => ({
  isPackaged: true,
  openAtLogin: false,
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: mocks.openAtLogin })),
  setLoginItemSettings: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return mocks.isPackaged
    },
    getLoginItemSettings: () => mocks.getLoginItemSettings(),
    setLoginItemSettings: (settings: unknown) => mocks.setLoginItemSettings(settings)
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

let getHubOpenAtLogin: typeof import('./loginItem').getHubOpenAtLogin
let setHubOpenAtLogin: typeof import('./loginItem').setHubOpenAtLogin
let getHubAutostart: typeof import('./loginItem').getHubAutostart
let setHubAutostart: typeof import('./loginItem').setHubAutostart

beforeAll(async () => {
  const mod = await import('./loginItem')
  getHubOpenAtLogin = mod.getHubOpenAtLogin
  setHubOpenAtLogin = mod.setHubOpenAtLogin
  getHubAutostart = mod.getHubAutostart
  setHubAutostart = mod.setHubAutostart
})

beforeEach(() => {
  mocks.isPackaged = true
  mocks.openAtLogin = false
  mocks.getLoginItemSettings
    .mockClear()
    .mockImplementation(() => ({ openAtLogin: mocks.openAtLogin }))
  mocks.setLoginItemSettings.mockReset()
})

describe('loginItem', () => {
  it('getHubOpenAtLogin lê openAtLogin do SO', () => {
    mocks.openAtLogin = true
    expect(getHubOpenAtLogin()).toBe(true)
    mocks.openAtLogin = false
    expect(getHubOpenAtLogin()).toBe(false)
  })

  it('getHubOpenAtLogin devolve false quando a leitura falha', () => {
    mocks.getLoginItemSettings.mockImplementation(() => {
      throw new Error('registro indisponível')
    })
    expect(getHubOpenAtLogin()).toBe(false)
  })

  it('setHubOpenAtLogin(true) registra com path e --hidden', () => {
    setHubOpenAtLogin(true)
    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: process.execPath,
      args: ['--hidden']
    })
  })

  it('setHubOpenAtLogin(false) remove o item de inicialização', () => {
    setHubOpenAtLogin(false)
    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
  })

  it('getHubAutostart expõe enabled (do SO) e supported (app empacotado)', () => {
    mocks.openAtLogin = true
    expect(getHubAutostart()).toEqual({ enabled: true, supported: true })
    mocks.isPackaged = false
    expect(getHubAutostart()).toEqual({ enabled: true, supported: false })
  })

  it('setHubAutostart exige boolean estrito', () => {
    expect(setHubAutostart('sim' as never).success).toBe(false)
    expect(setHubAutostart(1 as never).success).toBe(false)
    expect(setHubAutostart(undefined as never).success).toBe(false)
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('setHubAutostart recusa gravar fora do app instalado', () => {
    mocks.isPackaged = false
    const res = setHubAutostart(true)
    expect(res.success).toBe(false)
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('setHubAutostart traduz falha do SO para { success: false, error }', () => {
    mocks.setLoginItemSettings.mockImplementation(() => {
      throw new Error('gravar Run falhou')
    })
    const res = setHubAutostart(true)
    expect(res.success).toBe(false)
    expect(res.error).toContain('inicialização com o Windows')
  })

  it('setHubAutostart liga e desliga com sucesso no app instalado', () => {
    expect(setHubAutostart(true)).toEqual({ success: true })
    expect(setHubAutostart(false)).toEqual({ success: true })
  })
})
