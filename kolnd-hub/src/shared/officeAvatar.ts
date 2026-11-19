// Aparência editável dos personagens do OpenOffice.
//
// FRONTEIRA: arquivo compartilhado entre main (store/IPC) e renderer (editor e
// canvas). Paletas FIXAS curadas (sem color picker livre), validação por índice
// e um look padrão determinístico pela seed da sessão — quem nunca editou
// continua com a mesma "cara" de antes. Nada de I/O, DOM ou relógio.

export type OfficeAvatarSex = 'feminino' | 'masculino' | 'neutro'

/** Aparência persistida por sessão (chave `officeAvatars` do store). */
export interface OfficeAvatarLook {
  /** Silhueta/base do corpo. */
  sex: OfficeAvatarSex
  /** Índice de `HAIR_STYLES`. */
  hairStyle: number
  /** Índice de `HAIR_COLORS`. */
  hairColor: number
  /** Índice de `SKIN_TONES`. */
  skin: number
  /** Índice de `SHIRT_COLORS`. */
  shirt: number
  /** Índice de `PANTS_COLORS`. */
  pants: number
}

/** Cor com tom principal (`c`) e sombra (`C`) — a pixel art usa os dois. */
export interface OfficeAvatarColor {
  name: string
  c: string
  C: string
}

export interface OfficeHairStyle {
  name: string
  /** Grade de caracteres (`. ` = transparente, `h`/`H` = cabelo). */
  rows: readonly string[]
}

/** Teto do mapa de looks persistido (sessões antigas saem na escrita). */
export const OFFICE_AVATARS_MAX = 300

export const AVATAR_SEXES: readonly OfficeAvatarSex[] = ['feminino', 'masculino', 'neutro']

export const AVATAR_SEX_LABELS: Record<OfficeAvatarSex, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  neutro: 'Neutro'
}

/** 10 tons de pele (mesma curadoria aprovada no mockup). */
export const SKIN_TONES: readonly OfficeAvatarColor[] = [
  { name: 'Porcelana', c: '#f7d9c0', C: '#e6c0a4' },
  { name: 'Claro', c: '#f0c39b', C: '#d9a97f' },
  { name: 'Médio', c: '#d9a97f', C: '#c79670' },
  { name: 'Dourado', c: '#c08a5f', C: '#a8744c' },
  { name: 'Moreno', c: '#a0693f', C: '#8a5732' },
  { name: 'Marrom', c: '#8d5a3b', C: '#7a4a30' },
  { name: 'Escuro', c: '#6b4530', C: '#5a3823' },
  { name: 'Profundo', c: '#4f3527', C: '#40291c' },
  { name: 'Ébano', c: '#3a2a20', C: '#2d2018' },
  { name: 'Oliváceo', c: '#c9a06a', C: '#b08a55' }
]

/** 10 cores de cabelo. */
export const HAIR_COLORS: readonly OfficeAvatarColor[] = [
  { name: 'Preto', c: '#161616', C: '#0d0d0d' },
  { name: 'Castanho-escuro', c: '#3b2416', C: '#2e1c11' },
  { name: 'Castanho', c: '#7a4b23', C: '#633c1b' },
  { name: 'Louro', c: '#c0a062', C: '#a88950' },
  { name: 'Ruivo', c: '#8a3b2a', C: '#713023' },
  { name: 'Grisalho', c: '#8b95a0', C: '#6f7983' },
  { name: 'Roxo', c: '#6b3d6e', C: '#553058' },
  { name: 'Azul-aço', c: '#2f4858', C: '#253a47' },
  { name: 'Rosa', c: '#a85a7a', C: '#8a4762' },
  { name: 'Verde', c: '#3f6b4f', C: '#2f5239' }
]

/** 10 cores de camisa (o âmbar do Hub abre a lista). */
export const SHIRT_COLORS: readonly OfficeAvatarColor[] = [
  { name: 'Âmbar', c: '#e2a33f', C: '#c98d2f' },
  { name: 'Verde', c: '#47c476', C: '#3aa862' },
  { name: 'Azul', c: '#7fb3e8', C: '#6395c9' },
  { name: 'Lilás', c: '#c79bf0', C: '#a97fd1' },
  { name: 'Vermelho', c: '#f06048', C: '#c94c38' },
  { name: 'Turquesa', c: '#5aa0a8', C: '#46858c' },
  { name: 'Gelo', c: '#d6d6d6', C: '#b3b3b3' },
  { name: 'Marinho', c: '#3a5a80', C: '#2c4666' },
  { name: 'Oliva', c: '#8a9a4f', C: '#70803d' },
  { name: 'Rosa', c: '#d98aa8', C: '#bd708e' }
]

