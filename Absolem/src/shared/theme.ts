/**
 * Schema do tema visual do Absolem, compartilhado entre main, preload e
 * renderer.
 *
 * O tema é dado puro: nenhum estado do avatar (`AvatarState`) e nenhuma regra de
 * voz entram aqui. O renderer de comportamento recebe o tema e o adaptador
 * (`overlay/avatar/themeAdapter.ts`) traduz para parâmetros da cena.
 *
 * A normalização nunca lança: um config editado à mão ou um JSON importado
 * inválido vira um tema completo e válido, campo a campo, sem derrubar o app.
 */

export const THEME_SCHEMA_VERSION = 1

export const THEME_PRESET_IDS = ['classic', 'neon', 'smoke', 'circuit', 'jade', 'amber'] as const

export type ThemePresetId = (typeof THEME_PRESET_IDS)[number]

export const THEME_STYLES = ['classic', 'neon', 'wireframe', 'liquid'] as const

export type ThemeStyle = (typeof THEME_STYLES)[number]

export const THEME_OUTFITS = ['none', 'scarf', 'collar', 'visor'] as const

export type ThemeOutfit = (typeof THEME_OUTFITS)[number]

export const THEME_ACCESSORIES = ['antenna_glow', 'back_spikes', 'visor_hud'] as const

export type ThemeAccessory = (typeof THEME_ACCESSORIES)[number]

export const PARTICLE_DENSITIES = ['off', 'low', 'medium', 'high'] as const

export type ParticleDensity = (typeof PARTICLE_DENSITIES)[number]

/** Preset "feito à mão": qualquer edição manual deixa de apontar para um preset. */
export const THEME_PRESET_CUSTOM = 'custom'
export const DEFAULT_THEME_PRESET_ID = 'classic'
export const MAX_THEME_PRESET_ID_LENGTH = 64

export const DEFAULT_PRIMARY_COLOR = '#3b82f6'
export const DEFAULT_EFFECT_COLOR = '#93c5fd'
export const DEFAULT_GLOW_INTENSITY = 0.7
export const DEFAULT_THEME_STYLE: ThemeStyle = 'classic'
export const DEFAULT_THEME_OUTFIT: ThemeOutfit = 'none'
export const DEFAULT_PARTICLE_DENSITY: ParticleDensity = 'medium'
export const GLOW_INTENSITY_MIN = 0
export const GLOW_INTENSITY_MAX = 1
export const THEME_SCALE_MIN = 0.8
export const THEME_SCALE_MAX = 1.5
export const DEFAULT_THEME_SCALE = 1

/** Configuração visual completa. Cores canônicas em `#rrggbb`. */
export interface ThemeConfig {
  version: number
  presetId: string
  primaryColor: string
  effectColor: string
  glowIntensity: number
  style: ThemeStyle
  outfit: ThemeOutfit
  accessories: ThemeAccessory[]
  particleDensity: ParticleDensity
  scale: number
  reducedMotion: boolean
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/**
 * Cor em `#rrggbb` minúsculo. Aceita `#rgb` (expande) e ignora caixa. Entrada
 * inválida cai no fallback — nunca devolve string que o shader leria como NaN.
 */
export function normalizeHexColor(
  input: unknown,
  fallback: string = DEFAULT_PRIMARY_COLOR
): string {
  if (typeof input !== 'string') return fallback
  const trimmed = input.trim()
  if (!HEX_COLOR_RE.test(trimmed)) return fallback
  const body = trimmed.slice(1).toLowerCase()
  const expanded =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body
  return `#${expanded}`
}

function normalizePresetId(input: unknown): string {
  if (typeof input !== 'string') return DEFAULT_THEME_PRESET_ID
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > MAX_THEME_PRESET_ID_LENGTH) return DEFAULT_THEME_PRESET_ID
  return trimmed
}

function normalizeAccessories(input: unknown): ThemeAccessory[] {
  if (!Array.isArray(input)) return []
  const out: ThemeAccessory[] = []
  for (const item of input) {
    if (!includes(THEME_ACCESSORIES, item) || out.includes(item)) continue
    out.push(item)
  }
  return out
}

