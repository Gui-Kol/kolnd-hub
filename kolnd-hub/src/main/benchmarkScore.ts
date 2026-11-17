/**
 * Cálculos puros do benchmark v2 (testados em `benchmarkScore.test.ts`).
 *
 * Por que a nota é normalizada por carga em vez de média geométrica de MOps:
 * as cinco cargas têm ordens de grandeza diferentes (inteiros ~1.000 MOps,
 * SHA ~36 MOps). A média geométrica de MOps brutos fazia um único teste ruim
 * arrastar o resultado inteiro. Aqui cada carga vira uma nota na mesma escala
 * (`1000 × MOps / referência`) e a fase é a média **aritmética ponderada**.
 *
 * A escala é a do CPU-Z 3.02 **medida nesta máquina** (Ryzen 7 5700X, 8C/16T):
 * single 582,45 · multi 4.700,26. As referências abaixo foram calibradas para
 * que esta máquina reproduza esses números; **não é o score oficial do CPU-Z**
 * (o deles depende do serviço online e do hardware exato). Em outra máquina a
 * escala continua consistente entre execuções, mas não é comparável ao site.
 */

/** Cargas do run, na ordem exibida na interface. */
export interface BenchmarkLoad {
  id: string
  label: string
}

/** Referência de cada carga em MOps/s: 1.000 pontos = throughput de referência. */
export const BENCHMARK_REFERENCES: Readonly<Record<string, number>> = {
  integers: 1711,
  floats: 649,
  memory: 3745,
  aes: 214.4,
  sha: 60.8
}

/**
 * Pesos da média ponderada. Somam 1. Inteiros e SHA pesam mais porque são as
 * cargas de computação pura que melhor representam o ganho real de threads;
 * memória e AES pesam menos porque no multi são limitadas por banda/alocação e
 * escalam pouco. Calibrados para o conjunto reproduzir a escala medida do
 * CPU-Z 3.02 nesta máquina (single ~582 · multi ~4.700) com a medição em
 * processo filho (que usa SHA-NI — ver o aquecimento em `benchmarkRunnerSource`).
 */
export const BENCHMARK_WEIGHTS: Readonly<Record<string, number>> = {
  integers: 0.25,
  floats: 0.15,
  memory: 0.23,
  aes: 0.1,
  sha: 0.27
}

/** Teto defensivo: nota absurda (referência errada/medição corrompida) vira isto. */
export const MAX_LOAD_SCORE = 1_000_000

/** Spread (max/min) tolerado entre repetições antes de repetir a carga uma vez. */
export const MAX_STABLE_SPREAD = 1.25

/** Amostra de uma repetição: operações contadas e tempo medido. */
export interface RepSample {
  ops: number
  ms: number
}

/** Conversão de operações contadas para MOps/s; entradas inválidas → 0. */
export function toMops(ops: number, elapsedMs: number): number {
  if (!Number.isFinite(ops) || !Number.isFinite(elapsedMs) || ops <= 0 || elapsedMs <= 0) return 0
  return ops / (elapsedMs / 1000) / 1_000_000
}

/**
 * Série de MOps/s de uma carga em **uma** thread (fase single): uma amostra
 * por repetição. Repetições inválidas viram 0 e são descartadas pela mediana.
 */
export function singleReps(series: { ops: number[]; ms: number[] }): number[] {
  const length = Math.min(series.ops.length, series.ms.length)
  const out: number[] = []
  for (let index = 0; index < length; index++) {
    out.push(toMops(series.ops[index], series.ms[index]))
  }
  return out
}

/**
 * Série de MOps/s da fase multi: para cada repetição, soma as operações de
 * todos os filhos e divide pelo **maior** tempo (rodaram em paralelo). As
 * repetições são alinhadas por índice — cada filho mede a mesma carga no mesmo
 * passo, então a soma representa a vazão agregada daquele passo.
 */
export function multiReps(children: ReadonlyArray<{ ops: number[]; ms: number[] }>): number[] {
  if (children.length === 0) return []
  const length = Math.min(...children.map((child) => Math.min(child.ops.length, child.ms.length)))
  const out: number[] = []
  for (let rep = 0; rep < length; rep++) {
    let totalOps = 0
    let slowestMs = 0
    for (const child of children) {
      totalOps += child.ops[rep]
      slowestMs = Math.max(slowestMs, child.ms[rep])
    }
    out.push(toMops(totalOps, slowestMs))
  }
  return out
}

/** Mediana (média dos dois centrais quando a contagem é par); vazio → 0. */
export function median(values: ReadonlyArray<number>): number {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0)
  if (valid.length === 0) return 0
  const sorted = [...valid].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Spread max/min da série (1 = perfeitamente estável). Menos de duas amostras
 * válidas → 1, porque não há como medir variação com uma medição só.
 */
export function spreadRatio(values: ReadonlyArray<number>): number {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0)
  if (valid.length < 2) return 1
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  if (min <= 0) return Number.POSITIVE_INFINITY
  return max / min
}

/** Guarda de estabilidade: spread acima do limite pede uma nova medição. */
export function isUnstableSpread(spread: number, limit: number = MAX_STABLE_SPREAD): boolean {
  if (!Number.isFinite(spread)) return true
  return spread > limit
}

/** Nota de uma carga: 1.000 pontos quando o throughput é o de referência. */
export function loadScore(id: string, mops: number): number {
  const reference = BENCHMARK_REFERENCES[id]
  if (!reference || !Number.isFinite(reference) || reference <= 0) return 0
  if (!Number.isFinite(mops) || mops <= 0) return 0
  return Math.min(MAX_LOAD_SCORE, (1000 * mops) / reference)
}

/**
 * Nota da fase: média **aritmética ponderada** das cargas medidas, normalizada
 * pelo peso presente. A normalização importa nos subconjuntos usados pelos
 * testes automatizados (uma carga só não pode valer 18 % da nota).
 */
export function weightedPhaseScore(loads: ReadonlyArray<{ id: string; mops: number }>): number {
  let totalWeight = 0
  let total = 0
  for (const load of loads) {
    const weight = BENCHMARK_WEIGHTS[load.id]
    if (!weight || weight <= 0) continue
    total += weight * loadScore(load.id, load.mops)
    totalWeight += weight
  }
  if (totalWeight <= 0) return 0
  return total / totalWeight
}

/** Arredonda nota para 2 casas (mesma resolução exibida na interface). */
export function roundScore(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * 100) / 100
}

/** Razão multi/single; entradas inválidas → 0 (a interface exibe "—"). */
export function computeRatio(multi: number, single: number): number {
  if (!Number.isFinite(multi) || !Number.isFinite(single) || single <= 0 || multi < 0) return 0
  return multi / single
}

/** `true` quando pelo menos uma carga ficou marcada como instável. */
export function hasUnstableLoad(measurements: ReadonlyArray<{ unstable: boolean }>): boolean {
  return measurements.some((measurement) => measurement.unstable)
}
