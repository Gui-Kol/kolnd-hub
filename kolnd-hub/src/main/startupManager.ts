import { execFileSync } from 'child_process'
import { hostname } from 'os'

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

/* Processos em execução no sistema */
const PROCESS_LIST_SCRIPT = `
$proc = Get-Process -ErrorAction SilentlyContinue | Select-Object ProcessName, Id, @{N='Path';E={try{$_.Path}catch{''}}}
if ($null -eq $proc) { @() | ConvertTo-Json -Depth 1 } else { @($proc) | ConvertTo-Json -Depth 1 }
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

/** Lista tudo que está configurado para iniciar com o Windows. */
export function listStartupItems(): StartupItem[] {
  const items: StartupItem[] = []

  for (const it of jsonArray(ps(REG_LIST_SCRIPT))) {
    const row = it as Record<string, unknown>
    items.push({
      id: `registro:${row.scope}:${row.name}`,
      name: String(row.name ?? ''),
      path: String(row.path ?? ''),
      location: 'registro',
      scope: row.scope as StartupScope
    })
  }

  for (const it of jsonArray(ps(FOLDER_LIST_SCRIPT))) {
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

/** Lista processos em execução no sistema (para detecção de segundo plano). */
export function listRunningProcesses(): RunningProcess[] {
  return jsonArray(ps(PROCESS_LIST_SCRIPT)).map((it) => {
    const row = it as Record<string, unknown>
    return {
      name: String(row.ProcessName ?? ''),
      id: Number(row.Id ?? 0),
      path: String(row.Path ?? '')
    }
  })
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
        `$name = $env:KOLND_STARTUP_NAME\nforeach ($path in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run') { if (Test-Path $path) { Remove-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue } }`,
        { KOLND_STARTUP_NAME: item.name }
      )
    } else {
      ps(
        `$name = $env:KOLND_STARTUP_NAME\nforeach ($f in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) { if (Test-Path $f) { Get-ChildItem -Path $f -File | Where-Object { $_.BaseName -eq $name -and ($_.Extension -eq '.lnk' -or $_.Extension -eq '.exe') } | Remove-Item -Force -ErrorAction SilentlyContinue } }`,
        { KOLND_STARTUP_NAME: item.name }
      )
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Nome do computador (ex.: DESKTOP-ABC123). */
export function getPcName(): string {
  return hostname()
}
