# measure-absolem.ps1 -- mede CPU e memoria do Absolem em tres cenarios (task 23).
#
# Cenarios:
#   A - overlay oculto (app recem-iniciado na bandeja)
#   B - overlay visivel em idle por N segundos
#   C - overlay visivel em speaking com fakeVoice=1
#
# O script sobe o binario NAO empacotado (`out/` via electron) com userData
# temporario, espera o boot/overlay estabilizar, amostra a arvore de processos
# uma vez por segundo e grava um CSV fora do repositorio. No fim, le o
# `metrics.json` do harness visual (getMetrics real) quando o cenario B/C o
# gerou.
#
# CPU: delta de TotalProcessorTime entre amostras, dividido pelo tempo de
# parede. `avgCpuPercent` e a leitura de um nucleo (soma da arvore);
# `avgCpuPercentOfMachine` divide pelo numero de nucleos, que e a leitura
# comparavel ao Gerenciador de Tarefas e as metas do README (1% e 2%).
#
# RAM: WorkingSet64 do processo principal + renderers (`--type=renderer`) da
# arvore. A carga do sistema (Win32_Processor.LoadPercentage) e amostrada para
# o relatorio saber se a maquina estava ocupada.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf/measure-absolem.ps1 `
#     -Scenario B -Seconds 60 -OutFile C:\Temp\absolem-perf-b.csv
#
# Exemplo C:
#   ... -Scenario C -Seconds 60 -OutFile C:\Temp\absolem-perf-c.csv

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('A', 'B', 'C')]
  [string]$Scenario,

  [int]$Seconds = 60,

  [Parameter(Mandatory = $true)]
  [string]$OutFile,

  [string]$Label = '',

  [string]$AppRoot = '',

  [string]$ElectronPath = '',

  [string]$VisualBase = '',

  [int]$WarmupSeconds = 12,

  [switch]$NoLaunch,

  [int]$RootPid = 0
)

$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture

if ($Seconds -lt 1) { throw 'Seconds precisa ser >= 1.' }
if ($WarmupSeconds -lt 0) { throw 'WarmupSeconds nao pode ser negativo.' }

function Format-Num([double]$value, [int]$decimals) {
  if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return '0' }
  return $value.ToString('F' + $decimals, $inv)
}

function Get-Average([double[]]$values) {
  if ($null -eq $values -or $values.Count -eq 0) { return 0 }
  $sum = 0.0
  foreach ($value in $values) { $sum += [double]$value }
  return $sum / $values.Count
}

function Get-P95([double[]]$values) {
  if ($null -eq $values -or $values.Count -eq 0) { return 0 }
  $sorted = @($values | Sort-Object)
  $index = [int][Math]::Ceiling(0.95 * $sorted.Count) - 1
  if ($index -lt 0) { $index = 0 }
  if ($index -ge $sorted.Count) { $index = $sorted.Count - 1 }
  return [double]$sorted[$index]
}

function Get-SystemLoad {
  try {
    $values = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue |
      ForEach-Object { [double]$_.LoadPercentage })
    if ($values.Count -eq 0) { return $null }
    return Get-Average $values.ToArray()
  } catch {
    return $null
  }
}

function Get-MachineInfo {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
  $cpu = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue)
  $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
  $cpuName = if ($cpu.Count -gt 0) { [string]$cpu[0].Name } else { 'desconhecido' }
  $ramMb = if ($os) { [double]$os.TotalVisibleMemorySize / 1024.0 } else { 0 }
  return [PSCustomObject]@{
    Os = if ($os) { [string]$os.Caption } else { 'desconhecido' }
    OsVersion = if ($os) { [string]$os.Version } else { '' }
    Cpu = $cpuName.Trim()
    Cores = [Environment]::ProcessorCount
    Machine = if ($cs) { [string]$cs.Model } else { 'desconhecido' }
    RamMb = $ramMb
  }
}

# Arvore viva do PID raiz, com o mapa de Win32_Process para identificar renderer.
function Get-ProcessTree([int]$root) {
  $map = @{}
  foreach ($item in (Get-CimInstance -ClassName Win32_Process)) {
    $map[[int]$item.ProcessId] = $item
  }
  $children = @{}
  foreach ($item in $map.Values) {
    $parent = [int]$item.ParentProcessId
    if (-not $children.ContainsKey($parent)) {
      $children[$parent] = New-Object System.Collections.Generic.List[int]
    }
    $children[$parent].Add([int]$item.ProcessId)
  }
  $result = New-Object System.Collections.Generic.List[int]
  $queue = New-Object System.Collections.Queue
  $seen = @{}
  $queue.Enqueue($root)
  $seen[$root] = $true
  while ($queue.Count -gt 0) {
    $current = [int]$queue.Dequeue()
    $result.Add($current)
    if ($children.ContainsKey($current)) {
      foreach ($child in $children[$current]) {
        if (-not $seen.ContainsKey($child)) {
          $seen[$child] = $true
          $queue.Enqueue($child)
        }
      }
    }
  }
  $processes = @(Get-Process -Id @($result) -ErrorAction SilentlyContinue)
  return [PSCustomObject]@{ Map = $map; Pids = $result; Processes = $processes }
}

