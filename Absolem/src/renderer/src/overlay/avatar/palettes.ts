import { normalizeHexColor } from '../../../../shared/theme'
import { CATERPILLAR_MATERIAL_ROLES, type CaterpillarMaterialRole } from './caterpillar'

/**
 * Paleta nomeada do personagem.
 *
 * Cada papel de material tem uma cor em `#rrggbb`. Os valores de
 * `ABSOLEM_1951_PALETTE` são provisórios: as tasks 15-19 ajustam geometria,
 * rosto, membros, turbante e iluminação antes da comparação final com a
 * referência. Nenhum preset de tema mora aqui; a paleta é independente do
 * `ThemeConfig` e só a fábrica de materiais da cena a consome.
 */
export type CaterpillarPalette = Record<CaterpillarMaterialRole, string>

/** Paleta base da recriação procedural (sem asset oficial). */
export const ABSOLEM_1951_PALETTE: CaterpillarPalette = {
  body: '#4a6fa5',
  belly: '#d9e6d3',
  head: '#5478b0',
  eyelid: '#6c5a8a',
  brow: '#2c3e5c',
  sclera: '#f2ead8',
  iris: '#2f5d8a',
  pupil: '#121826',
  highlight: '#ffffff',
  lip: '#c96f7a',
  mouth: '#3a1f2b',
  tongue: '#d98a93',
  antenna: '#6b8fc4',
  mandible: '#e8dcc0',
  hand: '#e8a0a8',
  sleeve: '#4a6fa5',
  claw: '#f0e6cf',
  turban: '#5b4a86',
  turbanStripe: '#d9b45b',
  pipe: '#b8863b',
  hose: '#4a3b2f',
  smoke: '#dfe8f0',
  outfit: '#3f5f8f',
  accessory: '#d9b45b'
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

/**
 * Normaliza uma paleta parcial sem lançar. Toda role ausente ou com cor
 * inválida recebe o valor de referência; chaves fora de
 * `CATERPILLAR_MATERIAL_ROLES` são descartadas. O retorno é sempre um objeto
 * novo e completo.
 */
export function normalizePalette(input: unknown): CaterpillarPalette {
  const raw = asRecord(input)
  const palette = {} as CaterpillarPalette

  for (const role of CATERPILLAR_MATERIAL_ROLES) {
    palette[role] = normalizeHexColor(raw[role], ABSOLEM_1951_PALETTE[role])
  }

  return palette
}
