import {
  MEMORY_PROMPT_BUDGET,
  MEMORY_PROMPT_MAX_ITEMS,
  MEMORY_RECENCY_HALF_LIFE_DAYS,
  type MemoryRecord
} from '../../shared/memory'
import { formatMemoryBlock, type FormattedMemoryBlock } from './format'
import type { MemoryRepository } from './repository'

/**
 * Recuperação por relevância + recência.
 *
 * `bm25` (FTS5) vira relevância normalizada; soma-se decaimento exponencial de
 * 30 dias, frequência de uso e prioridade de `pinned`/`profile`. Nunca devolve
 * mais de 8 memórias nem passa do orçamento de caracteres do prompt.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_QUERY_ITEMS = 200
const MAX_PRIORITY_ITEMS = 50

export interface RecallOptions {
  budgetChars?: number
  maxItems?: number
  now?: number
  /** Registra uso (`use_count`/`last_used_at`) nas memórias devolvidas. */
  touch?: boolean
}

export interface RecallResult {
  memories: MemoryRecord[]
  text: string
  formatted: FormattedMemoryBlock
  touched: number
}

/** Relevância normalizada a partir do bm25 cru (negativo no SQLite). */
export function normalizeRelevance(rank: number): number {
  const raw = Math.max(0, -rank)
  return raw / (1 + raw)
}

export function recencyFactor(updatedAt: number, now: number): number {
  const ageMs = Math.max(0, now - updatedAt)
  const ageDays = ageMs / DAY_MS
  return Math.pow(0.5, ageDays / MEMORY_RECENCY_HALF_LIFE_DAYS)
}

export function usageFactor(useCount: number): number {
  return Math.min(1, Math.log1p(Math.max(0, useCount)) / Math.log1p(20))
}

export interface MemoryScoreInput {
  relevance: number
  updatedAt: number
  useCount: number
  now: number
}

/** 70% relevância, 20% recência e 10% uso. */
export function memoryScore(input: MemoryScoreInput): number {
  return (
    0.7 * Math.min(1, Math.max(0, input.relevance)) +
    0.2 * recencyFactor(input.updatedAt, input.now) +
    0.1 * usageFactor(input.useCount)
  )
}

function priorityGroup(memory: MemoryRecord): number {
  if (memory.pinned) return 0
  if (memory.kind === 'profile') return 1
  return 2
}

interface Candidate {
  memory: MemoryRecord
  relevance: number
  score: number
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const group = priorityGroup(a.memory) - priorityGroup(b.memory)
  if (group !== 0) return group
  if (b.score !== a.score) return b.score - a.score
  if (b.memory.updatedAt !== a.memory.updatedAt) {
    return b.memory.updatedAt - a.memory.updatedAt
  }
  return a.memory.id.localeCompare(b.memory.id)
}

/**
 * Devolve no máximo `maxItems` memórias dentro do orçamento, já formatadas.
 * Query vazia devolve apenas pinned/perfil (o contexto básico do usuário).
 */
export function recall(
  repo: MemoryRepository,
  query: string,
  options: RecallOptions = {}
): RecallResult {
  const now =
    typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
  const maxItems = Math.min(
    20,
    Math.max(1, Math.floor(options.maxItems ?? MEMORY_PROMPT_MAX_ITEMS))
  )
  const budget = Math.max(0, Math.floor(options.budgetChars ?? MEMORY_PROMPT_BUDGET))

  const priorities = repo.listPriority({ limit: MAX_PRIORITY_ITEMS, now })
  const trimmed = typeof query === 'string' ? query.trim() : ''
  let candidates: Candidate[]

  if (!trimmed) {
    candidates = priorities.map((memory) => ({
      memory,
      relevance: 0,
      score: memoryScore({
        relevance: 0,
        updatedAt: memory.updatedAt,
        useCount: memory.useCount,
        now
      })
    }))
  } else {
    const byId = new Map<string, Candidate>()
    for (const memory of priorities) {
      byId.set(memory.id, {
        memory,
        // Prioridade entra com relevância mínima para não sumir de query longa.
        relevance: 0.5,
        score: 0
      })
    }
    for (const ranked of repo.searchRanked(trimmed, { limit: MAX_QUERY_ITEMS, now })) {
      const relevance = normalizeRelevance(ranked.rank)
      const existing = byId.get(ranked.memory.id)
      byId.set(ranked.memory.id, {
        memory: ranked.memory,
        relevance: Math.max(relevance, existing?.relevance ?? 0),
        score: 0
      })
    }
    candidates = [...byId.values()].map((candidate) => ({
      ...candidate,
      score: memoryScore({
        relevance: candidate.relevance,
        updatedAt: candidate.memory.updatedAt,
        useCount: candidate.memory.useCount,
        now
      })
    }))
  }

  candidates.sort(compareCandidates)
  const shortlist = candidates.slice(0, maxItems).map((candidate) => candidate.memory)
  const formatted = formatMemoryBlock(shortlist, budget)
  const touched =
    options.touch === false || formatted.included.length === 0
      ? 0
      : repo.touch(
          formatted.included.map((memory) => memory.id),
          now
        )

  return { memories: formatted.included, text: formatted.text, formatted, touched }
}
