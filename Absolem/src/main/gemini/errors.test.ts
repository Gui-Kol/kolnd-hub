import { describe, expect, it } from 'vitest'
import { GeminiError, classifyError, sanitizeDetail, toPublicError } from './errors'

/**
 * Erros sem `status`/`code` são o caso real do Live: o SDK devolve a mensagem
 * crua (`INVALID_ARGUMENT`, `NOT_FOUND`, `model not found`, `not supported`).
 * A classificação precisa ser `invalid` e a mensagem pública em pt-BR.
 */
describe('classifyError por mensagem', () => {
  it.each([
    'INVALID_ARGUMENT: model gemini-2.0-flash is not supported',
    'NOT_FOUND: models/gemini-2.0-flash',
    'model not found',
    'the requested model is not supported'
  ])('reconhece %s', (message) => {
    const error = classifyError(new Error(message))

    expect(error.kind).toBe('invalid')
    expect(error.retryable).toBe(false)
    expect(error.message).toBe(
      'O Gemini recusou o modelo ou a requisição. Verifique as configurações.'
    )
  })

  it('mantém a chave fora da mensagem pública', () => {
    const error = classifyError(new Error('INVALID_ARGUMENT: api_key=segredo-nao-pode-vazar'))

    const publicError = toPublicError(error)
    expect(publicError.kind).toBe('invalid')
    expect(JSON.stringify(publicError)).not.toContain('segredo-nao-pode-vazar')
  })

  it('erro sem pista continua unknown', () => {
    const error = classifyError(new Error('algo inesperado'))
    expect(error.kind).toBe('unknown')
  })

  it('não reclassifica um GeminiError já normalizado', () => {
    const original = new GeminiError('quota', 'Cota esgotada.', { retryable: true })
    expect(classifyError(original)).toBe(original)
  })
})

describe('sanitizeDetail', () => {
  it('redige a chave e reduz a uma linha', () => {
    expect(sanitizeDetail(new Error('falha  api_key=AIza-segredo\noutra linha'))).toBe(
      'falha api_key=[redigido] outra linha'
    )
  })

  it('redige só o valor e preserva o restante da URL/mensagem', () => {
    const detail = sanitizeDetail(
      new Error(
        'GET https://api.exemplo.test/v1beta/models?alt=sse&key=SEGREDO&x=1 Unexpected server response: 404'
      )
    )

    expect(detail).toContain('key=[redigido]&x=1')
    expect(detail).not.toContain('SEGREDO')
    expect(detail).toContain('Unexpected server response: 404')
  })

  it('texto vazio quando não há mensagem', () => {
    expect(sanitizeDetail({ status: 500 })).toBe('')
  })
})

describe('classifyError pelo status da mensagem', () => {
  it('Unexpected server response: 404 vira invalid com status', () => {
    const error = classifyError(
      new Error('GET https://x.test/models?key=SEGREDO Unexpected server response: 404')
    )

    expect(error.kind).toBe('invalid')
    expect(error.status).toBe(404)
    expect(error.message).toContain('Requisição inválida')
    expect(error.message).not.toContain('SEGREDO')
  })

  it('Unexpected server response: 503 vira server retryable', () => {
    const error = classifyError(
      new Error('GET https://x.test/models?key=SEGREDO Unexpected server response: 503')
    )

    expect(error.kind).toBe('server')
    expect(error.status).toBe(503)
    expect(error.retryable).toBe(true)
  })
})