/** 8 cores de calça. */
export const PANTS_COLORS: readonly OfficeAvatarColor[] = [
  { name: 'Jeans', c: '#2d3f52', C: '#22303c' },
  { name: 'Preto', c: '#1a2028', C: '#12171d' },
  { name: 'Cinza', c: '#4a545f', C: '#3b444d' },
  { name: 'Cáqui', c: '#7a6a4a', C: '#655638' },
  { name: 'Marrom', c: '#5a4230', C: '#493524' },
  { name: 'Marinho', c: '#24344a', C: '#1b2838' },
  { name: 'Verde', c: '#3a4a3a', C: '#2d3a2d' },
  { name: 'Vinho', c: '#5a2f35', C: '#48252a' }
]

/**
 * 6 estilos de cabelo desenhados como sobreposição na cabeça da base 16×24.
 * A ordem dos caracteres importa: `h` é o tom principal, `H` a sombra.
 */
export const HAIR_STYLES: readonly OfficeHairStyle[] = [
  {
    name: 'Curto',
    rows: [
      '.....hhhhhh.....',
      '....hhhhhhhh....',
      '....hhHHHHhh....',
      '....hh....hh....',
      '....hh....hh....'
    ]
  },
  {
    name: 'Longo',
    rows: [
      '.....hhhhhh.....',
      '....hhhhhhhh....',
      '....hhHHHHhh....',
      '....hh....hh....',
      '....hh....hh....',
      '....hh....hh....',
      '....hh....hh....',
      '....hh....hh....',
      '....h......h....',
      '....h......h....',
      '....h......h....',
      '....h......h....',
      '....h......h....'
    ]
  },
  {
    name: 'Coque',
    rows: [
      '......hhhh......',
      '.....hhhhhh.....',
      '....hhhhhhhh....',
      '....hhHHHHhh....',
      '....hh....hh....',
      '....h......h....'
    ]
  },
  {
    name: 'Moicano',
    rows: [
      '.......hh.......',
      '.......hh.......',
      '.......hh.......',
      '......hhhh......',
      '....hh....hh....',
      '....h......h....'
    ]
  },
  {
    name: 'Cacheado',
    rows: [
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..hhhHHHHHHhhh..',
      '..hh........hh..',
      '..h..........h..'
    ]
  },
  {
    name: 'Franja',
    rows: [
      '.....hhhhhh.....',
      '....hhhhhhhh....',
      '....hhhhhhhh....',
      '....HHHHHHHH....',
      '....hh....hh....',
      '....hh....hh....',
      '....hh....hh....',
      '....h......h....',
      '....h......h....'
    ]
  }
]

/** Bases do corpo por sexo (16×24). Cabelo entra por cima, no render. */
export const BODY_ROWS: Record<OfficeAvatarSex, readonly string[]> = {
  masculino: [
    '.....ssssss.....',
    '....ssssssss....',
    '....ssssssss....',
    '....ssssssss....',
    '....ssessess....',
    '....ssssssss....',
    '....ssSSSSss....',
    '.....ssssss.....',
    '......ssss......',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..sccccccccccs..',
    '...pppppppppp...',
    '...pppppppppp...',
    '...pppp..pppp...',
    '...pppp..pppp...',
    '...pppp..pppp...',
    '...pppp..pppp...',
    '...bbbb..bbbb...',
    '................'
  ],
  feminino: [
    '.....ssssss.....',
    '....ssssssss....',
    '....ssssssss....',
    '....ssssssss....',
    '....ssessess....',
    '....ssssssss....',
    '....ssSSSSss....',
    '.....ssssss.....',
    '......ssss......',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..sccccccccccs..',
    '..pppppppppppp..',
    '..pppppppppppp..',
    '...pp......pp...',
    '...pp......pp...',
    '...pp......pp...',
    '....p......p....',
    '...bbb....bbb...',
    '................'
  ],
  neutro: [
    '.....ssssss.....',
    '....ssssssss....',
    '....ssssssss....',
    '....ssssssss....',
    '....ssessess....',
    '....ssssssss....',
    '....ssSSSSss....',
    '.....ssssss.....',
    '......ssss......',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..CccccccccccC..',
    '..sccccccccccs..',
    '...pppppppppp...',
    '...pppppppppp...',
    '...ppp....ppp...',
    '...ppp....ppp...',
    '...ppp....ppp...',
    '...ppp....ppp...',
    '..bbbb....bbbb..',
    '................'
  ]
}

