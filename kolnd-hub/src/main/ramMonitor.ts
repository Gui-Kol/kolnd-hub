import { ipcMain } from 'electron'
import * as os from 'os'
import type { RamProcessInfo, RamSnapshot } from '../shared/ram'
import { runPowerShellCommand } from './hwmon/powershell'
import { logger } from './logger'

/** O polling da aba Memória é de ~5 s; 1 s de cache só absorve cliques e abas. */
const CACHE_TTL_MS = 1000
const COLLECT_TIMEOUT_MS = 8000
const MAX_PROCESSES = 10

/** Total/disponível lidos do Node — usados quando o PowerShell falha. */
export interface RamFallbackTotals {
  totalBytes: number
  freeBytes: number
}

/**
 * Uma única chamada ao PowerShell: SO, contadores de memória e os 10 maiores
 * working sets. `ConvertTo-Json -Compress` mantém a saída num objeto só.
 */
export function buildRamCommand(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$os = Get-CimInstance Win32_OperatingSystem',
    '$mem = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory',
    '$procs = Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Id,ProcessName,WorkingSet64',
    '[pscustomobject]@{',
    'TotalVisibleMemorySize = $os.TotalVisibleMemorySize',
    'FreePhysicalMemory = $os.FreePhysicalMemory',
    'AvailableBytes = $mem.AvailableBytes',
    'CacheBytes = $mem.CacheBytes',
    'StandbyCacheNormalPriorityBytes = $mem.StandbyCacheNormalPriorityBytes',
    'StandbyCacheReserveBytes = $mem.StandbyCacheReserveBytes',
    'StandbyCacheCoreBytes = $mem.StandbyCacheCoreBytes',
    'CommittedBytes = $mem.CommittedBytes',
    'Processes = @($procs)',
    '} | ConvertTo-Json -Compress -Depth 4'
  ].join('\n')
}

/** Número finito e não negativo; qualquer outra coisa (null, NaN, texto) vira null. */
function nonNegative(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

/** KiB do Win32_OperatingSystem → bytes. */
function kibToBytes(value: unknown): number | null {
  const kb = nonNegative(value)
  return kb === null ? null : Math.floor(kb * 1024)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Lista de processos: aceita array ou item único, clampa e ordena por working set. */
export function parseTopProcesses(value: unknown): RamProcessInfo[] {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
  const processes: RamProcessInfo[] = []

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const rawPid = nonNegative(record.Id ?? record.id ?? record.pid)
    const rawName = record.ProcessName ?? record.name ?? record.Name
    const workingSet = nonNegative(
      record.WorkingSet64 ?? record.workingSetBytes ?? record.WorkingSet
    )
    if (rawPid === null || workingSet === null) continue

    const pid = Math.trunc(rawPid)
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (pid <= 0 || name === '') continue

    processes.push({ pid, name, workingSetBytes: Math.floor(workingSet) })
  }

  return processes.sort((a, b) => b.workingSetBytes - a.workingSetBytes).slice(0, MAX_PROCESSES)
}

/**
 * Converte o JSON do PowerShell num snapshot. O parser é puro e nunca lança:
 * JSON inválido, campos ausentes ou contadores absurdos caem no fallback do
 * Node, que sempre devolve uma leitura básica utilizável.
 */
export function parseRamSnapshot(raw: string, fallback: RamFallbackTotals): RamSnapshot {
  const fallbackTotal = nonNegative(fallback.totalBytes) ?? 0
  const fallbackFree = Math.min(fallbackTotal, nonNegative(fallback.freeBytes) ?? 0)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return buildOsSnapshot({ totalBytes: fallbackTotal, freeBytes: fallbackFree })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return buildOsSnapshot({ totalBytes: fallbackTotal, freeBytes: fallbackFree })
  }
  const record = parsed as Record<string, unknown>

  // Win32_OperatingSystem expõe KiB; os contadores de PerfOS já vêm em bytes.
  const totalBytes = kibToBytes(record.TotalVisibleMemorySize) ?? fallbackTotal
  if (totalBytes <= 0) {
    return buildOsSnapshot({ totalBytes: fallbackTotal, freeBytes: fallbackFree }, true)
  }

  const freePhysical = kibToBytes(record.FreePhysicalMemory)
  const freeBytes = clamp(freePhysical ?? fallbackFree, 0, totalBytes)
  const availableBytes = nonNegative(record.AvailableBytes)
  const cacheBytes = nonNegative(record.CacheBytes)
  const committedBytes = nonNegative(record.CommittedBytes)

  const standbyParts = [
    nonNegative(record.StandbyCacheNormalPriorityBytes),
    nonNegative(record.StandbyCacheReserveBytes),
    nonNegative(record.StandbyCacheCoreBytes)
  ].filter((part): part is number => part !== null)
  const standbyBytes =
    standbyParts.length === 0 ? null : standbyParts.reduce((sum, part) => sum + part, 0)

  const usedBytes = clamp(totalBytes - (availableBytes ?? freeBytes), 0, totalBytes)
  const usedPercent = clamp((usedBytes / totalBytes) * 100, 0, 100)

  return {
    ok: true,
    totalBytes: Math.floor(totalBytes),
    usedBytes: Math.floor(usedBytes),
    usedPercent,
    freeBytes: Math.floor(freeBytes),
    availableBytes: availableBytes === null ? null : Math.floor(availableBytes),
    cacheBytes: cacheBytes === null ? null : Math.floor(cacheBytes),
    standbyBytes: standbyBytes === null ? null : Math.floor(standbyBytes),
    committedBytes: committedBytes === null ? null : Math.floor(committedBytes),
    topProcesses: parseTopProcesses(record.Processes),
    source: 'cim'
  }
}

