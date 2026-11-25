import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  isBusy: vi.fn(() => false),
  isHubUninstallInProgress: vi.fn(() => false),
  lockMainWindowForUninstall: vi.fn(),
  unlockMainWindowForUninstall: vi.fn(),
  runHubUninstallSteps: vi.fn(),
  shutdownHub: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../uninstaller', () => ({
  isHubUninstallInProgress: mocks.isHubUninstallInProgress,
  lockMainWindowForUninstall: mocks.lockMainWindowForUninstall,
  unlockMainWindowForUninstall: mocks.unlockMainWindowForUninstall,
  runHubUninstallSteps: mocks.runHubUninstallSteps,
  uninstaller: { isBusy: mocks.isBusy }
}))
vi.mock('./lifecycle', () => ({ shutdownHub: mocks.shutdownHub }))

import { registerUninstallHubIpc } from './uninstall'
import type { IpcContext } from './lifecycle'

const send = vi.fn()
const window = { webContents: { send } }
const ctx = { getMainWindow: () => window } as unknown as IpcContext

function call(payload?: unknown): unknown {
  return mocks.handlers.get('uninstall:hub')?.({}, payload)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  mocks.isBusy.mockReturnValue(false)
  mocks.isHubUninstallInProgress.mockReturnValue(false)
  registerUninstallHubIpc(ctx)
})

describe('uninstall:hub', () => {
  it('recusa quando outra desinstalação está em andamento', async () => {
    mocks.isBusy.mockReturnValue(true)
    expect(await call({})).toEqual({
      success: false,
      error: 'Desinstalação já em andamento. Aguarde o término e tente de novo.'
    })
    expect(mocks.lockMainWindowForUninstall).not.toHaveBeenCalled()
  })

  it('recusa também quando o fluxo do Hub já está em andamento', async () => {
    mocks.isHubUninstallInProgress.mockReturnValue(true)
    expect((await call({})) as { success: boolean }).toMatchObject({ success: false })
  })

  it('spawn concluído: encaminha progresso, encerra o Hub e destrava a janela', async () => {
    mocks.runHubUninstallSteps.mockImplementation(
      async (_args: unknown, onEvent: (event: unknown) => void) => {
        onEvent({ step: 'kloud', status: 'done' })
        return { ok: true, spawned: true }
      }
    )

    expect(await call({ wipe: true })).toEqual({ success: true })
    expect(send).toHaveBeenCalledWith('uninstall:progress', { step: 'kloud', status: 'done' })
    expect(mocks.shutdownHub).toHaveBeenCalledWith(ctx)
    expect(mocks.lockMainWindowForUninstall).toHaveBeenCalledTimes(1)
    expect(mocks.unlockMainWindowForUninstall).toHaveBeenCalledTimes(1)
  })

  it('evento sem janela não quebra', async () => {
    const noWindowCtx = { getMainWindow: () => null } as unknown as IpcContext
    mocks.handlers.clear()
    registerUninstallHubIpc(noWindowCtx)
    mocks.runHubUninstallSteps.mockImplementation(
      async (_args: unknown, onEvent: (event: unknown) => void) => {
        onEvent({ step: 'x' })
        return { ok: true, spawned: true }
      }
    )
    await expect(call({})).resolves.toEqual({ success: true })
  })

  it('resultado pausado mantém o app aberto e propaga as fases', async () => {
    mocks.runHubUninstallSteps.mockResolvedValue({
      ok: false,
      spawned: false,
      paused: true,
      error: 'Escolha o que desinstalar',
      wipeErrors: ['x']
    })

    expect(await call({})).toEqual({
      success: false,
      paused: true,
      error: 'Escolha o que desinstalar',
      wipeErrors: ['x']
    })
    expect(mocks.shutdownHub).not.toHaveBeenCalled()
    expect(mocks.unlockMainWindowForUninstall).toHaveBeenCalledTimes(1)
  })

  it('erro sem pausa devolve paused=false', async () => {
    mocks.runHubUninstallSteps.mockResolvedValue({
      ok: false,
      spawned: false,
      error: 'desinstalador não encontrado'
    })
    expect(await call({})).toEqual({
      success: false,
      paused: false,
      error: 'desinstalador não encontrado',
      wipeErrors: undefined
    })
  })

  it('exceção destrava a janela mesmo assim', async () => {
    mocks.runHubUninstallSteps.mockRejectedValue(new Error('estourou'))
    await expect(call({})).rejects.toThrow('estourou')
    expect(mocks.unlockMainWindowForUninstall).toHaveBeenCalledTimes(1)
  })
})
