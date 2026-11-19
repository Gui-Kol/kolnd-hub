/**
 * Projeção isométrica pura do OpenOffice.
 *
 * Mundo em tiles: `x` cresce para a direita-baixo e `y` para a esquerda-baixo;
 * o chão é um losango 2:1 (`TILE_W` × `TILE_H`). A câmera (escala/origem) é
 * calculada para caber a cena no canvas. Nada aqui toca DOM ou canvas.
 */

export const TILE_W = 64
export const TILE_H = 32

export interface Point {
  x: number
  y: number
}

/** Retângulo em pixels de tela. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface IsoCamera {
  scale: number
  originX: number
  originY: number
}

export interface IsoViewport {
  width: number
  height: number
}

export interface FitCameraOptions {
  padding?: number
  /** Limite superior da escala (salas pequenas não viram microscópio). */
  maxScale?: number
  /** Limite inferior para nunca degenerar em 0 em cenas gigantes. */
  minScale?: number
}

/** Projeção mundo → tela sem câmera: `z` em pixels (para cima). */
export function projectIso(x: number, y: number, z = 0): Point {
  return {
    x: (x - y) * (TILE_W / 2),
    y: (x + y) * (TILE_H / 2) - z
  }
}

/** Inversa da projeção no plano do chão (`z = 0`). */
export function unprojectIso(x: number, y: number): Point {
  const dx = x / (TILE_W / 2)
  const dy = y / (TILE_H / 2)
  return { x: (dy + dx) / 2, y: (dy - dx) / 2 }
}

/** Profundidade de pintura: quanto maior, mais à frente. */
export function depthOf(x: number, y: number, layer = 0): number {
  return (x + y) * 1024 + layer
}

/** Ordena por profundidade preservando a ordem original em empates (estável). */
export function sortByDepth<T extends { depth: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      left.item.depth !== right.item.depth
        ? left.item.depth - right.item.depth
        : left.index - right.index
    )
    .map((entry) => entry.item)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Câmera que enquadra todos os pontos (mundo, com `z` opcional) no viewport.
 * `padding` é o respiro em pixels de tela; a cena fica centralizada.
 */
export function fitCamera(
  points: readonly { x: number; y: number; z?: number }[],
  viewport: IsoViewport,
  options: FitCameraOptions = {}
): IsoCamera {
  const padding = Math.max(0, options.padding ?? 16)
  const maxScale = options.maxScale ?? 1.4
  const minScale = options.minScale ?? 0.1
  const width = Math.max(0, viewport.width)
  const height = Math.max(0, viewport.height)
  if (points.length === 0) return { scale: 1, originX: padding, originY: padding }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    const screen = projectIso(point.x, point.y, point.z ?? 0)
    minX = Math.min(minX, screen.x)
    minY = Math.min(minY, screen.y)
    maxX = Math.max(maxX, screen.x)
    maxY = Math.max(maxY, screen.y)
  }

  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  const availableW = Math.max(1, width - padding * 2)
  const availableH = Math.max(1, height - padding * 2)
  const scale = clamp(Math.min(availableW / spanX, availableH / spanY), minScale, maxScale)

  return {
    scale,
    originX: padding + (availableW - spanX * scale) / 2 - minX * scale,
    originY: padding + (availableH - spanY * scale) / 2 - minY * scale
  }
}

/** Aplica a câmera a um ponto já projetado (sem escala). */
export function cameraToScreen(point: Point, camera: IsoCamera): Point {
  return {
    x: camera.originX + point.x * camera.scale,
    y: camera.originY + point.y * camera.scale
  }
}

/** Mundo → tela (atalho de `projectIso` + `cameraToScreen`). */
export function worldToScreen(x: number, y: number, z: number, camera: IsoCamera): Point {
  return cameraToScreen(projectIso(x, y, z), camera)
}

/** Tela → mundo no plano do chão. */
export function screenToWorld(x: number, y: number, camera: IsoCamera): Point {
  if (camera.scale <= 0) return { x: 0, y: 0 }
  return unprojectIso((x - camera.originX) / camera.scale, (y - camera.originY) / camera.scale)
}

/** Losango de um tile centrado em `center` (raios em pixels de tela). */
export function diamondPolygon(center: Point, halfW: number, halfH: number): Point[] {
  return [
    { x: center.x, y: center.y - halfH },
    { x: center.x + halfW, y: center.y },
    { x: center.x, y: center.y + halfH },
    { x: center.x - halfW, y: center.y }
  ]
}

/** Hit test do losango (bordas incluídas). */
export function pointInDiamond(point: Point, center: Point, halfW: number, halfH: number): boolean {
  if (halfW <= 0 || halfH <= 0) return false
  const dx = Math.abs(point.x - center.x) / halfW
  const dy = Math.abs(point.y - center.y) / halfH
  return dx + dy <= 1
}

/**
 * Ponto dentro de um polígono simples (ray casting). Usado no hit test das
 * salas: o piso isométrico é um paralelogramo, não um retângulo de tela.
 */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]
    const b = polygon[previous]
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x
    if (intersects) inside = !inside
  }
  return inside
}
