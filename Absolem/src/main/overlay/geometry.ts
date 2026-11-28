import type { OverlayPosition } from '../../shared/config'
import {
  OVERLAY_DEFAULT_POSITION,
  OVERLAY_HEIGHT_DEFAULT,
  OVERLAY_MARGIN,
  OVERLAY_WIDTH_DEFAULT,
  isOverlayPosition
} from '../../shared/overlay'

/** Retângulo em DIPs, estruturalmente compatível com `Electron.Rectangle`. */
export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface OverlaySize {
  width: number
  height: number
}

export interface OverlayOffset {
  offsetX: number
  offsetY: number
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  // max pode ficar menor que min quando o tamanho já ocupa a workArea; o
  // Math.min primeiro garante o limite superior nesse caso degenerado.
  return Math.min(max, Math.max(min, value))
}

/**
 * Bounds do overlay para uma área de trabalho, em DIPs.
 *
 * Regras (task 02/T1):
 * - margem padrão de 16 DIPs em relação ao canto escolhido;
 * - tamanho nunca maior que a workArea (largura e altura são limitadas);
 * - offsets opcionais somados ao canto, sem nunca sair da tela;
 * - posição desconhecida cai em `bottom-left`.
 *
 * A função é pura de propósito: o main pode chamá-la a cada mudança de
 * monitor sem tocar em Electron.
 */
export function computeOverlayBounds(
  workArea: OverlayBounds,
  size: OverlaySize,
  position: OverlayPosition | string,
  margin: number = OVERLAY_MARGIN,
  offset: OverlayOffset = { offsetX: 0, offsetY: 0 }
): OverlayBounds {
  const areaWidth = Math.max(1, finiteOr(workArea.width, 1))
  const areaHeight = Math.max(1, finiteOr(workArea.height, 1))
  const width = Math.max(1, Math.min(finiteOr(size.width, OVERLAY_WIDTH_DEFAULT), areaWidth))
  const height = Math.max(1, Math.min(finiteOr(size.height, OVERLAY_HEIGHT_DEFAULT), areaHeight))

  const safeMargin = Math.max(0, finiteOr(margin, OVERLAY_MARGIN))
  const offsetX = finiteOr(offset.offsetX, 0)
  const offsetY = finiteOr(offset.offsetY, 0)

  const left = workArea.x + safeMargin + offsetX
  const right = workArea.x + areaWidth - width - safeMargin + offsetX
  const top = workArea.y + safeMargin + offsetY
  const bottom = workArea.y + areaHeight - height - safeMargin + offsetY

  const chosen: OverlayPosition = isOverlayPosition(position) ? position : OVERLAY_DEFAULT_POSITION

  const x = chosen === 'bottom-right' || chosen === 'top-right' ? right : left
  const y = chosen === 'bottom-left' || chosen === 'bottom-right' ? bottom : top

  return {
    x: clamp(x, workArea.x, workArea.x + areaWidth - width),
    y: clamp(y, workArea.y, workArea.y + areaHeight - height),
    width,
    height
  }
}
