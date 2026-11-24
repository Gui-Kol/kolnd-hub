import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  cpSync: vi.fn(),
  openPath: vi.fn(),
  detectKloudGames: vi.fn(),
  findHubUninstaller: vi.fn(),
  logPath: vi.fn(),
  isAnyUninstallInProgress: vi.fn(),
  isHubUninstallInProgress: vi.fn(),
  lock: vi.fn(),
  unlock: vi.fn(),
  setWindowGetter: vi.fn(),
  isKloudSubstepEvent: vi.fn(),
  isHubUninstallComplete: vi.fn(),
  removeKloudGamesService: vi.fn(),
  uninstall: vi.fn(),
  uninstallOrphan: vi.fn(),
  isBusy: vi.fn()
}))

const APPDATA = 'C:\\Users\\u\\AppData\\Roaming'
const DOCUMENTS = 'C:\\Users\\u\\Documents'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => (name === 'documents' ? DOCUMENTS : APPDATA)
  },
  shell: { openPath: mocks.openPath },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  cpSync: mocks.cpSync
}))
vi.mock('./uninstallDetection', () => ({
  detectKloudGames: mocks.detectKloudGames,
  findHubUninstaller: mocks.findHubUninstaller
}))
vi.mock('./kloudGames', () => ({
  getKloudGamesUninstallLogPath: mocks.logPath
}))
vi.mock('./uninstall/shared', () => ({
  isAnyUninstallInProgress: mocks.isAnyUninstallInProgress,
  isHubUninstallInProgress: mocks.isHubUninstallInProgress,
  lockMainWindowForUninstall: mocks.lock,
  unlockMainWindowForUninstall: mocks.unlock,
  setUninstallWindowGetter: mocks.setWindowGetter
}))
vi.mock('./uninstall/hub', () => ({
  isHubUninstallComplete: mocks.isHubUninstallComplete,
  isKloudSubstepEvent: mocks.isKloudSubstepEvent
}))
vi.mock('./uninstall/kloud', () => ({
  removeKloudGamesService: mocks.removeKloudGamesService,
  uninstaller: {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      mocks.listeners.set(event, handler)
    },
    uninstall: mocks.uninstall,
    uninstallOrphan: mocks.uninstallOrphan,
    isBusy: mocks.isBusy
  }
}))

import { registerUninstallIpc } from './uninstaller'

const send = vi.fn()
const window = { webContents: { send } }

/** Dispara um listener registrado pelo módulo (progress/log/complete). */
function emit(event: string, payload: unknown): void {
  mocks.listeners.get(event)?.(payload)
}

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.listeners.clear()
  mocks.isAnyUninstallInProgress.mockReturnValue(false)
  mocks.isHubUninstallInProgress.mockReturnValue(false)
  mocks.isKloudSubstepEvent.mockReturnValue(false)
  mocks.isHubUninstallComplete.mockReturnValue(false)
  mocks.uninstall.mockResolvedValue(undefined)
  mocks.uninstallOrphan.mockResolvedValue(undefined)
  mocks.removeKloudGamesService.mockResolvedValue({ success: true })
  mocks.logPath.mockReturnValue('C:\\Users\\u\\AppData\\Roaming\\kolnd-hub\\logs\\uninstall.log')
  registerUninstallIpc(() => window as unknown as BrowserWindow)
})

describe('registerUninstallIpc — eventos', () => {
  it('guarda o getter da janela e registra os canais', () => {
    expect(mocks.setWindowGetter).toHaveBeenCalledWith(expect.any(Function))
    expect([...mocks.handlers.keys()].sort()).toEqual([
      'uninstall:backup-data',
      'uninstall:hub-status',
      'uninstall:kloud-games',
      'uninstall:kloud-orphan',
      'uninstall:kloud-status',
      'uninstall:open-logs',
      'uninstall:remove-kloud-service'
    ])
  })

  it('reenvia progress/log/complete do uninstaller', () => {
    emit('progress', { stepId: 'check', status: 'running', progress: 0 })
    emit('log', 'linha\n')
    emit('complete', { success: true })

    expect(send).toHaveBeenCalledWith('uninstall:progress', {
      stepId: 'check',
      status: 'running',
      progress: 0
    })
    expect(send).toHaveBeenCalledWith('uninstall:log', 'linha\n')
    expect(send).toHaveBeenCalledWith('uninstall:complete', { success: true })
  })

  it('durante o fluxo do Hub ignora subpassos do Kloud e completes parciais', () => {
    mocks.isHubUninstallInProgress.mockReturnValue(true)
    mocks.isKloudSubstepEvent.mockReturnValue(true)
    mocks.isHubUninstallComplete.mockReturnValue(false)

    emit('progress', { stepId: 'kloud-check' })
    emit('complete', { success: false })
    expect(send).not.toHaveBeenCalled()

    mocks.isHubUninstallComplete.mockReturnValue(true)
    emit('complete', { success: true })
    expect(send).toHaveBeenCalledWith('uninstall:complete', { success: true })
  })

  it('sem janela não lança ao reenviar', () => {
    mocks.handlers.clear()
    mocks.listeners.clear()
    registerUninstallIpc(() => null)
    expect(() => emit('log', 'x')).not.toThrow()
  })
})

