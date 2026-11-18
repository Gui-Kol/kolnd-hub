import { describe, expect, it, vi } from 'vitest'
import { once } from './once'

describe('once', () => {
  it('chama a factory uma única vez em duas invocações e devolve o mesmo valor', async () => {
    const factory = vi.fn().mockResolvedValue(42)
    const run = once(factory)

    const [a, b] = await Promise.all([run(), run()])

    expect(factory).toHaveBeenCalledTimes(1)
    expect(a).toBe(42)
    expect(b).toBe(42)
  })

  it('devolve a mesma referência de promise nas duas invocações', () => {
    const run = once(() => Promise.resolve('x'))

    expect(run()).toBe(run())
  })

  it('memoiza a rejeição — a factory não roda de novo', async () => {
    const factory = vi.fn().mockRejectedValue(new Error('falhou'))
    const run = once(factory)

    await expect(run()).rejects.toThrow('falhou')
    await expect(run()).rejects.toThrow('falhou')
    expect(factory).toHaveBeenCalledTimes(1)
  })
})
