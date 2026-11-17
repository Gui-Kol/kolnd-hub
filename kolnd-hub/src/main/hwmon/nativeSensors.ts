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
  gpuSharedBytes: number | null
  processorPerformancePercent: number | null
}

/** Parte estável da consulta CIM — cacheada por sessão. */
export type StaticFacts = Pick<CimFacts, 'ramModules' | 'cpu' | 'board'>

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
 * Consulta CIM estática (RAM, CPU e placa) — uma execução por sessão.
 * `[Console]::OutputEncoding` força UTF-8 no stdout mesmo em console localizado;
 * `$ErrorActionPreference` evita que uma classe ausente escreva lixo no JSON.
 */
const CIM_STATIC_SCRIPT = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  "$ErrorActionPreference='SilentlyContinue'",
  '$ram=@(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,ConfiguredClockSpeed,ConfiguredVoltage,SMBIOSMemoryType)',
  '$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed',
  '$board=Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer,Product',
  '[pscustomobject]@{ram=@($ram);cpu=$cpu;board=$board} | ConvertTo-Json -Depth 6 -Compress'
].join('; ')

/** Consulta CIM dinâmica (GPU compartilhada + performance do processador) por tick. */
const CIM_DYNAMIC_SCRIPT = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  "$ErrorActionPreference='SilentlyContinue'",
  '$gpuMem=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | Select-Object Name,SharedUsage)',
  "$perf=Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1 PercentProcessorPerformance",
  '[pscustomobject]@{gpuMemory=@($gpuMem);processor=$perf} | ConvertTo-Json -Depth 6 -Compress'
].join('; ')

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

  // Várias linhas (uma por adaptador). A do adaptador básico de vídeo tem
  // `SharedUsage` minúsculo (8 KiB nesta máquina); o maior valor é o da GPU real.
  const sharedValues = toRecordList(value.gpuMemory)
    .map((row) => toNonNegative(row.SharedUsage))
    .filter((entry): entry is number => entry !== null)
  const gpuSharedBytes = sharedValues.length > 0 ? Math.max(...sharedValues) : null

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
    gpuSharedBytes,
    processorPerformancePercent: toPositive(processorRecord.PercentProcessorPerformance)
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
    tempC: null,
    watts: null
  }

  const gpu: HwGpu = {
    model: nvidia?.name ?? null,
    usagePercent: nvidia?.usagePercent ?? null,
    coreClockMhz: nvidia?.coreClockMhz ?? null,
    memClockMhz: nvidia?.memClockMhz ?? null,
    vramUsedMb: nvidia?.vramUsedMb ?? null,
    vramTotalMb: nvidia?.vramTotalMb ?? null,
    sharedMb: sharedBytes !== null ? round(sharedBytes / MIB, 1) : null,
    tempC: nvidia?.tempC ?? null,
    fanPercent: nvidia?.fanPercent ?? null,
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
      gpu: buildGpuSpec(gpu, nvidia?.driverVersion ?? null),
      ram: buildRamSpec(ram, modules),
      board: board ? buildBoardSpec(board) : null
    },
    sources: {
      driver: input.driver ?? 'absent',
      // No snapshot nativo a CPU só pode ser estimada; o merge promove para
      // `measured` quando o driver entrega watts reais.
      cpu: cpuEstimatedW !== null ? 'estimated' : 'unavailable',
      gpu: gpuW !== null ? 'measured' : 'unavailable',
      platform: 'estimated'
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

  staticCache = { ramModules: facts.ramModules, cpu: facts.cpu, board: facts.board }
  staticResolved = true
  return staticCache
}

async function readDynamicCim(
  runner: CommandRunner
): Promise<{ gpuSharedBytes: number | null; processorPerformancePercent: number | null }> {
  const stdout = await runner(resolvePowershellPath(), cimArgs(CIM_DYNAMIC_SCRIPT), CIM_TIMEOUT_MS)
  const facts = parseCimJson(stdout)
  return {
    gpuSharedBytes: facts?.gpuSharedBytes ?? null,
    processorPerformancePercent: facts?.processorPerformancePercent ?? null
  }
}

async function capture(runner: CommandRunner): Promise<HwSnapshot> {
  const nvidiaPath = resolveNvidiaSmiPath()

  // GPU, CIM estática (1ª vez) e dinâmica em paralelo: um sensor lento não
  // penaliza os outros; depois do 1º tick só a dinâmica permanece.
  const [nvidiaRaw, staticFacts, dynamic] = await Promise.all([
    runner(nvidiaPath, NVIDIA_QUERY_ARGS, NVIDIA_TIMEOUT_MS),
    readStaticCim(runner),
    readDynamicCim(runner)
  ])

  const nextCpuTimes = os.cpus()
  const cpuUsagePercent = computeCpuUsage(previousCpuTimes, nextCpuTimes)
  previousCpuTimes = nextCpuTimes

  return buildNativeSnapshot({
    cpuUsagePercent,
    nvidia: parseNvidiaSmi(nvidiaRaw),
    staticFacts,
    gpuSharedBytes: dynamic.gpuSharedBytes,
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
  warnedExec = new Set<string>()
}
