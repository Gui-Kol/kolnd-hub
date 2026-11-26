import { describe, expect, it } from 'vitest'
import { ATTACK_SECONDS, RELEASE_SECONDS, createLipSync } from './lipSync'

describe('lip-sync', () => {
  it('amplitude 0 fecha a boca', () => {
    const lip = createLipSync()
    lip.setState('speaking')
    lip.setLevel(0)

    lip.update(0.016)
    const frame = lip.update(0.5)

    expect(frame.mouthOpen).toBe(0)
    expect(lip.getMouthOpen()).toBe(0)
  })

  it('ataque é mais rápido que relaxamento', () => {
    const lip = createLipSync()
    lip.setState('speaking')

    lip.setLevel(1)
    const attackFrame = lip.update(ATTACK_SECONDS)
    const attackProgress = attackFrame.mouthOpen

    lip.setLevel(0)
    // Mesmo intervalo de 40 ms: o ataque sobe mais do que o relaxamento desce.
    const releaseFrame = lip.update(ATTACK_SECONDS)
    const releaseProgress = 1 - releaseFrame.mouthOpen

    expect(ATTACK_SECONDS).toBeLessThan(RELEASE_SECONDS)
    expect(attackProgress).toBeGreaterThan(0.5)
    expect(releaseFrame.mouthOpen).toBeGreaterThan(0.4)
    expect(attackProgress).toBeGreaterThan(releaseProgress)
  })

  it('estado listening não move a boca', () => {
    const lip = createLipSync()
    lip.setState('listening')
    lip.setLevel(1)

    let frame = lip.update(0.016)
    for (let index = 0; index < 20; index += 1) frame = lip.update(0.016)

    expect(frame.mouthOpen).toBe(0)
    expect(frame.aura).toBeGreaterThan(0.5)
  })

  it('viseme de fechamento sobrepõe amplitude', () => {
    const lip = createLipSync()
    lip.setState('speaking')
    lip.setLevel(1)

    lip.setViseme({ openness: 1, width: 0.6, closure: 1 })
    const closed = lip.update(0.2)
    expect(closed.mouthOpen).toBe(0)

    lip.setViseme({ openness: 1, width: 0.6, closure: 0 })
    const open = lip.update(0.2)
    expect(open.mouthOpen).toBeGreaterThan(0.9)
    expect(open.mouthWidth).toBeCloseTo(0.6)

    // Sem visema, a amplitude volta a mandar.
    lip.setViseme(null)
    const amplitude = lip.update(0.2)
    expect(amplitude.mouthOpen).toBeGreaterThan(0.9)
  })
})