/** Tema padrão completo, sempre como objeto novo (o chamador pode mutar). */
export function defaultTheme(): ThemeConfig {
  return {
    version: THEME_SCHEMA_VERSION,
    presetId: DEFAULT_THEME_PRESET_ID,
    primaryColor: DEFAULT_PRIMARY_COLOR,
    effectColor: DEFAULT_EFFECT_COLOR,
    glowIntensity: DEFAULT_GLOW_INTENSITY,
    style: DEFAULT_THEME_STYLE,
    outfit: DEFAULT_THEME_OUTFIT,
    accessories: [],
    particleDensity: DEFAULT_PARTICLE_DENSITY,
    scale: DEFAULT_THEME_SCALE,
    reducedMotion: false
  }
}

/** Normaliza um tema desconhecido. Nunca lança e nunca devolve campo ausente. */
export function normalizeTheme(input: unknown): ThemeConfig {
  const raw = asRecord(input)
  return {
    version: THEME_SCHEMA_VERSION,
    presetId: normalizePresetId(raw.presetId),
    primaryColor: normalizeHexColor(raw.primaryColor, DEFAULT_PRIMARY_COLOR),
    effectColor: normalizeHexColor(raw.effectColor, DEFAULT_EFFECT_COLOR),
    glowIntensity: clampNumber(
      raw.glowIntensity,
      GLOW_INTENSITY_MIN,
      GLOW_INTENSITY_MAX,
      DEFAULT_GLOW_INTENSITY
    ),
    style: includes(THEME_STYLES, raw.style) ? raw.style : DEFAULT_THEME_STYLE,
    outfit: includes(THEME_OUTFITS, raw.outfit) ? raw.outfit : DEFAULT_THEME_OUTFIT,
    accessories: normalizeAccessories(raw.accessories),
    particleDensity: includes(PARTICLE_DENSITIES, raw.particleDensity)
      ? raw.particleDensity
      : DEFAULT_PARTICLE_DENSITY,
    scale: clampNumber(raw.scale, THEME_SCALE_MIN, THEME_SCALE_MAX, DEFAULT_THEME_SCALE),
    reducedMotion: raw.reducedMotion === true
  }
}

/**
 * Preset visual pronto: apenas dados. Aplicar copia valores para um novo
 * `ThemeConfig` e grava o `presetId`; nenhuma função de comportamento consulta
 * o preset.
 */
export interface ThemePreset {
  id: ThemePresetId
  name: string
  values: Omit<ThemeConfig, 'version' | 'presetId'>
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'classic',
    name: 'Absolem Clássico',
    values: {
      primaryColor: '#3b82f6',
      effectColor: '#93c5fd',
      glowIntensity: 0.7,
      style: 'classic',
      outfit: 'none',
      accessories: [],
      particleDensity: 'medium',
      scale: 1,
      reducedMotion: false
    }
  },
  {
    id: 'neon',
    name: 'Neon',
    values: {
      primaryColor: '#22d3ee',
      effectColor: '#f0abfc',
      glowIntensity: 0.95,
      style: 'neon',
      outfit: 'visor',
      accessories: ['antenna_glow'],
      particleDensity: 'high',
      scale: 1.05,
      reducedMotion: false
    }
  },
  {
    id: 'smoke',
    name: 'Fumaça',
    values: {
      primaryColor: '#94a3b8',
      effectColor: '#cbd5e1',
      glowIntensity: 0.55,
      style: 'liquid',
      outfit: 'scarf',
      accessories: ['back_spikes'],
      particleDensity: 'medium',
      scale: 1,
      reducedMotion: false
    }
  },
  {
    id: 'circuit',
    name: 'Circuito',
    values: {
      primaryColor: '#34d399',
      effectColor: '#a7f3d0',
      glowIntensity: 0.8,
      style: 'wireframe',
      outfit: 'collar',
      accessories: ['visor_hud'],
      particleDensity: 'low',
      scale: 0.95,
      reducedMotion: false
    }
  },
  {
    id: 'jade',
    name: 'Jade',
    values: {
      primaryColor: '#10b981',
      effectColor: '#6ee7b7',
      glowIntensity: 0.6,
      style: 'classic',
      outfit: 'none',
      accessories: ['back_spikes'],
      particleDensity: 'medium',
      scale: 1.1,
      reducedMotion: false
    }
  },
  {
    id: 'amber',
    name: 'Âmbar',
    values: {
      primaryColor: '#f59e0b',
      effectColor: '#fcd34d',
      glowIntensity: 0.85,
      style: 'neon',
      outfit: 'scarf',
      accessories: ['antenna_glow', 'visor_hud'],
      particleDensity: 'high',
      scale: 1,
      reducedMotion: false
    }
  }
]

