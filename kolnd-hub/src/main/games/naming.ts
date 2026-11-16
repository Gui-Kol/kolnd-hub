import { createHash } from 'crypto'

/**
 * Helpers puros da biblioteca de jogos: nomeação, validação e hash — sem
 * Electron, disco ou dependências internas. Extraídos de main/games.ts;
 * compartilhados pelos módulos irmãos (icons/launch/store).
 *
 * Nota: `GameResult` também vive aqui por ser o tipo base das operações da
 * biblioteca usado pelos módulos irmãos (evita ciclo entre icons e store).
 */

/**
 * Siglas preservadas em maiúsculas na formatação do nome derivado do arquivo.
 * Lista curta e conhecida — o objetivo é previsibilidade, não perfeição.
 */
const KNOWN_ACRONYMS = new Set([
  'GTA',
  'FIFA',
  'RPG',
  'FPS',
  'MMO',
  'MMORPG',
  'MOBA',
  'RTS',
  'DLC',
  'VR',
  'HD',
  'HDR',
  'AI',
  'NPC'
])

/** Numerais romanos comuns em títulos (mantidos em maiúsculas). */
const ROMAN_NUMERALS = new Set([
  'II',
  'III',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XX'
])

function formatNameWord(word: string): string {
  const upper = word.toUpperCase()
  if (KNOWN_ACRONYMS.has(upper)) return upper
  if (ROMAN_NUMERALS.has(upper)) return upper
  if (/^\d+$/.test(word)) return word
  // Palavra já escrita em maiúsculas e curta (ex.: "V", "GTA"): mantém.
  if (word.length <= 5 && word === upper && /^[A-Z0-9]+$/.test(word)) return upper
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * Deriva um nome legível a partir do nome do arquivo sem extensão.
 * Heurística intencionalmente simples e previsível (documentada no código):
 *  1. `.`, `_`, `-` e espaços múltiplos viram um único espaço;
 *  2. cada palavra recebe inicial maiúscula e o restante minúscula;
 *  3. siglas conhecidas (GTA, FIFA…), numerais romanos (II, III…) e palavras
 *     já em maiúsculas com até 5 caracteres são preservadas como estão;
 *  4. acentos são mantidos; sufixos técnicos comuns (`_x64`, `-Win64-Shipping`)
 *     NÃO são removidos — viram "X64"/"Win64 Shipping" no nome. Aceito de
 *     propósito para manter a regra simples e sem surpresas.
 * Se nada sobrar (ex.: arquivo "___.exe"), devolve "Jogo sem nome".
 */
export function formatGameName(rawBase: string): string {
  const cleaned = rawBase
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Jogo sem nome'
  return cleaned.split(' ').map(formatNameWord).join(' ')
}

/** Hash determinístico (40 bits) de um caminho normalizado — mesmo espírito do steamScanner. */
export function exePathHash(exePath: string): string {
  return createHash('sha1').update(exePath.toLowerCase()).digest('hex').slice(0, 10)
}

export interface GameResult {
  success: boolean
  error?: string
}

export const GAME_ID_MAX_LENGTH = 200
export const EXE_PATH_MAX_LENGTH = 1024

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0 && id.trim().length <= GAME_ID_MAX_LENGTH
}

export function isValidExePath(exePath: unknown): exePath is string {
  return (
    typeof exePath === 'string' &&
    exePath.trim().length > 0 &&
    exePath.trim().length <= EXE_PATH_MAX_LENGTH
  )
}