describe('uninstall:kloud-status', () => {
  it('devolve a detecção ou o erro', () => {
    mocks.detectKloudGames.mockReturnValue({ installed: true })
    expect(call('uninstall:kloud-status')).toEqual({
      ok: true,
      detection: { installed: true }
    })

    mocks.detectKloudGames.mockImplementationOnce(() => {
      throw new Error('registry falhou')
    })
    expect(call('uninstall:kloud-status')).toEqual({ ok: false, error: 'registry falhou' })
  })
})

describe('fluxos de desinstalação', () => {
  it('kloud-games recusa quando há fluxo em andamento', async () => {
    mocks.isAnyUninstallInProgress.mockReturnValue(true)
    await expect(call('uninstall:kloud-games')).resolves.toMatchObject({ success: false })
    expect(mocks.uninstall).not.toHaveBeenCalled()
  })

  it('kloud-games trava a janela, executa e destrava ao final', async () => {
    await expect(call('uninstall:kloud-games')).resolves.toEqual({ success: true })
    expect(mocks.lock).toHaveBeenCalled()
    expect(mocks.uninstall).toHaveBeenCalledWith(expect.any(Function))
    await vi.waitFor(() => expect(mocks.unlock).toHaveBeenCalled())
  })

  it('falha inesperada no kloud-games vira log + complete', async () => {
    mocks.uninstall.mockRejectedValueOnce(new Error('estourou'))
    await call('uninstall:kloud-games')
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith('uninstall:complete', {
        success: false,
        error: 'estourou'
      })
    )
    expect(send).toHaveBeenCalledWith('uninstall:log', expect.stringContaining('estourou'))
    expect(mocks.unlock).toHaveBeenCalled()
  })

  it('órfãos recusam com fluxo em andamento e executam quando livre', async () => {
    mocks.isAnyUninstallInProgress.mockReturnValue(true)
    await expect(call('uninstall:kloud-orphan')).resolves.toMatchObject({ success: false })

    mocks.isAnyUninstallInProgress.mockReturnValue(false)
    await expect(call('uninstall:kloud-orphan')).resolves.toEqual({ success: true })
    expect(mocks.uninstallOrphan).toHaveBeenCalled()
  })

  it('falha nos órfãos marca orphanManual no complete', async () => {
    mocks.uninstallOrphan.mockRejectedValueOnce(new Error('falhou órfão'))
    await call('uninstall:kloud-orphan')
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith('uninstall:complete', {
        success: false,
        error: 'falhou órfão',
        orphanManual: true
      })
    )
  })

  it('remove-kloud-service recusa em andamento e destrava no fim', async () => {
    mocks.isAnyUninstallInProgress.mockReturnValue(true)
    await expect(call('uninstall:remove-kloud-service')).resolves.toMatchObject({ success: false })

    mocks.isAnyUninstallInProgress.mockReturnValue(false)
    await expect(call('uninstall:remove-kloud-service')).resolves.toEqual({ success: true })
    expect(mocks.lock).toHaveBeenCalled()
    expect(mocks.unlock).toHaveBeenCalled()
  })
})

describe('status, backup e logs', () => {
  it('uninstall:hub-status devolve disponibilidade e isPackaged', () => {
    mocks.findHubUninstaller.mockReturnValue({ available: true, uninstallerPath: 'C:\\u.exe' })
    expect(call('uninstall:hub-status')).toEqual({
      available: true,
      uninstallerPath: 'C:\\u.exe',
      isPackaged: true
    })
  })

  it('backup recusa quando a pasta não existe', () => {
    mocks.existsSync.mockReturnValue(false)
    expect(call('uninstall:backup-data')).toEqual({
      success: false,
      error: 'A pasta %APPDATA%\\kolnd-hub não existe — nada para fazer backup.'
    })
  })

  it('backup escolhe um nome livre e copia a pasta', () => {
    mocks.existsSync.mockImplementation((path: string) => {
      if (path.endsWith('kolnd-hub')) return true
      // Só o primeiro nome está ocupado; o sufixo -2 fica livre.
      if (path.includes('KolndHub-Backup-') && !path.endsWith('-2')) return true
      return false
    })

    const result = (call('uninstall:backup-data') as { success: boolean; path: string }).path
    expect(result).toContain('KolndHub-Backup-')
    expect(result).toMatch(/-2$/)
    expect(mocks.cpSync).toHaveBeenCalledWith(join(APPDATA, 'kolnd-hub'), result, {
      recursive: true
    })
  })

  it('falha de cópia vira erro amigável', () => {
    mocks.existsSync.mockImplementation((path: string) => path.endsWith('kolnd-hub'))
    mocks.cpSync.mockImplementationOnce(() => {
      throw new Error('disco cheio')
    })
    expect(call('uninstall:backup-data')).toEqual({ success: false, error: 'disco cheio' })
  })

  it('abre a pasta de logs', () => {
    call('uninstall:open-logs')
    expect(mocks.openPath).toHaveBeenCalledWith(join(APPDATA, 'kolnd-hub', 'logs'))
  })
})

import { join } from 'node:path'
