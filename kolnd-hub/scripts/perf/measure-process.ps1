# measure-process.ps1 -- mede CPU e RAM da ARVORE de processos do Hub.
#
# Por que existe: o Hub cria processos filhos (renderer, GPU, utility, e um
# powershell.exe por tick do hwmon). Medir so o processo raiz esconde a maior
# parte do custo. Aqui resolvemos a arvore pelo mapa ParentProcessId do
# Win32_Process e amostramos 1x por segundo.
#
# CPU: delta de TotalProcessorTime entre amostras (robusto, nao depende de
# contadores localizados como "\Process(*)\% Processor Time"). Para um PID que
# apareceu DEPOIS da amostra anterior, o TotalProcessorTime inteiro e atribuido
# ao intervalo -- e o unico jeito de nao perder processos curtos (powershell de
# CIM/NVML vive menos que 1 s).
#
# RAM: WorkingSet64 e PrivateMemorySize64 via Get-Process.
#
# Saida: CSV com cabecalho timestamp,pid,name,cpuPercent,workingsetMb,privateMb
# (uma linha por processo + uma linha pid=0/name=TOTAL por amostra) e, no fim,
# uma linha de resumo #SUMMARY,... com media/p95 do conjunto.
#
# Numeros sempre em cultura invariante: este Windows esta em pt-BR e uma virgula
# decimal quebraria o CSV.
#
# Exemplo:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\perf\measure-process.ps1 `
#     -RootPid 1234 -Seconds 60 -OutFile .\out\perf\b1.csv -Label b1-dashboard

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [int]$Seconds = 60,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Label = 'unnamed'
)

$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture

function Format-Num([double]$value, [int]$decimals) {
  if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return '0' }
  return $value.ToString('F' + $decimals, $inv)
}

function Get-P95([double[]]$values) {
  if ($null -eq $values -or $values.Count -eq 0) { return 0 }
  $sorted = @($values | Sort-Object)
  $index = [int][Math]::Ceiling(0.95 * $sorted.Count) - 1
  if ($index -lt 0) { $index = 0 }
  if ($index -ge $sorted.Count) { $index = $sorted.Count - 1 }
  return [double]$sorted[$index]
}

function Get-Average([double[]]$values) {
  if ($null -eq $values -or $values.Count -eq 0) { return 0 }
  $sum = 0.0
  foreach ($value in $values) { $sum += [double]$value }
  return $sum / $values.Count
}

# Uma leitura de Win32_Process + resolucao recursiva dos descendentes do PID raiz.
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

if ($Seconds -lt 1) { throw 'Seconds precisa ser >= 1.' }
$cores = [Environment]::ProcessorCount

$target = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
if ($null -eq $target) { throw "PID raiz $RootPid nao encontrado." }

$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('timestamp,pid,name,cpuPercent,workingsetMb,privateMb')

# Amostra zero: apenas baseline dos tempos acumulados (sem linha no CSV).
$first = Get-ProcessTree -root $RootPid
$previousTotals = @{}
foreach ($proc in $first.Processes) {
  try {
    $previousTotals[[int]$proc.Id] = [double]$proc.TotalProcessorTime.TotalSeconds
  } catch {
    # Processo protegido/saindo: fica fora do baseline, entra como "novo".
  }
}
$previousStamp = [DateTime]::UtcNow

$sampleCpu = New-Object System.Collections.Generic.List[double]
$sampleWorkingSet = New-Object System.Collections.Generic.List[double]
$samplePrivate = New-Object System.Collections.Generic.List[double]

# `-Seconds` e tempo de PAREDE: alinhamos cada amostra ao relogio. A consulta
# CIM custa ~100 ms; sem alinhar, 60 amostras levariam ~66 s.
$nextAt = $previousStamp.AddSeconds(1)

