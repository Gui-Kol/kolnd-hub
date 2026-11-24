import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openPath: vi.fn(),
  getPath: vi.fn(() => 'C:\\fake\\userdata'),
  mkdirSync: vi.fn(),
  killProcessesForCommand: vi.fn(),
  invalidateKloudGamesRunningCache: vi.fn(),
  stopKloudGamesElevated: vi.fn(),
  getMarkLviDataDir: vi.fn(() => 'C:\\fake\\userdata\\mark-lvi'),
  isAnyUninstallInProgress: vi.fn(() => false),
  shutdownHub: vi.fn(),
  logWarn: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  },
  shell: { openPath: mocks.openPath },
  app: { getPath: mocks.getPath }
}))
vi.mock('fs', () => ({ mkdirSync: mocks.mkdirSync }))
vi.mock('../processKiller', () => ({ killProcessesForCommand: mocks.killProcessesForCommand }))
vi.mock('../kloudGames', () => ({
  invalidateKloudGamesRunningCache: mocks.invalidateKloudGamesRunningCache,
  stopKloudGamesElevated: mocks.stopKloudGamesElevated
}))
vi.mock('../programsDeployer', () => ({ getMarkLviDataDir: mocks.getMarkLviDataDir }))
vi.mock('../uninstaller', () => ({ isAnyUninstallInProgress: mocks.isAnyUninstallInProgress }))
vi.mock('./lifecycle', () => ({ shutdownHub: mocks.shutdownHub }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import { registerAppIpc } from './app'
import type { IpcContext } from './lifecycle'

const processManager = {
  launch: vi.fn(),
  stop: vi.fn(),
  getStatus: vi.fn(),
  getAllStatus: vi.fn(),
  getLogs: vi.fn()
}
const ctx = { getMainWindow: () => null, processManager } as unknown as IpcContext

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  mocks.isAnyUninstallInProgress.mockReturnValue(false)
  registerAppIpc(ctx)
})

describe('app:launch', () => {
  it('recusa parâmetros de tipo errado', async () => {
    expect(await call('app:launch', 1, 'cmd', 'cwd')).toEqual({
      success: false,
      error: 'Parâmetros inválidos para app:launch'
    })
    expect(processManager.launch).not.toHaveBeenCalled()
  })

  it('valida id, comando e diretório', async () => {
    expect(await call('app:launch', '   ', 'cmd', 'cwd')).toEqual({
      success: false,
      error: 'appId inválido'
    })
    expect(await call('app:launch', 'a'.repeat(101), 'cmd', 'cwd')).toEqual({
      success: false,
      error: 'appId inválido'
    })
    expect(await call('app:launch', 'id', '  ', 'cwd')).toEqual({
      success: false,
      error: 'Comando vazio ou longo demais'
    })
    expect(await call('app:launch', 'id', 'x'.repeat(4097), 'cwd')).toEqual({
      success: false,
      error: 'Comando vazio ou longo demais'
    })
    expect(await call('app:launch', 'id', 'cmd', 'x'.repeat(1025))).toEqual({
      success: false,
      error: 'Diretório de trabalho longo demais'
    })
  })

  it('lança com shell ligado por padrão e repassa o trim', async () => {
    processManager.launch.mockResolvedValue({ success: true })
    expect(await call('app:launch', ' app1 ', ' run.exe ', ' C:\\app ', undefined)).toEqual({
      success: true
    })
    expect(processManager.launch).toHaveBeenCalledWith('app1', 'run.exe', 'C:\\app', {
      shell: true,
      env: undefined
    })
  })

  it('useShell=false é preservado e Mark LVI recebe MARK_LVI_HOME', async () => {
    processManager.launch.mockResolvedValue({ success: true })
    await call('app:launch', 'mark-lvi', 'MarkLVI.exe', 'C:\\mark', false)
    expect(processManager.launch).toHaveBeenCalledWith('mark-lvi', 'MarkLVI.exe', 'C:\\mark', {
      shell: false,
      env: { MARK_LVI_HOME: 'C:\\fake\\userdata\\mark-lvi' }
    })
  })
})

