import { execFile } from 'child_process'
import { logger } from '../logger'

/**
 * Família/modelo da CPU e tensão do núcleo (Vcore).
 *
 * A tensão é MEDIDA pelo agente elevado (SVI2 no AMD, `IA32_PERF_STATUS` no
 * Intel); este módulo só identifica a CPU e decodifica os registradores crus.
 *
 * AMD (LibreHardwareMonitor, `Amd17Cpu.cs`): bloco SVI0 em `0x0005A000`, TFN em
 * `+0x8` (bit 0 setado = leitura inválida) e plano 0 (`VDDCR_CPU`) em `+0xC`
 * (Zen/Zen+) ou `+0x10` (Threadripper 3000, Zen 2–5). A escolha do offset é
 * feita aqui, na decodificação: o agente lê os dois candidatos sempre, então a
 * lista de registradores não depende do modelo instalado.
 *
 * Intel (`IntelCpu.cs`): `0x198` (`IA32_PERF_STATUS`) traz a tensão em passos
 * de 1/8192 V no campo alto; o campo baixo é o fallback quando o alto é zero.
 * Caminho implementado, mas NÃO validado em hardware Intel até hoje.
 *
 * Regras: nada é estimado. Modelo desconhecido, TFN ativo ou tensão fora de
 * 0,3–1,8 V viram `null` e a UI mostra "—".
 */

const CPU_IDENTIFIER_KEY = 'HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0'
const REG_TIMEOUT_MS = 3_000

/** Faixa plausível de Vcore; fora dela a leitura é lixo, não tensão. */
const MIN_PLAUSIBLE_VOLTAGE_V = 0.3
const MAX_PLAUSIBLE_VOLTAGE_V = 1.8

/** Codificação SVI2: `V = 1,550 − 0,00625 × VID`. */
const SVI_VID_BASE_V = 1.55
const SVI_VID_STEP_V = 0.00625

/** Passo do campo de tensão do `IA32_PERF_STATUS` (1/8192 V). */
const INTEL_VOLTAGE_STEP = 8192

/** Offsets do plano 0 dentro do bloco SVI0 (`SVI + 0xC` / `SVI + 0x10`). */
export const AMD_SVI_PLANE0_OFFSET_LEGACY = 0x0c
export const AMD_SVI_PLANE0_OFFSET_MODERN = 0x10

/** Modelos cujo plano 0 fica em `SVI + 0x10` (TR 3000, Zen 2–5). */
const AMD_SVI_PLANE0_MODERN_MODELS = new Set([0x31, 0x71, 0x21, 0x61, 0x44])

export interface CpuFamilyModel {
  family: number
  model: number
}

/**
 * `AMD64 Family 25 Model 33 Stepping 2` → `{ family: 25, model: 33 }`.
 * Texto fora do padrão vira `null` (a tensão fica "—" em vez de errada).
 */
export function parseCpuIdentifier(output: string | null | undefined): CpuFamilyModel | null {
  if (typeof output !== 'string') return null
  const match = /Family\s+(\d+)\s+Model\s+(\d+)/i.exec(output)
  if (!match) return null
  const family = Number(match[1])
  const model = Number(match[2])
  if (!Number.isInteger(family) || family <= 0) return null
  if (!Number.isInteger(model) || model < 0) return null
  return { family, model }
}

/**
 * Offset do plano 0 (`VDDCR_CPU`) no bloco SVI0, em função do modelo.
 *
 * Zen/Zen+ (demais modelos) usam `+0xC`; Threadripper 3000 e Zen 2–5 usam
 * `+0x10`. Modelo ausente/inválido cai no legado, mas a decodificação recusa
 * a leitura antes — nunca inventamos tensão para CPU não identificada.
 */
export function amdSviPlane0Offset(model: number | null | undefined): number {
  if (typeof model !== 'number' || !Number.isInteger(model)) {
    return AMD_SVI_PLANE0_OFFSET_LEGACY
  }
  return AMD_SVI_PLANE0_MODERN_MODELS.has(model)
    ? AMD_SVI_PLANE0_OFFSET_MODERN
    : AMD_SVI_PLANE0_OFFSET_LEGACY
}

