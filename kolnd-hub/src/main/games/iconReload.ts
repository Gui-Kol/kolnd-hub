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

/** Dependências do "Atualizar todos os ícones" — o equivalente em lote do modal. */
export interface RefreshIconsDeps {
  /** Jogos persistidos, na ordem em que serão atualizados. */
  games: () => StoredGame[]
  /** Destino da extração (mesmo `<id>.png` usado por "Restaurar ícone"). */
  targetOf: (game: StoredGame) => string
  /** Executável de onde o ícone será extraído. */
  exeOf: (game: StoredGame) => string
  /** Extrai e grava o ícone; `true` = gravado com sucesso. */
  extract: (exePath: string, target: string) => Promise<boolean>
  /** Persiste a lista atualizada de uma vez; `false` = nada foi gravado no store. */
  persist: (games: StoredGame[]) => boolean
  /** Apaga sobras do ícone anterior de um jogo já persistido. */
  cleanup: (game: StoredGame, keptTarget: string) => void
}

/** Contagens do "Atualizar todos os ícones": revisados, atualizados e falhas. */
export interface RefreshIconsResult {
  checked: number
  refreshed: number
  failed: number
}

/**
 * Re-extrai o ícone de **todos** os jogos a partir do executável — o mesmo
 * efeito de abrir cada jogo e clicar em "Restaurar ícone do executável".
 * Diferente de `reloadMissingGameIcons`, sobrescreve também ícones válidos
 * (inclusive os escolhidos à mão), então só deve ser chamado por ação explícita
 * do usuário.
 *
 * Os arquivos são extraídos primeiro e o store é gravado **uma única vez** ao
 * final; se a persistência falhar, o resultado conta tudo como falha e nenhum
 * ícone antigo é apagado. Best-effort por jogo: uma exceção não interrompe os
 * demais. Nunca lança.
 */
export async function refreshAllGameIcons(deps: RefreshIconsDeps): Promise<RefreshIconsResult> {
  const games = deps.games()
  const next = [...games]
  const refreshed = new Map<string, string>()
  let failed = 0

  for (let index = 0; index < games.length; index += 1) {
    const game = games[index]
    const target = deps.targetOf(game)
    try {
      if (!(await deps.extract(deps.exeOf(game), target))) {
        failed += 1
        continue
      }
      next[index] = { ...game, iconPath: target }
      refreshed.set(game.id, target)
    } catch {
      // Exe sumiu, sem permissão de escrita, extração quebrada: segue adiante.
      failed += 1
    }
  }

  if (refreshed.size === 0) return { checked: games.length, refreshed: 0, failed }

  let persisted: boolean
  try {
    persisted = deps.persist(next)
  } catch {
    persisted = false
  }
  if (!persisted) {
    // Os arquivos podem ter sido regravados, mas o store continua apontando
    // para os caminhos antigos — reporta falha total em vez de sucesso falso.
    return { checked: games.length, refreshed: 0, failed: games.length }
  }

  for (const game of games) {
    const target = refreshed.get(game.id)
    if (!target) continue
    try {
      deps.cleanup(game, target)
    } catch {
      // Limpeza é cosmética: o ícone novo já está persistido.
    }
  }

  return { checked: games.length, refreshed: refreshed.size, failed }
}