function Test-IsRenderer($item) {
  if ($null -eq $item) { return $false }
  $line = [string]$item.CommandLine
  return $line -match '--type=renderer'
}

function Get-ProcessKind($item) {
  if ($null -eq $item) { return 'other' }
  $line = [string]$item.CommandLine
  if ($line -match '--type=renderer') { return 'renderer' }
  if ($line -match '--type=gpu-process') { return 'gpu' }
  if ($line -match '--type=utility') { return 'utility' }
  return 'other'
}

function Stop-ProcessTree([int]$processId) {
  if ($processId -le 0) { return }
  try {
    & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
  } catch {
    # Processo ja saiu.
  }
}

$appRootResolved = if ($AppRoot) { (Resolve-Path -LiteralPath $AppRoot).Path } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
$electronResolved = if ($ElectronPath) {
  (Resolve-Path -LiteralPath $ElectronPath).Path
} else {
  (Resolve-Path (Join-Path $appRootResolved 'node_modules\electron\dist\electron.exe')).Path
}

$outFull = [IO.Path]::GetFullPath($OutFile)
$outDir = Split-Path -Parent $outFull
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$machine = Get-MachineInfo
$scenarioLabel = if ($Label) { $Label } else { "scenario-$Scenario" }
$userData = Join-Path ([IO.Path]::GetTempPath()) ('absolem-perf-userdata-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $userData -Force | Out-Null
Set-Content -LiteralPath (Join-Path $userData 'first-run-complete.flag') -Value '1' -Encoding ASCII

$visualDir = ''
$proc = $null
$rootPidValue = $RootPid

if (-not $NoLaunch) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $electronResolved
  $psi.Arguments = '.'
  $psi.WorkingDirectory = $appRootResolved
  $psi.UseShellExecute = $false
  $psi.EnvironmentVariables['ABSOLEM_TEST_USERDATA'] = $userData
  $psi.EnvironmentVariables['ABSOLEM_TEST_TRANSPORT'] = 'fake'
  if ($Scenario -ne 'A') {
    $visualBaseDir = if ($VisualBase) {
      [IO.Path]::GetFullPath($VisualBase)
    } else {
      Join-Path ([IO.Path]::GetTempPath()) 'absolem-perf-visual'
    }
    $visualDir = Join-Path $visualBaseDir ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $visualDir -Force | Out-Null
    $state = if ($Scenario -eq 'C') { 'speaking' } else { 'idle' }
    $holdMs = ($Seconds + $WarmupSeconds + 45) * 1000
    $psi.EnvironmentVariables['ABSOLEM_VISUAL_DIR'] = $visualDir
    $psi.EnvironmentVariables['ABSOLEM_VISUAL_STATES'] = $state
    $psi.EnvironmentVariables['ABSOLEM_VISUAL_SIZES'] = '320x360'
    $psi.EnvironmentVariables['ABSOLEM_VISUAL_LOOK'] = 'storybook'
    $psi.EnvironmentVariables['ABSOLEM_VISUAL_HOLD_MS'] = [string]$holdMs
    if ($Scenario -eq 'C') {
      $psi.EnvironmentVariables['ABSOLEM_VISUAL_FAKE_VOICE'] = '1'
    }
  }

  $proc = [System.Diagnostics.Process]::Start($psi)
  $rootPidValue = $proc.Id
  if ($rootPidValue -le 0) { throw 'Falha ao iniciar o Electron.' }
}

