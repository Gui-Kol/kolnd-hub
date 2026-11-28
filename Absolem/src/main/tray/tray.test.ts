import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import type { TrayContext } from './tray'

const state = vi.hoisted(() => ({
  packaged: false,
  exists: true,
  createFromPath: vi.fn(),
  createEmpty: vi.fn(),
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  trayOn: vi.fn(),
  warn: vi.fn(),
  icon: { isEmpty: () => false },
  empty: { isEmpty: () => true }
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged
    }
  },
  nativeImage: {
    createFromPath: state.createFromPath,
    createEmpty: state.createEmpty
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({}))
  },
  Tray: class {
    setToolTip = state.setToolTip
    setContextMenu = state.setContextMenu
    on = state.trayOn
  }
}))

vi.mock('fs', () => ({
  existsSync: () => state.exists
}))

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: state.warn, error: vi.fn() }
}))

type TrayModule = typeof import('./tray')

let mod: TrayModule

function makeContext(): TrayContext {
  return {
    showOverlay: vi.fn(),
    toggleOverlay: vi.fn(),
    openSettings: vi.fn(),
    quit: vi.fn()
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  state.packaged = false
  state.exists = true
  state.createFromPath.mockReturnValue(state.icon)
  state.createEmpty.mockReturnValue(state.empty)
  mod = await import('./tray')
})

describe('createTray', () => {
  it('usa resourcesPath quando empacotado', () => {
    state.packaged = true
    Object.defineProperty(process, 'resourcesPath', {
      value: join('C:', 'fake', 'resources'),
      configurable: true
    })

    mod.createTray(makeContext())

    expect(state.createFromPath).toHaveBeenCalledWith(
      join('C:', 'fake', 'resources', 'tray-icon.png')
    )
  })

  it('cai para imagem vazia quando o arquivo não existe', () => {
    state.exists = false

    mod.createTray(makeContext())

    expect(state.createFromPath).not.toHaveBeenCalled()
    expect(state.createEmpty).toHaveBeenCalledTimes(1)
    expect(state.warn).toHaveBeenCalledWith('tray', expect.stringContaining('não encontrado'))
  })

  it('define tooltip', () => {
    mod.createTray(makeContext())

    expect(state.setToolTip).toHaveBeenCalledWith('Absolem')
  })
})
