import { ipcMain } from 'electron'
import { basename, extname } from 'path'
import type { RamOptimizeResult, RamSnapshot } from '../shared/ram'
import { runPowerShell, runPowerShellCommand } from './hwmon/powershell'
import { isUacCancelled } from './hwmon/uac'
import { collectRamSnapshot } from './ramMonitor'
import { logger } from './logger'

const TRIM_TIMEOUT_MS = 20000
const PURGE_TIMEOUT_MS = 60000

/**
 * Processos que nunca recebem `EmptyWorkingSet`: fechar/limpar o working set de
 * qualquer um deles pode travar a área de trabalho ou o próprio Windows.
 * `explorer` entra mesmo sendo da sessão do usuário — reiniciá-lo no meio de
 * uma otimização seria um efeito colateral visível demais.
 */
export const CRITICAL_PROCESS_NAMES = [
  'System',
  'Idle',
  'Registry',
  'Memory Compression',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'smss',
  'fontdrvhost',
  'dwm',
  'explorer',
  'audiodg',
  'sihost',
  'ctfmon',
  'taskhostw'
] as const

/** Nome do executável do Hub sem extensão (`electron` em dev, `Kolnd Hub` no app). */
export function hubProcessName(execPath: string = process.execPath): string {
  const file = basename(execPath)
  const ext = extname(file)
  return ext ? file.slice(0, -ext.length) : file
}

/** Aspas simples do PowerShell são escapadas duplicando-as. */
function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

/** PowerShell usa UTF-16LE no `-EncodedCommand` (mesmo padrão do remoteAccess). */
function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Script interno do trim (roda sem elevação). `OpenProcess` usa
 * `PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA` e `EmptyWorkingSet` apenas
 * devolve páginas ao standby — nunca encerra nem fecha processos.
 */
export function buildTrimScript(hubPid: number, hubName: string): string {
  const safePid = Number.isFinite(hubPid) && hubPid > 0 ? Math.trunc(hubPid) : 0
  const safeName = psQuote(hubName.trim())
  const critical = CRITICAL_PROCESS_NAMES.map((name) => `'${psQuote(name)}'`).join(',')

  return `$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;
public static class KolndRam {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("psapi.dll", SetLastError = true)]
  public static extern bool EmptyWorkingSet(IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
}
'@
Add-Type -TypeDefinition $code
$critical = @(${critical})
$hubPid = ${safePid}
$hubName = '${safeName}'
$trimmed = 0
$skipped = 0
$errors = 0
foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
  try {
    if ($p.Id -eq $PID -or $p.Id -eq $hubPid) { $skipped++; continue }
    if ($hubName -and $p.ProcessName -ieq $hubName) { $skipped++; continue }
    if ($p.SessionId -eq 0) { $skipped++; continue }
    if ($critical -contains $p.ProcessName) { $skipped++; continue }
    $handle = [KolndRam]::OpenProcess(0x0400 -bor 0x0100, $false, $p.Id)
    if ($handle -eq [IntPtr]::Zero) { $skipped++; continue }
    try {
      if ([KolndRam]::EmptyWorkingSet($handle)) { $trimmed++ } else { $errors++ }
    } finally {
      [void][KolndRam]::CloseHandle($handle)
    }
  } catch {
    $errors++
  }
}
[pscustomobject]@{ trimmed = $trimmed; skipped = $skipped; errors = $errors } | ConvertTo-Json -Compress`
}

/**
 * Script interno da standby list — roda já elevado. Habilita
 * `SeProfileSingleProcessPrivilege` e chama `NtSetSystemInformation(80, 4)`.
 */
export function buildPurgeScript(): string {
  return `$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;
public static class KolndStandby {
  [StructLayout(LayoutKind.Sequential, Pack = 1)]
  public struct TokPriv1Luid {
    public int Count;
    public long Luid;
    public int Attr;
  }
  [DllImport("kernel32.dll", ExactSpelling = true)]
  public static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll", ExactSpelling = true, SetLastError = true)]
  public static extern bool OpenProcessToken(IntPtr process, int access, ref IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool LookupPrivilegeValue(string host, string name, ref long luid);
  [DllImport("advapi32.dll", ExactSpelling = true, SetLastError = true)]
  public static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TokPriv1Luid state, int length, IntPtr previous, IntPtr returnLength);
  [DllImport("ntdll.dll")]
  public static extern int NtSetSystemInformation(int infoClass, ref int info, int length);
  public static int Purge() {
    IntPtr token = IntPtr.Zero;
    if (!OpenProcessToken(GetCurrentProcess(), 0x28, ref token)) return -1;
    TokPriv1Luid state;
    state.Count = 1;
    state.Luid = 0;
    state.Attr = 0x2;
    if (!LookupPrivilegeValue(null, "SeProfileSingleProcessPrivilege", ref state.Luid)) return -2;
    if (!AdjustTokenPrivileges(token, false, ref state, 0, IntPtr.Zero, IntPtr.Zero)) return -3;
    int command = 4;
    return NtSetSystemInformation(80, ref command, sizeof(int));
  }
}
'@
Add-Type -TypeDefinition $code
try {
  $result = [KolndStandby]::Purge()
  if ($result -ne 0) {
    [pscustomobject]@{ ok = $false; code = $result } | ConvertTo-Json -Compress
    exit 1
  }
  [pscustomobject]@{ ok = $true; code = 0 } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ ok = $false; code = -1 } | ConvertTo-Json -Compress
  exit 1
}`
}

