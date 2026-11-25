import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeStream {
  written: string
  write: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
}

const fsState = vi.hoisted(() => ({
  size: 0,
  appPathThrows: false,
  mkdirThrows: false,
  renameThrows: false,
  endThrows: false,
  streams: [] as FakeStream[]
}))

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(() => {
    if (fsState.mkdirThrows) throw new Error('EACCES')
  }),
  statSync: vi.fn(() => ({ size: fsState.size })),
  renameSync: vi.fn(() => {
    if (fsState.renameThrows) throw new Error('EBUSY')
    fsState.size = 0
  }),
  createWriteStream: vi.fn(() => {
    const stream: FakeStream = {
      written: '',
      write: vi.fn((chunk: string) => {
        stream.written += chunk
        return true
      }),
      end: vi.fn(() => {
        if (fsState.endThrows) throw new Error('EPIPE')
      }),
      on: vi.fn()
    }
    fsState.streams.push(stream)
    return stream
  })
}))

vi.mock('fs', () => ({
  existsSync: fsMock.existsSync,
  mkdirSync: fsMock.mkdirSync,
  statSync: fsMock.statSync,
  renameSync: fsMock.renameSync,
  createWriteStream: fsMock.createWriteStream
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      if (fsState.appPathThrows) throw new Error('sem electron')
      return 'C:\\fake-userdata'
    }
  }
}))
vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const spawnMock = vi.hoisted(() => vi.fn())
const spawnSyncMock = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({ spawn: spawnMock, spawnSync: spawnSyncMock }))

const treeKillMock = vi.hoisted(() => vi.fn())
vi.mock('tree-kill', () => ({ default: treeKillMock }))

import {
  KILL_ALL_DEADLINE_MS,
  PERSIST_LOG_MAX_BYTES,
  ProcessManager,
  STOP_FORCE_TIMEOUT_MS,
  STOP_GRACE_MS,
  expandPath,
  resolvePath,
  setBaseDir
} from './processManager'

interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  pid?: number
  exitCode: number | null
}

function child(pid = 5000): FakeChild {
  const proc = new EventEmitter() as FakeChild
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = pid
  proc.exitCode = null
  return proc
}

