import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve('')),
  resolvePath: vi.fn((path: string) => path),
  logWarn: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  },
  shell: { openExternal: mocks.openExternal, openPath: mocks.openPath }
}))
vi.mock('../processManager', () => ({ resolvePath: mocks.resolvePath }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import { isAllowedExternalUrl, registerShellIpc } from './shell'
import type { IpcContext } from './lifecycle'

const ctx = {} as IpcContext

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  mocks.openExternal.mockResolvedValue(undefined)
  registerShellIpc(ctx)
})

describe('isAllowedExternalUrl', () => {
  it('aceita https, http e mailto (qualquer caixa)', () => {
    expect(isAllowedExternalUrl('https://exemplo.com')).toBe(true)
    expect(isAllowedExternalUrl('HTTP://exemplo.com')).toBe(true)
    expect(isAllowedExternalUrl('mailto:suporte@exemplo.com')).toBe(true)
  })

  it('bloqueia esquemas perigosos ou desconhecidos', () => {
    expect(isAllowedExternalUrl('file:///C:/Windows')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('data:text/html,x')).toBe(false)
    expect(isAllowedExternalUrl('ftp://exemplo.com')).toBe(false)
    expect(isAllowedExternalUrl('steam://run/123')).toBe(false)
  })

  it('URL inválida → false', () => {
    expect(isAllowedExternalUrl('')).toBe(false)
    expect(isAllowedExternalUrl('não é url')).toBe(false)
  })
})

describe('shell:openExternal', () => {
  it('abre URLs permitidas', () => {
    call('shell:openExternal', 'https://exemplo.com')
    expect(mocks.openExternal).toHaveBeenCalledWith('https://exemplo.com')
    expect(mocks.logWarn).not.toHaveBeenCalled()
  })

  it('bloqueia não-string e esquemas fora da allowlist', () => {
    call('shell:openExternal', 42)
    call('shell:openExternal', 'file:///C:/secret.txt')
    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(mocks.logWarn).toHaveBeenCalledTimes(2)
  })
})

describe('shell:openPath', () => {
  it('resolve e abre caminhos válidos', () => {
    mocks.resolvePath.mockReturnValueOnce('C:\\resolvido')
    call('shell:openPath', '%APPDATA%\\kolnd-hub')
    expect(mocks.resolvePath).toHaveBeenCalledWith('%APPDATA%\\kolnd-hub')
    expect(mocks.openPath).toHaveBeenCalledWith('C:\\resolvido')
  })

  it('ignora não-string, vazio e caminho longo demais', () => {
    call('shell:openPath', null)
    call('shell:openPath', '   ')
    call('shell:openPath', 'x'.repeat(1025))
    expect(mocks.openPath).not.toHaveBeenCalled()
  })
})