describe('app:stop', () => {
  it('recusa parâmetros inválidos', async () => {
    expect(await call('app:stop', 1)).toEqual({
      success: false,
      error: 'Parâmetros inválidos para app:stop'
    })
    expect(await call('app:stop', 'id', 5)).toEqual({
      success: false,
      error: 'Parâmetros inválidos para app:stop'
    })
  })

  it('para app comum com sucesso', async () => {
    processManager.stop.mockResolvedValue({ success: true })
    expect(await call('app:stop', 'app1')).toEqual({ success: true })
  })

  it('app comum sem sucesso e sem comando devolve o resultado original', async () => {
    processManager.stop.mockResolvedValue({ success: false, error: 'x' })
    expect(await call('app:stop', 'app1')).toEqual({ success: false, error: 'x' })
    expect(mocks.killProcessesForCommand).not.toHaveBeenCalled()
  })

  it('app comum órfão cai no kill por comando', async () => {
    processManager.stop.mockResolvedValue({ success: false })
    mocks.killProcessesForCommand.mockResolvedValue({ success: true, killed: [1] })
    expect(await call('app:stop', 'app1', 'C:\\app\\app.exe')).toEqual({
      success: true,
      killed: [1]
    })
    expect(mocks.killProcessesForCommand).toHaveBeenCalledWith('C:\\app\\app.exe')
  })

  it('Kloud Games com sucesso invalida o cache e devolve o resultado', async () => {
    processManager.stop.mockResolvedValue({ success: true })
    expect(await call('app:stop', 'kloud-games')).toEqual({ success: true })
    expect(mocks.invalidateKloudGamesRunningCache).toHaveBeenCalledTimes(1)
    expect(mocks.stopKloudGamesElevated).not.toHaveBeenCalled()
  })

  it('Kloud Games elevado com sucesso encerra sem fallback', async () => {
    processManager.stop.mockResolvedValue({ success: false })
    mocks.stopKloudGamesElevated.mockResolvedValue({ success: true })
    expect(await call('app:stop', 'kloud-games', 'KLOUD_GAMES.exe')).toEqual({ success: true })
    expect(mocks.killProcessesForCommand).not.toHaveBeenCalled()
  })

  it('Kloud Games: elevado falha e o fallback por nome funciona', async () => {
    processManager.stop.mockResolvedValue({ success: false })
    mocks.stopKloudGamesElevated.mockResolvedValue({ success: false, error: 'elevado falhou' })
    mocks.killProcessesForCommand.mockResolvedValue({ success: true, killed: [5] })
    expect(await call('app:stop', 'kloud-games', 'KLOUD_GAMES.exe')).toEqual({
      success: true,
      killed: [5]
    })
  })

  it('Kloud Games: tudo falha devolve o erro da tentativa elevada', async () => {
    processManager.stop.mockResolvedValue({ success: false })
    mocks.stopKloudGamesElevated.mockResolvedValue({ success: false, error: 'elevado falhou' })
    mocks.killProcessesForCommand.mockResolvedValue({ success: false, error: 'sem processo' })
    expect(await call('app:stop', 'kloud-games', 'KLOUD_GAMES.exe')).toEqual({
      success: false,
      error: 'elevado falhou'
    })
  })

  it('Kloud Games sem comando não tenta o fallback por nome', async () => {
    processManager.stop.mockResolvedValue({ success: false })
    mocks.stopKloudGamesElevated.mockResolvedValue({ success: false, error: 'elevado falhou' })
    expect(await call('app:stop', 'kloud-games')).toEqual({
      success: false,
      error: 'elevado falhou'
    })
    expect(mocks.killProcessesForCommand).not.toHaveBeenCalled()
  })
})

describe('app:status / app:all-status / app:logs', () => {
  it('app:status valida o id e delega', async () => {
    expect(await call('app:status', 42)).toEqual({ status: 'stopped', logCount: 0 })
    processManager.getStatus.mockReturnValue({ status: 'running', logCount: 3 })
    expect(await call('app:status', 'app1')).toEqual({ status: 'running', logCount: 3 })
    expect(processManager.getStatus).toHaveBeenCalledWith('app1')
  })

  it('app:all-status devolve o mapa do processManager', async () => {
    processManager.getAllStatus.mockReturnValue({ a: { status: 'running', logCount: 1 } })
    expect(await call('app:all-status')).toEqual({ a: { status: 'running', logCount: 1 } })
  })

  it('app:logs valida o id e delega', async () => {
    expect(await call('app:logs', null)).toBe('')
    processManager.getLogs.mockReturnValue('linha')
    expect(await call('app:logs', 'app1')).toBe('linha')
  })
})

describe('app:open-logs-folder', () => {
  it('cria a pasta e abre no Explorer', async () => {
    mocks.openPath.mockResolvedValue('')
    expect(await call('app:open-logs-folder')).toEqual({ success: true })
    expect(mocks.mkdirSync).toHaveBeenCalledWith('C:\\fake\\userdata\\logs', { recursive: true })
    expect(mocks.openPath).toHaveBeenCalledWith('C:\\fake\\userdata\\logs')
  })

  it('falha do shell.openPath é repassada', async () => {
    mocks.openPath.mockResolvedValue('sem associação')
    expect(await call('app:open-logs-folder')).toEqual({
      success: false,
      error: 'sem associação'
    })
  })

  it('exceção vira erro amigável e warning', async () => {
    mocks.mkdirSync.mockImplementationOnce(() => {
      throw new Error('sem permissão')
    })
    expect(await call('app:open-logs-folder')).toEqual({
      success: false,
      error: 'sem permissão'
    })
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('app:shutdown', () => {
  it('bloqueia durante uma desinstalação destrutiva', async () => {
    mocks.isAnyUninstallInProgress.mockReturnValue(true)
    expect(await call('app:shutdown')).toEqual({
      success: false,
      error: 'Uma desinstalação está em andamento — aguarde o término.'
    })
    expect(mocks.shutdownHub).not.toHaveBeenCalled()
  })

  it('fora da desinstalação, encerra o Hub', async () => {
    expect(await call('app:shutdown')).toEqual({ success: true })
    expect(mocks.shutdownHub).toHaveBeenCalledWith(ctx)
  })
})
