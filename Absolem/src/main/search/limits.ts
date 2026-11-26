import {
  MAX_FETCHES_PER_TURN,
  MAX_SEARCHES_PER_TURN,
  SEARCH_TURN_BUDGET_MS,
  type SearchKind,
  type SearchTurnStatus
} from '../../shared/search'

/**
 * Limites de pesquisa por turno (task 10, T7).
 *
 * - no máximo 3 buscas grounded e 5 aberturas de página por turno de chat;
 * - orçamento de 30 s contado a partir do início do turno;
 * - o teto mensal do medidor (task 05) é consultado em TODA operação: se
 *   estourou, a resposta é `quota` antes de qualquer rede;
 * - o contador reinicia no começo de cada turno (`beginTurn(requestId)`).
 *
 * O estado é só contagem/relógio: nenhuma query, URL ou conteúdo é retido.
 */

export type SearchLimitReason = 'disabled' | 'turn-limit' | 'budget' | 'monthly'

export type SearchLimitDecision =
  { ok: true } | { ok: false; reason: SearchLimitReason; message: string }

export interface SearchLimitsOptions {
  now?: () => number
  maxSearches?: number
  maxFetches?: number
  budgetMs?: number
  /** Lança quando o teto mensal já foi atingido (medidor da task 05). */
  checkBudget?: () => void
}

export class SearchTurnLimits {
  private readonly now: () => number
  private readonly maxSearches: number
  private readonly maxFetches: number
  private readonly budgetMs: number
  private readonly checkBudget?: () => void

  private requestId: string | null = null
  private startedAt: number | null = null
  private searches = 0
  private fetches = 0

  constructor(options: SearchLimitsOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.maxSearches = Math.max(1, Math.floor(options.maxSearches ?? MAX_SEARCHES_PER_TURN))
    this.maxFetches = Math.max(1, Math.floor(options.maxFetches ?? MAX_FETCHES_PER_TURN))
    this.budgetMs = Math.max(1, Math.floor(options.budgetMs ?? SEARCH_TURN_BUDGET_MS))
    this.checkBudget = options.checkBudget
  }

  /** Reinicia os contadores e o relógio do turno. */
  beginTurn(requestId: string | null = null, now: number = this.now()): void {
    this.requestId = typeof requestId === 'string' && requestId.length > 0 ? requestId : null
    this.startedAt = now
    this.searches = 0
    this.fetches = 0
  }

  getCurrentRequestId(): string | null {
    return this.requestId
  }

  private ensureStarted(now: number): void {
    if (this.startedAt === null) {
      this.startedAt = now
    }
  }

  check(kind: SearchKind, now: number = this.now()): SearchLimitDecision {
    this.ensureStarted(now)
    if (this.checkBudget) {
      try {
        this.checkBudget()
      } catch (err) {
        return {
          ok: false,
          reason: 'monthly',
          message:
            err instanceof Error ? err.message : 'Teto mensal de tokens atingido. Ajuste o limite.'
        }
      }
    }

    const remaining = this.budgetMs - (now - (this.startedAt as number))
    if (remaining <= 0) {
      return {
        ok: false,
        reason: 'budget',
        message: `O orçamento de ${Math.round(this.budgetMs / 1000)} s de pesquisa do turno acabou.`
      }
    }

    const used = kind === 'search' ? this.searches : this.fetches
    const limit = kind === 'search' ? this.maxSearches : this.maxFetches
    if (used >= limit) {
      return {
        ok: false,
        reason: 'turn-limit',
        message:
          kind === 'search'
            ? `Limite de ${limit} buscas por turno atingido.`
            : `Limite de ${limit} aberturas de página por turno atingido.`
      }
    }
    return { ok: true }
  }

  /** Conta a operação aprovada. Chame só depois de `check` devolver `ok`. */
  consume(kind: SearchKind): void {
    if (kind === 'search') this.searches += 1
    else this.fetches += 1
  }

  snapshot(now: number = this.now()): SearchTurnStatus {
    const startedAt = this.startedAt ?? now
    return {
      requestId: this.requestId,
      searches: this.searches,
      searchesLimit: this.maxSearches,
      fetches: this.fetches,
      fetchesLimit: this.maxFetches,
      budgetRemainingMs: Math.max(0, this.budgetMs - (now - startedAt))
    }
  }

  reset(): void {
    this.requestId = null
    this.startedAt = null
    this.searches = 0
    this.fetches = 0
  }
}

export function createSearchTurnLimits(options: SearchLimitsOptions = {}): SearchTurnLimits {
  return new SearchTurnLimits(options)
}

/** Erro tipado para o roteador mapear `kind: 'quota'` sem perder a mensagem. */
export class SearchQuotaError extends Error {
  readonly kind = 'quota'

  constructor(message: string) {
    super(message)
    this.name = 'SearchQuotaError'
  }
}

/** Erro tipado de limite/feature desligada (vira falha estruturada da tool). */
export class SearchLimitError extends Error {
  readonly kind = 'limit'

  constructor(message: string) {
    super(message)
    this.name = 'SearchLimitError'
  }
}
