import { execFile } from 'child_process'
import * as os from 'os'
import { logger } from '../logger'
import { resolveNvidiaSmiPath, resolvePowershellPath } from './systemPaths'

/**
 * Captura nativa de sensores sem privilégio (Fase A do monitor de hardware).
 *
 * Fontes (verificadas nesta máquina):
 * - `nvidia-smi` para a GPU (nome, uso, clocks, VRAM, temperatura, fan %, W);
 * - consulta CIM **estática** (RAM/CPU/placa) uma vez por sessão e consulta CIM
 *   **dinâmica** (GPU-compartilhada + contador do processador) a cada tick;
 * - `os.cpus()`/`os.totalmem`/`os.freemem` para uso de CPU e RAM.
 *
 * Regras: nada lança por sensor ausente (campo vira `null`), nada bloqueia o
 * event loop (`execFile` assíncrono com timeout) e nada sai da máquina.
 */

import type { DriverStatus, HwCpu, HwGpu, HwRam, HwSnapshot } from '../../shared/hwmon'
import {
  buildGpuAdapters,
  parseGpuRegistry,
  parseVideoControllers,
  selectPrimaryGpu,
  type GpuAdapterInfo
} from './gpuInfo'
import { readNvmlFan } from './nvml'
import { estimateCpuWatts, estimatePlatformWatts, estimateTotalWatts } from './powerEstimate'

export type {
  DriverStatus,
  HwCpu,
  HwGpu,
  HwPower,
  HwPowerSourceCpu,
  HwPowerSourceGpu,
  HwRam,
  HwSnapshot,
  HwSources,
  HwSpecs
} from '../../shared/hwmon'

/** Amostra do `nvidia-smi --query-gpu=... --format=csv,noheader,nounits`. */
export interface NvidiaSmiSample {
  name: string
  driverVersion: string | null
  usagePercent: number | null
  coreClockMhz: number | null
  memClockMhz: number | null
  vramUsedMb: number | null
  vramTotalMb: number | null
  tempC: number | null
  fanPercent: number | null
  watts: number | null
  powerLimitW: number | null
}

export interface CimRamModule {
  capacityBytes: number | null
  configuredClockMhz: number | null
  configuredVoltageMv: number | null
  memoryType: number | null
}

export interface CimCpuFacts {
  name: string | null
  cores: number | null
  threads: number | null
  baseClockMhz: number | null
}

export interface CimBoardFacts {
  manufacturer: string | null
  product: string | null
}

/** Fatos de uma consulta CIM (estática ou dinâmica). */
export interface CimFacts {
  ramModules: CimRamModule[]
  cpu: CimCpuFacts
  board: CimBoardFacts
  gpuAdapters: GpuAdapterInfo[]
  gpuSharedBytes: number | null
  gpuDedicatedBytes: number | null
  gpuUsagePercent: number | null
  processorPerformancePercent: number | null
  /** Temperatura da CPU por ACPI (aprox.), quando a placa expõe alguma zona. */
  cpuTempAcpiC: number | null
}

/** Parte estável da consulta CIM — cacheada por sessão. */
export type StaticFacts = Pick<
  CimFacts,
  'ramModules' | 'cpu' | 'board' | 'gpuAdapters' | 'cpuTempAcpiC'
>

/** Executor injetável (testes espionam as chamadas sem tocar na máquina). */
export type CommandRunner = (
  file: string,
  args: string[],
  timeoutMs: number
) => Promise<string | null>

/** Entrada do agregador puro (testável sem tocar na máquina). */
export interface NativeSnapshotInput {
  capturedAt?: number
  cpuUsagePercent?: number | null
  nvidia?: NvidiaSmiSample | null
  staticFacts?: StaticFacts | null
  gpuSharedBytes?: number | null
  gpuDedicatedBytes?: number | null
  gpuUsagePercent?: number | null
  /** RPM da ventoinha medido pela NVML; `null` sem driver NVIDIA/NVML. */
  gpuFanRpm?: number | null
  processorPerformancePercent?: number | null
  totalmemBytes?: number
  freememBytes?: number
  driver?: DriverStatus
}

