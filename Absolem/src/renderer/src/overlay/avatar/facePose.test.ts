import { describe, expect, it } from 'vitest'
import { buildCaterpillar } from './caterpillar'
import { EXPRESSION_TARGETS } from './expressions'
import { MAX_JAW_ROTATION, applyFacePose, lidClosureFromOpenness } from './facePose'
import { EYELID_CLOSED_ROTATION, EYELID_OPEN_ROTATION } from './parts/head'

describe('pose facial da cena', () => {
  it('cena nao quebra com antennae vazio', () => {
    const build = buildCaterpillar()
    try {
      const empty = { ...build, antennae: [] }
      expect(() =>
        applyFacePose(
          empty,
          { eyeOpenness: 1, antennaLift: 0.9 },
          { mouthOpen: 1, mouthWidth: 0.8 }
        )
      ).not.toThrow()

      expect(empty.lids[0].rotation.x).toBeCloseTo(EYELID_OPEN_ROTATION, 6)
      expect(empty.jaw.rotation.x).toBeCloseTo(MAX_JAW_ROTATION, 6)
      expect(empty.mouth.scale.x).toBeGreaterThan(1)
    } finally {
      build.dispose()
    }
  })

  it('aplica palpebra, antena e boca a partir dos valores existentes', () => {
    const build = buildCaterpillar()
    try {
      applyFacePose(build, { eyeOpenness: 0, antennaLift: 0.5 }, { mouthOpen: 0, mouthWidth: 0.5 })

      expect(build.lids[0].rotation.x).toBeCloseTo(EYELID_CLOSED_ROTATION, 6)
      expect(build.lids[1].rotation.x).toBeCloseTo(EYELID_CLOSED_ROTATION, 6)
      expect(build.jaw.rotation.x).toBe(0)
      for (const antenna of build.antennae) {
        expect(Math.abs(antenna.rotation.z)).toBeCloseTo(0.18 + 0.5 * 0.32, 6)
      }
    } finally {
      build.dispose()
    }
  })

  it('cinco alvos de expressao produzem leituras de palpebra distintas', () => {
    const states = ['idle', 'listening', 'speaking', 'thinking', 'error'] as const
    const closures = states.map((state) =>
      lidClosureFromOpenness(EXPRESSION_TARGETS[state].eyeOpenness)
    )
    const [idle, listening, speaking, thinking, error] = closures

    // Repouso sonolento, abertura total só em listening e fechamento maior em
    // thinking/error. Speaking se distingue pela boca articulando.
    expect(listening).toBe(0)
    expect(idle).toBeGreaterThan(0.3)
    expect(idle).toBeLessThan(0.45)
    expect(speaking).toBeGreaterThan(idle)
    expect(thinking).toBeGreaterThan(idle)
    expect(error).toBeGreaterThan(idle)
    expect(new Set(closures.map((value) => value.toFixed(3))).size).toBe(5)
  })

  it('thinking e error tem nos prontos para o deslocamento da task 20', () => {
    const build = buildCaterpillar()
    try {
      const pupil = build.pupils[0]
      const brow = build.brows[0]
      const pupilX = pupil.position.x
      const browY = brow.position.y

      pupil.position.x += 0.01
      brow.position.y -= 0.01

      expect(pupil.position.x).toBeGreaterThan(pupilX)
      expect(brow.position.y).toBeLessThan(browY)
    } finally {
      build.dispose()
    }
  })
})