function manager(persistLogs = false, logsDir: string | null = 'C:\\logs'): ProcessManager {
  return new ProcessManager({
    getAppPrefs: () => ({ persistLogs }),
    ...(logsDir ? { logsDir } : {})
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  fsState.size = 0
  fsState.appPathThrows = false
  fsState.mkdirThrows = false
  fsState.renameThrows = false
  fsState.endThrows = false
  fsState.streams.length = 0
  spawnMock.mockReset()
  spawnSyncMock.mockReset()
  treeKillMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('expandPath / resolvePath', () => {
  it('expande ~, ~/ e ~\\', () => {
    expect(expandPath('')).toBe('')
    expect(expandPath('~')).toBe(homedir())
    expect(expandPath('~/jogos')).toBe(resolve(homedir(), 'jogos'))
    expect(expandPath('~\\jogos')).toBe(resolve(homedir(), 'jogos'))
  })

  it('expande %VAR% existente e preserva variável ausente', () => {
    process.env.KOLND_TEST_VAR = 'C:\\valor'
    expect(expandPath('%KOLND_TEST_VAR%\\app.exe')).toBe('C:\\valor\\app.exe')
    expect(expandPath('%KOLND_NAO_EXISTE%\\app.exe')).toBe('%KOLND_NAO_EXISTE%\\app.exe')
    delete process.env.KOLND_TEST_VAR
  })

  it('setBaseDir muda a resolução de caminhos relativos', () => {
    setBaseDir('C:\\hub')
    expect(resolvePath('rel\\app.exe')).toBe(resolve('C:\\hub', 'rel\\app.exe'))
  })
})

describe('diretório de logs', () => {
  it('sem logsDir usa userData/logs', () => {
    const proc = child()
    spawnMock.mockReturnValue(proc)
    const instance = manager(true, null)
    expect(instance.launch('app', 'cmd', 'C:\\dir').success).toBe(true)
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(join('C:\\fake-userdata', 'logs'), {
      recursive: true
    })
  })

  it('sem Electron cai para <cwd>/logs', () => {
    fsState.appPathThrows = true
    const proc = child()
    spawnMock.mockReturnValue(proc)
    const instance = manager(true, null)
    expect(instance.launch('app', 'cmd', 'C:\\dir').success).toBe(true)
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(join(process.cwd(), 'logs'), {
      recursive: true
    })
  })

  it('roda o log quando passa de 1 MB ao abrir', () => {
    fsState.size = PERSIST_LOG_MAX_BYTES + 1
    spawnMock.mockReturnValue(child())
    const instance = manager(true)
    instance.launch('app', 'cmd', 'C:\\dir')
    expect(fsMock.renameSync).toHaveBeenCalledWith(
      join('C:\\logs', 'app.log'),
      join('C:\\logs', 'app.log.1')
    )
  })

  it('falha ao preparar a pasta não impede o launch', () => {
    fsState.mkdirThrows = true
    spawnMock.mockReturnValue(child())
    const instance = manager(true)
    expect(instance.launch('app', 'cmd', 'C:\\dir')).toEqual({ success: true })
  })

  it('rotaciona antes de escrever e sobrevive a rename/reabertura falhando', () => {
    spawnMock.mockReturnValue(child())
    const instance = manager(true)
    instance.launch('app', 'cmd', 'C:\\dir')
    const proc = spawnMock.mock.results[0].value as FakeChild

    fsState.size = PERSIST_LOG_MAX_BYTES + 1
    fsState.renameThrows = true
    fsState.mkdirThrows = true // reabertura falha após a rotação
    proc.stdout.emit('data', Buffer.from('linha'))

    expect(fsMock.renameSync).toHaveBeenCalled()
    expect(instance.getLogs('app')).toContain('linha')
  })

  it('erro ao fechar o stream no exit é engolido', () => {
    spawnMock.mockReturnValue(child())
    const instance = manager(true)
    instance.launch('app', 'cmd', 'C:\\dir')
    const proc = spawnMock.mock.results[0].value as FakeChild

    fsState.endThrows = true
    expect(() => proc.emit('close', 0)).not.toThrow()
  })
})

describe('launch — erros e defesa de segunda instância', () => {
  it('recusa comando vazio, diretório inexistente e app já em execução', () => {
    spawnMock.mockReturnValue(child())
    const instance = manager()
    expect(instance.launch('app', '   ', 'C:\\dir')).toEqual({
      success: false,
      error: 'Nenhum comando configurado'
    })

    fsMock.existsSync.mockReturnValueOnce(false)
    expect(instance.launch('app', 'cmd', 'C:\\nao-existe')).toEqual({
      success: false,
      error: `Diretório não encontrado: ${resolve('C:\\nao-existe')}`
    })

    expect(instance.launch('app', 'cmd', 'C:\\dir').success).toBe(true)
    expect(instance.launch('app', 'cmd', 'C:\\dir')).toEqual({
      success: false,
      error: 'Processo já está em execução'
    })
  })

  it('spawn lançando vira erro amigável', () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn quebrou')
    })
    expect(manager().launch('app', 'cmd', 'C:\\dir')).toEqual({
      success: false,
      error: 'spawn quebrou'
    })
  })

  it('relança matando o filho anterior que ficou vivo', () => {
    const first = child()
    spawnMock.mockReturnValueOnce(first)
    const instance = manager()
    instance.launch('app', 'cmd', 'C:\\dir')

    // close sem preencher exitCode mantém a "árvore possivelmente viva".
    first.emit('close', 0)
    spawnMock.mockReturnValueOnce(child(6000))
    expect(instance.launch('app', 'cmd', 'C:\\dir').success).toBe(true)
    expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/pid', '5000', '/T', '/F'], {
      windowsHide: true
    })
  })

  it('shell:false passa o argv separado', () => {
    spawnMock.mockReturnValue(child())
    manager().launch('app', 'C:\\app.exe --flag', 'C:\\dir', { shell: false, env: { X: '1' } })
    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\app.exe',
      ['--flag'],
      expect.objectContaining({ shell: false, env: expect.objectContaining({ X: '1' }) })
    )
  })
})

describe('status', () => {
  it('getStatus sem processo e getAllStatus após launch', () => {
    spawnMock.mockReturnValue(child())
    const instance = manager()
    expect(instance.getStatus('x')).toEqual({ status: 'stopped', logCount: 0 })

    instance.launch('app', 'cmd', 'C:\\dir')
    expect(instance.getStatus('app').status).toBe('running')
    expect(instance.getAllStatus().app.status).toBe('running')
    expect(instance.getLogs('app')).toBe('')
  })
})