const NVIDIA_QUERY_ARGS = [
  '--query-gpu=name,driver_version,utilization.gpu,clocks.current.graphics,clocks.current.memory,memory.used,memory.total,temperature.gpu,fan.speed,power.draw,power.limit',
  '--format=csv,noheader,nounits'
]

const NVIDIA_TIMEOUT_MS = 2500
const CIM_TIMEOUT_MS = 6000
const MAX_BUFFER = 2 * 1024 * 1024
const MIB = 1024 * 1024
const GIB = 1024 * 1024 * 1024

const SMBIOS_MEMORY_TYPES: Record<number, string> = {
  20: 'DDR',
  21: 'DDR2',
  24: 'DDR3',
  26: 'DDR4',
  34: 'DDR5'
}

/**
 * Consulta CIM estática (RAM, CPU, placa e temperatura ACPI) — uma execução por
 * sessão. `[Console]::OutputEncoding` força UTF-8 no stdout mesmo em console
 * localizado; `$ErrorActionPreference` evita que uma classe ausente escreva lixo
 * no JSON.
 *
 * A temperatura entra AQUI (e não no tick) porque `MSAcpi_ThermalZoneTemperature`
 * não existe em muitos desktops — medido nesta máquina: a consulta falha. Pagar
 * a falha uma vez por sessão evita custo e log repetido a cada segundo.
 */
const CIM_STATIC_SCRIPT = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  "$ErrorActionPreference='SilentlyContinue'",
  '$ram=@(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,ConfiguredClockSpeed,ConfiguredVoltage,SMBIOSMemoryType)',
  '$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed',
  '$board=Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer,Product',
  '$acpi=@(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object InstanceName,CurrentTemperature)',
  '$thermal=@(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation | Select-Object Name,HighPrecisionTemperature,Temperature)',
  // GPU é estática (modelo/driver/VRAM não mudam no tick). A VRAM real vem do
  // registro: `AdapterRAM` satura em ~4 GiB e mentiria numa placa de 8 GB.
  '$video=@(Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID,DriverVersion,DriverDate,AdapterRAM)',
  `$gpuReg=@(Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}" | ForEach-Object { $p=Get-ItemProperty $_.PSPath; [pscustomobject]@{DriverDesc=$p.DriverDesc;DriverVersion=$p.DriverVersion;MatchingDeviceId=$p.MatchingDeviceId;'HardwareInformation.qwMemorySize'=$p.'HardwareInformation.qwMemorySize'} })`,
  '[pscustomobject]@{ram=@($ram);cpu=$cpu;board=$board;acpi=@($acpi);thermal=@($thermal);video=@($video);gpuRegistry=@($gpuReg)} | ConvertTo-Json -Depth 6 -Compress'
].join('; ')

/**
 * Consulta CIM dinâmica (GPU + performance do processador) por tick.
 *
 * Por que a agregação acontece aqui: o contador `\GPU Engine(*)\Utilization
 * Percentage` tem o caminho LOCALIZADO (pt-BR quebra), mas as classes CIM
 * `Win32_PerfFormattedData_GPUPerformanceCounters_*` são independentes de
 * idioma. A regra de uso é a mesma do Gerenciador de Tarefas: somar as
 * instâncias do motor 3D por adaptador (LUID) e ler o adaptador primário —
 * `Copy`, `VideoDecode`, `Security` e afins não são "uso da GPU" para o
 * usuário. O adaptador primário é o de maior memória dedicada; um adaptador
 * virtual (ex.: Parsec) tem 0 dedicado e não zera a leitura da GPU real.
 *
 * O bloco de uso é CONDICIONAL: em NVIDIA o `nvidia-smi` já entrega o uso com
 * mais precisão, e consultar o `GPUEngine` custa ~300 ms por tick (medido:
 * 486 instâncias). Com ele o tick ia de ~610 ms para ~960 ms; sem ele a máquina
 * NVIDIA continua no orçamento antigo e AMD/Intel pagam só quando precisam.
 *
 * Tudo é agregado no PowerShell e só os totais voltam: o JSON por tick precisa
 * continuar pequeno (1 processo por tick, sem custo extra de parsing).
 *
 * Medição empírica nesta máquina (RTX 5060 Ti, 18/11/2026), comparando com
 * `nvidia-smi --query-gpu=utilization.gpu`: em repouso 2% (CIM) × 2%
 * (nvidia-smi); com carga leve ~25% × 26–28%; saturada 97–100% × 99–100%.
 * A memória dedicada acompanhou `memory.used` dentro de ~15 MiB. Agregar só o
 * `3D` por LUID é o que replica o Gerenciador de Tarefas; somar todas as
 * instâncias (Copy/VideoDecode) inflaria o número sem relação com o uso.
 */
