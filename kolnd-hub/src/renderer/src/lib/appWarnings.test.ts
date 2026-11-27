import { describe, it, expect } from 'vitest'
import { APP_WARNINGS, appWarning } from './appWarnings'

describe('appWarning', () => {
  it('retorna a mensagem exata do Absolem', () => {
    expect(appWarning('absolem')).toBe('Ainda em desenvolvimento, não recomendado utilização')
  })

  it('retorna null para apps sem aviso e para id desconhecido', () => {
    expect(appWarning('kloud-games')).toBeNull()
    expect(appWarning('app-inexistente')).toBeNull()
  })

  it('mantém somente o Absolem mapeado', () => {
    expect(Object.keys(APP_WARNINGS)).toEqual(['absolem'])
  })
})