describe('stop — casos de borda', () => {
  it('sem processo, já parado e sem PID', async () => {
    const instance = manager()
    await expect(instance.stop('app')).resolves.toEqual({
      success: false,
      error: 'Processo não está em execução'
    })

    const proc = child()
    spawnMock.mockReturnValue(proc)
    instance.launch('app', 'cmd', 'C:\\dir')
    proc.emit('close', 0)
    await expect(instance.stop('app')).resolves.toEqual({
      success: false,
      error: 'Processo não está em execução'
    })

    const noPid = child()
    delete noPid.pid
    spawnMock.mockReturnValue(noPid)
    instance.launch('app2', 'cmd', 'C:\\dir')
    await expect(instance.stop('app2')).resolves.toEqual({
      success: false,
      error: 'PID não encontrado'
    })
  })

  it('stop concorrente compartilha a mesma operação', async () => {
    vi.useFakeTimers()
    const proc = child()
    spawnMock.mockReturnValue(proc)
    treeKillMock.mockImplementation((_pid: number, _signal: string, cb: () => void) => cb())
    const instance = manager()
    instance.launch('app', 'cmd', 'C:\\dir')

    const first = instance.stop('app')
    const second = instance.stop('app')
    expect(second).toBe(first)

    proc.emit('close', 0)
    await expect(first).resolves.toEqual({ success: true })
  })

  it('escala para SIGKILL quando o SIGTERM não confirma a saída', async () => {
    vi.useFakeTimers()
    const proc = child()
    spawnMock.mockReturnValue(proc)
    treeKillMock.mockImplementation((_pid: number, _signal: string, cb: () => void) => cb())
    const instance = manager()
    instance.launch('app', 'cmd', 'C:\\dir')

    const stop = instance.stop('app')
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + 50)
    proc.emit('close', 1)
    await expect(stop).resolves.toEqual({ success: true })
    // SIGTERM e, depois do grace, SIGKILL.
    expect(treeKillMock.mock.calls.map((call) => call[1])).toContain('SIGKILL')
  })

  it('sem confirmação de saída devolve erro', async () => {
    vi.useFakeTimers()
    const proc = child()
    spawnMock.mockReturnValue(proc)
    treeKillMock.mockImplementation((_pid: number, _signal: string, cb: () => void) => cb())
    const instance = manager()
    instance.launch('app', 'cmd', 'C:\\dir')

    const stop = instance.stop('app')
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS + STOP_FORCE_TIMEOUT_MS + 100)
    await expect(stop).resolves.toMatchObject({ success: false })
  })
})

describe('auto-restart', () => {
  it('relança após queda quando o opt-in está ligado', async () => {
    vi.useFakeTimers()
    const first = child()
    const second = child(7000)
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const instance = new ProcessManager({ getAppPrefs: () => ({ autoRestart: true }) })
    instance.launch('app', 'cmd', 'C:\\dir')

    first.emit('close', 1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('desiste depois do limite de tentativas', async () => {
    const instance = new ProcessManager({ getAppPrefs: () => ({ autoRestart: true }) })
    const info = {
      appId: 'app',
      restartTimer: null,
      launch: { command: 'cmd', cwd: 'C:\\dir', shell: true, env: undefined }
    }
    // Três tentativas recentes esgotam o orçamento. Acesso deliberado ao estado
    // privado para não depender de quatro quedas reais.
    ;(instance as unknown as { restartAttempts: Map<string, number[]> }).restartAttempts.set(
      'app',
      [Date.now(), Date.now(), Date.now()]
    )

    ;(
      instance as unknown as { maybeScheduleAutoRestart: (i: unknown) => void }
    ).maybeScheduleAutoRestart(info)
    expect(info.restartTimer).toBeNull()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('falha do relaunch é apenas logada', async () => {
    vi.useFakeTimers()
    const first = child()
    spawnMock.mockReturnValueOnce(first)
    spawnMock.mockImplementationOnce(() => {
      throw new Error('relaunch falhou')
    })
    const instance = new ProcessManager({ getAppPrefs: () => ({ autoRestart: true }) })
    instance.launch('app', 'cmd', 'C:\\dir')
    first.emit('close', 1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })
})

describe('killAll / killAllSync', () => {
  it('killAll força a árvore dos sobreviventes do deadline', async () => {
    vi.useFakeTimers()
    const proc = child()
    spawnMock.mockReturnValue(proc)
    treeKillMock.mockImplementation(() => undefined)
    const instance = manager()
    instance.launch('app', 'cmd', 'C:\\dir')

    const kill = instance.killAll()
    await vi.advanceTimersByTimeAsync(KILL_ALL_DEADLINE_MS + 100)
    await kill
    expect(spawnSyncMock).toHaveBeenCalledWith('taskkill', ['/pid', '5000', '/T', '/F'], {
      windowsHide: true
    })
  })

  it('killAll sem processos resolve imediatamente', async () => {
    await expect(manager().killAll()).resolves.toBeUndefined()
  })

  it('killAllSync marca stopped e usa o grupo fora do Windows', () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const proc = child()
    spawnMock.mockReturnValue(proc)
    const instance = manager()
    instance.launch('app', 'cmd', 'C:\\dir')

    const events: string[] = []
    instance.on('status-change', (_id: string, status: string) => events.push(status))
    instance.killAllSync()

    expect(kill).toHaveBeenCalledWith(-5000, 'SIGKILL')
    expect(kill).toHaveBeenCalledWith(5000, 'SIGKILL')
    expect(events).toContain('stopped')
    platform.mockRestore()
  })
})