function toBigInt(value: number | bigint | null | undefined): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  return null
}

/** Tensão só existe dentro da faixa plausível; fora dela é lixo de leitura. */
function plausibleVoltage(voltage: number): number | null {
  if (!Number.isFinite(voltage)) return null
  if (voltage < MIN_PLAUSIBLE_VOLTAGE_V || voltage > MAX_PLAUSIBLE_VOLTAGE_V) return null
  return voltage
}

/**
 * Vcore AMD pela telemetria SVI2.
 *
 * `tfnRaw` é o `SVI0_TFN_PLANE0` (`SVI + 0x8`): bit 0 setado significa leitura
 * do plano 0 inválida (Zen 4/5 forçam TFN), então vira `null` em vez de um
 * número inventado. `plane0Raw` é o registrador do plano 0 já escolhido pelo
 * modelo via `amdSviPlane0Offset`; o VID vem nos bits 16–23 e a tensão é
 * `1,550 − 0,00625 × VID`. Modelo ausente/inválido também vira `null`.
 */
export function decodeAmdSviVoltage(
  tfnRaw: number | bigint | null | undefined,
  plane0Raw: number | bigint | null | undefined,
  model: number | null | undefined
): number | null {
  if (typeof model !== 'number' || !Number.isInteger(model) || model < 0) return null
  const tfn = toBigInt(tfnRaw)
  if (tfn === null || (tfn & 0x01n) !== 0n) return null
  const plane0 = toBigInt(plane0Raw)
  if (plane0 === null) return null

  const vid = Number((plane0 >> 16n) & 0xffn)
  if (!Number.isInteger(vid)) return null
  return plausibleVoltage(SVI_VID_BASE_V - SVI_VID_STEP_V * vid)
}

/**
 * Vcore Intel pelo `IA32_PERF_STATUS` (`0x198`): o campo alto (bits 16–31) vem
 * em passos de 1/8192 V; quando ele é zero, o campo baixo é o fallback usado
 * pelas ferramentas consagradas. Caminho implementado, mas NÃO validado em
 * hardware Intel (não havia máquina Intel para conferir a leitura ao vivo).
 */
export function decodeIntelVoltage(raw: number | bigint | null | undefined): number | null {
  const value = toBigInt(raw)
  if (value === null) return null
  let field = Number((value >> 16n) & 0xffffn)
  if (field === 0) field = Number(value & 0xffffn)
  if (!Number.isInteger(field)) return null
  return plausibleVoltage(field / INTEL_VOLTAGE_STEP)
}

/** `reg query` assíncrono (nunca bloqueia o main); `null` em qualquer falha. */
function runRegQuery(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', CPU_IDENTIFIER_KEY, '/v', 'Identifier'],
      { windowsHide: true, timeout: REG_TIMEOUT_MS, maxBuffer: 64 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          logger.warn(
            'hwmon',
            `não foi possível ler a identificação da CPU no registro: ${error.message}`
          )
          resolve(null)
          return
        }
        resolve(typeof stdout === 'string' ? stdout : '')
      }
    )
  })
}

async function readFamilyModelFromRegistry(): Promise<CpuFamilyModel | null> {
  if (process.platform !== 'win32') return null
  const output = await runRegQuery()
  return parseCpuIdentifier(output)
}

let cachedFamilyModel: Promise<CpuFamilyModel | null> | null = null

/**
 * Família/modelo da CPU, lida UMA vez por sessão: a identificação não muda com
 * o PC ligado. Nunca lança — falha vira `null` e a tensão fica "—".
 */
export function readCpuFamilyModel(): Promise<CpuFamilyModel | null> {
  if (!cachedFamilyModel) {
    cachedFamilyModel = readFamilyModelFromRegistry().catch(() => null)
  }
  return cachedFamilyModel
}

/** Apenas para testes: descarta o cache da identificação. */
export function resetCpuFamilyModelCacheForTests(): void {
  cachedFamilyModel = null
}
