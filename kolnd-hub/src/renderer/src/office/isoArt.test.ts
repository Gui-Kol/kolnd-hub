import { describe, expect, it } from 'vitest'
import {
  composeCharacter,
  deskShapes,
  floorShapes,
  frameShapes,
  characterPalette,
  plantSprite,
  rugShapes,
  scenePalette,
  wallShapes,
  type IsoArtOrigin,
  type IsoShape
} from './isoArt'
import {
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  type OfficeAvatarLook
} from '../../../shared/officeAvatar'

const ORIGIN: IsoArtOrigin = { x: 300, y: 120, scale: 1 }
const LOOK: OfficeAvatarLook = {
  sex: 'feminino',
  hairStyle: 1,
  hairColor: 6,
  skin: 1,
  shirt: 0,
  pants: 0
}

function allPoints(shapes: readonly IsoShape[]): number[] {
  const values: number[] = []
  for (const shape of shapes) {
    if (shape.kind === 'poly') {
      for (const point of shape.points) values.push(point.x, point.y)
    } else {
      values.push(shape.x, shape.y, shape.width, shape.height)
    }
  }
  return values
}

function allFills(shapes: readonly IsoShape[]): string[] {
  return shapes.map((shape) => shape.fill)
}

describe('personagem composto', () => {
  it('é determinístico e sempre 16×24 com cabelo sobreposto', () => {
    const first = composeCharacter(LOOK, 'idle')
    const second = composeCharacter(LOOK, 'idle')
    expect(first.rows).toEqual(second.rows)
    expect(first.width).toBe(16)
    expect(first.height).toBe(24)
    expect(first.rows).toHaveLength(24)
    for (const row of first.rows) expect(row).toHaveLength(16)

    // A cor do cabelo escolhida aparece na paleta e no sprite.
    expect(first.palette.h).toBe(HAIR_COLORS[LOOK.hairColor].c)
    expect(first.palette.s).toBe(SKIN_TONES[LOOK.skin].c)
    expect(first.rows.join('')).toContain('h')
  })

  it('muda sexo, cabelo e cores sem mudar o tamanho', () => {
    const male = composeCharacter({ ...LOOK, sex: 'masculino' }, 'idle')
    const female = composeCharacter({ ...LOOK, sex: 'feminino' }, 'idle')
    expect(male.rows).not.toEqual(female.rows)

    for (let style = 0; style < HAIR_STYLES.length; style++) {
      const art = composeCharacter({ ...LOOK, hairStyle: style }, 'idle')
      expect(art.rows).toHaveLength(24)
      for (const row of art.rows) expect(row).toHaveLength(16)
    }
  })

  it('working tem 3 quadros de digitação; os outros estados são estáticos', () => {
    expect(composeCharacter(LOOK, 'working').frames).toHaveLength(3)
    expect(composeCharacter(LOOK, 'idle').frames).toHaveLength(1)
    expect(composeCharacter(LOOK, 'needsYou').frames).toHaveLength(1)
    expect(composeCharacter(LOOK, 'ended').frames).toHaveLength(1)
    expect(composeCharacter(LOOK, 'unknown').frames).toHaveLength(1)

    const frames = composeCharacter(LOOK, 'working').frames
    expect(new Set(frames.map((rows) => rows.join('\n'))).size).toBeGreaterThan(1)
  })

  it('encerrado vira silhueta cinza e olhos fechados', () => {
    const ended = composeCharacter(LOOK, 'ended')
    expect(ended.palette.c).toBe('#47525e')
    expect(ended.palette.s).toBe('#7d8894')
    const normal = composeCharacter(LOOK, 'idle')
    expect(characterPalette(LOOK, 'idle').c).toBe('#e2a33f')
    expect(normal.rows.join('')).not.toContain('o')
  })

  it('quadro fora da faixa é normalizado (nunca quebra a animação)', () => {
    const art = composeCharacter(LOOK, 'working', 99)
    expect(art.rows).toHaveLength(24)
    expect(composeCharacter(LOOK, 'working', -1).rows).toHaveLength(24)
  })
})

describe('cenário isométrico', () => {
  it('piso tem um losango por tile, todos com coordenadas finitas', () => {
    const shapes = floorShapes(ORIGIN, 3, 2)
    expect(shapes).toHaveLength(6)
    for (const value of allPoints(shapes)) expect(Number.isFinite(value)).toBe(true)
    expect(new Set(allFills(shapes))).toEqual(
      new Set([scenePalette().floorA, scenePalette().floorB])
    )
  })

  it('paredes têm topo iluminado, faces laterais e rodapé (sem imagem)', () => {
    const shapes = wallShapes(ORIGIN, 4, 3)
    const palette = scenePalette()
    expect(shapes).toHaveLength(6)
    expect(allFills(shapes)).toContain(palette.wallTop)
    expect(allFills(shapes)).toContain(palette.wall)
    expect(allFills(shapes)).toContain(palette.wallSide)
    for (const fill of allFills([...shapes, ...floorShapes(ORIGIN, 2, 2)])) {
      expect(fill).not.toMatch(/url\(|\.png|\.jpg|http/i)
    }
  })

  it('tapete, quadro, mesa, cadeira e planta são geométricos e determinísticos', () => {
    const palette = scenePalette()
    expect(rugShapes(ORIGIN, 4, 3)).toHaveLength(2)
    expect(frameShapes(ORIGIN, 1)).toHaveLength(2)
    expect(deskShapes(ORIGIN, 1, 1)).toHaveLength(15)
    expect(JSON.stringify(deskShapes(ORIGIN, 1, 1))).toBe(JSON.stringify(deskShapes(ORIGIN, 1, 1)))

    const plant = plantSprite(ORIGIN, 2, 2)
    expect(plant.kind).toBe('sprite')
    expect(plant.rows.length).toBeGreaterThan(0)
    expect(plant.palette.t).toBe(palette.plant)
    expect(plant.width).toBeGreaterThan(0)
    expect(plant.height).toBeGreaterThan(0)
  })

  it('a escala multiplica o tamanho sem mudar a estrutura', () => {
    const small = floorShapes({ ...ORIGIN, scale: 0.5 }, 2, 2)
    const large = floorShapes({ ...ORIGIN, scale: 2 }, 2, 2)
    expect(small).toHaveLength(large.length)
    const smallWidth = Math.abs(
      small[0].kind === 'poly' ? small[0].points[1].x - small[0].points[0].x : 0
    )
    const largeWidth = Math.abs(
      large[0].kind === 'poly' ? large[0].points[1].x - large[0].points[0].x : 0
    )
    expect(largeWidth).toBeCloseTo(smallWidth * 4, 6)
  })
})
