import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  startProcessWatch: vi.fn(),
  registerProcessConsumer: vi.fn(),
  unsubscribe: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../processWatch', () => ({
  startProcessWatch: mocks.startProcessWatch,
  registerProcessConsumer: mocks.registerProcessConsumer
}))

import { registerProcessWatchIpc } from './processWatch'
import type { IpcContext } from './lifecycle'

const ctx = { getMainWindow: () => null } as unknown as IpcContext

function call(channel: string, ...args: unknown[]): unknown {
  return mocks.handlers.get(channel)?.(...args)
}

function start(id: unknown, intervalMs: unknown, extra: Record<string, unknown> = {}): unknown {
  return call('process-watch:start', {}, { id, intervalMs, ...extra })
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  mocks.registerProcessConsumer.mockReturnValue(mocks.unsubscribe)
  registerProcessWatchIpc(ctx)
})

describe('processWatch IPC — registro', () => {
  it('liga o agendador à janela principal e registra o consumidor', () => {
    expect(mocks.startProcessWatch).toHaveBeenCalledWith(ctx)
    expect(start('games:running', 10000)).toEqual({ ok: true })
    expect(mocks.registerProcessConsumer).toHaveBeenCalledWith('games:running', 10000)
  })

  it('re-registrar o mesmo id atualiza o intervalo (sem unsubscribe manual)', () => {
    start('app:dashboard', 15000)
    start('app:dashboard', 60000)
    expect(mocks.registerProcessConsumer).toHaveBeenNthCalledWith(1, 'app:dashboard', 15000)
    expect(mocks.registerProcessConsumer).toHaveBeenNthCalledWith(2, 'app:dashboard', 60000)
    expect(mocks.unsubscribe).not.toHaveBeenCalled()
  })

  it('stop chama o unsubscribe do consumidor uma única vez', () => {
    start('games:running', 10000)
    expect(call('process-watch:stop', {}, { id: 'games:running' })).toEqual({ ok: true })
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)

    expect(call('process-watch:stop', {}, { id: 'games:running' })).toEqual({ ok: true })
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('processWatch IPC — validação', () => {
  it('rejeita aridade diferente de (evento, payload)', () => {
    expect(() => call('process-watch:start')).toThrow(/argumentos inválidos/)
    expect(() => call('process-watch:start', {})).toThrow(/argumentos inválidos/)
    expect(() => start('games:running', 10000, { extra: true })).toThrow(/payload inválido/)
    expect(() => call('process-watch:stop', {}, { id: 'games:running' }, 'x')).toThrow(
      /argumentos inválidos/
    )
  })

  it('rejeita id fora do formato com mensagem em pt-BR', () => {
    for (const id of ['', 'Games:Running', 'a'.repeat(65), 'id com espaço', 'id!', 42, null]) {
      expect(() => start(id, 10000)).toThrow(
        'id inválido: use 1 a 64 caracteres (a-z, 0-9, :, _, -)'
      )
    }
    expect(mocks.registerProcessConsumer).not.toHaveBeenCalled()
  })

  it('rejeita intervalo fora da faixa 4000–120000 ou não inteiro', () => {
    for (const intervalMs of [3999, 120001, 4000.5, Number.NaN, '10000', null]) {
      expect(() => start('games:running', intervalMs)).toThrow(
        'intervalMs inválido: use um inteiro entre 4000 e 120000'
      )
    }
    expect(start('games:running', 4000)).toEqual({ ok: true })
    expect(start('games:running', 120000)).toEqual({ ok: true })
  })

  it('rejeita payload que não é objeto ou com campos faltando/sobrando', () => {
    expect(() => call('process-watch:start', {}, null)).toThrow(/payload inválido/)
    expect(() => call('process-watch:start', {}, ['id', 10000])).toThrow(/payload inválido/)
    expect(() => call('process-watch:start', {}, { id: 'games:running' })).toThrow(
      /payload inválido/
    )
    expect(() =>
      call('process-watch:start', {}, { id: 'games:running', intervalMs: 10000, extra: 1 })
    ).toThrow(/payload inválido/)
    expect(() =>
      call('process-watch:stop', {}, { id: 'games:running', intervalMs: 10000 })
    ).toThrow(/payload inválido/)
  })

  it('stop com id inválido é rejeitado', () => {
    expect(() => call('process-watch:stop', {}, { id: 'ID INVÁLIDO' })).toThrow(/id inválido/)
  })
})