/** Procura um preset pelo id (entrada `unknown` vinda de UI/import). */
export function findThemePreset(input: unknown): ThemePreset | null {
  if (typeof input !== 'string') return null
  return THEME_PRESETS.find((preset) => preset.id === input) ?? null
}

/**
 * Aplica um preset: devolve um tema novo, com os valores copiados. O preset
 * original nunca é mutado, inclusive a lista de acessórios.
 */
export function applyThemePreset(preset: ThemePreset | ThemePresetId): ThemeConfig {
  const found = typeof preset === 'string' ? findThemePreset(preset) : preset
  if (!found) return defaultTheme()
  return normalizeTheme({
    ...found.values,
    accessories: [...found.values.accessories],
    presetId: found.id
  })
}

/** Marca o tema como editado à mão (deixa de apontar para um preset). */
export function markThemeCustom(theme: ThemeConfig): ThemeConfig {
  return {
    ...theme,
    accessories: [...theme.accessories],
    presetId: THEME_PRESET_CUSTOM
  }
}

/**
 * Lista legível do que a normalização corrigiu. Usada no import para avisar o
 * usuário sem bloquear a aplicação de um arquivo parcialmente válido.
 */
export function themeNormalizationWarnings(input: unknown): string[] {
  const raw = asRecord(input)
  const normalized = normalizeTheme(input)
  const warnings: string[] = []

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return ['Tema inválido: o padrão completo foi aplicado.']
  }

  if (
    raw.primaryColor !== undefined &&
    !(typeof raw.primaryColor === 'string' && HEX_COLOR_RE.test(raw.primaryColor.trim()))
  ) {
    warnings.push('Cor principal inválida; o padrão foi aplicado.')
  }
  if (
    raw.effectColor !== undefined &&
    !(typeof raw.effectColor === 'string' && HEX_COLOR_RE.test(raw.effectColor.trim()))
  ) {
    warnings.push('Cor de efeitos inválida; o padrão foi aplicado.')
  }
  if (
    raw.glowIntensity !== undefined &&
    (typeof raw.glowIntensity !== 'number' || raw.glowIntensity !== normalized.glowIntensity)
  ) {
    warnings.push('Brilho fora da faixa 0..1; o valor foi ajustado.')
  }
  if (raw.style !== undefined && raw.style !== normalized.style) {
    warnings.push('Estilo desconhecido; o padrão foi aplicado.')
  }
  if (raw.outfit !== undefined && raw.outfit !== normalized.outfit) {
    warnings.push('Roupa desconhecida; o padrão foi aplicado.')
  }
  if (raw.particleDensity !== undefined && raw.particleDensity !== normalized.particleDensity) {
    warnings.push('Densidade de partículas desconhecida; o padrão foi aplicado.')
  }
  if (raw.scale !== undefined && raw.scale !== normalized.scale) {
    warnings.push('Escala fora da faixa 0.8..1.5; o valor foi ajustado.')
  }
  if (Array.isArray(raw.accessories)) {
    const dropped = raw.accessories.filter((item) => !includes(THEME_ACCESSORIES, item))
    if (dropped.length > 0) {
      warnings.push('Acessórios desconhecidos foram descartados.')
    }
  } else if (raw.accessories !== undefined) {
    warnings.push('Lista de acessórios inválida; nenhum acessório foi aplicado.')
  }

  return warnings
}
