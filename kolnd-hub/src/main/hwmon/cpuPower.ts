import * as os from 'os'
import { logger } from '../logger'
import { createSensorsAgentReader } from './agent'
import { detectCpuVendor, readPawnIoBatch, type CpuVendor } from './pawnio'
import {
  AMD_SVI_PLANE0_OFFSET_MODERN,
  amdSviPlane0Offset,
  decodeAmdSviVoltage,
  decodeIntelVoltage,
  readCpuFamilyModel
} from './cpuVoltage'
import {
  MSR_AMD_PACKAGE_ENERGY_STATUS,
  MSR_AMD_RAPL_POWER_UNIT,
  MSR_INTEL_PACKAGE_ENERGY_STATUS,
  MSR_INTEL_PACKAGE_THERM_STATUS,
  MSR_INTEL_PERF_STATUS,
  MSR_INTEL_RAPL_POWER_UNIT,
  MSR_INTEL_TEMPERATURE_TARGET,
  MSR_INTEL_THERM_STATUS,
  SMN_AMD_SVI0_PLANE0_0C,
  SMN_AMD_SVI0_PLANE0_10,
  SMN_AMD_SVI0_TFN,
  SMN_THM_TCON_CUR_TMP
} from './registers'

/**
 * CPU: potência de pacote (RAPL) e temperatura real do pacote.
 *
 * Backend único: PawnIO (o driver anterior, OpenLibSys, saiu do projeto —
 * HVCI/blocklist o recusam).
 * O `HwRegisterReader` isola o cpuPower do transporte (processo PowerShell,
 * cache do helper), então os testes injetam valores sem tocar na máquina.
 *
 * AMD:
 * - RAPL: MSR `0xC0010299` (unidade nos bits 8–12) e `0xC001029B` (contador de
 *   32 bits do pacote). Watts = delta × unidade ÷ tempo, com wrap e média móvel.
 * - Temperatura: `Tctl` pelo SMN `0x00059800` via `ioctl_read_smn` do módulo
 *   `AMDFamily17` — o módulo faz o acesso PCI internamente (não escrevemos mais
 *   em 0x60/0x64). A decodificação inclui o offset de −49 °C da regra do
 *   k10temp/LibreHardwareMonitor (`Amd17Cpu.cs`); ver `decodeSmnTemp`.
 * - Tensão: SVI2 (`SVI0_TFN_PLANE0` + plano 0 do SVI0), com o offset do plano
 *   escolhido pelo modelo da CPU — ver `cpuVoltage`.
 *
 * Intel:
 * - RAPL: MSR `0x606` (unidade, mesmos bits 8–12) e `0x611` (contador do
 *   pacote, 32 bits).
 * - Temperatura: `TjMax` nos bits 16–23 do `0x1A2`; a distância até o limite
 *   vem nos bits 16–22 do `0x1B1` (`IA32_PACKAGE_THERM_STATUS`), com o `0x19C`
 *   (`IA32_THERM_STATUS`) como alternativa em CPUs sem o status do pacote.
 *   `temp = TjMax − delta`.
 * - Tensão: `IA32_PERF_STATUS` (`0x198`), campo alto com fallback para o baixo
 *   — caminho implementado, ainda NÃO validado em hardware Intel.
 *
 * Sem driver (ou leitura inválida) tudo vira `null` — nada é estimado aqui.
 */

// Re-exportados para não quebrar quem já importava os registradores daqui
// (testes e módulos do monitor). A fonte única agora é `./registers`.
export {
  MSR_AMD_PACKAGE_ENERGY_STATUS,
  MSR_AMD_RAPL_POWER_UNIT,
  MSR_INTEL_PACKAGE_ENERGY_STATUS,
  MSR_INTEL_PACKAGE_THERM_STATUS,
  MSR_INTEL_RAPL_POWER_UNIT,
  MSR_INTEL_TEMPERATURE_TARGET,
  MSR_INTEL_THERM_STATUS,
  SMN_THM_TCON_CUR_TMP
} from './registers'

const POWER_WINDOW = 5

