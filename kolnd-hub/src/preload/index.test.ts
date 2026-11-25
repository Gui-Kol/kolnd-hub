// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(async (..._args: unknown[]) => null),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener
  }
}))

type Api = Record<string, (...args: unknown[]) => unknown>

let api: Api

beforeAll(async () => {
  await import('./index')
  api = mocks.exposeInMainWorld.mock.calls[0][1] as Api
})

beforeEach(() => {
  mocks.invoke.mockClear()
  mocks.on.mockClear()
  mocks.removeListener.mockClear()
})

describe('preload — contrato de window.api', () => {
  it('expõe o objeto "api" com a superfície completa', () => {
    expect(mocks.exposeInMainWorld).toHaveBeenCalledWith('api', expect.any(Object))
    expect(Object.keys(api).length).toBeGreaterThanOrEqual(80)
    for (const key of [
      'systemPcName',
      'getGames',
      'getGameCollections',
      'createGameCollection',
      'pickGameCover',
      'setGameCover',
      'getGameCover',
      'launchApp',
      'onStatusChanged',
      'firstRunCheck',
      'hwmonSnapshot',
      'hudGet',
      'remoteSetZeroTierOpen',
      'uninstallHub',
      'onUninstallComplete',
      'checkForUpdates'
    ]) {
      expect(api[key]).toBeTypeOf('function')
    }
  })

  it('encaminha os canais principais com os argumentos certos', async () => {
    await api.systemPcName()
    expect(mocks.invoke).toHaveBeenLastCalledWith('system:pc-name')

    await api.launchApp('app1', 'run.exe', 'C:\\app', false)
    expect(mocks.invoke).toHaveBeenLastCalledWith('app:launch', 'app1', 'run.exe', 'C:\\app', false)

    await api.getRunningGames(['a', 'b'])
    expect(mocks.invoke).toHaveBeenLastCalledWith('games:running-map', ['a', 'b'])

    await api.importGames()
    expect(mocks.invoke).toHaveBeenLastCalledWith('games:import-all')

    await api.getGameCollections()
    expect(mocks.invoke).toHaveBeenLastCalledWith('games:collections')

    await api.createGameCollection('RPG')
    expect(mocks.invoke).toHaveBeenLastCalledWith('games:collection-create', 'RPG')

    await api.removeGames(['g1', 'g2'])
    expect(mocks.invoke).toHaveBeenLastCalledWith('games:remove-many', ['g1', 'g2'])

    await api.pickGameCover()
    expect(mocks.invoke).toHaveBeenLastCalledWith('games:pick-cover')

    await api.setGameCover('g1', 'data:image/png;base64,xx')
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      'games:set-cover',
      'g1',
      'data:image/png;base64,xx'
    )

    await api.getGameCover('g1')
    expect(mocks.invoke).toHaveBeenLastCalledWith('games:get-cover', 'g1')

    await api.upgradeOneUpdate('Git.Git')
    expect(mocks.invoke).toHaveBeenLastCalledWith('winget:upgrade-one', { id: 'Git.Git' })

    await api.installUpdate(42)
    expect(mocks.invoke).toHaveBeenLastCalledWith('updates:install', 42)

    await api.setFullScreen(true)
    expect(mocks.invoke).toHaveBeenLastCalledWith('window:set-fullscreen', true)

    await api.importConfigPreview()
    expect(mocks.invoke).toHaveBeenLastCalledWith('config:import', { mode: 'preview' })

    await api.importConfigApply()
    expect(mocks.invoke).toHaveBeenLastCalledWith('config:import', { mode: 'apply' })

    await api.uninstallHub({ wipeUserData: true })
    expect(mocks.invoke).toHaveBeenLastCalledWith('uninstall:hub', { wipeUserData: true })

    await api.hudReportSize(300)
    expect(mocks.invoke).toHaveBeenLastCalledWith('hud:report-size', { height: 300 })

    await api.remoteSetZeroTierOpen(false)
    expect(mocks.invoke).toHaveBeenLastCalledWith('remote:set-zerotier-open', false)
  })

  it('todos os métodos invoke encaminham um canal string sem lançar', async () => {
    for (const [key, fn] of Object.entries(api)) {
      if (key.startsWith('on')) continue
      await expect(Promise.resolve(fn('x', 'y', 0, true))).resolves.toBeDefined()
    }
    expect(mocks.invoke.mock.calls.length).toBeGreaterThan(60)
    for (const call of mocks.invoke.mock.calls) {
      expect(typeof call[0]).toBe('string')
    }
  })

  it('todos os métodos "on" registram o canal e removem o MESMO handler', () => {
    for (const [key, fn] of Object.entries(api)) {
      if (!key.startsWith('on')) continue
      const callback = vi.fn()
      const unsubscribe = fn(callback as never) as () => void
      expect(mocks.on).toHaveBeenCalled()
      const [channel, handler] = mocks.on.mock.calls.at(-1) as [string, unknown]
      expect(typeof channel).toBe('string')

      // O handler repassa o payload (sem o objeto de evento) ao callback.
      ;(handler as (event: unknown, payload: unknown) => void)({ sender: 'main' }, { value: 1 })
      expect(callback).toHaveBeenCalled()

      unsubscribe()
      expect(mocks.removeListener).toHaveBeenLastCalledWith(channel, handler)
    }
  })

  it('eventos específicos usam os canais documentados', () => {
    api.onHudStatus(vi.fn() as never)
    expect(mocks.on).toHaveBeenLastCalledWith('hud:status', expect.any(Function))

    api.onUninstallProgress(vi.fn() as never)
    expect(mocks.on).toHaveBeenLastCalledWith('uninstall:progress', expect.any(Function))

    api.onStatusChanged(vi.fn() as never)
    expect(mocks.on).toHaveBeenLastCalledWith('app:status-changed', expect.any(Function))
  })

  it('onStatusChanged repassa appId e status separadamente', () => {
    const callback = vi.fn()
    api.onStatusChanged(callback as never)
    const [, handler] = mocks.on.mock.calls.at(-1) as [string, (...args: unknown[]) => void]
    handler({}, 'app1', 'running')
    expect(callback).toHaveBeenCalledWith('app1', 'running')
  })
})
