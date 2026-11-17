import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_REFERENCES,
  BENCHMARK_WEIGHTS,
  MAX_LOAD_SCORE,
  computeRatio,
  hasUnstableLoad,
  isUnstableSpread,
  loadScore,
  median,
  multiReps,
  roundScore,
  singleReps,
  spreadRatio,
  toMops,
  weightedPhaseScore
} from './benchmarkScore'

describe('conversões e séries do benchmark', () => {
  it('converte operações em MOps/s e ignora entradas inválidas', () => {
    expect(toMops(1_000_000, 1000)).toBeCloseTo(1, 10)
    expect(toMops(2_000_000, 500)).toBeCloseTo(4, 10)
    expect(toMops(1_000_000, 0)).toBe(0)
    expect(toMops(0, 100)).toBe(0)
    expect(toMops(NaN, 100)).toBe(0)
  })

  it('série single: uma amostra por repetição, na ordem medida', () => {
    expect(singleReps({ ops: [1_000_000, 2_000_000], ms: [1000, 500] })).toEqual([1, 4])
    // Listas de tamanhos diferentes: usa o menor comprimento (nunca inventa par).
    expect(singleReps({ ops: [1_000_000, 2_000_000, 3_000_000], ms: [1000] })).toEqual([1])
    expect(singleReps({ ops: [], ms: [] })).toEqual([])
  })

  it('série multi: soma das operações dividida pelo maior tempo de cada passo', () => {
    const children = [
      { ops: [1_000_000, 2_000_000], ms: [500, 400] },
      { ops: [1_000_000, 2_000_000], ms: [520, 400] }
    ]
    // Passo 0: 2M ops / 520 ms; passo 1: 4M ops / 400 ms.
    expect(multiReps(children)).toEqual([toMops(2_000_000, 520), toMops(4_000_000, 400)])
    expect(multiReps([])).toEqual([])
    // Filhos com contagens diferentes: alinha pelo menor comprimento.
    expect(
      multiReps([
        { ops: [1, 2], ms: [1, 1] },
        { ops: [1], ms: [1] }
      ])
    ).toHaveLength(1)
  })
})

describe('mediana e guarda de estabilidade', () => {
  it('mediana usa o centro (e a média dos centrais em contagem par)', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([5])).toBe(5)
    // Inválidos são descartados antes da mediana.
    expect(median([0, -1, NaN, Infinity, 7, 9, 8])).toBe(8)
    expect(median([])).toBe(0)
  })

  it('spread é max/min; série curta ou inválida não pede repetição', () => {
    expect(spreadRatio([100, 100, 100])).toBe(1)
    expect(spreadRatio([100, 150])).toBeCloseTo(1.5, 10)
    expect(spreadRatio([100])).toBe(1)
    expect(spreadRatio([])).toBe(1)
    expect(spreadRatio([0, 100])).toBe(1)
  })

  it('limite de 25 % decide a repetição (e NaN/Infinity contam como instável)', () => {
    expect(isUnstableSpread(1.25)).toBe(false)
    expect(isUnstableSpread(1.2501)).toBe(true)
    expect(isUnstableSpread(Number.POSITIVE_INFINITY)).toBe(true)
    expect(isUnstableSpread(Number.NaN)).toBe(true)
    expect(isUnstableSpread(2, 3)).toBe(false)
  })
})

describe('nota por carga e da fase', () => {
  it('1.000 pontos = throughput de referência; nota nunca é negativa nem absurda', () => {
    for (const [id, reference] of Object.entries(BENCHMARK_REFERENCES)) {
      expect(loadScore(id, reference)).toBeCloseTo(1000, 10)
    }
    expect(loadScore('integers', 0)).toBe(0)
    expect(loadScore('integers', -5)).toBe(0)
    expect(loadScore('desconhecida', 100)).toBe(0)
    expect(loadScore('integers', Number.MAX_VALUE)).toBe(MAX_LOAD_SCORE)
  })

  it('a fase é a média ponderada das cargas (pesos documentados somam 1)', () => {
    const totalWeight = Object.values(BENCHMARK_WEIGHTS).reduce((sum, weight) => sum + weight, 0)
    expect(totalWeight).toBeCloseTo(1, 10)

    // Medir exatamente a referência em todas as cargas devolve 1.000 pontos.
    const atReference = Object.keys(BENCHMARK_REFERENCES).map((id) => ({
      id,
      mops: BENCHMARK_REFERENCES[id]
    }))
    expect(weightedPhaseScore(atReference)).toBeCloseTo(1000, 10)

    // Metade da referência em todas as cargas devolve metade da nota.
    const half = atReference.map((load) => ({ id: load.id, mops: load.mops / 2 }))
    expect(weightedPhaseScore(half)).toBeCloseTo(500, 10)
  })

  it('a escala calibrada reproduz ~582 no single e ~4.700 no multi desta máquina', () => {
    // Throughputs medidos no app (Ryzen 7 5700X, 8C/16T), medianas de 3 execuções.
    const measuredSingle = {
      integers: 996.65,
      floats: 377.79,
      memory: 2181.13,
      aes: 124.86,
      sha: 35.4
    }
    const measuredMulti = {
      integers: 12000,
      floats: 2550,
      memory: 6600,
      aes: 262,
      sha: 420
    }
    const single = weightedPhaseScore(
      Object.entries(measuredSingle).map(([id, mops]) => ({ id, mops }))
    )
    const multi = weightedPhaseScore(
      Object.entries(measuredMulti).map(([id, mops]) => ({ id, mops }))
    )
    expect(single).toBeCloseTo(582.45, 0)
    expect(multi).toBeGreaterThan(4500)
    expect(multi).toBeLessThan(5000)
  })

  it('subconjunto de cargas é normalizado pelo peso presente', () => {
    // Só uma carga: a nota dela é a nota da fase (não 18 % dela).
    expect(weightedPhaseScore([{ id: 'integers', mops: BENCHMARK_REFERENCES.integers }])).toBe(1000)
    expect(weightedPhaseScore([])).toBe(0)
    expect(weightedPhaseScore([{ id: 'desconhecida', mops: 10 }])).toBe(0)
  })

  it('arredonda em 2 casas e calcula a razão multi/single', () => {
    expect(roundScore(582.456)).toBe(582.46)
    expect(roundScore(-1)).toBe(0)
    expect(computeRatio(4700, 582)).toBeCloseTo(8.0756, 3)
    expect(computeRatio(100, 0)).toBe(0)
    expect(computeRatio(NaN, 10)).toBe(0)
  })

  it('a marca de instabilidade vem de qualquer carga', () => {
    expect(hasUnstableLoad([])).toBe(false)
    expect(hasUnstableLoad([{ unstable: false }, { unstable: false }])).toBe(false)
    expect(hasUnstableLoad([{ unstable: false }, { unstable: true }])).toBe(true)
  })
})
