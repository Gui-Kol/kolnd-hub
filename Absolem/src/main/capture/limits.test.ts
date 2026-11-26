import { describe, expect, it, vi } from 'vitest'
import { CaptureLimiter } from './limits'

function limiter(options: { checkBudget?: () => void } = {}) {
  let now = 1_000_000
  const instance = new CaptureLimiter({
    now: () => now,
    ...options
  })
  return {
    instance,
    advance: (ms: number) => {
      now += ms
    },
    get now() {
      return now
    }
  }
}

describe('limites de captura', () => {
  it('proativo desligado não captura', () => {
    const { instance } = limiter()

    const disabled = instance.check({
      proactive: true,
      proactiveEnabled: false,
      voiceState: 'listening'
    })
    expect(disabled).toMatchObject({ ok: false, reason: 'proactive-off' })

    const notListening = instance.check({
      proactive: true,
      proactiveEnabled: true,
      voiceState: 'speaking'
    })
    expect(notListening).toMatchObject({ ok: false, reason: 'voice-not-listening' })

    expect(
      instance.check({ proactive: true, proactiveEnabled: true, voiceState: 'listening' })
    ).toEqual({ ok: true })
  })

  it('2 capturas em 60 s: a segunda é recusada', () => {
    const { instance, advance } = limiter()

    expect(
      instance.check({ proactive: true, proactiveEnabled: true, voiceState: 'listening' })
    ).toEqual({ ok: true })
    instance.record({ proactive: true })

    advance(30_000)
    const second = instance.check({
      proactive: true,
      proactiveEnabled: true,
      voiceState: 'listening'
    })
    expect(second).toMatchObject({ ok: false, reason: 'proactive-interval' })
    if (!second.ok) expect(second.message).toContain('60 s')

    advance(31_000)
    expect(
      instance.check({ proactive: true, proactiveEnabled: true, voiceState: 'listening' })
    ).toEqual({ ok: true })
  })

  it('21ª na hora é recusada', () => {
    const { instance } = limiter()

    for (let index = 0; index < 20; index += 1) {
      expect(instance.check({ proactive: false, voiceState: null })).toEqual({ ok: true })
      instance.record({})
    }
    expect(instance.snapshot()).toEqual({ capturesLastHour: 20, maxPerHour: 20 })

    const blocked = instance.check({ proactive: false, voiceState: null })
    expect(blocked).toMatchObject({ ok: false, reason: 'hourly' })
    if (!blocked.ok) expect(blocked.message).toContain('20 capturas por hora')
  })

  it('teto mensal bloqueia', () => {
    const checkBudget = vi.fn(() => {
      throw new Error('Limite mensal de tokens atingido (2000000 de 2000000).')
    })
    const { instance } = limiter({ checkBudget })

    const result = instance.check({ proactive: false, voiceState: null })

    expect(result).toMatchObject({ ok: false, reason: 'monthly', code: 'quota' })
    if (!result.ok) expect(result.message).toContain('Limite mensal')
    expect(checkBudget).toHaveBeenCalledTimes(1)
  })
})
