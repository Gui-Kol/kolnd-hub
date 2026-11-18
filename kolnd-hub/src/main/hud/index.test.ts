import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HwSnapshot } from '../../shared/hwmon'
import type { HudStatus } from '../../shared/hud'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  once: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
  getHudConfig: vi.fn(),
  setHudShortcut: vi.fn(),
  setHudVisible: vi.fn(),
  setHudSize: vi.fn(),
  acquireHwPolling: vi.fn(),
  releaseHwPolling: vi.fn(),
  onHwSnapshot: vi.fn(),
  collectHwSnapshot: vi.fn(),
  getFpsStatus: vi.fn(),
  getFpsAutoUpdate: vi.fn(),
  showHudWindow: vi.fn(),
  hideHudWindow: vi.fn(),
  getHudWindow: vi.fn(),
  destroyHudWindow: vi.fn(),
  setHudWidth: vi.fn(),
  setHudHeight: vi.fn()
}))

vi.mock('electron', () => ({
  app: { once: mocks.once },
  globalShortcut: {
    register: mocks.register,
    unregister: mocks.unregister,
    unregisterAll: mocks.unregisterAll
  },
  ipcMain: { handle: mocks.handle }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../fps', () => ({ getFpsStatus: mocks.getFpsStatus }))
vi.mock('../fps/agent', () => ({ getFpsAutoUpdate: mocks.getFpsAutoUpdate }))
vi.mock('../hwmon', () => ({
  acquireHwPolling: mocks.acquireHwPolling,
  releaseHwPolling: mocks.releaseHwPolling,
  onHwSnapshot: mocks.onHwSnapshot,
  collectHwSnapshot: mocks.collectHwSnapshot
}))
vi.mock('../store', () => ({
  getHudConfig: mocks.getHudConfig,
  setHudShortcut: mocks.setHudShortcut,
  setHudVisible: mocks.setHudVisible,
  setHudSize: mocks.setHudSize
}))
vi.mock('./overlayWindow', () => ({
  showHudWindow: mocks.showHudWindow,
  hideHudWindow: mocks.hideHudWindow,
  getHudWindow: mocks.getHudWindow,
  destroyHudWindow: mocks.destroyHudWindow,
  setHudWidth: mocks.setHudWidth,
  setHudHeight: mocks.setHudHeight
}))

import { registerHudIpc, resetHudForTests } from './index'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

interface FakeWindow {
  isDestroyed: () => boolean
  isVisible: () => boolean
  webContents: {
    send: ReturnType<typeof vi.fn>
    isLoading: () => boolean
    once: ReturnType<typeof vi.fn>
  }
}

let fakeWindow: FakeWindow

function snapshotFixture(): HwSnapshot {
  return {
    power: {
      cpuW: null,
      gpuW: 28,
      totalMeasuredW: null,
      cpuEstimatedW: 22,
      platformEstimatedW: 30,
      totalEstimatedW: 80
    },
    cpu: { model: 'CPU', usagePercent: 12, clockMhz: 3400, tempC: null, watts: null },
    ram: { installedGb: 24, speedMhz: 3200, voltageV: 1.2, usedGb: 11, usedPercent: 47 },
    gpu: {
      model: 'GPU',
      usagePercent: 2,
      coreClockMhz: 2655,
      memClockMhz: 14001,
      vramUsedMb: 1427,
      vramTotalMb: 8151,
      sharedMb: 116,
      tempC: 41,
      fanPercent: 0,
      watts: 28,
      powerLimitW: 180
    },
    specs: { cpu: null, gpu: null, ram: null, board: null },
    sources: { driver: 'absent', cpu: 'estimated', gpu: 'measured', platform: 'estimated' },
    capturedAt: '2026-11-17T12:00:00.000Z'
  }
}

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`handler ${channel} não registrado`)
  return handler
}

// Sem janela principal nos testes de IPC: o broadcast de status vira no-op.
function register(): void {
  registerHudIpc({ getMainWindow: () => null, processManager: {} as never })
}

function willQuitHandler(): () => void {
  const call = mocks.once.mock.calls.find(([event]) => event === 'will-quit')
  if (!call) throw new Error('will-quit não registrado')
  return call[1] as () => void
}

beforeEach(() => {
  resetHudForTests()
  vi.clearAllMocks()
  handlers.clear()

  fakeWindow = {
    isDestroyed: () => false,
    isVisible: () => true,
    webContents: { send: vi.fn(), isLoading: () => false, once: vi.fn() }
  }

  mocks.handle.mockImplementation((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  })
  mocks.getHudConfig.mockReturnValue({
    shortcut: 'Control+Alt+M',
    visible: false,
    width: 300,
    scale: 'normal'
  })
  mocks.register.mockReturnValue(true)
  mocks.setHudShortcut.mockReturnValue({ success: true })
  mocks.setHudVisible.mockReturnValue({ success: true })
  mocks.setHudSize.mockReturnValue({ success: true, size: { width: 420, scale: 'grande' } })
  mocks.onHwSnapshot.mockImplementation(() => vi.fn())
  mocks.collectHwSnapshot.mockResolvedValue(snapshotFixture())
  mocks.getFpsStatus.mockReturnValue({ state: 'off', last: null })
  mocks.getFpsAutoUpdate.mockReturnValue(null)
  mocks.showHudWindow.mockReturnValue(fakeWindow)
  mocks.getHudWindow.mockReturnValue(fakeWindow)
  mocks.setHudWidth.mockImplementation((width: number) => width)
  mocks.setHudHeight.mockImplementation((height: number) => height)
})

describe('registerHudIpc', () => {
  it('registra os canais, o atalho persistido e a limpeza no will-quit', () => {
    register()
    expect([...handlers.keys()].sort()).toEqual([
      'hud:get',
      'hud:report-size',
      'hud:set-shortcut',
      'hud:set-size',
      'hud:set-visible',
      'hud:toggle'
    ])
    expect(mocks.register).toHaveBeenCalledWith('Control+Alt+M', expect.any(Function))
    expect(mocks.setHudWidth).toHaveBeenCalledWith(300)
    expect(mocks.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
    // visível=false persistido: nenhuma janela aparece ao abrir o Hub.
    expect(mocks.showHudWindow).not.toHaveBeenCalled()
  })

  it('restaura visible=true sem reescrever a preferência', () => {
    mocks.getHudConfig.mockReturnValue({
      shortcut: 'Alt+Shift+F9',
      visible: true,
      width: 420,
      scale: 'grande'
    })
    register()
    expect(mocks.register).toHaveBeenCalledWith('Alt+Shift+F9', expect.any(Function))
    expect(mocks.showHudWindow).toHaveBeenCalledTimes(1)
    expect(mocks.setHudWidth).toHaveBeenCalledWith(420)
    expect(mocks.acquireHwPolling).toHaveBeenCalledTimes(1)
    expect(mocks.setHudVisible).not.toHaveBeenCalled()
  })
})

describe('hud:get / hud:set-visible / hud:toggle', () => {
  it('hud:get devolve o estado atual e rejeita argumentos', () => {
    register()
    const status = getHandler('hud:get')({}) as HudStatus
    expect(status).toEqual({
      config: { shortcut: 'Control+Alt+M', visible: false, width: 300, scale: 'normal' },
      registered: true
    })
    expect(() => getHandler('hud:get')({}, 'extra')).toThrow('Requisição inválida.')
  })

  it('set-visible(true) mostra, liga o polling e persiste; false esconde e solta', async () => {
    register()

    const shown = getHandler('hud:set-visible')({}, true) as HudStatus
    expect(shown.config.visible).toBe(true)
    expect(mocks.showHudWindow).toHaveBeenCalledTimes(1)
    expect(mocks.acquireHwPolling).toHaveBeenCalledTimes(1)
    expect(mocks.onHwSnapshot).toHaveBeenCalledTimes(1)
    expect(mocks.setHudVisible).toHaveBeenCalledWith(true)

    // Primeiro push usa a leitura imediata (não espera o tick de 1 s).
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith(
      'hud:update',
      expect.objectContaining({ fps: null })
    )

    const hidden = getHandler('hud:set-visible')({}, false) as HudStatus
    expect(hidden.config.visible).toBe(false)
    expect(mocks.hideHudWindow).toHaveBeenCalledTimes(1)
    expect(mocks.releaseHwPolling).toHaveBeenCalledTimes(1)
    expect(mocks.setHudVisible).toHaveBeenLastCalledWith(false)
  })

  it('não abre um segundo timer: dois set-visible(true) usam o mesmo acquire', () => {
    register()
    getHandler('hud:set-visible')({}, true)
    getHandler('hud:set-visible')({}, true)
    expect(mocks.acquireHwPolling).toHaveBeenCalledTimes(1)
    expect(mocks.onHwSnapshot).toHaveBeenCalledTimes(1)
  })

  it('hud:toggle alterna e rejeita argumentos', () => {
    register()
    const on = getHandler('hud:toggle')({}) as HudStatus
    expect(on.config.visible).toBe(true)
    const off = getHandler('hud:toggle')({}) as HudStatus
    expect(off.config.visible).toBe(false)
    expect(() => getHandler('hud:toggle')({}, 1)).toThrow('Requisição inválida.')
  })

  it('rejeita valor de visibilidade que não é booleano', () => {
    register()
    expect(() => getHandler('hud:set-visible')({}, 'sim')).toThrow('Requisição inválida.')
  })
})

describe('hud:set-size / hud:report-size', () => {
  it('set-size persiste, aplica a largura na janela e devolve o estado', () => {
    register()
    const result = getHandler('hud:set-size')({}, { width: 420, scale: 'grande' }) as {
      success: boolean
      status: HudStatus
    }
    expect(mocks.setHudSize).toHaveBeenCalledWith({ width: 420, scale: 'grande' })
    expect(mocks.setHudWidth).toHaveBeenCalledWith(420)
    expect(result.success).toBe(true)
    expect(result.status.config.width).toBe(420)
    expect(result.status.config.scale).toBe('grande')
  })

  it('set-size recusa payload inválido sem tocar na janela', () => {
    mocks.setHudSize.mockReturnValue({ success: false, error: 'Largura inválida.' })
    register()
    mocks.setHudWidth.mockClear()
    const result = getHandler('hud:set-size')({}, { width: 'x' }) as {
      success: boolean
      error?: string
    }
    expect(result).toEqual({
      success: false,
      status: expect.any(Object),
      error: 'Largura inválida.'
    })
    expect(mocks.setHudWidth).not.toHaveBeenCalled()
  })

  it('report-size aplica a altura medida e só aceita a própria janela do HUD', () => {
    register()
    const result = getHandler('hud:report-size')(
      { sender: fakeWindow.webContents },
      { height: 512.4 }
    ) as { height: number }
    expect(mocks.setHudHeight).toHaveBeenCalledWith(513)
    expect(result).toEqual({ height: 513 })

    expect(() => getHandler('hud:report-size')({ sender: {} }, { height: 400 })).toThrow(
      'Requisição inválida.'
    )
    expect(() =>
      getHandler('hud:report-size')({ sender: fakeWindow.webContents }, { height: '400' })
    ).toThrow('Requisição inválida.')
  })
})

describe('hud:set-shortcut', () => {
  it('desregistra o antigo, registra o novo e persiste o canônico', () => {
    register()
    const result = getHandler('hud:set-shortcut')({}, 'ctrl+alt+k') as {
      success: boolean
      status: HudStatus
    }
    expect(result.success).toBe(true)
    expect(mocks.unregister).toHaveBeenCalledWith('Control+Alt+M')
    expect(mocks.register).toHaveBeenLastCalledWith('Control+Alt+K', expect.any(Function))
    expect(mocks.setHudShortcut).toHaveBeenCalledWith('Control+Alt+K')
    expect(result.status.config.shortcut).toBe('Control+Alt+K')
    expect(result.status.registered).toBe(true)
  })

  it('atalho inválido é recusado antes de registrar e não toca no store', () => {
    register()
    const callsBefore = mocks.register.mock.calls.length
    const result = getHandler('hud:set-shortcut')({}, 'sem-modificador') as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('Atalho inválido')
    expect(mocks.register.mock.calls.length).toBe(callsBefore)
    expect(mocks.setHudShortcut).not.toHaveBeenCalled()
  })

  it('registro recusado (atalho em uso) devolve erro e re-registra o anterior', () => {
    register()
    mocks.register.mockReturnValueOnce(false).mockReturnValue(true)

    const result = getHandler('hud:set-shortcut')({}, 'Control+Alt+K') as {
      success: boolean
      status: HudStatus
      error?: string
    }

    expect(result.success).toBe(false)
    expect(result.error).toContain('em uso')
    expect(mocks.setHudShortcut).not.toHaveBeenCalled()
    // novo (recusado) + anterior de volta.
    const registrations = mocks.register.mock.calls.map(([accelerator]) => accelerator)
    expect(registrations).toEqual(['Control+Alt+M', 'Control+Alt+K', 'Control+Alt+M'])
    expect(result.status.registered).toBe(true)
    expect(result.status.config.shortcut).toBe('Control+Alt+M')
  })

  it('rejeita argumentos extras no IPC', () => {
    register()
    expect(() => getHandler('hud:set-shortcut')({}, 'Control+Alt+K', 'extra')).toThrow(
      'Requisição inválida.'
    )
  })
})

describe('push hud:update', () => {
  it('usa o snapshot do polling e inclui FPS só quando há alvo ativo', () => {
    register()
    getHandler('hud:set-visible')({}, true)
    const listener = mocks.onHwSnapshot.mock.calls[0][0] as (snapshot: HwSnapshot) => void

    listener(snapshotFixture())
    expect(fakeWindow.webContents.send).toHaveBeenLastCalledWith(
      'hud:update',
      expect.objectContaining({
        snapshot: expect.objectContaining({ capturedAt: expect.any(String) }),
        size: { width: 300, scale: 'normal' }
      })
    )

    const activeUpdate = {
      state: 'running',
      active: true,
      pid: 123,
      processName: 'jogo.exe',
      fps: 144,
      frametimeMs: 6.9,
      capturedAt: '2026-11-17T12:00:01.000Z'
    }
    mocks.getFpsStatus.mockReturnValue({ state: 'running', last: activeUpdate })
    listener(snapshotFixture())
    expect(fakeWindow.webContents.send).toHaveBeenLastCalledWith(
      'hud:update',
      expect.objectContaining({ fps: activeUpdate })
    )

    // Medição rodando sem alvo ativo continua null (nunca 0 FPS).
    mocks.getFpsStatus.mockReturnValue({
      state: 'running',
      last: { ...activeUpdate, active: false, fps: null, frametimeMs: null }
    })
    listener(snapshotFixture())
    expect(fakeWindow.webContents.send).toHaveBeenLastCalledWith(
      'hud:update',
      expect.objectContaining({ fps: null })
    )
  })

  it('usa a amostra do FPS automático quando o manual não tem alvo', () => {
    register()
    getHandler('hud:set-visible')({}, true)
    const listener = mocks.onHwSnapshot.mock.calls[0][0] as (snapshot: HwSnapshot) => void
    const autoUpdate = {
      state: 'running',
      active: true,
      pid: 777,
      processName: 'jogo.exe',
      fps: 60,
      frametimeMs: 16.7,
      capturedAt: '2026-11-17T12:00:02.000Z'
    }
    mocks.getFpsAutoUpdate.mockReturnValue(autoUpdate)
    listener(snapshotFixture())
    expect(fakeWindow.webContents.send).toHaveBeenLastCalledWith(
      'hud:update',
      expect.objectContaining({ fps: autoUpdate })
    )

    // Manual com alvo ativo tem prioridade sobre o automático.
    const manual = { ...autoUpdate, pid: 999, fps: 144, capturedAt: '2026-11-17T12:00:03.000Z' }
    mocks.getFpsStatus.mockReturnValue({ state: 'running', last: manual })
    listener(snapshotFixture())
    expect(fakeWindow.webContents.send).toHaveBeenLastCalledWith(
      'hud:update',
      expect.objectContaining({ fps: manual })
    )
  })

  it('não envia para janela oculta/destruída', () => {
    register()
    getHandler('hud:set-visible')({}, true)
    const listener = mocks.onHwSnapshot.mock.calls[0][0] as (snapshot: HwSnapshot) => void
    fakeWindow.isVisible = () => false
    const callsBefore = fakeWindow.webContents.send.mock.calls.length
    listener(snapshotFixture())
    expect(fakeWindow.webContents.send.mock.calls.length).toBe(callsBefore)
  })
})

describe('will-quit', () => {
  it('solta o polling, destrói a janela e libera todos os atalhos', () => {
    register()
    getHandler('hud:set-visible')({}, true)

    willQuitHandler()()

    expect(mocks.releaseHwPolling).toHaveBeenCalledTimes(1)
    expect(mocks.destroyHudWindow).toHaveBeenCalledTimes(1)
    expect(mocks.unregisterAll).toHaveBeenCalledTimes(1)
    expect((getHandler('hud:get')({}) as HudStatus).registered).toBe(false)
  })
})