/** Leitura básica do Node: total/disponível reais, sem detalhes do Windows. */
export function buildOsSnapshot(fallback: RamFallbackTotals, fatal = false): RamSnapshot {
  const totalBytes = Math.max(0, Math.floor(nonNegative(fallback.totalBytes) ?? 0))
  const freeBytes = clamp(Math.floor(nonNegative(fallback.freeBytes) ?? 0), 0, totalBytes)
  const usedBytes = clamp(totalBytes - freeBytes, 0, totalBytes)
  const usedPercent = totalBytes > 0 ? clamp((usedBytes / totalBytes) * 100, 0, 100) : 0

  return {
    ok: totalBytes > 0,
    totalBytes,
    usedBytes,
    usedPercent,
    freeBytes,
    availableBytes: null,
    cacheBytes: null,
    standbyBytes: null,
    committedBytes: null,
    topProcesses: [],
    source: 'os',
    ...(totalBytes > 0 && !fatal
      ? {}
      : {
          error:
            'Não foi possível ler a memória deste PC agora. Tente novamente em alguns instantes.'
        })
  }
}

/** Totais do Node — o fallback nunca depende do PowerShell. */
export function osFallbackTotals(): RamFallbackTotals {
  return {
    totalBytes: Math.max(0, Math.floor(os.totalmem())),
    freeBytes: Math.max(0, Math.floor(os.freemem()))
  }
}

let cache: { at: number; snapshot: RamSnapshot } | null = null
let inflight: Promise<RamSnapshot> | null = null

/**
 * Coleta com cache curto + de-duplicação de chamada em voo (mesmo padrão do
 * `startupManager`): duas abas/cliques não abrem dois PowerShell.
 * `force` ignora o TTL — usado antes/depois de uma otimização.
 */
export async function collectRamSnapshot(force = false): Promise<RamSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot
  if (inflight) return inflight

  inflight = (async (): Promise<RamSnapshot> => {
    let snapshot: RamSnapshot
    try {
      const result = await runPowerShellCommand(buildRamCommand(), COLLECT_TIMEOUT_MS)
      const raw = `${result.stdout ?? ''}`.trim()
      snapshot =
        raw === '' ? buildOsSnapshot(osFallbackTotals()) : parseRamSnapshot(raw, osFallbackTotals())
    } catch {
      // `runPowerShellCommand` promete nunca rejeitar, mas a defesa é barata.
      snapshot = buildOsSnapshot(osFallbackTotals())
    }
    cache = { at: Date.now(), snapshot }
    return snapshot
  })().finally(() => {
    inflight = null
  })

  return inflight
}

/** Limpa cache/estado entre testes — não usar em produção. */
export function resetRamMonitorForTests(): void {
  cache = null
  inflight = null
}

/** Registra o canal IPC de leitura da memória. Sem argumentos por contrato. */
export function registerRamMonitorIpc(): void {
  ipcMain.handle('ram:info', (_event, ...args: unknown[]): Promise<RamSnapshot> => {
    if (args.length > 0) {
      logger.warn('ram', 'ram:info ignorou argumentos inesperados')
    }
    return collectRamSnapshot()
  })
}
