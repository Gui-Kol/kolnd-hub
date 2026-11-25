import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ quit: vi.fn() }))

vi.mock('electron', () => ({ app: { quit: mocks.quit } }))

import { shutdownHub } from './lifecycle'
import type { IpcContext } from './lifecycle'

function context(killAll: ReturnType<typeof vi.fn>, window: unknown): IpcContext {
  return {
    getMainWindow: () => window as never,
    processManager: { killAll } as never
  }
}

beforeEach(() => {
  mocks.quit.mockReset()
})

describe('shutdownHub', () => {
  it('mata todos os processos, destrói a janela e encerra o Electron', async () => {
    const killAll = vi.fn().mockResolvedValue(undefined)
    const destroy = vi.fn()

    await shutdownHub(context(killAll, { destroy }))

    expect(killAll).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(mocks.quit).toHaveBeenCalledTimes(1)
  })

  it('sem janela principal ainda encerra o app', async () => {
    const killAll = vi.fn().mockResolvedValue(undefined)
    await shutdownHub(context(killAll, null))
    expect(mocks.quit).toHaveBeenCalledTimes(1)
  })

  it('killAll rejeitando não impede o encerramento', async () => {
    const killAll = vi.fn().mockRejectedValue(new Error('falha inesperada'))
    const destroy = vi.fn()

    await expect(shutdownHub(context(killAll, { destroy }))).resolves.toBeUndefined()
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(mocks.quit).toHaveBeenCalledTimes(1)
  })
})
