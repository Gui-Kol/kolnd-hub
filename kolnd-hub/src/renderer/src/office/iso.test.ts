import { describe, expect, it } from 'vitest'
import {
  cameraToScreen,
  depthOf,
  diamondPolygon,
  fitCamera,
  pointInDiamond,
  projectIso,
  screenToWorld,
  sortByDepth,
  TILE_H,
  TILE_W,
  unprojectIso,
  worldToScreen
} from './iso'

describe('projeção isométrica', () => {
  it('projeta um losango 2:1 a partir da origem', () => {
    expect(TILE_W).toBe(64)
    expect(TILE_H).toBe(32)
    expect(projectIso(0, 0)).toEqual({ x: 0, y: 0 })
    expect(projectIso(1, 0)).toEqual({ x: 32, y: 16 })
    expect(projectIso(0, 1)).toEqual({ x: -32, y: 16 })
    expect(projectIso(2, 2)).toEqual({ x: 0, y: 64 })
    expect(projectIso(1, 1, 40)).toEqual({ x: 0, y: 32 - 40 })
  })

  it('unproject é a inversa exata no plano do chão', () => {
    for (const [x, y] of [
      [0, 0],
      [0.5, 0.5],
      [3.25, 1.75],
      [-2, 8]
    ] as const) {
      const screen = projectIso(x, y)
      const back = unprojectIso(screen.x, screen.y)
      expect(back.x).toBeCloseTo(x, 10)
      expect(back.y).toBeCloseTo(y, 10)
    }
  })

  it('ordena por profundidade com empate estável', () => {
    const items = [
      { id: 'a', depth: depthOf(2, 0) },
      { id: 'b', depth: depthOf(0, 0) },
      { id: 'c', depth: depthOf(1, 0) },
      { id: 'd', depth: depthOf(0, 0) }
    ]
    expect(sortByDepth(items).map((item) => item.id)).toEqual(['b', 'd', 'c', 'a'])
  })
})

describe('câmera', () => {
  it('enquadra todos os pontos no viewport com padding', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10, z: 40 }
    ]
    const camera = fitCamera(points, { width: 800, height: 600 }, { padding: 20 })
    expect(camera.scale).toBeGreaterThan(0)
    for (const point of points) {
      const screen = worldToScreen(point.x, point.y, point.z ?? 0, camera)
      expect(screen.x).toBeGreaterThanOrEqual(20 - 1e-6)
      expect(screen.x).toBeLessThanOrEqual(780 + 1e-6)
      expect(screen.y).toBeGreaterThanOrEqual(20 - 1e-6)
      expect(screen.y).toBeLessThanOrEqual(580 + 1e-6)
    }
  })

  it('respeita os limites de escala e não divide por zero', () => {
    expect(fitCamera([], { width: 0, height: 0 }).scale).toBe(1)
    const huge = fitCamera(
      [
        { x: 0, y: 0 },
        { x: 300, y: 300 }
      ],
      { width: 400, height: 300 },
      { maxScale: 1.4, minScale: 0.2 }
    )
    expect(huge.scale).toBeGreaterThanOrEqual(0.2)
    expect(huge.scale).toBeLessThanOrEqual(1.4)
    expect(cameraToScreen({ x: 0, y: 0 }, huge)).toEqual({
      x: huge.originX,
      y: huge.originY
    })
  })

  it('screenToWorld desfaz worldToScreen', () => {
    const camera = fitCamera(
      [
        { x: 0, y: 0 },
        { x: 6, y: 4 }
      ],
      { width: 640, height: 480 }
    )
    const screen = worldToScreen(2.5, 3.25, 0, camera)
    const world = screenToWorld(screen.x, screen.y, camera)
    expect(world.x).toBeCloseTo(2.5, 8)
    expect(world.y).toBeCloseTo(3.25, 8)
  })
})

describe('hit test do losango', () => {
  const center = { x: 100, y: 100 }
  const polygon = diamondPolygon(center, 32, 16)

  it('gera quatro cantos (topo/direita/baixo/esquerda)', () => {
    expect(polygon).toEqual([
      { x: 100, y: 84 },
      { x: 132, y: 100 },
      { x: 100, y: 116 },
      { x: 68, y: 100 }
    ])
  })

  it('aceita centro/bordas e recusa fora', () => {
    expect(pointInDiamond(center, center, 32, 16)).toBe(true)
    expect(pointInDiamond({ x: 132, y: 100 }, center, 32, 16)).toBe(true)
    expect(pointInDiamond({ x: 100, y: 116 }, center, 32, 16)).toBe(true)
    expect(pointInDiamond({ x: 133, y: 100 }, center, 32, 16)).toBe(false)
    expect(pointInDiamond({ x: 120, y: 110 }, center, 32, 16)).toBe(false)
    expect(pointInDiamond(center, center, 0, 0)).toBe(false)
  })
})
