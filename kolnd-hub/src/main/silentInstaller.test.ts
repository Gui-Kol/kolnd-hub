import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn()
}))
const kloudMock = vi.hoisted(() => ({
  ensureKloudGamesInstalled: vi.fn(),
  findKloudGamesExe: vi.fn()
}))

// Nenhum processo real é executado: spawn/spawnSync são simulados.
vi.mock('child_process', () => ({ spawn: spawnMock, spawnSync: spawnSyncMock }))
vi.mock('./kloudGames', () => ({
  ensureKloudGamesInstalled: kloudMock.ensureKloudGamesInstalled,
  findKloudGamesExe: kloudMock.findKloudGamesExe
}))

import {
  installKloudGames,
  installPython,
  isKloudGamesInstalled,
  isWingetAvailable
} from './silentInstaller'

/** Cria um child fake e agenda o evento final (close ou error). */
function fakeChild(outcome: { code?: number | null; error?: Error }): void {
  const child = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (outcome.error && event === 'error') process.nextTick(() => listener(outcome.error))
      if (!outcome.error && event === 'close') process.nextTick(() => listener(outcome.code))
      return child
    })
  }
  spawnMock.mockReturnValue(child)
}

beforeEach(() => {
  spawnMock.mockReset()
  spawnSyncMock.mockReset()
  kloudMock.ensureKloudGamesInstalled.mockReset()
  kloudMock.findKloudGamesExe.mockReset()
})

describe('isWingetAvailable', () => {
  it('status 0 → disponível; status != 0 → indisponível', () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0 })
    expect(isWingetAvailable()).toBe(true)

    spawnSyncMock.mockReturnValueOnce({ status: 1 })
    expect(isWingetAvailable()).toBe(false)
  })

  it('exceção do spawnSync → indisponível', () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error('não encontrado')
    })
    expect(isWingetAvailable()).toBe(false)
  })
})

describe('installPython', () => {
  it('sem winget → erro orientando instalação manual', async () => {
    spawnSyncMock.mockReturnValue({ status: 1 })
    expect(await installPython()).toEqual({
      success: false,
      error:
        'winget não encontrado. Instale o Python manualmente ou execute este app como administrador.'
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('com winget: instala em silêncio com os argumentos esperados', async () => {
    spawnSyncMock.mockReturnValue({ status: 0 })
    fakeChild({ code: 0 })

    expect(await installPython()).toEqual({ success: true })
    expect(spawnMock).toHaveBeenCalledWith(
      'winget',
      [
        'install',
        '--id',
        'Python.Python.3.12',
        '--silent',
        '--accept-package-agreements',
        '--accept-source-agreements'
      ],
      { windowsHide: true, stdio: 'ignore' }
    )
  })

  it('código de saída diferente de 0 → erro com o código', async () => {
    spawnSyncMock.mockReturnValue({ status: 0 })
    fakeChild({ code: 1603 })
    expect(await installPython()).toEqual({
      success: false,
      error: 'winget saiu com código 1603'
    })
  })

  it('erro do processo → mensagem do erro', async () => {
    spawnSyncMock.mockReturnValue({ status: 0 })
    fakeChild({ error: new Error('EACCES') })
    expect(await installPython()).toEqual({ success: false, error: 'EACCES' })
  })
})

describe('installKloudGames', () => {
  it('sucesso com instalação nova → alreadyInstalled=false', async () => {
    kloudMock.ensureKloudGamesInstalled.mockResolvedValue({ success: true, installedNow: true })
    expect(await installKloudGames()).toEqual({ success: true, alreadyInstalled: false })
  })

  it('sucesso sem instalar (já estava) → alreadyInstalled=true', async () => {
    kloudMock.ensureKloudGamesInstalled.mockResolvedValue({ success: true, installedNow: false })
    expect(await installKloudGames()).toEqual({ success: true, alreadyInstalled: true })
  })

  it('falha repassa a mensagem', async () => {
    kloudMock.ensureKloudGamesInstalled.mockResolvedValue({ success: false, error: 'MSI ausente' })
    expect(await installKloudGames()).toEqual({ success: false, error: 'MSI ausente' })
  })
})

describe('isKloudGamesInstalled', () => {
  it('reflete a presença do executável', () => {
    kloudMock.findKloudGamesExe.mockReturnValue('C:\\Kloud\\KLOUD_GAMES.exe')
    expect(isKloudGamesInstalled()).toBe(true)

    kloudMock.findKloudGamesExe.mockReturnValue(null)
    expect(isKloudGamesInstalled()).toBe(false)
  })
})