/** Mistura barata (mesmo espírito do `art.ts`): distribui a seed nos índices. */
function mix(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x21f0aaad)
  x ^= x >>> 15
  return x >>> 0
}

/**
 * Índices das paletas ANTIGAS (4 skins, 7 cabelos, 7 camisas do `art.ts`).
 * Mapeados para as paletas novas, o look padrão mantém exatamente a cor que o
 * personagem já tinha antes da edição — só o estilo/sexo/calça são novos.
 */
const LEGACY_SKIN = [1, 2, 5, 6] as const
const LEGACY_HAIR = [1, 0, 6, 2, 7, 4, 3] as const
const LEGACY_SHIRT = [0, 1, 2, 3, 4, 5, 6] as const

/**
 * Look padrão determinístico pela seed da sessão. Sem store, duas execuções
 * com o mesmo `sessionID` produzem o mesmo personagem.
 */
export function defaultLookFor(seed: number): OfficeAvatarLook {
  const safe = Number.isFinite(seed) ? seed >>> 0 : 0
  return {
    sex: AVATAR_SEXES[mix(safe, 6) % AVATAR_SEXES.length],
    hairStyle: mix(safe, 5) % HAIR_STYLES.length,
    hairColor: LEGACY_HAIR[mix(safe, 2) % LEGACY_HAIR.length],
    skin: LEGACY_SKIN[mix(safe, 1) % LEGACY_SKIN.length],
    shirt: LEGACY_SHIRT[mix(safe, 3) % LEGACY_SHIRT.length],
    pants: mix(safe, 4) % PANTS_COLORS.length
  }
}

/** Índice inteiro dentro da faixa (0..length-1); qualquer outra coisa → false. */
export function isValidPaletteIndex(value: unknown, length: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length
}

export function isAvatarSex(value: unknown): value is OfficeAvatarSex {
  return typeof value === 'string' && (AVATAR_SEXES as readonly string[]).includes(value)
}

/** Look válido? Usado pelo store e pelo IPC (renderer pode estar comprometido). */
export function isValidAvatarLook(input: unknown): input is OfficeAvatarLook {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const raw = input as Record<string, unknown>
  if (Object.keys(raw).length !== 6) return false
  return (
    isAvatarSex(raw.sex) &&
    isValidPaletteIndex(raw.hairStyle, HAIR_STYLES.length) &&
    isValidPaletteIndex(raw.hairColor, HAIR_COLORS.length) &&
    isValidPaletteIndex(raw.skin, SKIN_TONES.length) &&
    isValidPaletteIndex(raw.shirt, SHIRT_COLORS.length) &&
    isValidPaletteIndex(raw.pants, PANTS_COLORS.length)
  )
}

/**
 * Normaliza um look vindo do disco/IPC. Inválido → `null` (nunca um look
 * parcial silencioso: o chamador decide cair no padrão da seed).
 */
export function normalizeAvatarLook(input: unknown): OfficeAvatarLook | null {
  return isValidAvatarLook(input) ? { ...input } : null
}

/** Paleta resolvida de um look (sem status — o renderer aplica o cinza de `ended`). */
export function avatarPalette(look: OfficeAvatarLook): Record<string, string> {
  const hair = HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0]
  const skin = SKIN_TONES[look.skin] ?? SKIN_TONES[0]
  const shirt = SHIRT_COLORS[look.shirt] ?? SHIRT_COLORS[0]
  const pants = PANTS_COLORS[look.pants] ?? PANTS_COLORS[0]
  return {
    h: hair.c,
    H: hair.C,
    s: skin.c,
    S: skin.C,
    c: shirt.c,
    C: shirt.C,
    p: pants.c,
    P: pants.C,
    b: '#151b22',
    e: '#232b34'
  }
}
