import { describe, expect, it, vi } from 'vitest'
import { createFocusStore } from './focusStore'

describe('createFocusStore', () => {
  it('começa vazio (null) por padrão e aceita um valor inicial', () => {
    expect(createFocusStore().get()).toBeNull()
    expect(createFocusStore('game:a').get()).toBe('game:a')
  })

  it('set atualiza o valor e notifica os assinantes', () => {
    const store = createFocusStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.set('game:a')
    expect(store.get()).toBe('game:a')
    expect(listener).toHaveBeenCalledTimes(1)

    store.set('game:b')
    expect(store.get()).toBe('game:b')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('set com o mesmo id não notifica (evita re-render inútil)', () => {
    const store = createFocusStore('game:a')
    const listener = vi.fn()
    store.subscribe(listener)

    store.set('game:a')
    expect(store.get()).toBe('game:a')
    expect(listener).not.toHaveBeenCalled()

    // Voltar para o valor inicial depois de mudar é uma mudança de fato.
    store.set('game:b')
    store.set('game:b')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('set(null) limpa o foco e notifica', () => {
    const store = createFocusStore('game:a')
    const listener = vi.fn()
    store.subscribe(listener)

    store.set(null)
    expect(store.get()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('cada assinante é chamado uma vez e o cancelamento o remove', () => {
    const store = createFocusStore()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = store.subscribe(first)
    store.subscribe(second)

    store.set('game:a')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    store.set('game:b')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('cancelar durante a notificação não quebra a iteração', () => {
    const store = createFocusStore()
    const calls: string[] = []
    const unsubscribeFirst = store.subscribe(() => {
      calls.push('first')
      unsubscribeFirst()
    })
    store.subscribe(() => calls.push('second'))

    store.set('game:a')
    expect(calls).toEqual(['first', 'second'])

    store.set('game:b')
    expect(calls).toEqual(['first', 'second', 'second'])
  })

  it('instâncias são independentes', () => {
    const a = createFocusStore()
    const b = createFocusStore()
    const listenerA = vi.fn()
    a.subscribe(listenerA)

    b.set('game:b')
    expect(a.get()).toBeNull()
    expect(listenerA).not.toHaveBeenCalled()
  })
})
