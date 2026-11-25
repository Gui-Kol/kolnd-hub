import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getGamepadConfig: vi.fn(),
  setGamepadConfig: vi.fn(),
  resetGamepadConfig: vi.fn(),
  getBigPicturePrefs: vi.fn(),
  setBigPicturePrefs: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('./store', () => ({
  getGamepadConfig: mocks.getGamepadConfig,
  setGamepadConfig: mocks.setGamepadConfig,
  resetGamepadConfig: mocks.resetGamepadConfig,
  getBigPicturePrefs: mocks.getBigPicturePrefs,
  setBigPicturePrefs: mocks.setBigPicturePrefs
}))
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mocks.loggerError, debug: vi.fn() }
}))

import { registerGamepadIpc } from './gamepad'

function call(channel: string, payload?: unknown): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return payload === undefined ? handler({}) : handler({}, payload)
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.getGamepadConfig.mockReset()
  mocks.setGamepadConfig.mockReset()
  mocks.resetGamepadConfig.mockReset()
  mocks.getBigPicturePrefs.mockReset()
  mocks.setBigPicturePrefs.mockReset()
  mocks.loggerError.mockReset()
  registerGamepadIpc()
})

describe('registerGamepadIpc — canais', () => {
  it('registra os quatro canais do Big Picture', () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      'bigpicture:get-prefs',
      'bigpicture:set-prefs',
      'gamepad:get',
      'gamepad:reset',
      'gamepad:set'
    ])
  })

  it('gamepad:get devolve a configuração persistida', () => {
    mocks.getGamepadConfig.mockReturnValue({ deadzone: 0.2 })
    expect(call('gamepad:get')).toEqual({ ok: true, config: { deadzone: 0.2 } })
  })

  it('gamepad:get converte exceção em ok=false e loga o erro', () => {
    mocks.getGamepadConfig.mockImplementation(() => {
      throw new Error('store corrompido')
    })
    expect(call('gamepad:get')).toEqual({
      ok: false,
      config: null,
      error: 'store corrompido'
    })
    expect(mocks.loggerError).toHaveBeenCalled()
  })

  it('gamepad:set encaminha o payload e reflete sucesso/erro', () => {
    mocks.setGamepadConfig.mockReturnValueOnce({ success: true })
    expect(call('gamepad:set', { deadzone: 0.3 })).toEqual({ ok: true })
    expect(mocks.setGamepadConfig).toHaveBeenCalledWith({ deadzone: 0.3 })

    mocks.setGamepadConfig.mockReturnValueOnce({ success: false, error: 'inválido' })
    expect(call('gamepad:set', null)).toEqual({ ok: false, error: 'inválido' })
  })

  it('gamepad:reset reflete sucesso/erro', () => {
    mocks.resetGamepadConfig.mockReturnValueOnce({ success: true })
    expect(call('gamepad:reset')).toEqual({ ok: true })

    mocks.resetGamepadConfig.mockReturnValueOnce({ success: false, error: 'falhou' })
    expect(call('gamepad:reset')).toEqual({ ok: false, error: 'falhou' })
  })

  it('bigpicture:get-prefs devolve as preferências', () => {
    mocks.getBigPicturePrefs.mockReturnValue({ sounds: false, scanlines: true })
    expect(call('bigpicture:get-prefs')).toEqual({
      ok: true,
      prefs: { sounds: false, scanlines: true }
    })
  })

  it('bigpicture:get-prefs cai no padrão {sounds:true} quando o store falha', () => {
    mocks.getBigPicturePrefs.mockImplementation(() => {
      throw 'quebrou'
    })
    expect(call('bigpicture:get-prefs')).toEqual({
      ok: false,
      prefs: { sounds: true },
      error: 'quebrou'
    })
  })

  it('bigpicture:set-prefs encaminha e reflete o resultado', () => {
    mocks.setBigPicturePrefs.mockReturnValueOnce({ success: true })
    expect(call('bigpicture:set-prefs', { sounds: true })).toEqual({ ok: true })
    expect(mocks.setBigPicturePrefs).toHaveBeenCalledWith({ sounds: true })

    mocks.setBigPicturePrefs.mockReturnValueOnce({ success: false, error: 'não' })
    expect(call('bigpicture:set-prefs', 42)).toEqual({ ok: false, error: 'não' })
  })
})
