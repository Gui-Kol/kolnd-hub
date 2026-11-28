import type { ScreenRect } from '../../shared/screen'

/**
 * Cálculos da janela ativa (task 07, T4), sem Electron.
 *
 * `getForegroundWindow()` (task 02) devolve bounds em DIPs no espaço virtual do
 * Windows. O recorte é relativo ao display e multiplicado pela proporção real
 * entre a imagem capturada e o monitor (task 04) - a imagem pode ter sido
 * reduzida a `MAX_CAPTURE_SIDE`, então não basta o `scaleFactor`.
 */

export interface CaptureDisplay {
  id: string
  bounds: ScreenRect
  scaleFactor: number
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** Tolerância de 1 px físico para arredondamentos de borda. */
export const CROP_TOLERANCE_PX = 1

export function rectCenter(rect: ScreenRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function pointInRect(point: { x: number; y: number }, rect: ScreenRect): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  )
}

/** Display que contém o centro dos bounds (`null` se a janela está fora de todos). */
export function selectDisplayForBounds(
  displays: readonly CaptureDisplay[],
  bounds: ScreenRect
): CaptureDisplay | null {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null
  }
  const center = rectCenter(bounds)
  return displays.find((display) => pointInRect(center, display.bounds)) ?? null
}

/** Retângulo da janela em pixels da imagem capturada, relativo ao display. */
export function computeCropRect(
  bounds: ScreenRect,
  display: CaptureDisplay,
  captured?: { width: number; height: number }
): PixelRect {
  const { scaleX, scaleY } = cropScale(display, captured)
  return {
    x: Math.round((bounds.x - display.bounds.x) * scaleX),
    y: Math.round((bounds.y - display.bounds.y) * scaleY),
    width: Math.round(bounds.width * scaleX),
    height: Math.round(bounds.height * scaleY)
  }
}

/** Retângulo de região (DIPs locais) em pixels da imagem capturada. */
export function computeRegionRectPx(
  rect: ScreenRect,
  display: CaptureDisplay,
  captured?: { width: number; height: number }
): PixelRect {
  const { scaleX, scaleY } = cropScale(display, captured)
  return {
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY)
  }
}

/**
 * O renderer limita a captura a `MAX_CAPTURE_SIDE`, então a imagem pode vir
 * menor que o monitor em pixels físicos. O recorte precisa usar a proporção
 * real imagem/monitor, não só o `scaleFactor` (task 04): em 1920x1080 a imagem
 * chega em 1280x720 e o recorte antigo caía na área errada.
 */
function cropScale(
  display: CaptureDisplay,
  captured?: { width: number; height: number }
): { scaleX: number; scaleY: number } {
  const fallback = display.scaleFactor > 0 ? display.scaleFactor : 1
  const scaleX =
    captured && captured.width > 0 && display.bounds.width > 0
      ? captured.width / display.bounds.width
      : fallback
  const scaleY =
    captured && captured.height > 0 && display.bounds.height > 0
      ? captured.height / display.bounds.height
      : fallback
  return { scaleX, scaleY }
}

/**
 * Ajusta o retângulo aos limites da imagem. Devolve `null` quando não sobra
 * área útil (janela totalmente fora da captura).
 */
export function clampRectToImage(
  rect: PixelRect,
  imageWidth: number,
  imageHeight: number
): PixelRect | null {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return null
  }
  const left = Math.max(0, rect.x)
  const top = Math.max(0, rect.y)
  const right = Math.min(imageWidth, rect.x + rect.width)
  const bottom = Math.min(imageHeight, rect.y + rect.height)
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return null
  // Janela quase inteira fora do monitor: recusar em vez de capturar uma tira.
  if (width < rect.width - CROP_TOLERANCE_PX && width < 32) return null
  if (height < rect.height - CROP_TOLERANCE_PX && height < 32) return null
  return { x: left, y: top, width, height }
}
