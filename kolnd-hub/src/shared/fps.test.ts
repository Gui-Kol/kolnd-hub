import { describe, expect, it } from 'vitest'
import {
  fpsReadingWithReason,
  HUD_FPS_REASONS,
  HUD_FPS_STATES,
  isHudFpsReason,
  isHudFpsState,
  normalizeHudFpsReading,
  type HudFpsReading
} from './fps'

describe('normalizeHudFpsReading', () => {
  it('aceita live com fps, frametime e nome plausíveis', () => {
    expect(
      normalizeHudFpsReading({
        state: 'live',
        fps: 144,
        frametimeMs: 6.94,
        processName: '  EldenRing  '
      })
    ).toEqual<HudFpsReading>({
      state: 'live',
      fps: 144,
      frametimeMs: 6.94,
      processName: 'EldenRing'
    })
  })

  it('live com número fora da faixa/nome vazio vira null (a UI cai em "—")', () => {
    for (const bad of [
      { fps: 0, frametimeMs: 6.94, processName: 'game' },
      { fps: 1001, frametimeMs: 6.94, processName: 'game' },
      { fps: 144, frametimeMs: 0, processName: 'game' },
      { fps: 144, frametimeMs: 1001, processName: 'game' },
      { fps: 144, frametimeMs: 6.94, processName: '' },
      { fps: Number.NaN, frametimeMs: 6.94, processName: 'game' }
    ]) {
      expect(normalizeHudFpsReading({ state: 'live', ...bad })).toBeNull()
    }
  })

  it('estado != live DESCARTA os números e preserva só o motivo da whitelist', () => {
    const reading = normalizeHudFpsReading({
      state: 'not-activated',
      fps: 144,
      frametimeMs: 6.94,
      processName: 'game',
      reason: 'not-activated'
    })
    expect(reading).toEqual<HudFpsReading>({
      state: 'not-activated',
      fps: null,
      frametimeMs: null,
      processName: null,
      reason: 'not-activated'
    })

    const unknownReason = normalizeHudFpsReading({ state: 'unavailable', reason: 'hackeado' })
    expect(unknownReason).toEqual<HudFpsReading>({
      state: 'unavailable',
      fps: null,
      frametimeMs: null,
      processName: null
    })
  })

  it('rejeita payload sem estado conhecido', () => {
    expect(normalizeHudFpsReading(null)).toBeNull()
    expect(normalizeHudFpsReading({ state: 'quebrado' })).toBeNull()
    expect(normalizeHudFpsReading('texto')).toBeNull()
  })
})

describe('whitelists e leitura neutra', () => {
  it('reconhece somente os estados/motivos declarados', () => {
    for (const state of HUD_FPS_STATES) expect(isHudFpsState(state)).toBe(true)
    for (const reason of HUD_FPS_REASONS) expect(isHudFpsReason(reason)).toBe(true)
    expect(isHudFpsState('live ')).toBe(false)
    expect(isHudFpsReason('qualquer')).toBe(false)
  })

  it('fpsReadingWithReason nunca carrega número', () => {
    const reading = fpsReadingWithReason('no-target', 'self-focus')
    expect(reading).toEqual({
      state: 'no-target',
      fps: null,
      frametimeMs: null,
      processName: null,
      reason: 'self-focus'
    })
  })
})
