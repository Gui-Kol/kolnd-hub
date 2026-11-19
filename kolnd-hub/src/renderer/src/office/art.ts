import type { OfficeAgentStatus } from '../../../shared/office'

/**
 * Arte procedural do Escritório — dados puros, sem canvas e sem DOM.
 *
 * Cada sprite é uma grade de caracteres; cada caractere é um índice de paleta
 * (`.` = transparente). O renderer resolve a paleta e desenha pixel a pixel.
 * Nada aqui lê o relógio, o DOM ou arquivos: os testes rodam em `node`.
 *
 * O "look" do personagem é determinístico por `seed` (hash da sessão, vindo do
 * contrato): mesmo seed ⇒ mesmo cabelo/pele/camisa, sem persistência nova.
 */

export const AGENT_WIDTH = 12
export const AGENT_HEIGHT = 20

/** Quantos quadros a animação de digitação tem. */
export const WORKING_FRAME_COUNT = 3

export type Palette = Record<string, string>

export interface PixelSprite {
  width: number
  height: number
  rows: string[]
}

/**
 * Paleta fixa de cenário/objetos. Os personagens herdam estes tons e trocam
 * apenas cabelo, pele e camisa (derivados da seed).
 */
export function officePalette(): Palette {
  return {
    // Semânticas do Hub
    a: '#e2a33f', // acento (âmbar)
    w: '#f5d76e', // aviso
    d: '#f06048', // perigo
    g: '#47c476', // sucesso / brilho do monitor
    // Objetos
    m: '#2b3644', // moldura do monitor
    l: '#8a6239', // madeira clara (tampo)
    k: '#4a3520', // madeira escura (pé/estrutura)
    t: '#4f9d69', // folha
    T: '#2f6b47', // folha escura
    u: '#8a5a3c', // vaso
    o: '#22303c' // contorno neutro
  }
}

const SKINS: ReadonlyArray<{ s: string; S: string }> = [
  { s: '#f0c39b', S: '#d9a97f' },
  { s: '#d9a97f', S: '#c79670' },
  { s: '#8d5a3b', S: '#7a4a30' },
  { s: '#6b4530', S: '#5a3823' }
]

const HAIRS: ReadonlyArray<{ h: string; H: string }> = [
  { h: '#3b2416', H: '#2e1c11' },
  { h: '#181818', H: '#101010' },
  { h: '#6b3d6e', H: '#553058' },
  { h: '#7a4b23', H: '#633c1b' },
  { h: '#2f4858', H: '#253a47' },
  { h: '#8a3b2a', H: '#713023' },
  { h: '#c0a062', H: '#a88950' }
]

const SHIRTS: ReadonlyArray<{ c: string; C: string }> = [
  { c: '#e2a33f', C: '#c98d2f' },
  { c: '#47c476', C: '#3aa862' },
  { c: '#7fb3e8', C: '#6395c9' },
  { c: '#c79bf0', C: '#a97fd1' },
  { c: '#f06048', C: '#c94c38' },
  { c: '#5aa0a8', C: '#46858c' },
  { c: '#d6d6d6', C: '#b3b3b3' }
]

/** Mistura barata (xorshift/multiplicação) para distribuir a seed. */
function mix(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x21f0aaad)
  x ^= x >>> 15
  return x >>> 0
}

function pick<T>(items: readonly T[], seed: number, salt: number): T {
  return items[mix(seed, salt) % items.length]
}

/**
 * Paleta do personagem: cenário + cabelo/pele/camisa derivados da seed.
 * `ended` fica acinzentado (saiu do escritório); `unknown` usa olhos neutros.
 */
export function agentPalette(seed: number, status: OfficeAgentStatus): Palette {
  const palette = officePalette()
  const safeSeed = Number.isFinite(seed) ? seed >>> 0 : 0
  const skin = pick(SKINS, safeSeed, 1)
  const hair = pick(HAIRS, safeSeed, 2)
  const shirt = pick(SHIRTS, safeSeed, 3)

  if (status === 'ended') {
    // Sem seed: personagem encerrado perde identidade e vira silhueta cinza.
    return {
      ...palette,
      h: '#3b4148',
      H: '#2b3137',
      s: '#7d8894',
      S: '#5f6975',
      c: '#47525e',
      C: '#3a4651',
      e: '#2b3137',
      p: '#3a4651',
      b: '#222d3a'
    }
  }

  return {
    ...palette,
    h: hair.h,
    H: hair.H,
    s: skin.s,
    S: skin.S,
    c: shirt.c,
    C: shirt.C,
    e: status === 'unknown' ? '#7d8894' : '#22303c',
    p: '#2d3f52',
    b: '#141c25'
  }
}

/** Base 12×20: cabeça, tronco, pernas e sapatos (frente, sem direções). */
const AGENT_BASE: string[] = [
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..hsessesh..',
  '..hssssssh..',
  '..hssSSssh..',
  '..hssssssh..',
  '...ssssss...',
  '..cccccccc..',
  '..cccccccc..',
  '..cccccccc..',
  '..cccccccc..',
  '..CccccccC..',
  '..pppppppp..',
  '...pp..pp...',
  '...pp..pp...',
  '...pp..pp...',
  '...pp..pp...',
  '..bbb..bbb..',
  '............'
]

