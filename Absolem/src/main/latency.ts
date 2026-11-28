/**
 * Agregador de latências do main (task 03).
 *
 * Guarda apenas números (milissegundos) por fase. Nada de áudio, transcrição,
 * prompt ou URL entra aqui: o resumo é seguro para log e para teste.
 *
 * - `record` ignora valores não finitos/negativos;
 * - a janela é limitada (`capacity`) para não crescer sem limite em sessões
 *   longas; os percentis usam a janela mais recente;
 * - `summary` devolve contagem, p50, p95 e máximo arredondados a 0,1 ms.
 */

export interface LatencySnapshot {
  samples: number
  p50Ms: number
  p95Ms: number
  maxMs: number
}

export type LatencySummary = Record<string, LatencySnapshot>

export const LATENCY_DEFAULT_CAPACITY = 240

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** Percentil por posto (mesma convenção do baseline de performance). */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index] ?? 0
}

export class LatencyTracker {
  private readonly capacity: number
  private readonly samples = new Map<string, number[]>()

  constructor(capacity: number = LATENCY_DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity))
  }

  record(phase: string, ms: number): void {
    if (typeof phase !== 'string' || phase.length === 0) return
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return
    const list = this.samples.get(phase) ?? []
    list.push(ms)
    if (list.length > this.capacity) list.splice(0, list.length - this.capacity)
    this.samples.set(phase, list)
  }

  count(phase: string): number {
    return this.samples.get(phase)?.length ?? 0
  }

  summary(): LatencySummary {
    const output: LatencySummary = {}
    for (const [phase, values] of this.samples) {
      if (values.length === 0) continue
      output[phase] = {
        samples: values.length,
        p50Ms: round(percentile(values, 0.5)),
        p95Ms: round(percentile(values, 0.95)),
        maxMs: round(Math.max(...values))
      }
    }
    return output
  }

  reset(): void {
    this.samples.clear()
  }
}
