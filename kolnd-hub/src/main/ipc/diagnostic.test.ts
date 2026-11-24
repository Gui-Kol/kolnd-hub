import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  writeText: vi.fn(),
  buildDiagnosticReport: vi.fn(() => 'relatório'),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: { writeText: mocks.writeText },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../diagnostic', () => ({ buildDiagnosticReport: mocks.buildDiagnosticReport }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mocks.logError, debug: vi.fn() }
}))

import { registerDiagnosticIpc } from './diagnostic'
import type { IpcContext } from './lifecycle'

const ctx = {} as IpcContext

function call(): unknown {
  return mocks.handlers.get('diagnostic:export')?.({})
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerDiagnosticIpc(ctx)
})

describe('diagnostic:export', () => {
  it('copia o relatório para a área de transferência', () => {
    expect(call()).toEqual({ success: true })
    expect(mocks.writeText).toHaveBeenCalledWith('relatório')
  })

  it('falha vira ok=false com a mensagem', () => {
    mocks.buildDiagnosticReport.mockImplementationOnce(() => {
      throw new Error('store quebrado')
    })
    expect(call()).toEqual({ success: false, error: 'store quebrado' })
    expect(mocks.logError).toHaveBeenCalled()
  })

  it('erro não-Error também é convertido em texto', () => {
    mocks.buildDiagnosticReport.mockImplementationOnce(() => {
      throw 'cru'
    })
    expect(call()).toEqual({ success: false, error: 'cru' })
  })
})
