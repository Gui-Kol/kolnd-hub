import { describe, expect, it } from 'vitest'
import {
  VOICE_STATE_LABELS,
  VOICE_STATES,
  canTransition,
  isVoiceState,
  normalizeVoiceState
} from './voice'

describe('máquina de estados da voz', () => {
  it('transições inválidas são rejeitadas', () => {
    expect(canTransition('off', 'connecting')).toBe(true)
    expect(canTransition('off', 'speaking')).toBe(false)
    expect(canTransition('listening', 'speaking')).toBe(false)
    expect(canTransition('listening', 'thinking')).toBe(true)
    expect(canTransition('connecting', 'listening')).toBe(true)
    expect(canTransition('error', 'off')).toBe(true)
    expect(canTransition('error', 'listening')).toBe(false)
    expect(normalizeVoiceState('inventado')).toBe('off')
    expect(isVoiceState('speaking')).toBe(true)
  })

  it('speaking só a partir de thinking', () => {
    for (const state of VOICE_STATES) {
      if (state === 'thinking') continue
      expect(canTransition(state, 'speaking')).toBe(false)
    }
    expect(canTransition('thinking', 'speaking')).toBe(true)
  })

  it('error preserva motivo', () => {
    // A tabela aceita `error` a partir de qualquer estado ativo; o motivo fica
    // no `reason` do push (o controlador usa `setReason` para erros repetidos).
    for (const state of ['off', 'connecting', 'listening', 'thinking', 'speaking'] as const) {
      expect(canTransition(state, 'error')).toBe(true)
    }
    expect(VOICE_STATE_LABELS.error).toBe('Erro na voz')
    expect(VOICE_STATE_LABELS).toHaveProperty('listening')
    expect(Object.keys(VOICE_STATE_LABELS)).toHaveLength(VOICE_STATES.length)
  })
})
