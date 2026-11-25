import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  resolvePowershellPath: vi.fn(
    () => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  )
}))

vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./systemPaths', () => ({ resolvePowershellPath: mocks.resolvePowershellPath }))

import { runPowerShell, runPowerShellCommand, runProcess } from './powershell'

interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function child(): FakeChild {
  const proc = new EventEmitter() as FakeChild
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  proc.kill = vi.fn()
  return proc
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('runProcess', () => {
  it('acumula stdout/stderr e devolve o código de saída', async () => {
    const proc = child()
    mocks.spawn.mockReturnValue(proc)
    const promise = runProcess('cmd.exe', ['/c', 'echo'], 'entrada', 5000)

    proc.stdout.emit('data', Buffer.from('saída'))
    proc.stderr.emit('data', Buffer.from('erro'))
    proc.emit('close', 0)

    await expect(promise).resolves.toEqual({
      stdout: 'saída',
      stderr: 'erro',
      code: 0,
      timedOut: false
    })
    expect(proc.stdin.end).toHaveBeenCalledWith('entrada')
    expect(mocks.spawn).toHaveBeenCalledWith('cmd.exe', ['/c', 'echo'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
  })

  it('sem stdin envia string vazia', async () => {
    const proc = child()
    mocks.spawn.mockReturnValue(proc)
    const promise = runProcess('cmd', [], null, 1000)
    proc.emit('close', 1)
    await promise
    expect(proc.stdin.end).toHaveBeenCalledWith('')
  })

  it('falha do spawn devolve o erro em stderr', async () => {
    mocks.spawn.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    await expect(runProcess('x', [], null, 1000)).resolves.toEqual({
      stdout: '',
      stderr: 'Error: ENOENT',
      code: null,
      timedOut: false
    })
  })

  it('erro do processo inclui stderr anterior', async () => {
    const proc = child()
    mocks.spawn.mockReturnValue(proc)
    const withStderr = runProcess('cmd', [], null, 1000)
    proc.stderr.emit('data', Buffer.from('aviso'))
    proc.emit('error', new Error('EACCES'))
    await expect(withStderr).resolves.toMatchObject({ stderr: 'aviso\nEACCES' })

    const noStderr = child()
    mocks.spawn.mockReturnValue(noStderr)
    const plain = runProcess('cmd', [], null, 1000)
    noStderr.emit('error', new Error('ENOENT'))
    await expect(plain).resolves.toMatchObject({ stderr: 'ENOENT' })
  })

  it('timeout mata o processo e marca timedOut', async () => {
    vi.useFakeTimers()
    const proc = child()
    mocks.spawn.mockReturnValue(proc)
    const promise = runProcess('cmd', [], null, 1000)
    proc.stdout.emit('data', Buffer.from('parcial'))

    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toEqual({
      stdout: 'parcial',
      stderr: '',
      code: null,
      timedOut: true
    })
    expect(proc.kill).toHaveBeenCalled()
  })

  it('kill lançando no timeout não impede o resultado', async () => {
    vi.useFakeTimers()
    const proc = child()
    proc.kill.mockImplementation(() => {
      throw new Error('já morreu')
    })
    mocks.spawn.mockReturnValue(proc)
    const promise = runProcess('cmd', [], null, 100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).resolves.toMatchObject({ timedOut: true })
  })

  it('stdin.end lançando não quebra', async () => {
    const proc = child()
    proc.stdin.end.mockImplementation(() => {
      throw new Error('EPIPE')
    })
    mocks.spawn.mockReturnValue(proc)
    const promise = runProcess('cmd', [], 'x', 1000)
    proc.emit('close', 0)
    await expect(promise).resolves.toMatchObject({ code: 0 })
  })
})

describe('runPowerShell / runPowerShellCommand', () => {
  it('resolve o executável e repassa args/stdin', async () => {
    const proc = child()
    mocks.spawn.mockReturnValue(proc)
    const promise = runPowerShell(['-Command', 'x'], 2000, 'stdin')
    proc.emit('close', 0)
    await promise
    expect(mocks.spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-Command', 'x'],
      expect.any(Object)
    )
    expect(proc.stdin.end).toHaveBeenCalledWith('stdin')
  })

  it('runPowerShellCommand monta os argumentos padrão', async () => {
    const proc = child()
    mocks.spawn.mockReturnValue(proc)
    const promise = runPowerShellCommand('Get-Date', 3000)
    proc.emit('close', 0)
    await promise
    expect(mocks.spawn.mock.calls[0][1]).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-Date'
    ])
  })
})