/** Substitui linhas específicas sem duplicar o sprite inteiro em cada quadro. */
function patch(base: readonly string[], rows: Record<number, string>): string[] {
  return base.map((row, index) => rows[index] ?? row)
}

const WORKING_FRAMES: string[][] = [
  patch(AGENT_BASE, {
    11: '..cccccccc..',
    12: '..CccccccC..'
  }),
  patch(AGENT_BASE, {
    11: '.cccccccccc.',
    12: '..CccccccC..'
  }),
  patch(AGENT_BASE, {
    11: '..cccccccc..',
    12: '.ccCCCCCCcc.'
  })
]

/** Mão levantada + manga subindo pelo lado direito. */
const NEEDS_YOU_FRAME = patch(AGENT_BASE, {
  1: '..hhhhhhhhw.',
  2: '..hsssssshc.',
  3: '..hsesseshc.',
  4: '..hsssssshc.',
  5: '..hssSSsshc.',
  6: '..hsssssshc.',
  7: '...ssssss.c.'
})

/** Caneca de café (pixel âmbar) ao lado do corpo. */
const IDLE_FRAME = patch(AGENT_BASE, {
  12: '..CccccccCa.'
})

/** Olhos fechados/ausentes: sessão encerrada. */
const ENDED_FRAME = patch(AGENT_BASE, {
  3: '..hssoossh..'
})

/** Olhos neutros (cinza) para estado desconhecido. */
const UNKNOWN_FRAME = patch(AGENT_BASE, {
  3: '..hsassash..'
})

/** Quadros de cada estado. Trabalhando anima; os demais são estáticos. */
export function agentFrames(status: OfficeAgentStatus): string[][] {
  switch (status) {
    case 'working':
      return WORKING_FRAMES
    case 'needsYou':
      return [NEEDS_YOU_FRAME]
    case 'idle':
      return [IDLE_FRAME]
    case 'ended':
      return [ENDED_FRAME]
    default:
      return [UNKNOWN_FRAME]
  }
}

function spriteFromRows(rows: string[]): PixelSprite {
  const width = rows[0]?.length ?? 0
  if (width === 0) throw new Error('Sprite vazio.')
  for (const row of rows) {
    if (row.length !== width) {
      throw new Error(`Sprite com linha inconsistente (${row.length} ≠ ${width}).`)
    }
  }
  return { width, height: rows.length, rows }
}

const DESK_ROWS = [
  'kkkkkkkkkkkkkkkkkkkkkkkk',
  'kllllllllllllllllllllllk',
  'kllllllllllllllllllllllk',
  'kkkkkkkkkkkkkkkkkkkkkkkk',
  '..kk................kk..',
  '..kk................kk..',
  '..kk................kk..',
  '..kk................kk..',
  '..kk................kk..',
  '..kk................kk..',
  '..kk................kk..',
  '..kk................kk..'
]

const MONITOR_ROWS = [
  'mmmmmmmmmmmmmmmm',
  'mggggggggggggggm',
  'mggggggggggggggm',
  'mggggggggggggggm',
  'mggggggggggggggm',
  'mggggggggggggggm',
  'mmmmmmmmmmmmmmmm',
  '.......mm.......',
  '.......mm.......',
  '......mmmm......',
  '....mmmmmmmm....',
  '................'
]

const CHAIR_ROWS = [
  '....kkkk....',
  '...kllllk...',
  '...kllllk...',
  '...kllllk...',
  '...kllllk...',
  '...kkkkkk...',
  '....k..k....',
  '....k..k....',
  '...kk..kk...',
  '............'
]

const PLANT_ROWS = [
  '...tttt...',
  '..ttTTtt..',
  '.ttTTTTtt.',
  '.tTTttTTt.',
  '..tTTTTt..',
  '...tTTt...',
  '....Tt....',
  '...uuuu...',
  '...uuuu...',
  '...uuuu...',
  '...uuuu...',
  '...uuuu...',
  '....uu....',
  '..........'
]

const DOOR_ROWS = [
  'kkkkkkkkkkkkkk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'klllllllllllak',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kllllllllllllk',
  'kkkkkkkkkkkkkk'
]

/** Móveis desenhados atrás/na frente dos personagens (sem PNG, sem asset). */
export const FURNITURE: {
  desk: PixelSprite
  monitor: PixelSprite
  chair: PixelSprite
  plant: PixelSprite
  door: PixelSprite
} = {
  desk: spriteFromRows(DESK_ROWS),
  monitor: spriteFromRows(MONITOR_ROWS),
  chair: spriteFromRows(CHAIR_ROWS),
  plant: spriteFromRows(PLANT_ROWS),
  door: spriteFromRows(DOOR_ROWS)
}
