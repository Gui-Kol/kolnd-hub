import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isBusy: vi.fn(() => false),
  verifyKloudGamesRemoval: vi.fn()
}))

vi.mock('./kloud', () => ({ uninstaller: { isBusy: mocks.isBusy } }))
vi.mock('../uninstallVerify', () => ({
  verifyKloudGamesRemoval: mocks.verifyKloudGamesRemoval
}))

import {
  attachLaudo,
  isAnyUninstallInProgress,
  isHubUninstallInProgress,
  lockMainWindowForUninstall,
  setHubUninstallInProgress,
  setUninstallWindowGetter,
  unlockMainWindowForUninstall
} from './shared'
import type { UninstallReport } from './shared'

function report(remaining: string[] = []): UninstallReport {
  return {
    success: true,
    cancelled: false,
    needsReboot: false,
    remaining,
    logPath: 'C:\\log.txt'
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isBusy.mockReturnValue(false)
  setHubUninstallInProgress(false)
  setUninstallWindowGetter(null)
})

describe('attachLaudo', () => {
  it('anexa o laudo e mescla itens remanescentes sem duplicar', () => {
    mocks.verifyKloudGamesRemoval.mockReturnValue({
      remaining: ['C:\\Program Files\\Kloud', 'Serviço'],
      installed: true
    })
    const target = report(['Serviço'])
    const lines: string[] = []

    attachLaudo(target, (line) => lines.push(line))

    expect(target.report).toEqual({
      remaining: ['C:\\Program Files\\Kloud', 'Serviço'],
      installed: true
    })
    expect(target.remaining).toEqual(['Serviço', 'C:\\Program Files\\Kloud'])
    expect(lines.join('')).toContain('[laudo] Itens remanescentes')
  })

  it('sem itens remanescentes não adiciona log de laudo', () => {
    mocks.verifyKloudGamesRemoval.mockReturnValue({ remaining: [] })
    const target = report(['x'])
    const lines: string[] = []
    attachLaudo(target, (line) => lines.push(line))
    expect(target.remaining).toEqual(['x'])
    expect(lines).toEqual([])
  })

  it('falha de verificação vira linha de log e não lança', () => {
    mocks.verifyKloudGamesRemoval.mockImplementation(() => {
      throw new Error('sem acesso')
    })
    const lines: string[] = []
    expect(() => attachLaudo(report(), (line) => lines.push(line))).not.toThrow()
    expect(lines.join('')).toContain('sem acesso')
  })
})

describe('flags de reentrância', () => {
  it('setHubUninstallInProgress controla isHubUninstallInProgress', () => {
    expect(isHubUninstallInProgress()).toBe(false)
    setHubUninstallInProgress(true)
    expect(isHubUninstallInProgress()).toBe(true)
  })

  it('isAnyUninstallInProgress considera os dois fluxos', () => {
    expect(isAnyUninstallInProgress()).toBe(false)
    mocks.isBusy.mockReturnValue(true)
    expect(isAnyUninstallInProgress()).toBe(true)

    mocks.isBusy.mockReturnValue(false)
    setHubUninstallInProgress(true)
    expect(isAnyUninstallInProgress()).toBe(true)
  })
})

describe('lock/unlock da janela', () => {
  it('sem getter ou sem janela não lança', () => {
    expect(() => lockMainWindowForUninstall()).not.toThrow()
    expect(() => unlockMainWindowForUninstall()).not.toThrow()

    setUninstallWindowGetter(() => null)
    expect(() => lockMainWindowForUninstall()).not.toThrow()
  })

  it('trava e destrava closable/minimizable', () => {
    const window = { setClosable: vi.fn(), setMinimizable: vi.fn() }
    setUninstallWindowGetter(() => window as never)

    lockMainWindowForUninstall()
    expect(window.setClosable).toHaveBeenCalledWith(false)
    expect(window.setMinimizable).toHaveBeenCalledWith(false)

    unlockMainWindowForUninstall()
    expect(window.setClosable).toHaveBeenLastCalledWith(true)
    expect(window.setMinimizable).toHaveBeenLastCalledWith(true)
  })

  it('erro da janela é ignorado', () => {
    const window = {
      setClosable: () => {
        throw new Error('destruída')
      },
      setMinimizable: vi.fn()
    }
    setUninstallWindowGetter(() => window as never)
    expect(() => lockMainWindowForUninstall()).not.toThrow()
    expect(() => unlockMainWindowForUninstall()).not.toThrow()
  })
})
