import { describe, expect, it } from 'vitest'
import { isQuitting, markQuitting } from './quitState'

// O módulo guarda um único booleano de processo — os testes rodam em ordem.
describe('quitState', () => {
  it('começa em false (fechar a janela esconde na bandeja)', () => {
    expect(isQuitting()).toBe(false)
  })

  it('markQuitting passa a devolver true de forma permanente', () => {
    markQuitting()
    expect(isQuitting()).toBe(true)
    markQuitting()
    expect(isQuitting()).toBe(true)
  })
})