/**
 * argv do PowerShell que pede UAC (`-Verb RunAs -Wait -PassThru`) e executa o
 * script interno por `-EncodedCommand` — nunca um `.ps1` em pasta gravável pelo
 * usuário. Copiado de `remoteAccess.buildElevatedServiceArgs`.
 */
export function buildElevatedPurgeArgs(): string[] {
  const inner = encodePowerShell(buildPurgeScript())
  const wrapper = [
    `$p = Start-Process -FilePath 'powershell.exe'`,
    `-ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}')`,
    '-Verb RunAs -Wait -PassThru',
    '; exit $p.ExitCode'
  ].join(' ')
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShell(wrapper)
  ]
}

/** Contadores do trim: qualquer valor inválido vira 0 (nunca negativo/NaN). */
function count(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export interface TrimCounts {
  trimmed: number
  skipped: number
  errors: number
}

/** JSON do trim; `null` quando a saída não é o objeto esperado. */
export function parseTrimOutput(raw: string): TrimCounts | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (!('trimmed' in record) && !('skipped' in record) && !('errors' in record)) return null
  return {
    trimmed: count(record.trimmed),
    skipped: count(record.skipped),
    errors: count(record.errors)
  }
}

/** JSON do purge elevado: só `{ ok: true }` conta como sucesso. */
export function parsePurgeOutput(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw)
    return !!parsed && typeof parsed === 'object' && (parsed as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

/**
 * Diferença de disponível antes/depois. Só soma quando as duas leituras têm o
 * campo; nunca devolve negativo (o Windows pode reduzir o disponível).
 */
export function computeFreedBytes(before: RamSnapshot, after: RamSnapshot): number {
  if (before.availableBytes === null || after.availableBytes === null) return 0
  const delta = after.availableBytes - before.availableBytes
  return Number.isFinite(delta) && delta > 0 ? Math.floor(delta) : 0
}

/** Libera os working sets sem UAC; nunca encerra processos. */
export async function trimWorkingSets(): Promise<RamOptimizeResult> {
  const before = await collectRamSnapshot(true)
  const result = await runPowerShellCommand(
    buildTrimScript(process.pid, hubProcessName()),
    TRIM_TIMEOUT_MS
  )
  const raw = `${result.stdout ?? ''}`.trim()
  const counts = parseTrimOutput(raw)
  const after = await collectRamSnapshot(true)
  const freedBytes = computeFreedBytes(before, after)

  if (!counts) {
    logger.warn(
      'ram',
      `Otimização de working sets não devolveu um resultado válido (timeout=${result.timedOut})`
    )
    return {
      ok: false,
      mode: 'trim',
      freedBytes,
      trimmedProcesses: 0,
      skipped: 0,
      errors: 1,
      error: result.timedOut
        ? 'A liberação de memória demorou mais que o esperado. Nenhum programa foi fechado; tente novamente em alguns instantes.'
        : 'Não foi possível liberar a memória dos programas agora. Nenhum programa foi fechado; tente novamente em alguns instantes.'
    }
  }

  return {
    ok: true,
    mode: 'trim',
    freedBytes,
    trimmedProcesses: counts.trimmed,
    skipped: counts.skipped,
    errors: counts.errors
  }
}

/** Limpa a standby list com UAC; recusa do usuário é um estado próprio. */
export async function purgeStandbyMemory(): Promise<RamOptimizeResult> {
  const before = await collectRamSnapshot(true)
  const result = await runPowerShell(buildElevatedPurgeArgs(), PURGE_TIMEOUT_MS)
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  if (isUacCancelled(combined)) {
    return {
      ok: false,
      cancelled: true,
      mode: 'purge',
      freedBytes: 0,
      skipped: 0,
      errors: 0,
      error:
        'A permissão de administrador foi cancelada. A memória standby não foi alterada; tente de novo quando quiser.'
    }
  }

  // O processo elevado tem console próprio: o wrapper normalmente não devolve
  // stdout. O código de saída é a fonte de verdade; se houver saída, ela não
  // pode contradizer o sucesso.
  const output = (result.stdout ?? '').trim()
  const explicitFailure = output !== '' && !parsePurgeOutput(output)
  if (result.timedOut || result.code !== 0 || explicitFailure) {
    logger.warn(
      'ram',
      `Limpeza da standby list não concluiu (timeout=${result.timedOut}, code=${result.code ?? 'null'})`
    )
    return {
      ok: false,
      mode: 'purge',
      freedBytes: 0,
      skipped: 0,
      errors: 1,
      error: result.timedOut
        ? 'A otimização avançada demorou mais que o esperado. Nada foi alterado de forma permanente; tente novamente em alguns instantes.'
        : 'Não foi possível limpar a memória standby agora. Nada foi alterado de forma permanente; tente novamente em alguns instantes.'
    }
  }

  const after = await collectRamSnapshot(true)
  return {
    ok: true,
    mode: 'purge',
    freedBytes: computeFreedBytes(before, after),
    skipped: 0,
    errors: 0
  }
}

/** Registra os canais IPC das otimizações. Sem argumentos por contrato. */
export function registerRamOptimizerIpc(): void {
  ipcMain.handle('ram:optimize', (_event, ...args: unknown[]): Promise<RamOptimizeResult> => {
    if (args.length > 0) {
      logger.warn('ram', 'ram:optimize ignorou argumentos inesperados')
    }
    return trimWorkingSets()
  })

  ipcMain.handle('ram:purge-standby', (_event, ...args: unknown[]): Promise<RamOptimizeResult> => {
    if (args.length > 0) {
      logger.warn('ram', 'ram:purge-standby ignorou argumentos inesperados')
    }
    return purgeStandbyMemory()
  })
}
