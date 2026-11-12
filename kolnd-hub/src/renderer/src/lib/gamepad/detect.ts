// Detecção de modelo e construção de config automática a partir da Gamepad API.
// Pura — sem Electron/IPC. O `id` varia por SO/driver, então nunca exija match exato.

import { GAMEPAD_PROFILES } from './profiles'
import type { GamepadConfig, GamepadProfile } from './types'

const VENDOR_REGEX = /Vendor:\s*([0-9a-fA-F]{4})/
const PRODUCT_REGEX = /Product:\s*([0-9a-fA-F]{4})/

// Vendors conhecidos (lowercase, big-endian).
const KNOWN_VENDORS = ['045e', '054c', '057e'] as const

export function parseGamepadId(id: string): { vendorId?: string; productId?: string } {
  if (!id) return {}

  const vendorMatch = id.match(VENDOR_REGEX)
  const productMatch = id.match(PRODUCT_REGEX)
  let vendorId = vendorMatch?.[1]?.toLowerCase()
  const productId = productMatch?.[1]?.toLowerCase()

  if (!vendorId) {
    const lower = id.toLowerCase()
    for (const vendor of KNOWN_VENDORS) {
      if (lower.includes(vendor)) {
        vendorId = vendor
        break
      }
      // Formato Mozilla hexadecimal: bytes little-endian (ex.: "…5e04…" = vendor 0x045e).
      const swapped = vendor.slice(2) + vendor.slice(0, 2)
      if (lower.includes(swapped)) {
        vendorId = vendor
        break
      }
    }
  }

  return { vendorId, productId }
}

export function detectProfile(id: string, mapping: string): GamepadProfile {
  // Sem mapping 'standard' os índices são posicionais/imprevisíveis — usa o genérico.
  if (mapping !== 'standard') return 'generic'
  const { vendorId } = parseGamepadId(id)
  switch (vendorId) {
    case '045e':
      return 'xbox'
    case '054c':
      return 'playstation'
    case '057e':
      return 'switch'
    default:
      return 'generic'
  }
}

export function friendlyControllerName(id: string, profile: GamepadProfile): string {
  switch (profile) {
    case 'xbox':
      return 'Controle Xbox'
    case 'playstation':
      return 'Controle PlayStation'
    case 'switch':
      return 'Nintendo Switch Pro Controller'
    default: {
      const trimmed = (id ?? '').trim()
      if (!trimmed) return 'Controle desconhecido'
      return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed
    }
  }
}

export function buildAutoConfig(pad: Gamepad): GamepadConfig {
  const profile = detectProfile(pad.id, pad.mapping)
  const { vendorId, productId } = parseGamepadId(pad.id)
  return {
    profile,
    controllerId: pad.id,
    controllerName: friendlyControllerName(pad.id, profile),
    vendorId,
    productId,
    mapping: { ...GAMEPAD_PROFILES[profile].mapping },
    autoMapped: true,
    configuredAt: new Date().toISOString()
  }
}

export const AXIS_DEADZONE = 0.5

export function axisToDirection(value: number): -1 | 0 | 1 {
  if (!Number.isFinite(value)) return 0
  if (Math.abs(value) < AXIS_DEADZONE) return 0
  return value > 0 ? 1 : -1
}
