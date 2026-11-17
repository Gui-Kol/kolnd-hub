import { logger } from '../logger'
import { readWinRing0Batch } from './winring0'
import type { WinRing0BatchRequest, WinRing0BatchResult } from './winring0'

/**
 * CPU: potência de pacote (RAPL AMD) e temperatura (Tctl via SMN).
 *
 * - RAPL: MSR `0xC0010299` (unidade de energia nos bits 8–12) e
 *   `0xC001029B` (contador de 32 bits do pacote). Watts = delta do contador ×
 *   unidade ÷ tempo, com wrap de 32 bits e média móvel curta.
 * - Temperatura: SMN `THM_TCON_CUR_TMP = 0x00059800`, acessado por PCI config
 *   (bus 0, device 0x14, function 0): índice em 0x60, dado em 0x64;
 *   `Tctl = ((valor >> 21) & 0x7FF) / 8`.
 *
 * Sem driver (ou com leitura inválida) tudo vira `null` — nada é estimado.
 */

export const MSR_AMD_RAPL_POWER_UNIT = 0xc0010299
export const MSR_AMD_PACKAGE_ENERGY_STATUS = 0xc001029b
export const SMN_THM_TCON_CUR_TMP = 0x00059800
export const SMN_PCI_BUS = 0
export const SMN_PCI_DEVICE = 0x14
export const SMN_PCI_FUNCTION = 0
export const SMN_INDEX_OFFSET = 0x60
export const SMN_DATA_OFFSET = 0x64

const POWER_WINDOW = 5

export interface RaplCounterSample {
  /** Contador de 32 bits do MSR 0xC001029B. */
  counter: number
  /** Joules por unidade do contador (2^-EnergyErs). */
  unitJ: number
}

export interface CpuPowerReading {
  /** true quando o device WinRing0 abriu nesta leitura. */
  available: boolean
  tempC: number | null
  watts: number | null
  error?: string
}

function toBigInt(value: number | bigint | null | undefined): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  return null
}

/**
 * Decodifica a unidade de energia do MSR RAPL: bits 8–12, em joules
 * (`2^-expoente`). Expoente 0 não é uma unidade útil (nenhum CPU real usa
 * 1 J por contagem) e vira `null`.
 */
export function decodeRaplUnit(raw: number | bigint | null | undefined): number | null {
  const value = toBigInt(raw)
  if (value === null) return null
  const exponent = Number((value >> 8n) & 0x1fn)
  if (!Number.isInteger(exponent) || exponent <= 0 || exponent > 31) return null
  const unit = 2 ** -exponent
  return Number.isFinite(unit) && unit > 0 ? unit : null
}

/**
 * Watts do pacote entre duas amostras do contador RAPL de 32 bits, com wrap.
 * Rejeita contadores inválidos, tempo não positivo, unidade inválida e saltos
 * maiores que metade do espaço do contador (reset — não é wrap em 1 s).
 */
export function computePackageWatts(
  previous: RaplCounterSample | null | undefined,
  next: RaplCounterSample | null | undefined,
  elapsedMs: number
): number | null {
  if (!previous || !next) return null

  const before = previous.counter
  const after = next.counter
  if (!Number.isInteger(before) || !Number.isInteger(after)) return null
  if (before < 0 || before > 0xffffffff || after < 0 || after > 0xffffffff) return null
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null

  const unitJ = next.unitJ
  if (!Number.isFinite(unitJ) || unitJ <= 0) return null

  const delta = after >= before ? after - before : after + 0x100000000 - before
  if (delta <= 0 || delta > 0x80000000) return null

  const watts = (delta * unitJ) / (elapsedMs / 1000)
  if (!Number.isFinite(watts) || watts < 0 || watts > 10000) return null
  return watts
}

/** `Tctl` em °C a partir do valor de 32 bits lido em 0x64. */
export function decodeSmnTemp(raw: number | bigint | null | undefined): number | null {
  const value = toBigInt(raw)
  if (value === null) return null
  const low32 = Number(value & 0xffffffffn)
  if (!Number.isFinite(low32)) return null
  const tempC = ((low32 >>> 21) & 0x7ff) / 8
  // 0 °C e leituras absurdas indicam sensor ausente, não temperatura real.
  if (!Number.isFinite(tempC) || tempC <= 0 || tempC >= 150) return null
  return tempC
}

