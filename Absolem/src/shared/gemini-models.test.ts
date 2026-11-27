import { describe, expect, it } from 'vitest'
import {
  GEMINI_LIVE_MODEL_OPTIONS,
  GEMINI_TEXT_MODEL_OPTIONS,
  isGeminiLiveModel,
  isGeminiTextModel
} from './gemini-models'

describe('catálogo de modelos Gemini', () => {
  it('mantém catálogo de texto separado do catálogo Live', () => {
    expect(GEMINI_TEXT_MODEL_OPTIONS.map((option) => option.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-4-hydrogen',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3-flash',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite'
    ])
    expect(GEMINI_LIVE_MODEL_OPTIONS.map((option) => option.id)).toEqual([
      'gemini-3.8-live',
      'gemini-3-flash-live',
      'gemini-2.5-flash-native-audio-dialog',
      'gemini-3.8-live-extended-thinking'
    ])
  })

  it('expõe labels pt-BR e não inclui categorias fora do escopo', () => {
    expect(GEMINI_TEXT_MODEL_OPTIONS.every((option) => option.label.length > 0)).toBe(true)
    expect(GEMINI_LIVE_MODEL_OPTIONS.every((option) => option.label.length > 0)).toBe(true)
    expect(
      [...GEMINI_TEXT_MODEL_OPTIONS, ...GEMINI_LIVE_MODEL_OPTIONS].some((option) =>
        /tts|imagem|embedding|agent|transcri/i.test(option.id)
      )
    ).toBe(false)
  })

  it('reconhece somente modelos no catálogo correspondente', () => {
    expect(isGeminiTextModel('gemini-3.8-flash')).toBe(true)
    expect(isGeminiTextModel('gemini-3.8-live')).toBe(false)
    expect(isGeminiTextModel('modelo-personalizado')).toBe(false)
    expect(isGeminiLiveModel('gemini-3.8-live')).toBe(true)
    expect(isGeminiLiveModel('gemini-3.8-flash')).toBe(false)
    expect(isGeminiLiveModel(undefined)).toBe(false)
  })
})