export function buildCimDynamicScript(includeGpuEngine: boolean): string {
  const lines = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    "$ErrorActionPreference='SilentlyContinue'",
    '$mem=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Select-Object Name,DedicatedUsage,SharedUsage)',
    `$rows=@($mem | ForEach-Object { $p=$_.Name -split '_'; [pscustomobject]@{ luid="$($p[1])_$($p[2])"; dedicated=[double]$_.DedicatedUsage; shared=[double]$_.SharedUsage } })`,
    `$primary=$rows | Sort-Object -Property @{Expression='dedicated';Descending=$true},@{Expression='shared';Descending=$true} | Select-Object -First 1`,
    '$usage=$null'
  ]

  if (includeGpuEngine) {
    lines.push(
      `$eng=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -match '_engtype_3D$' } | Select-Object Name,UtilizationPercentage)`,
      '$sums=@{}',
      `foreach ($e in $eng) { $p=$e.Name -split '_'; $key="$($p[3])_$($p[4])"; $v=[double]$e.UtilizationPercentage; if ($sums.ContainsKey($key)) { $sums[$key]=$sums[$key]+$v } else { $sums[$key]=$v } }`,
      'if ($primary -and $sums.ContainsKey($primary.luid)) { $usage=$sums[$primary.luid] } elseif ($sums.Count -gt 0) { $usage=($sums.Values | Measure-Object -Maximum).Maximum }',
      'if ($usage -ne $null) { $usage=[math]::Min(100,[math]::Max(0,$usage)) }'
    )
  }

  lines.push(
    '$dedicated=$null',
    '$shared=$null',
    'if ($primary) { $dedicated=$primary.dedicated; $shared=$primary.shared }',
    "$perf=Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1 PercentProcessorPerformance",
    '[pscustomobject]@{gpuUsagePercent=$usage;gpuDedicatedBytes=$dedicated;gpuSharedBytes=$shared;processor=$perf} | ConvertTo-Json -Depth 6 -Compress'
  )

  return lines.join('; ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toRecordList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value)) return [value]
  return []
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

/** `0`/valores negativos não são medida válida para clocks, uso ou potência. */
function toPositive(value: unknown): number | null {
  const parsed = toNumber(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

/** `0` é uma leitura legítima (uso, fan %, watts) — só descarta inválidos. */
function toNonNegative(value: unknown): number | null {
  const parsed = toNumber(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * Parser do CSV do `nvidia-smi`. Tolera `[N/A]`, espaços e vírgulas no nome
 * (o nome é o único campo textual; os 10 seguintes são numéricos).
 */
export function parseNvidiaSmi(raw: string | null | undefined): NvidiaSmiSample | null {
  if (!raw) return null
  const line = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0)
  if (!line) return null

  const fields = line.split(',')
  if (fields.length < 11) return null

  const extraNameFields = fields.length - 11
  const name = fields
    .slice(0, extraNameFields + 1)
    .join(',')
    .trim()
  if (!name) return null

  // `rest` começa no driver_version (o nome — e eventuais vírgulas nele — fica atrás).
  const rest = fields.slice(extraNameFields + 1)
  const usage = toNonNegative(rest[1])
  const fan = toNonNegative(rest[7])

  return {
    name,
    driverVersion: toText(rest[0]),
    usagePercent: usage === null ? null : clampPercent(usage),
    coreClockMhz: toPositive(rest[2]),
    memClockMhz: toPositive(rest[3]),
    vramUsedMb: toNonNegative(rest[4]),
    vramTotalMb: toPositive(rest[5]),
    tempC: toPositive(rest[6]),
    fanPercent: fan === null ? null : clampPercent(fan),
    watts: toNonNegative(rest[8]),
    powerLimitW: toPositive(rest[9])
  }
}

/**
 * Faixa de sanidade da temperatura da CPU. Abaixo de 15 °C só existe com
 * refrigeração extrema/erro de escala; acima de 110 °C a leitura é lixo (o
 * limite térmico da maioria das CPUs fica abaixo disso).
 */
const MIN_PLAUSIBLE_TEMP_C = 15
const MAX_PLAUSIBLE_TEMP_C = 110

/** Décimos de Kelvin (ACPI) → °C. Valores não positivos não são medida. */
export function acpiTenthsKelvinToCelsius(value: unknown): number | null {
  const tenths = toNumber(value)
  if (tenths === null || tenths <= 0) return null
  return round(tenths / 10 - 273.15, 1)
}

function isPlausibleTempCelsius(value: number | null): value is number {
  return value !== null && value >= MIN_PLAUSIBLE_TEMP_C && value <= MAX_PLAUSIBLE_TEMP_C
}

/**
 * Escolha da temperatura de CPU entre as zonas ACPI: maior valor VÁLIDO.
 *
 * Por que a maior: as zonas ACPI costumam misturar CPU, placa e ambiente, e o
 * sensor mais quente é o que se aproxima do pacote da CPU. É determinística
 * (independe da ordem do CIM) e uma zona ausente/louca simplesmente não vota.
 * Nenhuma zona válida → `null`, sem erro.
 */
export function selectCpuTempFromAcpi(zones: unknown, thermal: unknown): number | null {
  const candidates: number[] = []
  for (const row of toRecordList(zones)) {
    candidates.push(acpiTenthsKelvinToCelsius(row.CurrentTemperature) ?? Number.NaN)
  }
  for (const row of toRecordList(thermal)) {
    candidates.push(
      acpiTenthsKelvinToCelsius(row.HighPrecisionTemperature) ??
        acpiTenthsKelvinToCelsius(row.Temperature) ??
        Number.NaN
    )
  }
  const valid = candidates.filter(
    (value) => Number.isFinite(value) && isPlausibleTempCelsius(value)
  )
  return valid.length > 0 ? Math.max(...valid) : null
}

/** Parser do JSON de uma consulta CIM (estática ou dinâmica). Null se inválido. */
export function parseCimJson(raw: string | null | undefined): CimFacts | null {
  if (!raw) return null
  const text = raw.replace(/^\uFEFF/, '').trim()
  if (!text) return null

  // PowerShell pode emitir avisos antes/depois do JSON em máquinas localizadas.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!isRecord(value)) return null

  const ramModules = toRecordList(value.ram).map((row): CimRamModule => ({
    capacityBytes: toPositive(row.Capacity),
    configuredClockMhz: toPositive(row.ConfiguredClockSpeed),
    configuredVoltageMv: toPositive(row.ConfiguredVoltage),
    memoryType: toPositive(row.SMBIOSMemoryType)
  }))

  const cpuRecord = toRecordList(value.cpu)[0] ?? {}
  const boardRecord = toRecordList(value.board)[0] ?? {}
  const processorRecord = toRecordList(value.processor)[0] ?? {}

  // Totais agregados pelo script (uso 3D do adaptador primário + memória desse
  // mesmo adaptador). `0%` é leitura válida; ausência vira null.
  const usage = toNonNegative(value.gpuUsagePercent)

  return {
    ramModules,
    cpu: {
      name: toText(cpuRecord.Name),
      cores: toPositive(cpuRecord.NumberOfCores),
      threads: toPositive(cpuRecord.NumberOfLogicalProcessors),
      baseClockMhz: toPositive(cpuRecord.MaxClockSpeed)
    },
    board: {
      manufacturer: toText(boardRecord.Manufacturer),
      product: toText(boardRecord.Product)
    },
    gpuAdapters: buildGpuAdapters(
      parseVideoControllers(value.video),
      parseGpuRegistry(value.gpuRegistry)
    ),
    gpuSharedBytes: toNonNegative(value.gpuSharedBytes),
    gpuDedicatedBytes: toNonNegative(value.gpuDedicatedBytes),
    gpuUsagePercent: usage === null ? null : clampPercent(usage),
    processorPerformancePercent: toPositive(processorRecord.PercentProcessorPerformance),
    cpuTempAcpiC: selectCpuTempFromAcpi(value.acpi, value.thermal)
  }
}

export interface CpuTimesLike {
  times: { user: number; nice: number; sys: number; idle: number; irq: number }
}

/**
 * Uso de CPU entre duas amostras de `os.cpus()` (soma de todos os núcleos).
 * Delta <= 0 (relógio parado/amostras invertidas) vira null — nunca NaN.
 */
export function computeCpuUsage(
  previous: ReadonlyArray<CpuTimesLike> | null | undefined,
  next: ReadonlyArray<CpuTimesLike> | null | undefined
): number | null {
  if (!previous || !next) return null
  const length = Math.min(previous.length, next.length)
  if (length === 0) return null

  let totalDelta = 0
  let idleDelta = 0
  for (let index = 0; index < length; index += 1) {
    const before = previous[index].times
    const after = next[index].times
    const beforeTotal = before.user + before.nice + before.sys + before.idle + before.irq
    const afterTotal = after.user + after.nice + after.sys + after.idle + after.irq
    totalDelta += afterTotal - beforeTotal
    idleDelta += after.idle - before.idle
  }

  if (!Number.isFinite(totalDelta) || totalDelta <= 0) return null
  if (!Number.isFinite(idleDelta) || idleDelta < 0) return null
  return clampPercent(((totalDelta - idleDelta) / totalDelta) * 100)
}

function buildCpuSpec(cpu: CimCpuFacts): string | null {
  if (!cpu.name) return null
  const parts: string[] = [cpu.name]
  if (cpu.cores !== null && cpu.threads !== null) {
    parts.push(`${cpu.cores} núcleos / ${cpu.threads} threads`)
  } else if (cpu.cores !== null) {
    parts.push(`${cpu.cores} núcleos`)
  }
  if (cpu.baseClockMhz !== null) parts.push(`base ${cpu.baseClockMhz} MHz`)
  return parts.join(' · ')
}

function buildBoardSpec(board: CimBoardFacts): string | null {
  const parts = [board.manufacturer, board.product].filter(
    (entry): entry is string => entry !== null
  )
  return parts.length > 0 ? parts.join(' ') : null
}

function buildRamSpec(ram: HwRam, modules: CimRamModule[]): string | null {
  const parts: string[] = []
  if (ram.installedGb !== null) parts.push(`${round(ram.installedGb, 1)} GB`)
  const typeModule = modules.find((module) => module.memoryType !== null)
  const type = typeModule?.memoryType ?? null
  const typeLabel = type !== null ? SMBIOS_MEMORY_TYPES[type] : undefined
  const speed = ram.speedMhz
  if (typeLabel && speed !== null) parts.push(`${typeLabel}-${speed}`)
  else if (speed !== null) parts.push(`${speed} MHz`)
  else if (typeLabel) parts.push(typeLabel)
  if (modules.length > 0) {
    parts.push(`${modules.length} módulo${modules.length === 1 ? '' : 's'}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function buildGpuSpec(gpu: HwGpu, driverVersion: string | null): string | null {
  if (!gpu.model) return null
  const parts: string[] = [gpu.model]
  if (gpu.vramTotalMb !== null) parts.push(`${Math.round(gpu.vramTotalMb)} MiB de VRAM`)
  if (driverVersion) parts.push(`driver ${driverVersion}`)
  return parts.join(' · ')
}

/** Agrega as fontes em um snapshot — pura, para testes e para a orquestração. */
export function buildNativeSnapshot(input: NativeSnapshotInput): HwSnapshot {
  const capturedAt = input.capturedAt ?? Date.now()
  const cpuUsagePercent =
    input.cpuUsagePercent === null || input.cpuUsagePercent === undefined
      ? null
      : clampPercent(input.cpuUsagePercent)

  const staticFacts = input.staticFacts ?? null
  const cpuFacts = staticFacts?.cpu ?? null
  const modules = staticFacts?.ramModules ?? []
  const board = staticFacts?.board ?? null
  const nvidia = input.nvidia ?? null
  const sharedBytes = input.gpuSharedBytes ?? null
  const dedicatedBytes = input.gpuDedicatedBytes ?? null
  const cimUsagePercent = input.gpuUsagePercent ?? null
  // Adaptador primário detectado pelo CIM: existe em AMD/Intel e também serve
  // de fallback de nome/VRAM/driver quando o `nvidia-smi` não responde.
  const primaryGpu = selectPrimaryGpu(staticFacts?.gpuAdapters ?? [])

  const totalmemBytes = input.totalmemBytes ?? os.totalmem()
  const freememBytes = input.freememBytes ?? os.freemem()
  const installedBytes = modules.reduce((total, module) => total + (module.capacityBytes ?? 0), 0)
  const usedBytes = Math.max(0, totalmemBytes - freememBytes)

  const speedMhz =
    modules.find((module) => module.configuredClockMhz !== null)?.configuredClockMhz ?? null
  const voltageMv =
    modules.find((module) => module.configuredVoltageMv !== null)?.configuredVoltageMv ?? null

  const ram: HwRam = {
    installedGb: installedBytes > 0 ? round(installedBytes / GIB, 1) : null,
    speedMhz,
    voltageV: voltageMv !== null ? round(voltageMv / 1000, 2) : null,
    usedGb: round(usedBytes / GIB, 1),
    usedPercent: totalmemBytes > 0 ? round(clampPercent((usedBytes / totalmemBytes) * 100), 1) : 0
  }

  const baseClock =
    cpuFacts?.baseClockMhz !== null && cpuFacts?.baseClockMhz !== undefined
      ? cpuFacts.baseClockMhz
      : null
  const performance = input.processorPerformancePercent ?? null
  const clockMhz =
    baseClock !== null && performance !== null
      ? Math.round((baseClock * performance) / 100)
      : baseClock

  const cpu: HwCpu = {
    model: cpuFacts?.name ?? null,
    usagePercent: cpuUsagePercent === null ? null : round(cpuUsagePercent, 1),
    clockMhz,
    // ACPI é aproximada, mas é a única temperatura de CPU sem driver. O merge
    // promove para `measured` quando o driver entrega a leitura real.
    tempC: staticFacts?.cpuTempAcpiC ?? null,
    watts: null,
    // Só o agente elevado mede Vcore; o snapshot nativo nunca estima tensão.
    voltageV: null
  }

  const usagePercent = nvidia?.usagePercent ?? cimUsagePercent
  const gpu: HwGpu = {
    model: nvidia?.name ?? primaryGpu?.name ?? null,
    vendor: primaryGpu?.vendor ?? (nvidia ? 'nvidia' : null),
    driverVersion: nvidia?.driverVersion ?? primaryGpu?.driverVersion ?? null,
    driverDate: primaryGpu?.driverDate ?? null,
    usagePercent: usagePercent === null ? null : clampPercent(usagePercent),
    coreClockMhz: nvidia?.coreClockMhz ?? null,
    memClockMhz: nvidia?.memClockMhz ?? null,
    // Memória dedicada do contador CIM ≈ `memory.used` (medido: ~15 MiB de
    // diferença); o `nvidia-smi` continua vencendo quando está disponível.
    vramUsedMb:
      nvidia?.vramUsedMb ?? (dedicatedBytes !== null ? Math.round(dedicatedBytes / MIB) : null),
    vramTotalMb: nvidia?.vramTotalMb ?? primaryGpu?.vramTotalMb ?? null,
    sharedMb: sharedBytes !== null ? round(sharedBytes / MIB, 1) : null,
    tempC: nvidia?.tempC ?? null,
    fanPercent: nvidia?.fanPercent ?? null,
    // RPM só vem da NVML; o `nvidia-smi` publica apenas percentual.
    fanRpm: input.gpuFanRpm ?? null,
    watts: nvidia?.watts ?? null,
    powerLimitW: nvidia?.powerLimitW ?? null
  }

  // A estimativa nasce aqui porque é o único ponto com os núcleos (CIM) e o
  // uso da CPU — o `mergeCpuReadings` só aplica a precedência sobre ela.
  const gpuW = gpu.watts
  const cpuEstimatedW = estimateCpuWatts({
    cores: cpuFacts?.cores ?? null,
    usagePercent: cpuUsagePercent
  })
  const platformEstimatedW = estimatePlatformWatts()
  const totalEstimatedW = estimateTotalWatts({
    cpuEstimatedW,
    gpuW,
    platformW: platformEstimatedW
  })

  return {
    power: {
      cpuW: null,
      gpuW,
      totalMeasuredW: null,
      cpuEstimatedW,
      platformEstimatedW,
      totalEstimatedW
    },
    cpu,
    ram,
    gpu,
    specs: {
      cpu: cpuFacts ? buildCpuSpec(cpuFacts) : null,
      gpu: buildGpuSpec(gpu, gpu.driverVersion),
      ram: buildRamSpec(ram, modules),
      board: board ? buildBoardSpec(board) : null
    },
    sources: {
      driver: input.driver ?? 'absent',
      // No snapshot nativo a CPU só pode ser estimada; o merge promove para
      // `measured` quando o driver entrega watts reais.
      cpu: cpuEstimatedW !== null ? 'estimated' : 'unavailable',
      gpu: gpuW !== null ? 'measured' : 'unavailable',
      platform: 'estimated',
      cpuTemp: cpu.tempC !== null ? 'acpi' : 'unavailable',
      gpuUsage: usagePercent !== null ? 'measured' : 'unavailable',
      gpuTemp: nvidia?.tempC !== null && nvidia?.tempC !== undefined ? 'measured' : 'unavailable'
    },
    capturedAt: new Date(capturedAt).toISOString()
  }
}

/** Executa um binário sem shell, com timeout; null em qualquer falha. */
let warnedExec = new Set<string>()

function warnExecOnce(file: string, message: string): void {
  if (warnedExec.has(file)) return
  warnedExec.add(file)
  logger.warn('hwmon', message)
}

function runFile(file: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          // Uma falha por sessão no log: o polling de 1 Hz não pode inundar o arquivo.
          warnExecOnce(file, `falha ao executar ${file}: ${error.message}`)
          resolve(null)
          return
        }
        warnedExec.delete(file)
        resolve(typeof stdout === 'string' ? stdout : '')
      }
    )
  })
}

let staticCache: StaticFacts | null = null
let staticResolved = false
let previousCpuTimes: CpuTimesLike[] | null = null
let inflight: Promise<HwSnapshot> | null = null
/** Já vimos o `nvidia-smi` responder nesta sessão: o NVML vale a pena. */
let nvidiaSeen = false

function cimArgs(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]
}

/**
 * Estáticos uma vez por sessão. Se a consulta falhar (PowerShell indisponível
 * naquele instante), tenta de novo no próximo tick; sucesso — mesmo vazio —
 * fica cacheado e não repete.
 */
async function readStaticCim(runner: CommandRunner): Promise<StaticFacts | null> {
  if (staticResolved) return staticCache

  const stdout = await runner(resolvePowershellPath(), cimArgs(CIM_STATIC_SCRIPT), CIM_TIMEOUT_MS)
  const facts = parseCimJson(stdout)
  if (!facts) return staticCache

  staticCache = {
    ramModules: facts.ramModules,
    cpu: facts.cpu,
    board: facts.board,
    gpuAdapters: facts.gpuAdapters,
    cpuTempAcpiC: facts.cpuTempAcpiC
  }
  staticResolved = true
  if (facts.cpuTempAcpiC === null) {
    // Uma vez por sessão: o desktop sem ACPI não pode inundar o log a 1 Hz.
    logger.info('hwmon', 'temperatura da CPU por ACPI indisponível nesta máquina')
  }
  return staticCache
}

async function readDynamicCim(
  runner: CommandRunner,
  includeGpuEngine: boolean
): Promise<{
  gpuSharedBytes: number | null
  gpuDedicatedBytes: number | null
  gpuUsagePercent: number | null
  processorPerformancePercent: number | null
}> {
  const stdout = await runner(
    resolvePowershellPath(),
    cimArgs(buildCimDynamicScript(includeGpuEngine)),
    CIM_TIMEOUT_MS
  )
  const facts = parseCimJson(stdout)
  return {
    gpuSharedBytes: facts?.gpuSharedBytes ?? null,
    gpuDedicatedBytes: facts?.gpuDedicatedBytes ?? null,
    gpuUsagePercent: facts?.gpuUsagePercent ?? null,
    processorPerformancePercent: facts?.processorPerformancePercent ?? null
  }
}

/**
 * A máquina é NVIDIA? Só nela o NVML (RPM da ventoinha) faz sentido — em
 * AMD/Intel a DLL nem existe e o processo seria desperdício por tick.
 */
function isKnownNvidia(): boolean {
  if (nvidiaSeen) return true
  return (staticCache?.gpuAdapters ?? []).some((adapter) => adapter.vendor === 'nvidia')
}

async function capture(runner: CommandRunner): Promise<HwSnapshot> {
  const nvidiaPath = resolveNvidiaSmiPath()

  // O `nvidia-smi` roda primeiro (é rápido, ~50 ms) para decidir se o uso da
  // GPU precisa do contador CIM. Sem ele a decisão sai no mesmo tick e a
  // máquina NVIDIA não paga os ~300 ms do `GPUEngine` a cada segundo.
  //
  // O NVML (RPM) entra JUNTO: em máquina já identificada como NVIDIA ele
  // começa antes do `nvidia-smi`; na primeira leitura, quando o fabricante
  // ainda é desconhecido, ele entra no `Promise.all` abaixo junto do CIM.
  // Assim o tick nunca soma dois processos em série (~350 ms do NVML cabem
  // nos ~600 ms do CIM).
  const fanPromise = isKnownNvidia() ? readNvmlFan() : null

  const nvidiaRaw = await runner(nvidiaPath, NVIDIA_QUERY_ARGS, NVIDIA_TIMEOUT_MS)
  const nvidia = parseNvidiaSmi(nvidiaRaw)
  if (nvidia) nvidiaSeen = true
  const fan = fanPromise ?? (nvidia ? readNvmlFan() : Promise.resolve(null))

  // CIM estática (1ª vez) e dinâmica em paralelo: um sensor lento não penaliza
  // o outro; depois do 1º tick só a dinâmica permanece.
  const [staticFacts, dynamic, nvml] = await Promise.all([
    readStaticCim(runner),
    readDynamicCim(runner, nvidia === null),
    fan
  ])

  const nextCpuTimes = os.cpus()
  const cpuUsagePercent = computeCpuUsage(previousCpuTimes, nextCpuTimes)
  previousCpuTimes = nextCpuTimes

  return buildNativeSnapshot({
    cpuUsagePercent,
    nvidia,
    staticFacts,
    gpuSharedBytes: dynamic.gpuSharedBytes,
    gpuDedicatedBytes: dynamic.gpuDedicatedBytes,
    gpuUsagePercent: dynamic.gpuUsagePercent,
    gpuFanRpm: nvml?.rpm ?? null,
    processorPerformancePercent: dynamic.processorPerformancePercent,
    totalmemBytes: os.totalmem(),
    freememBytes: os.freemem(),
    driver: 'absent'
  })
}

/**
 * Snapshot nativo. Chamadas concorrentes compartilham a mesma leitura — o
 * polling de 1 Hz nunca empilha processos do PowerShell.
 */
export function snapshotNative(runner: CommandRunner = runFile): Promise<HwSnapshot> {
  if (inflight) return inflight
  inflight = capture(runner).finally(() => {
    inflight = null
  })
  return inflight
}

/** Apenas para testes: descarta caches de sessão e a amostra de CPU anterior. */
export function resetNativeSensorsForTests(): void {
  staticCache = null
  staticResolved = false
  previousCpuTimes = null
  inflight = null
  nvidiaSeen = false
  warnedExec = new Set<string>()
}