/** Janela curta (5 amostras) para a potência não oscilar a cada segundo. */
export function pushMovingAverage(
  samples: ReadonlyArray<number>,
  value: number,
  window: number = POWER_WINDOW
): number[] {
  if (!Number.isFinite(value) || window <= 0) return [...samples]
  const next = [...samples, value]
  return next.length > window ? next.slice(next.length - window) : next
}

export function averageOf(samples: ReadonlyArray<number>): number | null {
  const valid = samples.filter((value) => Number.isFinite(value))
  if (valid.length === 0) return null
  return valid.reduce((total, value) => total + value, 0) / valid.length
}

export type WinRing0BatchReader = (
  request: WinRing0BatchRequest,
  timeoutMs?: number
) => Promise<WinRing0BatchResult>

let lastEnergy: { counter: number; unitJ: number; at: number } | null = null
let powerSamples: number[] = []
let inflight: Promise<CpuPowerReading> | null = null

const unavailable = (error?: string): CpuPowerReading => ({
  available: false,
  tempC: null,
  watts: null,
  error
})

/**
 * Lê temperatura e potência da CPU. Uma única chamada ao helper (MSR + escrita
 * SMN + leitura SMN). Sem driver, devolve `available: false` e campos `null`.
 */
export async function readCpuPower(
  now: number = Date.now(),
  reader: WinRing0BatchReader = readWinRing0Batch
): Promise<CpuPowerReading> {
  if (inflight) return inflight

  inflight = (async (): Promise<CpuPowerReading> => {
    try {
      const result = await reader({
        msr: [MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS],
        pciWrites: [
          {
            bus: SMN_PCI_BUS,
            device: SMN_PCI_DEVICE,
            function: SMN_PCI_FUNCTION,
            offset: SMN_INDEX_OFFSET,
            value: SMN_THM_TCON_CUR_TMP
          }
        ],
        pci: [
          {
            bus: SMN_PCI_BUS,
            device: SMN_PCI_DEVICE,
            function: SMN_PCI_FUNCTION,
            offset: SMN_DATA_OFFSET
          }
        ]
      })

      if (!result.deviceOpen) {
        lastEnergy = null
        powerSamples = []
        return unavailable(result.error)
      }

      const unitRaw = result.msr.find((entry) => entry.index === MSR_AMD_RAPL_POWER_UNIT)?.value
      const energyRaw = result.msr.find(
        (entry) => entry.index === MSR_AMD_PACKAGE_ENERGY_STATUS
      )?.value
      const tempRaw = result.pci.find((entry) => entry.offset === SMN_DATA_OFFSET)?.value ?? null

      const unitJ = decodeRaplUnit(unitRaw ?? null)
      const tempC = decodeSmnTemp(tempRaw)
      const counter =
        energyRaw === null || energyRaw === undefined ? null : Number(energyRaw & 0xffffffffn)

      let watts: number | null = null
      if (unitJ !== null && counter !== null && Number.isFinite(counter)) {
        if (lastEnergy) {
          const instant = computePackageWatts(
            { counter: lastEnergy.counter, unitJ: lastEnergy.unitJ },
            { counter, unitJ },
            now - lastEnergy.at
          )
          if (instant !== null) {
            powerSamples = pushMovingAverage(powerSamples, instant)
            watts = averageOf(powerSamples)
          }
        }
        lastEnergy = { counter, unitJ, at: now }
      } else {
        lastEnergy = null
        powerSamples = []
      }

      return { available: true, tempC, watts }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('hwmon', `leitura de CPU (RAPL/SMN) falhou: ${message}`)
      lastEnergy = null
      powerSamples = []
      return unavailable('Não foi possível ler os sensores da CPU.')
    }
  })().finally(() => {
    inflight = null
  })

  return inflight
}

/** Apenas para testes: zera a amostra anterior e a média móvel. */
export function resetCpuPowerForTests(): void {
  lastEnergy = null
  powerSamples = []
  inflight = null
}