export interface RaplCounterSample {
  /** Contador de 32 bits do MSR de energia do pacote. */
  counter: number
  /** Joules por unidade do contador (2^-EnergyErs). */
  unitJ: number
}

export interface CpuPowerReading {
  /** true quando o device do PawnIO abriu nesta leitura. */
  available: boolean
  tempC: number | null
  watts: number | null
  /**
   * Vcore medido (SVI2 no AMD, `IA32_PERF_STATUS` no Intel). `null` quando a
   * leitura não responde, o TFN marca inválida ou a tensão cai fora da faixa
   * plausível — este módulo nunca estima tensão.
   */
  voltageV: number | null
  error?: string
}

/** Pedido de um lote — MSR e/ou SMN na mesma execução do helper. */
export interface HwRegisterBatchRequest {
  msr?: number[]
  smn?: number[]
}

/** Resultado do lote, com os valores alinhados posição a posição com o pedido. */
export interface HwRegisterBatchResult {
  /** true quando o device abriu (mesma semântica do leitor anterior). */
  available: boolean
  /** Alinhado com `request.msr`. */
  msr: Array<bigint | null>
  /** Alinhado com `request.smn`; vazio quando o vendor não tem SMN. */
  smn: Array<bigint | null>
  /** Mensagem para a UI; o detalhe técnico fica no log do helper. */
  error?: string
}

/**
 * Abstração de leitura privilegiada usada pelo cpuPower. O backend real é o
 * PawnIO; nos testes entra um leitor com valores fixos.
 *
 * Um único `readBatch` por tick é regra, não detalhe: no agente elevado cada
 * chamada vira uma leitura de `latest.json` (o processo persistente é quem fala
 * com o PawnIO), e o monitor roda a 1 Hz em cima de ~670 ms de CIM. Pedir MSR
 * e SMN separados no AMD só duplicaria o trabalho e o polling começaria a
 * pular ticks.
 */
export interface HwRegisterReader {
  readBatch(request: HwRegisterBatchRequest): Promise<HwRegisterBatchResult>
}

function toBigInt(value: number | bigint | null | undefined): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  return null
}

/**
 * Decodifica a unidade de energia do MSR RAPL (AMD `0xC0010299` e Intel
 * `0x606` usam o mesmo campo): bits 8–12, em joules (`2^-expoente`).
 * Expoente 0 não é uma unidade útil (nenhum CPU real usa 1 J por contagem).
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

/** Faixa aceitável de temperatura do pacote; fora dela a leitura é lixo. */
function isPlausiblePackageTemp(tempC: number): boolean {
  return Number.isFinite(tempC) && tempC > 0 && tempC < 150
}

/**
 * `Tctl` em °C a partir do valor de 32 bits lido pelo SMN `0x00059800`.
 *
 * O campo de 11 bits (21–31) vem em passos de 0,125 °C, mas em Zen o valor
 * inclui um offset de −49 °C. A regra é a mesma do k10temp
 * (`drivers/hwmon/k10temp.c`) e do LibreHardwareMonitor
 * (`Amd17Cpu.cs`): quando o bit 19 (`0x80000`) está setado — ou, como
 * alternativa, os bits 16–17 valem `0x3` (`(raw & 0x30000) == 0x30000`) —
 * subtrai-se 49 do valor bruto.
 *
 * Sem o offset, um Ryzen 7 5700X em repouso (SMN `0x6DFB0000`) apareceria como
 * ~110 °C em vez dos ~61 °C reais — o Tdie do CCD confirma a faixa.
 */
export function decodeSmnTemp(raw: number | bigint | null | undefined): number | null {
  const value = toBigInt(raw)
  if (value === null) return null
  const low32 = Number(value & 0xffffffffn)
  if (!Number.isFinite(low32)) return null

  let tempC = ((low32 >>> 21) & 0x7ff) / 8
  // `(raw & 0x80000)` testa o bit 19; a segunda condição cobre o "range select"
  // usado por alguns firmwares. Nos dois casos o offset é o mesmo.
  if ((low32 & 0x80000) !== 0 || (low32 & 0x30000) === 0x30000) {
    tempC -= 49
  }

  // 0 °C e leituras absurdas indicam sensor ausente, não temperatura real.
  if (!isPlausiblePackageTemp(tempC)) return null
  return tempC
}

