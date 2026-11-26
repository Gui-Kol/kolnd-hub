import { screen } from 'electron'
import type { OverlayLayout } from '../../shared/config'
import { OVERLAY_MARGIN } from '../../shared/overlay'
import { computeOverlayBounds, type OverlayBounds } from './geometry'

/**
 * Resolução de monitor do overlay.
 *
 * Tudo aqui trabalha em DIPs — exatamente o espaço de `screen.workArea`,
 * `display.bounds` e `BrowserWindow.setBounds`. NÃO multiplicar por
 * `scaleFactor`: isso converteria para pixels físicos e cortaria o overlay em
 * telas com escala > 100%.
 */

export interface OverlayDisplay {
  bounds: OverlayBounds
  workArea: OverlayBounds
  scaleFactor: number
}

/** Subconjunto de `Electron.Screen` usado pelo módulo (injetável em teste). */
export interface ScreenLike {
  getAllDisplays(): OverlayDisplay[]
  getPrimaryDisplay(): OverlayDisplay
  getDisplayMatching(rect: OverlayBounds): OverlayDisplay
  on(event: string, listener: () => void): void
  removeListener(event: string, listener: () => void): void
}

export const DISPLAY_EVENTS = [
  'display-added',
  'display-removed',
  'display-metrics-changed'
] as const

/** `screen` real do Electron; só deve ser chamado depois de `whenReady`. */
export function currentScreen(): ScreenLike {
  return screen as unknown as ScreenLike
}

function intersects(a: OverlayBounds, b: OverlayBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Escolhe o monitor da posição anterior.
 *
 * `getDisplayMatching` do Electron devolve o monitor mais próximo mesmo quando
 * o retângulo está fora de todos (monitor removido). Por isso primeiro
 * verificamos se os bounds anteriores ainda intersectam algum display; se não,
 * a posição persistida não existe mais e voltamos ao primário.
 */
export function selectDisplay(
  screenApi: Pick<ScreenLike, 'getAllDisplays' | 'getPrimaryDisplay' | 'getDisplayMatching'>,
  previousBounds: OverlayBounds | null
): OverlayDisplay {
  const primary = screenApi.getPrimaryDisplay()
  if (!previousBounds) return primary

  const stillExists = screenApi
    .getAllDisplays()
    .some((display) => intersects(previousBounds, display.bounds))
  if (!stillExists) return primary

  try {
    return screenApi.getDisplayMatching(previousBounds)
  } catch {
    return primary
  }
}

/** Bounds do layout dentro da workArea de um display, em DIPs. */
export function boundsForDisplay(display: OverlayDisplay, layout: OverlayLayout): OverlayBounds {
  return computeOverlayBounds(
    display.workArea,
    { width: layout.width, height: layout.height },
    layout.position,
    OVERLAY_MARGIN,
    { offsetX: layout.offsetX, offsetY: layout.offsetY }
  )
}

/** Bounds para o monitor que contém `previousBounds` (ou o primário). */
export function computeBoundsForLayout(
  layout: OverlayLayout,
  previousBounds: OverlayBounds | null,
  screenApi: ScreenLike = currentScreen()
): OverlayBounds {
  return boundsForDisplay(selectDisplay(screenApi, previousBounds), layout)
}

/**
 * Recalcula o overlay quando monitores entram, saem ou mudam de métrica.
 * Devolve a função de limpeza usada no encerramento.
 */
export function watchDisplayChanges(
  onChange: () => void,
  screenApi: ScreenLike = currentScreen()
): () => void {
  const listener = () => onChange()
  for (const event of DISPLAY_EVENTS) screenApi.on(event, listener)
  return () => {
    for (const event of DISPLAY_EVENTS) screenApi.removeListener(event, listener)
  }
}
