import { execFile, execFileSync, spawn } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { hostname } from 'os'
import { logger } from './logger'

export type StartupLocation = 'registro' | 'pasta-inicializacao'
export type StartupScope = 'usuario' | 'sistema'

export interface StartupItem {
  id: string
  name: string
  path: string
  location: StartupLocation
  scope: StartupScope
}

export interface RunningProcess {
  name: string
  id: number
  path: string
}

/* ── PowerShell scripts ──────────────────────────────────────────── */

/* Itens de inicialização: chaves de registro Run (HKCU e HKLM) */
const REG_LIST_SCRIPT = `
$items = @()
foreach ($path in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run') {
  if (Test-Path $path) {
    $key = Get-Item -Path $path
    $scope = if ($path -clike 'HKCU*') { 'usuario' } else { 'sistema' }
    foreach ($name in $key.GetValueNames()) {
      $items += [pscustomobject]@{
        name = [string]$name
        path = [string]($key.GetValue($name))
        location = 'registro'
        scope = $scope
      }
    }
  }
}
if ($items.Count -eq 0) { @() | ConvertTo-Json -Depth 2 } else { $items | ConvertTo-Json -Depth 2 }
`

/* Itens de inicialização: pastas de Inicialização (usuário e sistema) */
const FOLDER_LIST_SCRIPT = `
$items = @()
$shell = New-Object -ComObject WScript.Shell
$folders = @(
  @{ path = [Environment]::GetFolderPath('Startup'); scope = 'usuario' },
  @{ path = [Environment]::GetFolderPath('CommonStartup'); scope = 'sistema' }
)
foreach ($f in $folders) {
  if (Test-Path $f.path) {
    Get-ChildItem -Path $f.path -File | Where-Object { $_.Extension -eq '.lnk' -or $_.Extension -eq '.exe' } | ForEach-Object {
      $target = $_.FullName
      try { $sc = $shell.CreateShortcut($_.FullName); if ($sc.TargetPath) { $target = $sc.TargetPath } } catch {}
      $items += [pscustomobject]@{
        name = [string]$_.BaseName
        path = [string]$target
        location = 'pasta-inicializacao'
        scope = $f.scope
      }
    }
  }
}
if ($items.Count -eq 0) { @() | ConvertTo-Json -Depth 2 } else { $items | ConvertTo-Json -Depth 2 }
`

/* Processos em execução no sistema — consultado pelo helper persistente.
 * `Get-CimInstance Win32_Process` devolve os mesmos campos (Name/ProcessId/
 * ExecutablePath) numa única consulta WMI: com anti-cheat ativo, o antigo
 * `Get-Process … Path` abria handle em cada processo e levava ~5 s. */