for ($tick = 1; $tick -le $Seconds; $tick++) {
  $waitMs = ($nextAt - [DateTime]::UtcNow).TotalMilliseconds
  if ($waitMs -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Round($waitMs)) }
  $stamp = [DateTime]::UtcNow
  $nextAt = $nextAt.AddSeconds(1)
  if ($nextAt -lt $stamp) { $nextAt = $stamp.AddSeconds(1) }
  $elapsed = ($stamp - $previousStamp).TotalSeconds
  if ($elapsed -le 0) { $elapsed = 1 }
  $snapshot = Get-ProcessTree -root $RootPid

  $totalCpu = 0.0
  $totalWorkingSet = 0.0
  $totalPrivate = 0.0
  $nextTotals = @{}
  $stampText = $stamp.ToString('yyyy-MM-ddTHH:mm:ss.fff', $inv)

  foreach ($proc in $snapshot.Processes) {
    $pidValue = [int]$proc.Id
    $cpu = 0.0
    $totalCpuSeconds = $null
    try { $totalCpuSeconds = [double]$proc.TotalProcessorTime.TotalSeconds } catch { }
    if ($null -ne $totalCpuSeconds) {
      if ($previousTotals.ContainsKey($pidValue)) {
        $delta = $totalCpuSeconds - [double]$previousTotals[$pidValue]
        if ($delta -lt 0) { $delta = 0 }
      } else {
        # PID novo no intervalo: TODO o CPU acumulado dele pertence a este tick.
        $delta = $totalCpuSeconds
      }
      $cpu = ($delta / $elapsed) * 100.0
      $nextTotals[$pidValue] = $totalCpuSeconds
    }

    $workingSetMb = [double]$proc.WorkingSet64 / 1MB
    $privateMb = [double]$proc.PrivateMemorySize64 / 1MB
    $totalCpu += $cpu
    $totalWorkingSet += $workingSetMb
    $totalPrivate += $privateMb

    $lines.Add((
      $stampText + ',' +
      $pidValue + ',' +
      $proc.ProcessName + ',' +
      (Format-Num $cpu 2) + ',' +
      (Format-Num $workingSetMb 2) + ',' +
      (Format-Num $privateMb 2)
    ))
  }

  $lines.Add((
    $stampText + ',0,TOTAL,' +
    (Format-Num $totalCpu 2) + ',' +
    (Format-Num $totalWorkingSet 2) + ',' +
    (Format-Num $totalPrivate 2)
  ))

  $sampleCpu.Add($totalCpu)
  $sampleWorkingSet.Add($totalWorkingSet)
  $samplePrivate.Add($totalPrivate)

  $previousTotals = $nextTotals
  $previousStamp = $stamp
}

$cpuArray = $sampleCpu.ToArray()
$workingSetArray = $sampleWorkingSet.ToArray()
$privateArray = $samplePrivate.ToArray()
$avgCpu = Get-Average $cpuArray
$cpuOfMachine = if ($cores -gt 0) { $avgCpu / $cores } else { 0 }
$labelSafe = ($Label -replace '[,\r\n]', ' ')

$summary = '#SUMMARY,label=' + $labelSafe +
  ',seconds=' + $Seconds +
  ',samples=' + $cpuArray.Count +
  ',cores=' + $cores +
  ',rootPid=' + $RootPid +
  ',avgCpuPercent=' + (Format-Num $avgCpu 2) +
  ',p95CpuPercent=' + (Format-Num (Get-P95 $cpuArray) 2) +
  ',maxCpuPercent=' + (Format-Num ([double](($cpuArray | Measure-Object -Maximum).Maximum)) 2) +
  ',avgCpuPercentOfMachine=' + (Format-Num $cpuOfMachine 2) +
  ',avgWorkingSetMb=' + (Format-Num (Get-Average $workingSetArray) 2) +
  ',p95WorkingSetMb=' + (Format-Num (Get-P95 $workingSetArray) 2) +
  ',avgPrivateMb=' + (Format-Num (Get-Average $privateArray) 2) +
  ',p95PrivateMb=' + (Format-Num (Get-P95 $privateArray) 2) +
  ',finishedAt=' + ([DateTime]::UtcNow.ToString('o', $inv))

$lines.Add($summary)
[IO.File]::WriteAllText($OutFile, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
Write-Output $summary
