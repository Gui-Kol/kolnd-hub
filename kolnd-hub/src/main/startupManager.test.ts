import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn()
}))

vi.mock('child_process', () => ({ execFileSync: execFileSyncMock }))

import {
  listStartupItems,
  listRunningProcesses,
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
  { ProcessName: 'steam', Id: 123, Path: 'C:\\Steam\\steam.exe' },
  { ProcessName: 'explorer', Id: 456, Path: 'C:\\Windows\\explorer.exe' }
])

beforeEach(() => {
  execFileSyncMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('listStartupItems', () => {
  it('saída em array do PowerShell → lista de itens (registro + pasta)', () => {
    execFileSyncMock
      .mockReturnValueOnce(REG_OUTPUT_ARRAY)
      .mockReturnValueOnce('[]')
    const items = listStartupItems()
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'registro:usuario:OneDrive',
      name: 'OneDrive',
      path: 'C:\\OneDrive\\OneDrive.exe',
      location: 'registro',
      scope: 'usuario'
    })
    expect(items[1].scope).toBe('sistema')
  })

  it('objeto único (uma entrada) é embrulhado em array', () => {
    execFileSyncMock.mockReturnValueOnce(REG_OUTPUT_SINGLE).mockReturnValueOnce('[]')
    const items = listStartupItems()
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('Kolnd Hub')
  })

  it('saída vazia/JSON inválido → [] (não lança)', () => {
    execFileSyncMock.mockReturnValueOnce('').mockReturnValueOnce('não é json')
    expect(listStartupItems()).toEqual([])
  })
})

describe('listRunningProcesses', () => {
  it('parseia a lista de processos do PowerShell', () => {
    execFileSyncMock.mockReturnValueOnce(PROC_OUTPUT)
    const procs = listRunningProcesses()
    expect(procs).toEqual([
      { name: 'steam', id: 123, path: 'C:\\Steam\\steam.exe' },
      { name: 'explorer', id: 456, path: 'C:\\Windows\\explorer.exe' }
    ])
  })

  it('JSON inválido → []', () => {
    execFileSyncMock.mockReturnValueOnce('{quebrado')
    expect(listRunningProcesses()).toEqual([])
  })
})

describe('removeStartupItem / addStartupItem', () => {
  it('remove do registro chama powershell com o nome via env', () => {
    execFileSyncMock.mockReturnValue('ok')
    const res = removeStartupItem({ location: 'registro', scope: 'usuario', name: 'Kolnd Hub' })
    expect(res.success).toBe(true)
    const [cmd, args, opts] = execFileSyncMock.mock.lastCall as [string, string[], { env: Record<string, string> }]
    expect(cmd).toBe('powershell.exe')
    expect(args[4]).toContain('Remove-ItemProperty')
    expect(opts.env.KOLND_STARTUP_NAME).toBe('Kolnd Hub')
  })

  it('remove da pasta de inicialização filtra por BaseName', () => {
    execFileSyncMock.mockReturnValue('ok')
    const res = removeStartupItem({ location: 'pasta-inicializacao', scope: 'usuario', name: 'Atalho' })
    expect(res.success).toBe(true)
    const [cmd, args] = execFileSyncMock.mock.lastCall as [string, string[], { env: Record<string, string> }]
    expect(args[4]).toContain("BaseName -eq")
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
    const [cmd, args, opts] = execFileSyncMock.mock.lastCall as [string, string[], { env: Record<string, string> }]
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