const PROCESS_HELPER_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'quit') { break }
  $proc = Get-CimInstance Win32_Process | Select-Object Name, ProcessId, ExecutablePath
  $json = ConvertTo-Json -InputObject @($proc) -Compress -Depth 2
  [Console]::Out.WriteLine('KOLND-RESULT ' + $json)
  [Console]::Out.Flush()
}
`

function ps(script: string, extraEnv: Record<string, string> = {}): string {
  return execFileSync(
    'powershell.exe',
    ['-STA', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, ...extraEnv }
    }
  ).trim()
}

function jsonArray(out: string): unknown[] {
  if (!out) return []
  try {
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

/** Igual a `ps()`, mas sem bloquear o event loop do main (abertura e leituras). */
function psAsync(script: string, extraEnv: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-STA', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        maxBuffer: 100 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...extraEnv }
      },
      (err, stdout) => {
        if (err) reject(err)
        else resolve(String(stdout).trim())
      }
    )
  })
}

/** Lista tudo que está configurado para iniciar com o Windows. */
export async function listStartupItems(): Promise<StartupItem[]> {
  const items: StartupItem[] = []

  // Registro e pasta são independentes: as duas consultas rodam em paralelo e
  // fora da thread do main (antes eram 2 execFileSync no caminho da janela).
  const [regOut, folderOut] = await Promise.all([
    psAsync(REG_LIST_SCRIPT),
    psAsync(FOLDER_LIST_SCRIPT)
  ])

  for (const it of jsonArray(regOut)) {
    const row = it as Record<string, unknown>
    items.push({
      id: `registro:${row.scope}:${row.name}`,
      name: String(row.name ?? ''),
      path: String(row.path ?? ''),
      location: 'registro',
      scope: row.scope as StartupScope
    })
  }

  for (const it of jsonArray(folderOut)) {
    const row = it as Record<string, unknown>
    items.push({
      id: `pasta:${row.scope}:${row.name}`,
      name: String(row.name ?? ''),
      path: String(row.path ?? ''),
      location: 'pasta-inicializacao',
      scope: row.scope as StartupScope
    })
  }

  return items
}

/* ── Processos em execução: helper persistente + cache ───────────── */

const PROCESS_RESULT_PREFIX = 'KOLND-RESULT '
/* Consulta travada nunca pode prender o chamador: estoura, mata o helper e a
 * próxima chamada cria um novo processo. */
const PROCESS_HELPER_TIMEOUT_MS = 15_000
/* Cache curto: chamadas repetidas (StrictMode, várias janelas) não duplicam
 * consulta. O TTL é o mínimo exigido pela task (5 s). */
const PROCESS_LIST_TTL_MS = 5000

export type ProcessListRunner = () => Promise<string>

let processHelper: ChildProcessWithoutNullStreams | null = null
let helperBuffer = ''
let pendingResult: {
  resolve: (out: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
} | null = null
let processCache: { at: number; items: RunningProcess[] } | null = null
let processInflight: Promise<RunningProcess[]> | null = null

function rejectPending(error: Error): void {
  if (!pendingResult) return
  const { reject, timer } = pendingResult
  pendingResult = null
  clearTimeout(timer)
  reject(error)
}

function flushHelperBuffer(): void {
  let index = helperBuffer.indexOf('\n')
  while (index !== -1) {
    const line = helperBuffer.slice(0, index).replace(/\r$/, '')
    helperBuffer = helperBuffer.slice(index + 1)
    if (line.startsWith(PROCESS_RESULT_PREFIX) && pendingResult) {
      const { resolve, timer } = pendingResult
      pendingResult = null
      clearTimeout(timer)
      resolve(line.slice(PROCESS_RESULT_PREFIX.length))
    }
    index = helperBuffer.indexOf('\n')
  }
}

function ensureHelper(): ChildProcessWithoutNullStreams {
  if (processHelper) return processHelper

  // UM powershell.exe por sessão: elimina o spawn periódico que tirava o foco
  // do jogo em fullscreen (H2). O processo morre sozinho quando o stdin fecha
  // (quit/crash do main), então nunca vira órfão.
  const child = spawn(
    'powershell.exe',
    ['-STA', '-NoProfile', '-NonInteractive', '-Command', PROCESS_HELPER_SCRIPT],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  child.stdout.setEncoding('utf8')
  helperBuffer = ''
  child.stdout.on('data', (chunk: string) => {
    helperBuffer += chunk
    flushHelperBuffer()
  })
  // stderr precisa ser consumido para o pipe nunca encher (erros do WMI não
  // interessam: a resposta vem pelo prefixo KOLND-RESULT).
  child.stderr.on('data', () => undefined)
  // EPIPE no quit é esperado: o app está fechando e o helper encerra junto.
  child.stdin.on('error', () => undefined)
  child.on('error', () => {
    if (processHelper === child) {
      processHelper = null
      helperBuffer = ''
    }
    rejectPending(new Error('falha ao iniciar o helper de processos'))
  })
  child.on('exit', () => {
    if (processHelper === child) {
      processHelper = null
      helperBuffer = ''
    }
    rejectPending(new Error('helper de processos encerrou'))
  })
  processHelper = child
  return child
}

function stopHelper(): void {
  rejectPending(new Error('helper de processos encerrado'))
  const child = processHelper
  processHelper = null
  helperBuffer = ''
  if (!child) return
  try {
    child.stdin.end()
  } catch {
    // pipe já fechado
  }
  try {
    child.kill()
  } catch {
    // processo já saiu
  }
}

function runProcessListScript(): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = ensureHelper()
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    if (pendingResult) {
      reject(new Error('consulta de processos já em andamento'))
      return
    }
    const timer = setTimeout(() => {
      rejectPending(new Error('timeout na consulta de processos'))
      stopHelper()
    }, PROCESS_HELPER_TIMEOUT_MS)
    pendingResult = { resolve, reject, timer }
    child.stdin.write('processes\n')
  })
}

function parseRunningProcesses(out: string): RunningProcess[] {
  return jsonArray(out).map((it) => {
    const row = it as Record<string, unknown>
    return {
      // `Win32_Process.Name` traz o sufixo `.exe`; o contrato antigo (e o
      // `matchesProcess`) trabalhava com o nome sem extensão, como o
      // `ProcessName` do Get-Process.
      name: String(row.Name ?? '').replace(/\.exe$/i, ''),
      id: Number(row.ProcessId ?? 0),
      path: String(row.ExecutablePath ?? '')
    }
  })
}

/** Lista processos em execução no sistema (para detecção de segundo plano). */
export async function listRunningProcesses(
  runner: ProcessListRunner = runProcessListScript
): Promise<RunningProcess[]> {
  if (processCache && Date.now() - processCache.at < PROCESS_LIST_TTL_MS) {
    return processCache.items
  }
  // No máximo UMA consulta em voo: chamadas concorrentes compartilham a Promise.
  if (processInflight) return processInflight

  processInflight = (async (): Promise<RunningProcess[]> => {
    // Instrumentação de diagnóstico: o `debug` é o caminho normal (custo zero
    // em info). KOLDND_HUB_TRACE_PROCESSES=1 grava a mesma marca em info para
    // contar as consultas WMI reais em execuções de medição no Windows.
    logger.debug('startup', 'consulta de processos (WMI)')
    if (process.env.KOLDND_HUB_TRACE_PROCESSES === '1') {
      logger.info('startup', 'consulta de processos (WMI)')
    }
    const items = parseRunningProcesses(await runner())
    processCache = { at: Date.now(), items }
    return items
  })().finally(() => {
    processInflight = null
  })

  return processInflight
}

/** Estado limpo entre testes (cache + helper) — não usar em produção. */
export function resetProcessListForTests(): void {
  processCache = null
  processInflight = null
  stopHelper()
}

/** Remove um item da inicialização (valor de registro ou atalho da pasta). */
export function removeStartupItem(item: {
  location: StartupLocation
  scope: StartupScope
  name: string
}): { success: boolean; error?: string } {
  try {
    if (item.location === 'registro') {
      ps(
        `$ErrorActionPreference = 'SilentlyContinue'\n$name = $env:KOLND_STARTUP_NAME\nforeach ($path in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run') { if (Test-Path $path) { try { Remove-ItemProperty -Path $path -Name $name -ErrorAction Stop } catch {} } }\nexit 0`,
        { KOLND_STARTUP_NAME: item.name }
      )
    } else {
      ps(
        `$ErrorActionPreference = 'SilentlyContinue'\n$name = $env:KOLND_STARTUP_NAME\nforeach ($f in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) { if (Test-Path $f) { Get-ChildItem -Path $f -File | Where-Object { $_.BaseName -eq $name -and ($_.Extension -eq '.lnk' -or $_.Extension -eq '.exe') } | ForEach-Object { try { Remove-Item $_.FullName -Force -ErrorAction Stop } catch {} } } }\nexit 0`,
        { KOLND_STARTUP_NAME: item.name }
      )
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Remove vários itens da inicialização em lote. */
export function removeStartupItemsBatch(
  items: Array<{
    location: StartupLocation
    scope: StartupScope
    name: string
  }>
): { success: boolean; errors: string[] } {
  const errors: string[] = []
  let ok = true
  for (const item of items) {
    const result = removeStartupItem(item)
    if (!result.success) {
      ok = false
      errors.push(`${item.name}: ${result.error ?? 'erro desconhecido'}`)
    }
  }
  return { success: ok, errors }
}

/** Adiciona um item à inicialização (chave de registro Run do usuário atual). */
export function addStartupItem(item: { name: string; path: string }): {
  success: boolean
  error?: string
} {
  try {
    ps(
      `$ErrorActionPreference = 'SilentlyContinue'\n$name = $env:KOLND_STARTUP_NAME\n$value = $env:KOLND_STARTUP_PATH\n$reg = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'\nif (-not (Test-Path $reg)) { New-Item -Path $reg -Force | Out-Null }\ntry { New-ItemProperty -Path $reg -Name $name -Value $value -PropertyType String -Force -ErrorAction Stop } catch { Set-ItemProperty -Path $reg -Name $name -Value $value -ErrorAction Stop }\nexit 0`,
      { KOLND_STARTUP_NAME: item.name, KOLND_STARTUP_PATH: item.path }
    )
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Adiciona vários itens à inicialização em lote. */
export function addStartupItemsBatch(items: Array<{ name: string; path: string }>): {
  success: boolean
  errors: string[]
} {
  const errors: string[] = []
  let ok = true
  for (const item of items) {
    const result = addStartupItem(item)
    if (!result.success) {
      ok = false
      errors.push(`${item.name}: ${result.error ?? 'erro desconhecido'}`)
    }
  }
  return { success: ok, errors }
}

/** Nome do computador (ex.: DESKTOP-ABC123). */
export function getPcName(): string {
  return hostname()
}
