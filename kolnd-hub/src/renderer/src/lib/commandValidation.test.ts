import { describe, expect, it } from 'vitest'
import {
  commandSignature,
  mergeValidationResults,
  pendingValidations,
  type CommandValidationCache,
  type ValidatableApp
} from './commandValidation'

// O efeito de Configurações precisa saber SOMENTE o que ficou desatualizado —
// validar tudo a cada tecla custa uma IPC por app e polui a UI com resultados
// de comandos que o usuário nem tocou. Os testes cobrem a decisão pura.
const apps: ValidatableApp[] = [
  { id: 'a', command: 'C:\\a.exe', useShell: true },
  { id: 'b', command: 'b.exe --flag', useShell: false },
  { id: 'c', command: 'c.exe', useShell: undefined }
]

// Cache equivalente a "tudo já validado" para a lista recebida.
const cacheFor = (list: ValidatableApp[]): CommandValidationCache =>
  Object.fromEntries(
    list.map((app) => [
      app.id,
      {
        signature: commandSignature(app.command, app.useShell !== false),
        issues: []
      }
    ])
  )

describe('commandSignature', () => {
  it('distingue o par comando + modo shell', () => {
    expect(commandSignature('a.exe', true)).not.toBe(commandSignature('a.exe', false))
    expect(commandSignature('a.exe', true)).toBe(commandSignature('a.exe', true))
    // Sem colisão entre pares diferentes (o separador NUL existe para isso).
    expect(commandSignature('a.exe\u00000', false)).not.toBe(commandSignature('a.exe', false))
  })
})

describe('pendingValidations', () => {
  it('cache vazio devolve todos os apps na ordem da lista', () => {
    expect(pendingValidations({}, apps)).toEqual([
      { id: 'a', command: 'C:\\a.exe', useShell: true },
      { id: 'b', command: 'b.exe --flag', useShell: false },
      // `undefined` significa ligado (default preservado do app).
      { id: 'c', command: 'c.exe', useShell: true }
    ])
  })

  it('cache com assinaturas iguais não devolve nada', () => {
    expect(pendingValidations(cacheFor(apps), apps)).toEqual([])
  })

  it('mudar um caractere do comando pendencia só aquele app', () => {
    const edited: ValidatableApp[] = [apps[0], { ...apps[1], command: 'b.exe --flah' }, apps[2]]
    expect(pendingValidations(cacheFor(apps), edited)).toEqual([
      { id: 'b', command: 'b.exe --flah', useShell: false }
    ])
  })

  it('alternar useShell pendencia só aquele app', () => {
    const edited: ValidatableApp[] = [apps[0], { ...apps[1], useShell: true }, apps[2]]
    expect(pendingValidations(cacheFor(apps), edited)).toEqual([
      { id: 'b', command: 'b.exe --flag', useShell: true }
    ])
  })

  it('app removido da lista não aparece no resultado', () => {
    const edited: ValidatableApp[] = [apps[0], { ...apps[1], command: 'b.exe' }]
    expect(pendingValidations(cacheFor(apps), edited)).toEqual([
      { id: 'b', command: 'b.exe', useShell: false }
    ])
  })

  it('lista vazia devolve nenhuma pendência', () => {
    expect(pendingValidations(cacheFor(apps), [])).toEqual([])
    expect(pendingValidations({}, [])).toEqual([])
  })
})

describe('mergeValidationResults', () => {
  it('sobrescreve só as entradas devolvidas e mantém as demais', () => {
    const cache = cacheFor(apps)
    const results: CommandValidationCache = {
      b: {
        signature: commandSignature('b.exe --flah', false),
        issues: [{ level: 'error', message: 'binário não encontrado' }]
      }
    }

    const merged = mergeValidationResults(cache, results)

    expect(merged.b).toEqual(results.b)
    expect(merged.a).toEqual(cache.a)
    expect(merged.c).toEqual(cache.c)
    // O cache recebido não é mutado (o componente troca o ref pelo novo objeto).
    expect(cache.b.issues).toEqual([])
  })

  it('resultado vazio devolve uma cópia equivalente do cache', () => {
    const cache = cacheFor(apps)
    const merged = mergeValidationResults(cache, {})
    expect(merged).toEqual(cache)
    expect(merged).not.toBe(cache)
  })
})
