import type { OverlayConfig, OverlayLayout, OverlayPosition } from './config'

/**
 * Constantes e normalizadores do overlay compartilhados entre main, preload e
 * renderer.
 *
 * Os limites de tamanho e a margem são a fonte única da geometria: o main
 * aplica os bounds em DIPs e o renderer desenha dentro da janela. Nenhum valor
 * aqui depende de `scaleFactor`. As funções são puras para poderem ser usadas
 * no IPC (validação do `unknown`) e no store (leitura de config editado à mão).
 */

export const OVERLAY_WIDTH_MIN = 240
export const OVERLAY_WIDTH_MAX = 480
export const OVERLAY_WIDTH_DEFAULT = 320

export const OVERLAY_HEIGHT_MIN = 260
export const OVERLAY_HEIGHT_MAX = 560
export const OVERLAY_HEIGHT_DEFAULT = 360

/** Margem em DIPs entre o canto escolhido e a área de trabalho. */
export const OVERLAY_MARGIN = 16

/** Limite de sanidade dos offsets persistidos (a geometria clampa na tela). */
export const OVERLAY_MAX_OFFSET = 10000

export const OVERLAY_DEFAULT_POSITION: OverlayPosition = 'bottom-left'
export const OVERLAY_DEFAULT_SHORTCUT = 'Control+Alt+A'

/** Teto do accelerator persistido: o config.json não precisa de strings enormes. */
export const OVERLAY_MAX_SHORTCUT_LENGTH = 64

export const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  position: OVERLAY_DEFAULT_POSITION,
  offsetX: 0,
  offsetY: 0,
  width: OVERLAY_WIDTH_DEFAULT,
  height: OVERLAY_HEIGHT_DEFAULT
}

/** Whitelist de posições válidas (mesma lista do `config.ts`). */
export function isOverlayPosition(input: unknown): input is OverlayPosition {
  return (
    input === 'bottom-left' ||
    input === 'bottom-right' ||
    input === 'top-left' ||
    input === 'top-right'
  )
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Posição desconhecida cai no canto inferior esquerdo. */
export function normalizeOverlayPosition(input: unknown): OverlayPosition {
  return isOverlayPosition(input) ? input : OVERLAY_DEFAULT_POSITION
}

/** Largura em DIPs, sempre dentro de 240–480. */
export function normalizeOverlayWidth(input: unknown): number {
  return clampNumber(input, OVERLAY_WIDTH_MIN, OVERLAY_WIDTH_MAX, OVERLAY_WIDTH_DEFAULT)
}

/** Altura em DIPs, sempre dentro de 260–560. */
export function normalizeOverlayHeight(input: unknown): number {
  return clampNumber(input, OVERLAY_HEIGHT_MIN, OVERLAY_HEIGHT_MAX, OVERLAY_HEIGHT_DEFAULT)
}

/** Offset em DIPs; valores absurdos são limitados ao teto de sanidade. */
export function normalizeOverlayOffset(input: unknown): number {
  return clampNumber(input, -OVERLAY_MAX_OFFSET, OVERLAY_MAX_OFFSET, 0)
}

type ModifierName = 'Control' | 'Alt' | 'Shift' | 'Super'

// Aliases aceitos: o usuário (ou um backup antigo) pode ter escrito `Ctrl`.
const MODIFIER_ALIASES: Record<string, ModifierName> = {
  control: 'Control',
  ctrl: 'Control',
  commandorcontrol: 'Control',
  cmdorctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  command: 'Super',
  cmd: 'Super'
}

const MODIFIER_ORDER: ModifierName[] = ['Control', 'Alt', 'Shift', 'Super']

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  escape: 'Esc',
  esc: 'Esc',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  printscreen: 'PrintScreen',
  pause: 'Pause'
}

function normalizeKey(value: string): string | null {
  if (value === ' ') return 'Space'
  const part = value.trim()
  if (!part) return null
  if (/^[a-z]$/i.test(part)) return part.toUpperCase()
  if (/^[0-9]$/.test(part)) return part
  const functionKey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(part)
  if (functionKey) return `F${functionKey[1]}`
  return NAMED_KEYS[part.toLowerCase()] ?? null
}

/**
 * Valida e normaliza um accelerator do Electron. Retorna `null` se inválido.
 *
 * Exige ao menos um modificador: um atalho global de uma tecla solta
 * sequestraria a digitação do sistema inteiro.
 */
export function normalizeAccelerator(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > OVERLAY_MAX_SHORTCUT_LENGTH) return null

  const parts = trimmed
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2 || parts.length > MODIFIER_ORDER.length + 1) return null

  const modifiers = new Set<ModifierName>()
  let key: string | null = null

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier) {
      if (modifiers.has(modifier)) return null
      modifiers.add(modifier)
      continue
    }
    if (key !== null) return null
    key = normalizeKey(part)
    if (!key) return null
  }

  if (!key || modifiers.size === 0) return null
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
  return [...ordered, key].join('+')
}

/** Atalho persistido: inválido cai no default `Control+Alt+A`. */
export function normalizeOverlayShortcut(input: unknown): string {
  return normalizeAccelerator(input) ?? OVERLAY_DEFAULT_SHORTCUT
}

/** Normaliza a geometria do overlay sem tocar em visibilidade/atalho. */
export function normalizeOverlayLayout(input: unknown): OverlayLayout {
  const raw = asRecord(input)
  return {
    position: normalizeOverlayPosition(raw.position),
    offsetX: normalizeOverlayOffset(raw.offsetX),
    offsetY: normalizeOverlayOffset(raw.offsetY),
    width: normalizeOverlayWidth(raw.width),
    height: normalizeOverlayHeight(raw.height)
  }
}

/** Normaliza a chave `overlay` inteira do store. */
export function normalizeOverlayConfig(input: unknown): OverlayConfig {
  const raw = asRecord(input)
  return {
    ...normalizeOverlayLayout(raw),
    visible: raw.visible === true,
    shortcut: normalizeOverlayShortcut(raw.shortcut),
    hideOnFullscreen: raw.hideOnFullscreen !== false
  }
}
