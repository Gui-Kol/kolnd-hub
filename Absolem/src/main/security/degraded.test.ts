import { describe, expect, it } from 'vitest'
import { GEMINI_ERROR_KINDS, type GeminiErrorKind } from '../../shared/gemini'
import {
  DEGRADED_SCENARIOS,
  degradedForGeminiError,
  degradedState,
  listDegradedStates
} from './degraded'

/**
 * Modos degradados (task 13/T12).
 *
 * Garante mensagem curta, estado visual e recuperação para cada falha esperada.
 * Nenhum caso pode virar "erro desconhecido", tela branca ou loop silencioso.
 */

describe('modos degradados', () => {
  it('cobre as dez falhas esperadas mais a temporária', () => {
    const scenarios = listDegradedStates()
    expect(scenarios).toHaveLength(DEGRADED_SCENARIOS.length)
    expect(DEGRADED_SCENARIOS).toEqual(
      expect.arrayContaining([
        'no-key',
        'invalid-key',
        'no-network',
        'gemini-down',
        'quota',
        'microphone-denied',
        'device-removed',
        'webgl-unavailable',
        'memory-corrupted',
        'capture-blocked'
      ])
    )
    for (const state of scenarios) {
      expect(state.title.trim().length).toBeGreaterThan(0)
      expect(state.message.trim().length).toBeGreaterThan(0)
      expect(state.recovery.trim().length).toBeGreaterThan(0)
      expect(state.message.length).toBeLessThanOrEqual(180)
      expect(state.recovery.length).toBeLessThanOrEqual(220)
      expect(['idle', 'error']).toContain(state.avatar)
      expect(['info', 'warning', 'error']).toContain(state.severity)
      expect(state.message.toLowerCase()).not.toContain('erro desconhecido')
      expect(state.message.toLowerCase()).not.toContain('desconhecido')
    }
  })

  it('classifica auth, quota, rede, timeout e bloqueio', () => {
    expect(degradedForGeminiError('auth')?.scenario).toBe('invalid-key')
    expect(degradedForGeminiError('quota')?.scenario).toBe('quota')
    expect(degradedForGeminiError('network')?.scenario).toBe('no-network')
    expect(degradedForGeminiError('timeout')?.scenario).toBe('gemini-down')
    expect(degradedForGeminiError('server')?.scenario).toBe('gemini-down')
    expect(degradedForGeminiError('blocked')?.scenario).toBe('capture-blocked')
    expect(degradedForGeminiError('cancelled')).toBeNull()
    expect(degradedForGeminiError('unknown')?.scenario).toBe('temporary')
  })

  it('toda classe de erro do Gemini tem destino ou é cancelamento', () => {
    for (const kind of GEMINI_ERROR_KINDS) {
      const state = degradedForGeminiError(kind as GeminiErrorKind)
      if (kind === 'cancelled') expect(state).toBeNull()
      else expect(state?.recovery.length).toBeGreaterThan(0)
    }
  })

  it('estado degradado é determinístico e não compartilha referência', () => {
    const first = degradedState('temporary')
    const second = degradedState('temporary')
    expect(second).toEqual(first)
    expect(second).not.toBe(first)

    first.title = 'mutado'
    expect(degradedState('temporary').title).not.toBe('mutado')

    const listed = listDegradedStates()
    expect(listDegradedStates()).toEqual(listed)
    expect(listed.map((state) => state.scenario)).toEqual([...DEGRADED_SCENARIOS])
  })

  it('microfone negado, dispositivo removido e banco corrompido são acionáveis', () => {
    expect(degradedState('microphone-denied').recovery).toContain('Permitir microfone')
    expect(degradedState('microphone-denied').message).toContain('texto')
    expect(degradedState('device-removed').recovery).toContain('Configurações > Voz')
    expect(degradedState('memory-corrupted').recovery).toContain('memory.sqlite.bak')
    expect(degradedState('webgl-unavailable').recovery).toContain('driver')
    expect(degradedState('capture-blocked').recovery).toContain('Permissões')
  })
})
