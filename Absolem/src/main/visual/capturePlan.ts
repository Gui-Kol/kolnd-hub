import type { AvatarState } from '../../shared/avatar'
import { AVATAR_STATES, isAvatarState } from '../../shared/avatar'
import {
  OVERLAY_HEIGHT_MAX,
  OVERLAY_HEIGHT_MIN,
  OVERLAY_WIDTH_MAX,
  OVERLAY_WIDTH_MIN
} from '../../shared/overlay'

/**
 * Plano do harness de captura visual (task 23).
 *
 * Este módulo é puro: recebe as strings de ambiente e devolve estados, tamanhos,
 * nome de arquivo e hash do overlay. Assim o parsing é testável em Node, sem
 * Electron, e o módulo que abre a janela fica só com o efeito colateral.
 */

/** Tempo máximo para o primeiro frame estável antes de capturar mesmo assim. */
export const VISUAL_STABLE_TIMEOUT_MS = 2000

/** Intervalo de sondagem de `getMetrics()` enquanto a cena aquece. */
export const VISUAL_STABLE_POLL_MS = 100

export const VISUAL_LOOKS = ['holo', 'storybook'] as const

export type VisualLook = (typeof VISUAL_LOOKS)[number]

export const DEFAULT_VISUAL_LOOK: VisualLook = 'storybook'

export interface VisualSize {
  width: number
  height: number
}

export const DEFAULT_VISUAL_STATES: readonly AvatarState[] = [...AVATAR_STATES]

export const DEFAULT_VISUAL_SIZES: readonly VisualSize[] = [
  { width: 320, height: 360 },
  { width: 480, height: 560 }
]

function splitList(input: string | undefined): string[] {
  if (typeof input !== 'string') return []
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Estados da captura. Lista vazia, ausente ou só com valores inválidos cai nos
 * cinco estados do contrato, na ordem canônica. Duplicados são removidos sem
 * mudar a ordem pedida.
 */
export function parseVisualStates(input: string | undefined): AvatarState[] {
  const states: AvatarState[] = []
  for (const item of splitList(input)) {
    const value = item.toLowerCase()
    if (!isAvatarState(value) || states.includes(value)) continue
    states.push(value)
  }
  return states.length > 0 ? states : [...DEFAULT_VISUAL_STATES]
}

/**
 * Tamanhos no formato `WxH`. Fora da faixa aceita pelo overlay (`shared/overlay`)
 * é ignorado: o main normalizaria a janela e o nome do arquivo mentiria sobre o
 * frame real. Sem nenhum tamanho válido, usa 320x360 e 480x560.
 */
export function parseVisualSizes(input: string | undefined): VisualSize[] {
  const sizes: VisualSize[] = []
  for (const item of splitList(input)) {
    const match = /^(\d+)x(\d+)$/i.exec(item)
    if (!match) continue
    const width = Number(match[1])
    const height = Number(match[2])
    if (!Number.isInteger(width) || !Number.isInteger(height)) continue
    if (width < OVERLAY_WIDTH_MIN || width > OVERLAY_WIDTH_MAX) continue
    if (height < OVERLAY_HEIGHT_MIN || height > OVERLAY_HEIGHT_MAX) continue
    if (sizes.some((size) => size.width === width && size.height === height)) continue
    sizes.push({ width, height })
  }
  return sizes.length > 0 ? sizes : DEFAULT_VISUAL_SIZES.map((size) => ({ ...size }))
}

/** Look desconhecido cai no acabamento ilustrado, o default do produto. */
export function parseVisualLook(input: string | undefined): VisualLook {
  const value = typeof input === 'string' ? input.trim().toLowerCase() : ''
  return (VISUAL_LOOKS as readonly string[]).includes(value)
    ? (value as VisualLook)
    : DEFAULT_VISUAL_LOOK
}

/** Nome estável exigido pela task 23: `<look>-<state>-<WxH>.png`. */
export function visualFileName(look: VisualLook, state: AvatarState, size: VisualSize): string {
  return `${look}-${state}-${size.width}x${size.height}.png`
}

/** Hash da rota `#overlay?...`; `fakeVoice` só entra quando pedido pelo QA. */
export function buildVisualHash(look: VisualLook, state: AvatarState, fakeVoice: boolean): string {
  return `overlay?look=${look}&state=${state}&debug=0${fakeVoice ? '&fakeVoice=1' : ''}`
}