try {
  if ($rootPidValue -le 0) { throw 'RootPid precisa ser > 0 quando -NoLaunch e usado.' }
  $rootProcess = Get-Process -Id $rootPidValue -ErrorAction SilentlyContinue
  if ($null -eq $rootProcess) { throw "PID raiz $rootPidValue nao encontrado." }

  if ($WarmupSeconds -gt 0) {
    Write-Output ("[perf] aquecendo {0}s (pid {1}, cenario {2})..." -f $WarmupSeconds, $rootPidValue, $Scenario)
    Start-Sleep -Seconds $WarmupSeconds
  }

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('timestamp,pid,name,kind,cpuPercent,workingsetMb,privateMb')

  $first = Get-ProcessTree -root $rootPidValue
  $previousTotals = @{}
  foreach ($p in $first.Processes) {
    try { $previousTotals[[int]$p.Id] = [double]$p.TotalProcessorTime.TotalSeconds } catch { }
  }
  $previousStamp = [DateTime]::UtcNow
  $nextAt = $previousStamp.AddSeconds(1)

  $sampleCpu = New-Object System.Collections.Generic.List[double]
  $sampleCpuMachine = New-Object System.Collections.Generic.List[double]
  $sampleMainWs = New-Object System.Collections.Generic.List[double]
  $sampleRendererWs = New-Object System.Collections.Generic.List[double]
  $sampleTotalWs = New-Object System.Collections.Generic.List[double]
  $sampleLoad = New-Object System.Collections.Generic.List[double]
  $rendererCounts = New-Object System.Collections.Generic.List[int]
  $rendererSeen = 0

  $cores = [Environment]::ProcessorCount
  for ($tick = 1; $tick -le $Seconds; $tick++) {
    $waitMs = ($nextAt - [DateTime]::UtcNow).TotalMilliseconds
    if ($waitMs -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Round($waitMs)) }
    $stamp = [DateTime]::UtcNow
    $nextAt = $nextAt.AddSeconds(1)
    if ($nextAt -lt $stamp) { $nextAt = $stamp.AddSeconds(1) }
    $elapsed = ($stamp - $previousStamp).TotalSeconds
    if ($elapsed -le 0) { $elapsed = 1 }
    $snapshot = Get-ProcessTree -root $rootPidValue

    $totalCpu = 0.0
    $mainWs = 0.0
    $rendererWs = 0.0
    $totalWs = 0.0
    $rendererCount = 0
    $nextTotals = @{}
    $stampText = $stamp.ToString('yyyy-MM-ddTHH:mm:ss.fff', $inv)

    foreach ($p in $snapshot.Processes) {
      $pidValue = [int]$p.Id
      $item = if ($snapshot.Map.ContainsKey($pidValue)) { $snapshot.Map[$pidValue] } else { $null }
      $kind = if ($pidValue -eq $rootPidValue) { 'main' } else { Get-ProcessKind $item }
      if ($kind -eq 'renderer') {
        $rendererCount += 1
        $rendererSeen += 1
      }

      $cpu = 0.0
      $totalCpuSeconds = $null
      try { $totalCpuSeconds = [double]$p.TotalProcessorTime.TotalSeconds } catch { }
      if ($null -ne $totalCpuSeconds) {
        if ($previousTotals.ContainsKey($pidValue)) {
          $delta = $totalCpuSeconds - [double]$previousTotals[$pidValue]
          if ($delta -lt 0) { $delta = 0 }
        } else {
          $delta = $totalCpuSeconds
        }
        $cpu = ($delta / $elapsed) * 100.0
        $nextTotals[$pidValue] = $totalCpuSeconds
      }

      $ws = [double]$p.WorkingSet64 / 1MB
      $privateMb = [double]$p.PrivateMemorySize64 / 1MB
      if ($kind -eq 'main') { $mainWs += $ws }
      if ($kind -eq 'renderer') { $rendererWs += $ws }
      $totalCpu += $cpu
      $totalWs += $ws

      $lines.Add((
        $stampText + ',' + $pidValue + ',' + $p.ProcessName + ',' + $kind + ',' +
        (Format-Num $cpu 2) + ',' + (Format-Num $ws 2) + ',' + (Format-Num $privateMb 2)
      ))
    }

    $machineCpu = if ($cores -gt 0) { $totalCpu / $cores } else { 0 }
    $lines.Add((
      $stampText + ',0,TOTAL,tree,' + (Format-Num $totalCpu 2) + ',' +
      (Format-Num $totalWs 2) + ',0'
    ))

    $sampleCpu.Add($totalCpu)
    $sampleCpuMachine.Add($machineCpu)
    $sampleMainWs.Add($mainWs)
    $sampleRendererWs.Add($rendererWs)
    $sampleTotalWs.Add($totalWs)
    $rendererCounts.Add($rendererCount)

    if (($tick % 10) -eq 1 -or $tick -eq $Seconds) {
      $load = Get-SystemLoad
      if ($null -ne $load) { $sampleLoad.Add([double]$load) }
    }

    $previousTotals = $nextTotals
    $previousStamp = $stamp
  }

  $startedAt = $previousStamp.AddSeconds(-$Seconds).ToString('o', $inv)
  $summary = '#SUMMARY' +
    ',scenario=' + $Scenario +
    ',label=' + ($scenarioLabel -replace '[,\r\n]', ' ') +
    ',seconds=' + $Seconds +
    ',samples=' + $sampleCpu.Count +
    ',cores=' + $cores +
    ',rootPid=' + $rootPidValue +
    ',avgCpuPercent=' + (Format-Num (Get-Average $sampleCpu.ToArray()) 2) +
    ',avgCpuPercentOfMachine=' + (Format-Num (Get-Average $sampleCpuMachine.ToArray()) 2) +
    ',p95CpuPercentOfMachine=' + (Format-Num (Get-P95 $sampleCpuMachine.ToArray()) 2) +
    ',avgMainWorkingSetMb=' + (Format-Num (Get-Average $sampleMainWs.ToArray()) 2) +
    ',avgRendererWorkingSetMb=' + (Format-Num (Get-Average $sampleRendererWs.ToArray()) 2) +
    ',p95RendererWorkingSetMb=' + (Format-Num (Get-P95 $sampleRendererWs.ToArray()) 2) +
    ',avgTotalWorkingSetMb=' + (Format-Num (Get-Average $sampleTotalWs.ToArray()) 2) +
    ',maxTotalWorkingSetMb=' + (Format-Num ([double](($sampleTotalWs.ToArray() | Measure-Object -Maximum).Maximum)) 2) +
    ',avgRenderers=' + (Format-Num (Get-Average ($rendererCounts.ToArray() | ForEach-Object { [double]$_ })) 2) +
    ',rendererSamples=' + $rendererSeen +
    ',avgSystemLoadPercent=' + (Format-Num (Get-Average $sampleLoad.ToArray()) 2) +
    ',maxSystemLoadPercent=' + (Format-Num ([double](($sampleLoad.ToArray() | Measure-Object -Maximum).Maximum)) 2) +
    ',machine=' + ($machine.Machine -replace '[,\r\n]', ' ') +
    ',cpu=' + ($machine.Cpu -replace '[,\r\n]', ' ') +
    ',ramMb=' + (Format-Num $machine.RamMb 0) +
    ',os=' + ($machine.Os -replace '[,\r\n]', ' ') +
    ',startedAt=' + $startedAt +
    ',finishedAt=' + ([DateTime]::UtcNow.ToString('o', $inv))

  $lines.Add($summary)
  [IO.File]::WriteAllText($outFull, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  Write-Output $summary

  if ($visualDir) {
    # O harness grava metrics.json no fim do hold; esperar o quit evita ler um
    # arquivo antigo/inexistente.
    if ($proc -and -not $proc.HasExited) {
      Write-Output '[perf] aguardando o fim do hold para ler metrics.json...'
      try { $proc.WaitForExit(120000) | Out-Null } catch { }
    }
    $metricsPath = Join-Path $visualDir 'metrics.json'
    if (Test-Path -LiteralPath $metricsPath) {
      try {
        $report = Get-Content -LiteralPath $metricsPath -Raw | ConvertFrom-Json
        if ($report.finalMetrics) {
          $m = $report.finalMetrics
          Write-Output ("[perf] getMetrics final: fps={0} frameMs={1} drawCalls={2} triangles={3} degradation={4}" -f `
            $m.fps, $m.frameMs, $m.drawCalls, $m.triangles, $m.degradation)
        }
        if ($report.captures) {
          foreach ($entry in $report.captures) {
            if ($entry.metrics) {
              $m = $entry.metrics
              Write-Output ("[perf] getMetrics {0}: fps={1} frameMs={2} drawCalls={3} triangles={4} degradation={5}" -f `
                $entry.file, $m.fps, $m.frameMs, $m.drawCalls, $m.triangles, $m.degradation)
            }
          }
        }
      } catch {
        Write-Warning ("metrics.json ilegivel: {0}" -f $_.Exception.Message)
      }
    }
  }

  Write-Output ("[perf] CSV: {0}" -f $outFull)
  if ($visualDir) { Write-Output ("[perf] capturas/metricas: {0}" -f $visualDir) }
} finally {
  if ($proc -and -not $proc.HasExited -and $visualDir) {
    # O harness visual grava metrics.json no fim do hold e pede o quit.
    try { $proc.WaitForExit(60000) | Out-Null } catch { }
  }
  if ($rootPidValue -gt 0) {
    $alive = Get-Process -Id $rootPidValue -ErrorAction SilentlyContinue
    if ($null -ne $alive) { Stop-ProcessTree $rootPidValue }
  }
  try { Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
