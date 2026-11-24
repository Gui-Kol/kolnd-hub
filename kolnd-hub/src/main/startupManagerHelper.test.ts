import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
  execFile: vi.fn()
}))

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
  execFileSync: mocks.execFileSync,
  execFile: mocks.execFile
}))

import {
  addStartupItem,
  addStartupItemsBatch,
  listRunningProcesses,
  resetProcessListForTests
} from './startupManager'

interface FakeHelper extends EventEmitter {
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  stderr: EventEmitter
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function fakeHelper(): FakeHelper {
  const helper = new EventEmitter() as FakeHelper
  helper.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  helper.stderr = new EventEmitter()
  helper.stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn()
  })
  helper.kill = vi.fn()
  return helper
}

function respond(helper: FakeHelper, payload: unknown): void {
  helper.stdout.emit('data', `KOLND-RESULT ${JSON.stringify(payload)}\n`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  resetProcessListForTests()
  mocks.spawn.mockReturnValue(fakeHelper())
})

afterEach(() => {
  resetProcessListForTests()
  vi.useRealTimers()
})

describe('helper persistente de processos', () => {
  it('spawna um PowerShell e lê a resposta prefixada', async () => {
    const promise = listRunningProcesses()
    const helper = mocks.spawn.mock.results[0].value as FakeHelper
    respond(helper, [
      { Name: 'Jogo.exe', ProcessId: 42, ExecutablePath: 'C:\\Jogo\\Jogo.exe' },
      { Name: 'outro', ProcessId: 43, ExecutablePath: null }
    ])

    await expect(promise).resolves.toEqual([
      { name: 'Jogo', id: 42, path: 'C:\\Jogo\\Jogo.exe' },
      { name: 'outro', id: 43, path: '' }
    ])
    expect(mocks.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-STA', '-NoProfile', '-NonInteractive', '-Command', expect.any(String)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    expect(helper.stdin.write).toHaveBeenCalledWith('processes\n')
  })

  it('reaproveita o cache por 5 s e o mesmo helper na segunda consulta', async () => {
    const first = listRunningProcesses()
    const helper = mocks.spawn.mock.results[0].value as FakeHelper
    respond(helper, [])
    await first

    await expect(listRunningProcesses()).resolves.toEqual([])
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(helper.stdin.write).toHaveBeenCalledTimes(1)
  })

  it('linhas quebradas em chunks e ruído são ignorados', async () => {
    const promise = listRunningProcesses()
    const helper = mocks.spawn.mock.results[0].value as FakeHelper
    helper.stdout.emit('data', 'ruído do WMI\nKOLND-RES')
    helper.stdout.emit(
      'data',
      'ULT [{"Name":"a.exe","ProcessId":1,"ExecutablePath":"C:\\\\a.exe"}]\r\n'
    )

    await expect(promise).resolves.toEqual([{ name: 'a', id: 1, path: 'C:\\a.exe' }])
  })

  it('timeout rejeita e encerra o helper', async () => {
    vi.useFakeTimers()
    const promise = listRunningProcesses()
    const helper = mocks.spawn.mock.results[0].value as FakeHelper
    const assertion = expect(promise).rejects.toThrow('timeout na consulta de processos')

    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(helper.stdin.end).toHaveBeenCalled()
    expect(helper.kill).toHaveBeenCalled()
  })

  it('falha ao spawnar o helper rejeita a consulta', async () => {
    mocks.spawn.mockImplementation(() => {
      throw new Error('powershell ausente')
    })
    await expect(listRunningProcesses()).rejects.toThrow('powershell ausente')
  })

  it('erro do helper rejeita e permite uma nova tentativa', async () => {
    const promise = listRunningProcesses()
    const helper = mocks.spawn.mock.results[0].value as FakeHelper
    helper.emit('error', new Error('EPIPE'))

    await expect(promise).rejects.toThrow('falha ao iniciar o helper de processos')

    const retry = listRunningProcesses()
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    const next = mocks.spawn.mock.results[1].value as FakeHelper
    respond(next, [])
    await expect(retry).resolves.toEqual([])
  })

  it('exit do helper rejeita a consulta pendente', async () => {
    const promise = listRunningProcesses()
    const helper = mocks.spawn.mock.results[0].value as FakeHelper
    helper.emit('exit', 1)
    await expect(promise).rejects.toThrow('helper de processos encerrou')
  })

  it('reset encerra o helper tolerando pipes já fechados', () => {
    const helper = fakeHelper()
    helper.stdin.end.mockImplementation(() => {
      throw new Error('já fechado')
    })
    helper.kill.mockImplementation(() => {
      throw new Error('já saiu')
    })
    mocks.spawn.mockReturnValue(helper)

    const pending = listRunningProcesses()
    pending.catch(() => undefined)
    expect(() => resetProcessListForTests()).not.toThrow()
  })
})

describe('adição de itens de inicialização — falhas', () => {
  it('addStartupItem converte exceção do PowerShell em erro', () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('acesso negado')
    })
    expect(addStartupItem({ name: 'App', path: 'C:\\app.exe' })).toEqual({
      success: false,
      error: 'acesso negado'
    })

    expect(
      addStartupItemsBatch([
        { name: 'A', path: 'C:\\a.exe' },
        { name: 'B', path: 'C:\\b.exe' }
      ])
    ).toEqual({
      success: false,
      errors: ['A: acesso negado', 'B: acesso negado']
    })
  })
})
