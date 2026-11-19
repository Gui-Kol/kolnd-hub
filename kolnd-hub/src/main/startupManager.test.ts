import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileSyncMock, execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  execFileMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('child_process', () => ({
  execFile: execFileMock,
  execFileSync: execFileSyncMock,
  spawn: spawnMock
}))

import {
  listStartupItems,
  listRunningProcesses,
  resetProcessListForTests,
  removeStartupItem,
  addStartupItem,
  removeStartupItemsBatch,
  addStartupItemsBatch,
  getPcName
} from './startupManager'

const REG_OUTPUT_ARRAY = JSON.stringify([
  { name: 'OneDrive', path: 'C:\\OneDrive\\OneDrive.exe', location: 'registro', scope: 'usuario' },
  { name: 'Kolnd Hub', path: 'C:\\Kolnd Hub\\hub.exe', location: 'registro', scope: 'sistema' }
])

const REG_OUTPUT_SINGLE = JSON.stringify({
  name: 'Kolnd Hub',
  path: 'C:\\Kolnd Hub\\hub.exe',
  location: 'registro',
  scope: 'usuario'
})

const PROC_OUTPUT = JSON.stringify([
  { Name: 'steam.exe', ProcessId: 123, ExecutablePath: 'C:\\Steam\\steam.exe' },
  { Name: 'explorer.exe', ProcessId: 456, ExecutablePath: 'C:\\Windows\\explorer.exe' }
])

beforeEach(() => {
  execFileSyncMock.mockReset()
  execFileMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * `listStartupItems` roda as 2 consultas em paralelo via `execFile`: roteia a
 * saída pelo conteúdo do script (registro × pasta), sem depender da ordem.
 */
function mockExecFileOutputs(regOut: string, folderOut: string): void {
  execFileMock.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
      const script = String(args[4] ?? '')
      cb(null, script.includes('WScript.Shell') ? folderOut : regOut, '')
      return {}
    }
  )
}

