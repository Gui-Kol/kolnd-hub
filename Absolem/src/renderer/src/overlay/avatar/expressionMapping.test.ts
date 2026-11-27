import { describe, expect, it } from 'vitest'
import { createExpressionEngine } from './expressions'
import { applyExpressionFrame, createExpressionBase } from './expressionMapping'
import type { ExpressionChannels, ExpressionRig, RigNode } from './expressionMapping'
import { createLipSync } from './lipSync'

function node(x = 0, y = 0, z = 0, rotationX = 0): RigNode {
  return {
    position: { x, y, z },
    rotation: { x: rotationX, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

function makeRig(): ExpressionRig {
  return {
    lids: [node(0, 0, 0, -Math.PI / 2), node(0, 0, 0, -Math.PI / 2)],
    brows: [node(-0.1, 0.12, 0.2), node(0.1, 0.12, 0.2)],
    pupils: [node(-0.1, 0, 0.15), node(0.1, 0, 0.15)],
    mouthCorners: [node(-0.12, 0.03, 0), node(0.12, 0.03, 0)],
    jaw: node(0, 0, -0.1),
    mouth: node(0, -0.1, 0.2),
    upperLip: node(0, -0.05, 0.2),
    body: node(),
    turbanTassel: node()
  }
}

function channels(overrides: Partial<ExpressionChannels> = {}): ExpressionChannels {
  return {
    lidClosure: 0.4,
    browRaise: 0.3,
    browFurrow: 0,
    lookAside: 0.6,
    mouthOpen: 0.5,
    mouthWidth: 0.6,
    smile: 0.5,
    breathe: 0.5,
    antennaLift: 0.8,
    ...overrides
  }
}

function snapshot(rig: ExpressionRig): string {
  return JSON.stringify(rig)
}

describe('mapeamento de expressao para os nos', () => {
  it('aplicar o mesmo frame duas vezes produz o mesmo resultado', () => {
    const rig = makeRig()
    const base = createExpressionBase(rig)
    const frame = channels()
    const baseBefore = snapshot(base)

    applyExpressionFrame(rig, base, frame)
    const first = snapshot(rig)

    applyExpressionFrame(rig, base, frame)
    expect(snapshot(rig)).toBe(first)
    // A pose base nunca é alterada; por isso não há acumulo entre frames.
    expect(snapshot(base)).toBe(baseBefore)
  })

  it('canal sem no correspondente e ignorado sem erro', () => {
    const empty: ExpressionRig = {
      lids: [],
      brows: [],
      pupils: [],
      mouthCorners: [],
      jaw: null,
      mouth: null,
      upperLip: null,
      body: null,
      turbanTassel: null
    }
    const base = createExpressionBase(empty)

    expect(() => applyExpressionFrame(empty, base, channels())).not.toThrow()

    // Um rig parcial também e aceito: os nos ausentes ficam intocados.
    const partial = makeRig()
    partial.brows = []
    partial.pupils = []
    const partialBase = createExpressionBase(partial)
    expect(() => applyExpressionFrame(partial, partialBase, channels())).not.toThrow()
    expect(partial.jaw?.rotation.x).toBeGreaterThan(0)
  })

  it('palpebra, sobrancelha, olhar e sorriso chegam aos nos certos', () => {
    const rig = makeRig()
    const base = createExpressionBase(rig)
    const frame = channels({ lidClosure: 1, browRaise: 0.5, browFurrow: 1, lookAside: 1 })

    applyExpressionFrame(rig, base, frame)

    expect(rig.lids[0].rotation.x).toBeCloseTo(Math.PI / 2, 6)
    expect(rig.brows[0].position.y).toBeGreaterThan(base.brows[0].position.y)
    expect(rig.brows[1].rotation.z).toBeLessThan(0)
    expect(rig.pupils[0].position.x).toBeGreaterThan(base.pupils[0].position.x)
    expect(rig.mouthCorners[0].position.y).toBeGreaterThan(base.mouthCorners[0].position.y)
  })

  it('mouthOpen 1 abre a mandibula em pelo menos 0.06 rad', () => {
    const rig = makeRig()
    const base = createExpressionBase(rig)

    applyExpressionFrame(rig, base, channels({ mouthOpen: 1 }))

    expect(rig.jaw?.rotation.x).toBeGreaterThanOrEqual(0.06)
  })

  it('listening nao altera a mandibula', () => {
    const lip = createLipSync()
    lip.setState('listening')
    lip.setLevel(1)
    const frame = lip.update(0.2)

    const rig = makeRig()
    const base = createExpressionBase(rig)
    applyExpressionFrame(
      rig,
      base,
      channels({ mouthOpen: frame.mouthOpen, mouthWidth: frame.mouthWidth })
    )

    expect(frame.mouthOpen).toBe(0)
    expect(rig.jaw?.rotation.x).toBe(0)
  })

  it('speaking zera smokeStrength', () => {
    const engine = createExpressionEngine({ random: () => 0.5 })
    engine.setState('speaking')

    let frame = engine.update(0.016)
    for (let index = 0; index < 62; index += 1) frame = engine.update(0.016)

    expect(frame.smokeStrength).toBeLessThan(0.01)
  })
})
