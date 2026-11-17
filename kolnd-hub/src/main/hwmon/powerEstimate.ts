/**
 * Estimador de potência para o Monitor (CPU e plataforma).
 *
 * Por que existe: sem um driver de kernel o Windows não expõe a potência de
 * pacote da CPU (ver `gerente/tasks/hw-monitor-re.md`). A GPU é medida pelo
 * `nvidia-smi`; CPU e plataforma são **estimadas** por este modelo fixo e
 * documentado — e a UI sempre rotula o resultado como "estimado".
 *
 * Modelo:
 * - classe térmica (`tdpClassW`) = 35 W + 4,5 W por núcleo, limitada a 45–150 W;
 *   é um proxy do PPT: 8 núcleos ⇒ 71 W, próximo do PPT real de um 5700X;
 * - CPU = classe × (0,25 + 0,75 × (uso/100)^1,2) — 25% da classe em ocioso e
 *   teto na própria classe a 100% de uso;
 * - plataforma = 30 W fixos (placa-mãe, RAM, SSDs, ventoinhas e USB);
 * - total estimado só existe quando a GPU foi **medida** — nunca somar um
 *   campo ausente como se fosse zero.
 *
 * Tudo é puro: nada aqui lê a máquina e nada lança; entrada inválida vira `null`.
 */

export const TDP_BASE_W = 35
export const TDP_PER_CORE_W = 4.5
export const TDP_MIN_W = 45
export const TDP_MAX_W = 150
export const IDLE_FRACTION = 0.25
export const LOAD_FRACTION = 0.75
export const LOAD_EXPONENT = 1.2
export const PLATFORM_W = 30

export interface CpuEstimateInput {
  /** Núcleos físicos informados pelo CIM; inválido ⇒ sem estimativa. */
  cores: number | null | undefined
  /** Uso da CPU em %; fora de 0–100 é limitado à faixa. */
  usagePercent: number | null | undefined
}

export interface TotalEstimateInput {
  cpuEstimatedW: number | null | undefined
  /** GPU medida pelo `nvidia-smi`; sem ela, o total não é calculável. */
  gpuW: number | null | undefined
  /** Sobrescreve a constante em testes; ausente usa `PLATFORM_W`. */
  platformW?: number | null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidCores(value: unknown): value is number {
  // Núcleos são contagem discreta: fração, zero ou negativo indica leitura
  // corrompida e não deve virar estimativa.
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0
}

/** Classe térmica em W — `null` quando a contagem de núcleos não é confiável. */
export function tdpClassWatts(cores: number | null | undefined): number | null {
  if (!isValidCores(cores)) return null
  return clamp(TDP_BASE_W + TDP_PER_CORE_W * cores, TDP_MIN_W, TDP_MAX_W)
}

/** Potência estimada da CPU em W, arredondada a 0,1 W. */
export function estimateCpuWatts(input: CpuEstimateInput): number | null {
  const tdpClassW = tdpClassWatts(input.cores)
  if (tdpClassW === null) return null
  if (!isFiniteNumber(input.usagePercent)) return null

  // Uso pode passar de 100% por arredondamento do contador do SO; limitar é
  // melhor que descartar a leitura inteira.
  const usage = clamp(input.usagePercent, 0, 100)
  const loadFraction = IDLE_FRACTION + LOAD_FRACTION * (usage / 100) ** LOAD_EXPONENT
  return round1(tdpClassW * loadFraction)
}

/** Consumo fixo estimado da plataforma (placa, RAM, SSDs, ventoinhas, USB). */
export function estimatePlatformWatts(): number {
  return PLATFORM_W
}

/**
 * Total estimado do PC em W — `null` se qualquer parcela obrigatória faltar.
 * A GPU precisa estar medida: o total nunca é apresentado abaixo dela.
 */
export function estimateTotalWatts(input: TotalEstimateInput): number | null {
  const cpu = input.cpuEstimatedW
  const gpu = input.gpuW
  const platform = input.platformW === undefined ? PLATFORM_W : input.platformW

  if (!isFiniteNumber(cpu) || cpu < 0) return null
  if (!isFiniteNumber(gpu) || gpu < 0) return null
  if (!isFiniteNumber(platform) || platform < 0) return null

  return round1(cpu + gpu + platform)
}
