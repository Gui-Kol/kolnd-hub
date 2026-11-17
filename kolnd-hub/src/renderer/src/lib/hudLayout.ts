// Layout da sobreposição (HUD) — decisão pura derivada da largura configurada.
// Fica em `lib/` (como `globalSearch.ts`) para ser testável em vitest sem DOM.

/**
 * Largura mínima para o grid de duas colunas.
 *
 * No padrão 300 px, a versão em 1 coluna mede ~814 px de altura e não cabe numa
 * área de trabalho 720p (672 px, útil 648). Com 2 colunas o HUD fica compacto
 * (~500–650 px), por isso o padrão já usa 2 colunas. Abaixo de 300 (180–290) as
 * colunas ficariam estreitas demais e o HUD empilha as seções (1 coluna).
 */
export const HUD_TWO_COLUMN_MIN_WIDTH = 300

/**
 * Número de colunas do grid de seções para a largura vigente do HUD.
 *
 * O renderer recebe a largura por push (`update.size.width`); antes do primeiro
 * push o componente usa `HUD_DEFAULT_WIDTH` (300), que já cai em 1 coluna.
 * Entrada inválida também cai em 1 — o pior caso é o layout estreito, nunca um
 * grid que estoura a janela.
 */
export function hudColumnCount(width: number): 1 | 2 {
  if (typeof width !== 'number' || !Number.isFinite(width)) return 1
  return width >= HUD_TWO_COLUMN_MIN_WIDTH ? 2 : 1
}