/**
 * TjMax (°C) dos bits 16–23 do MSR `0x1A2`. Fora de 60–120 °C o campo não é
 * um limite térmico real (0 = não programado) e vira `null` — sem TjMax não há
 * como converter a distância do `0x1B1` em temperatura.
 */
export function decodeIntelTjMax(raw: number | bigint | null | undefined): number | null {
  const value = toBigInt(raw)
  if (value === null) return null
  const tjMax = Number((value >> 16n) & 0xffn)
  if (!Number.isInteger(tjMax) || tjMax < 60 || tjMax > 120) return null
  return tjMax
}

/**
 * Temperatura Intel: `temp = TjMax − delta`, com o delta nos bits 16–22 do
 * `IA32_PACKAGE_THERM_STATUS` (`0x1B1`) ou do `IA32_THERM_STATUS` (`0x19C`).
 *
 * O bit 31 ("reading valid") não é exigido: em várias placas ele fica zerado
 * mesmo com o delta correto, e ferramentas consagradas leem o campo do mesmo
 * jeito. Um delta que produza temperatura fora da faixa plausível vira `null`.
 */
export function decodeIntelTemp(
  raw: number | bigint | null | undefined,
  tjMax: number | null
): number | null {
  if (tjMax === null || !Number.isFinite(tjMax)) return null
  const value = toBigInt(raw)
  if (value === null) return null
  const delta = Number((value >> 16n) & 0x7fn)
  if (!Number.isInteger(delta)) return null
  const tempC = tjMax - delta
  return isPlausiblePackageTemp(tempC) ? tempC : null
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

let lastEnergy: { counter: number; unitJ: number; at: number } | null = null
let powerSamples: number[] = []
let inflight: Promise<CpuPowerReading> | null = null

const unavailable = (error?: string): CpuPowerReading => ({
  available: false,
  tempC: null,
  watts: null,
  voltageV: null,
  error
})

function resetEnergy(): void {
  lastEnergy = null
  powerSamples = []
}

/** Fabricante pelo brand string de `os.cpus()` — AMD/Intel/outro. */
export function currentCpuVendor(
  model: string | null | undefined = os.cpus()[0]?.model
): CpuVendor {
  return detectCpuVendor(model)
}

/**
 * Leitor padrão: **um** lote vira **uma** chamada ao helper PawnIO, com MSR e
 * SMN juntos. O contrato devolve `null` por registro ausente, então o cpuPower
 * nunca precisa saber se o módulo carregou — só se o device abriu.
 */
export function createPawnIoRegisterReader(): HwRegisterReader {
  const pick = (
    indices: ReadonlyArray<number>,
    entries: ReadonlyArray<{ index: number; value: bigint | null }>
  ): Array<bigint | null> =>
    indices.map((index) => entries.find((entry) => entry.index === index)?.value ?? null)

  return {
    async readBatch({ msr, smn }) {
      const msrIndices = msr ?? []
      const smnIndices = smn ?? []
      // O `readPawnIoBatch` filtra SMN por vendor: no Intel o pedido não vira erro.
      const result = await readPawnIoBatch({ msr: msrIndices, smn: smnIndices })
      return {
        available: result.deviceOpen,
        msr: pick(msrIndices, result.msr),
        smn: pick(smnIndices, result.smn),
        error: result.error
      }
    }
  }
}

/** Converte unidade + contador em watts, mantendo o estado entre ticks. */
function updateWatts(
  unitRaw: bigint | null | undefined,
  counterRaw: bigint | null | undefined,
  now: number
): number | null {
  const unitJ = decodeRaplUnit(unitRaw ?? null)
  const counter =
    counterRaw === null || counterRaw === undefined ? null : Number(counterRaw & 0xffffffffn)

  if (unitJ === null || counter === null || !Number.isFinite(counter)) {
    resetEnergy()
    return null
  }

  let watts: number | null = null
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
  return watts
}

async function readAmd(now: number, reader: HwRegisterReader): Promise<CpuPowerReading> {
  // Um único lote por tick: unidade + energia (MSR) e Tctl + SVI2 (SMN) viajam
  // juntos. Os dois candidatos do plano 0 são lidos sempre; o modelo escolhe.
  const [familyModel, result] = await Promise.all([
    readCpuFamilyModel(),
    reader.readBatch({
      msr: [MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS],
      smn: [SMN_THM_TCON_CUR_TMP, SMN_AMD_SVI0_TFN, SMN_AMD_SVI0_PLANE0_0C, SMN_AMD_SVI0_PLANE0_10]
    })
  ])
  if (!result.available) {
    resetEnergy()
    return unavailable(result.error)
  }

  const tempC = decodeSmnTemp(result.smn[0] ?? null)
  const watts = updateWatts(result.msr[0], result.msr[1], now)
  // `+0x10` vale para Threadripper 3000 e Zen 2–5; o restante usa `+0xC`.
  const plane0Raw =
    familyModel && amdSviPlane0Offset(familyModel.model) === AMD_SVI_PLANE0_OFFSET_MODERN
      ? (result.smn[3] ?? null)
      : (result.smn[2] ?? null)
  const voltageV = decodeAmdSviVoltage(result.smn[1] ?? null, plane0Raw, familyModel?.model)
  return {
    available: true,
    tempC,
    watts,
    voltageV,
    // Device abriu mas nenhum registro respondeu (módulo recusado/ausente):
    // sem números inventados, com o motivo em pt-BR vindo do helper.
    error: tempC === null && watts === null && voltageV === null ? result.error : undefined
  }
}

async function readIntel(now: number, reader: HwRegisterReader): Promise<CpuPowerReading> {
  // Um único lote: unidade, energia, TjMax, os dois status térmicos e a tensão.
  const result = await reader.readBatch({
    msr: [
      MSR_INTEL_RAPL_POWER_UNIT,
      MSR_INTEL_PACKAGE_ENERGY_STATUS,
      MSR_INTEL_TEMPERATURE_TARGET,
      MSR_INTEL_PACKAGE_THERM_STATUS,
      MSR_INTEL_THERM_STATUS,
      MSR_INTEL_PERF_STATUS
    ]
  })
  if (!result.available) {
    resetEnergy()
    return unavailable(result.error)
  }

  const tjMax = decodeIntelTjMax(result.msr[2] ?? null)
  const tempC =
    tjMax === null
      ? null
      : (decodeIntelTemp(result.msr[3] ?? null, tjMax) ??
        decodeIntelTemp(result.msr[4] ?? null, tjMax))
  const watts = updateWatts(result.msr[0], result.msr[1], now)
  const voltageV = decodeIntelVoltage(result.msr[5] ?? null)

  return {
    available: true,
    tempC,
    watts,
    voltageV,
    error: tempC === null && watts === null && voltageV === null ? result.error : undefined
  }
}

/**
 * Lê temperatura e potência da CPU com um único leitor por tick. A API pública
 * continua `readCpuPower(now?, reader?)`: o terceiro parâmetro (vendor) existe
 * para os testes exercitarem AMD e Intel sem tocar na máquina.
 *
 * Em produção o leitor padrão é o **sink do agente elevado** (o PawnIO exige
 * elevação; o main roda em integridade média). O `HwRegisterReader` continua
 * sendo a fronteira que os testes injetam, então a lógica de RAPL/temperatura
 * não muda entre teste e produção.
 */
export async function readCpuPower(
  now: number = Date.now(),
  reader: HwRegisterReader = createSensorsAgentReader(),
  vendor: CpuVendor = currentCpuVendor()
): Promise<CpuPowerReading> {
  if (inflight) return inflight

  inflight = (async (): Promise<CpuPowerReading> => {
    try {
      return vendor === 'intel' ? await readIntel(now, reader) : await readAmd(now, reader)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('hwmon', `leitura de CPU (RAPL/térmica) falhou: ${message}`)
      resetEnergy()
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
