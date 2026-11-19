import type { StoredGame } from '../store'

/**
 * Re-extração sob demanda dos ícones dos jogos.
 *
 * O objetivo é garantir que todos os cards da Biblioteca fiquem preenchidos:
 * ao abrir a página, o main revisa a biblioteca e tenta extrair de novo o ícone
 * do executável **apenas** dos jogos cujo ícone não está legível (ausente,
 * vazio, grande demais, corrompido). Ícones válidos nunca são sobrescritos —
 * isso preserva a imagem que o usuário escolheu à mão no modal de edição.
 *
 * A lógica é injetável (sem `electron`) para poder ser testada como unidade
 * pura; `icons.ts` fornece as dependências reais.
 */

/** Dependências da varredura — todas fornecidas por quem chama. */
export interface ReloadIconsDeps {
  /** Jogos persistidos, na ordem em que serão revisados. */
  games: () => StoredGame[]
  /** dataURL do ícone quando ele está legível; `null` = precisa recarregar. */
  iconOf: (game: StoredGame) => string | null
  /** Caminho de destino da extração (o primeiro candidato de ícone do jogo). */
  targetOf: (game: StoredGame) => string
  /** Executável de onde o ícone será extraído. */
  exeOf: (game: StoredGame) => string
  /** Extrai e grava o ícone; `true` = gravado com sucesso. */
  extract: (exePath: string, target: string) => Promise<boolean>
}

/** Contagens da varredura: revisados, regravados e falhas. */
export interface ReloadIconsResult {
  checked: number
  reloaded: number
  failed: number
}

/**
 * Percorre todos os jogos e re-extrai o ícone somente dos ilegíveis.
 * Best-effort: uma falha (ou exceção) num jogo conta como `failed` e não
 * interrompe os demais. Nunca lança — quem chama não deve ser derrubado
 * por causa de ícone.
 */
export async function reloadMissingGameIcons(deps: ReloadIconsDeps): Promise<ReloadIconsResult> {
  const result: ReloadIconsResult = { checked: 0, reloaded: 0, failed: 0 }
  for (const game of deps.games()) {
    result.checked += 1
    // Ícone legível: nada a fazer — sobrescrever apagaria a escolha do usuário.
    if (deps.iconOf(game) !== null) continue
    try {
      const ok = await deps.extract(deps.exeOf(game), deps.targetOf(game))
      if (ok) result.reloaded += 1
      else result.failed += 1
    } catch {
      // Exe inexistente, permissão negada, extração quebrada: segue para o
      // próximo jogo — um card sem ícone não pode invalidar a varredura toda.
      result.failed += 1
    }
  }
  return result
}