describe('listStartupItems', () => {
  it('saída em array do PowerShell → lista de itens (registro + pasta)', async () => {
    mockExecFileOutputs(
      REG_OUTPUT_ARRAY,
      JSON.stringify([
        {
          name: 'Atalho',
          path: 'C:\\Atalho\\atalho.exe',
          location: 'pasta-inicializacao',
          scope: 'usuario'
        }
      ])
    )
    const items = await listStartupItems()
    expect(items).toHaveLength(3)
    // Ordem preservada: registro primeiro, pasta depois.
    expect(items[0]).toMatchObject({
      id: 'registro:usuario:OneDrive',
      name: 'OneDrive',
      path: 'C:\\OneDrive\\OneDrive.exe',
      location: 'registro',
      scope: 'usuario'
    })
    expect(items[1].scope).toBe('sistema')
    expect(items[2]).toMatchObject({
      id: 'pasta:usuario:Atalho',
      location: 'pasta-inicializacao'
    })
    // Assíncrono: 2 execFile em paralelo, nenhum execFileSync bloqueando o main.
    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('objeto único (uma entrada) é embrulhado em array', async () => {
    mockExecFileOutputs(REG_OUTPUT_SINGLE, '[]')
    const items = await listStartupItems()
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Kolnd Hub')
  })

  it('saída vazia/JSON inválido → [] (não lança)', async () => {
    mockExecFileOutputs('', 'não é json')
    expect(await listStartupItems()).toEqual([])
  })
})

describe('listRunningProcesses', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetProcessListForTests()
  })

  it('runner injetado: devolve {name,id,path} sem execFileSync/spawn reais', async () => {
    const runner = vi.fn(async () => PROC_OUTPUT)
    const procs = await listRunningProcesses(runner)
    expect(procs).toEqual([
      { name: 'steam', id: 123, path: 'C:\\Steam\\steam.exe' },
      { name: 'explorer', id: 456, path: 'C:\\Windows\\explorer.exe' }
    ])
    expect(runner).toHaveBeenCalledTimes(1)
    expect(execFileSyncMock).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('mantém UMA consulta em voo com chamadas concorrentes', async () => {
    let release: (out: string) => void = () => undefined
    const runner = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )

    const first = listRunningProcesses(runner)
    const second = listRunningProcesses(runner)
    expect(runner).toHaveBeenCalledTimes(1)

    release(PROC_OUTPUT)
    await expect(first).resolves.toHaveLength(2)
    await expect(second).resolves.toHaveLength(2)
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('cache com TTL: chamadas repetidas dentro de 5 s não consultam de novo', async () => {
    const runner = vi.fn(async () => PROC_OUTPUT)

    const first = await listRunningProcesses(runner)
    expect(runner).toHaveBeenCalledTimes(1)

    const second = await listRunningProcesses(runner)
    expect(runner).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)

    vi.advanceTimersByTime(5001)
    await listRunningProcesses(runner)
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('JSON inválido → []', async () => {
    const procs = await listRunningProcesses(async () => '{quebrado')
    expect(procs).toEqual([])
  })
})

describe('removeStartupItem / addStartupItem', () => {
  it('remove do registro chama powershell com o nome via env', () => {
    execFileSyncMock.mockReturnValue('ok')
    const res = removeStartupItem({ location: 'registro', scope: 'usuario', name: 'Kolnd Hub' })
    expect(res.success).toBe(true)
    const [cmd, args, opts] = execFileSyncMock.mock.lastCall as [
      string,
      string[],
      { env: Record<string, string> }
    ]
    expect(cmd).toBe('powershell.exe')
    expect(args[4]).toContain('Remove-ItemProperty')
    expect(opts.env.KOLND_STARTUP_NAME).toBe('Kolnd Hub')
  })

  it('remove da pasta de inicialização filtra por BaseName', () => {
    execFileSyncMock.mockReturnValue('ok')
    const res = removeStartupItem({
      location: 'pasta-inicializacao',
      scope: 'usuario',
      name: 'Atalho'
    })
    expect(res.success).toBe(true)
    const [cmd, args] = execFileSyncMock.mock.lastCall as [
      string,
      string[],
      { env: Record<string, string> }
    ]
    expect(args[4]).toContain('BaseName -eq')
  })

  it('falha no powershell → {success: false, error}', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('acesso negado')
    })
    const res = removeStartupItem({ location: 'registro', scope: 'usuario', name: 'X' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('acesso negado')
  })

  it('addStartupItem grava a chave Run do usuário', () => {
    execFileSyncMock.mockReturnValue('ok')
    const res = addStartupItem({ name: 'App', path: 'C:\\App\\app.exe' })
    expect(res.success).toBe(true)
    const [cmd, args, opts] = execFileSyncMock.mock.lastCall as [
      string,
      string[],
      { env: Record<string, string> }
    ]
    expect(args[4]).toContain('New-ItemProperty')
    expect(opts.env.KOLND_STARTUP_NAME).toBe('App')
    expect(opts.env.KOLND_STARTUP_PATH).toBe('C:\\App\\app.exe')
  })
})

describe('batch operations', () => {
  it('removeStartupItemsBatch agrega erros e continua', () => {
    execFileSyncMock
      .mockReturnValueOnce('ok')
      .mockImplementationOnce(() => {
        throw new Error('falhou item 2')
      })
      .mockReturnValueOnce('ok')
    const res = removeStartupItemsBatch([
      { location: 'registro', scope: 'usuario', name: 'A' },
      { location: 'registro', scope: 'usuario', name: 'B' },
      { location: 'registro', scope: 'usuario', name: 'C' }
    ])
    expect(res.success).toBe(false)
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toContain('B')
  })

  it('addStartupItemsBatch bem-sucedido → success true, sem erros', () => {
    execFileSyncMock.mockReturnValue('ok')
    const res = addStartupItemsBatch([
      { name: 'A', path: 'C:\\A\\a.exe' },
      { name: 'B', path: 'C:\\B\\b.exe' }
    ])
    expect(res.success).toBe(true)
    expect(res.errors).toEqual([])
  })
})

describe('getPcName', () => {
  it('devolve o nome do computador (string não vazia)', () => {
    const name = getPcName()
    expect(typeof name).toBe('string')
    expect(name.length).toBeGreaterThan(0)
  })
})
