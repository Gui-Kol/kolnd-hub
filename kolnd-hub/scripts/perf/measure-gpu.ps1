# measure-gpu.ps1 -- mede uso da GPU 3D (contador de GPU do Windows) por um periodo.
#
# Por que existe (task 07): reduzir custo de composicao (backdrop-filter, etc.)
# so vale a pena se o contador de GPU 3D do Windows confirmar queda. Medimos o
# MESMO contador que o Hub ja le (src/main/hwmon/nativeSensors.ts +
# cimScripts.ts): Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine,
# instancias que terminam em _engtype_3D$, campo UtilizationPercentage. Esta
# classe CIM e independente de idioma (o contador de desempenho localizado
# quebraria em pt-BR).
#
# Agregacao por amostra (mesma regra do Gerenciador de Tarefas / do Hub):
# somar UtilizationPercentage das instancias _engtype_3D por adaptador (LUID),
# escolher o adaptador PRIMARIO (maior memoria dedicada+compartilhada em
# Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory; um adaptador
# virtual como Parsec tem 0 e nao zera a leitura) e saturar em [0,100]. Sem
# match do LUID primario, usa o MAIOR entre adaptadores. Apenas motores 3D
# contam -- Copy/VideoDecode/etc nao sao "uso de GPU" para esta medida.
#
# Amostra 1x por segundo de PAREDE (alinhado ao relogio, como measure-process).
# A classe Win32_PerfFormattedData_* se atualiza ~1x/s; -Seconds e tempo de
# parede. Amostras que nao conseguem ser lidas (classe ausente, consulta
# falhou, zero instancias _engtype_3D) NAO sao inventadas: contam separado em
# `unreadableSamples` e sao EXCLUIDAS da media/p95. Se NENHUMA amostra for
# legivel, a saida diz measurement=unavailable e nenhum numero e inventado.
#
# Saida: linha de resumo #SUMMARY,... com label, adaptador(es), samples,
# unreadableSamples, avgGpu3dPercent, p95Gpu3dPercent, maxGpu3dPercent,
# minGpu3dPercent; opcionalmente um CSV por amostra em -OutFile.
#
# Numeros sempre em cultura invariante (este Windows esta em pt-BR; uma virgula
# decimal quebraria o CSV). Script ASCII puro. Sem dependencia nova: so
# PowerShell nativo (Windows PowerShell 5.1 ou PowerShell 7+).
#
# Este script produz UMA execucao por estado. Para reduzir ruido, rode 3x por
# estado e use a MEDIANA externamente (task 07 pede 3 repeticoes; ver
# gerente/tasks/otimizacao-recursos/07-gpu/). Nada e fabricado: se o contador
# nao existir/nao puder ser medido nesta maquina, e reportado como tal.
#
# Exemplo:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\perf\measure-gpu.ps1 `
#     -Seconds 30 -Label antes-hud-on -OutFile .\out\perf\gpu-antes-hud-1.csv

[CmdletBinding()]
param(
  [int]$Seconds = 30,
  [string]$Label = 'unnamed',
  [string]$OutFile = ''
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

function Get-Max([double[]]$values) {
  if ($null -eq $values -or $values.Count -eq 0) { return 0 }
  return [double](($values | Measure-Object -Maximum).Maximum)
}

function Get-Min([double[]]$values) {
  if ($null -eq $values -or $values.Count -eq 0) { return 0 }
  return [double](($values | Measure-Object -Minimum).Minimum)
}

# LUID do adaptador a partir do nome da instancia GPU Engine
# (...luid_0xXXXX_0xXXXX_phys_...), como em cimScripts.ts.
function Get-Luid([string]$name) {
  $parts = $name -split '_'
  if ($parts.Count -ge 5) { return ($parts[3] + '_' + $parts[4]) }
  return 'unknown'
}

# Adaptador primario = maior memoria dedicada + compartilhada (GPUAdapterMemory).
function Get-PrimaryLuid {
  try {
    $mem = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue)
  } catch {
    $mem = @()
  }
  if ($null -eq $mem -or $mem.Count -eq 0) { return $null }
  $best = $null
  $bestScore = -1.0
  foreach ($row in $mem) {
    $name = [string]$row.Name
    $dedicated = 0.0
    $shared = 0.0
    if ($row.PSObject.Properties.Match('DedicatedUsage').Count -gt 0 -and $null -ne $row.DedicatedUsage) { $dedicated = [double]$row.DedicatedUsage }
    if ($row.PSObject.Properties.Match('SharedUsage').Count -gt 0 -and $null -ne $row.SharedUsage) { $shared = [double]$row.SharedUsage }
    $score = $dedicated + $shared
    # nome de GPUAdapterMemory: "luid_0xXXXX_0xXXXX_phys_0" -> LUID = p[1]_p[2]
    $parts = $name -split '_'
    $luid = $null
    if ($parts.Count -ge 3 -and $parts[0] -eq 'luid') { $luid = $parts[1] + '_' + $parts[2] }
    if ($null -ne $luid -and $score -gt $bestScore) {
      $bestScore = $score
      $best = $luid
    }
  }
  return $best
}

# Uma amostra: soma UtilizationPercentage das instancias _engtype_3D por LUID.
# Devolve $null se a consulta falhar ou nao houver NENHUMA instancia _engtype_3D
# (nao inventa numero). Caso contrario devolve hashtable luid->percentSum.
function Get-Gpu3dSample {
  try {
    $eng = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop |
      Where-Object { $_.Name -match '_engtype_3D$' })
  } catch {
    return $null
  }
  if ($eng.Count -eq 0) { return $null }
  $sums = @{}
  foreach ($e in $eng) {
    $luid = Get-Luid ([string]$e.Name)
    $value = 0.0
    if ($null -ne $e.UtilizationPercentage) { $value = [double]$e.UtilizationPercentage }
    if ($sums.ContainsKey($luid)) { $sums[$luid] = $sums[$luid] + $value } else { $sums[$luid] = $value }
  }
  return $sums
}

if ($Seconds -lt 1) { throw 'Seconds precisa ser >= 1.' }

# --- adaptadores (Win32_VideoController), so leitura, sem elevacao ------------
$adapters = @()
try {
  $adapters = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
    ForEach-Object {
      [pscustomobject]@{
        name          = [string]$_.Name
        driverVersion = [string]$_.DriverVersion
        pnpDeviceId   = [string]$_.PNPDeviceID
      }
    })
} catch {
  $adapters = @()
}
$adapterNames = @()
foreach ($a in $adapters) { if ($a.name) { $adapterNames += $a.name } }
$adapterList = if ($adapterNames.Count -gt 0) { ($adapterNames -join '; ') } else { 'unknown' }
$adapterListSafe = $adapterList -replace '[,\r\n]', ' '

$primaryLuid = Get-PrimaryLuid

if ($OutFile) {
  $outDir = Split-Path -Parent $OutFile
  if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  }
}

$labelSafe = ($Label -replace '[,\r\n]', ' ')
$sampleLines = New-Object System.Collections.Generic.List[string]
$sampleLines.Add('timestamp,gpu3dPercent,luidUsed,adapter')
$samples = New-Object System.Collections.Generic.List[double]
$unreadable = 0

# Cadencia 1 Hz alinhada ao relogio (a consulta CIM custa ~100-300 ms).
$startedAt = [DateTime]::UtcNow
$nextAt = $startedAt

for ($tick = 1; $tick -le $Seconds; $tick++) {
  $waitMs = ($nextAt - [DateTime]::UtcNow).TotalMilliseconds
  if ($waitMs -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Round($waitMs)) }
  $stamp = [DateTime]::UtcNow
  $nextAt = $nextAt.AddSeconds(1)
  if ($nextAt -lt $stamp) { $nextAt = $stamp.AddSeconds(1) }

  $sums = Get-Gpu3dSample
  if ($null -eq $sums -or $sums.Count -eq 0) {
    $unreadable += 1
    $sampleLines.Add(($stamp.ToString('yyyy-MM-ddTHH:mm:ss.fff', $inv) + ',,,unreadable'))
    continue
  }

  # Uso da GPU 3D: adaptador primario; sem match, o MAIOR entre adaptadores.
  $luidUsed = 'unknown'
  $percent = 0.0
  if ($null -ne $primaryLuid -and $sums.ContainsKey($primaryLuid)) {
    $luidUsed = $primaryLuid
    $percent = [double]$sums[$primaryLuid]
  } else {
    $maxValue = -1.0
    foreach ($key in $sums.Keys) {
      if ([double]$sums[$key] -gt $maxValue) { $maxValue = [double]$sums[$key]; $luidUsed = [string]$key }
    }
    if ($maxValue -lt 0) { $maxValue = 0.0 }
    $percent = $maxValue
  }
  if ([double]::IsNaN($percent) -or [double]::IsInfinity($percent)) { $percent = 0.0 }
  if ($percent -lt 0) { $percent = 0.0 }
  if ($percent -gt 100) { $percent = 100.0 }

  $samples.Add($percent)
  $sampleLines.Add((
    $stamp.ToString('yyyy-MM-ddTHH:mm:ss.fff', $inv) + ',' +
    (Format-Num $percent 2) + ',' + $luidUsed + ',' + $adapterListSafe
  ))
}

$arr = $samples.ToArray()
$measurement = if ($arr.Count -gt 0) { 'ok' } else { 'unavailable' }

if ($OutFile) {
  [IO.File]::WriteAllText($OutFile, (($sampleLines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
}

$summary = '#SUMMARY' +
  ',label=' + $labelSafe +
  ',measurement=' + $measurement +
  ',seconds=' + $Seconds +
  ',samples=' + $arr.Count +
  ',unreadableSamples=' + $unreadable +
  ',adapter=' + $adapterListSafe +
  ',primaryLuid=' + $(if ($null -ne $primaryLuid) { $primaryLuid } else { 'unknown' }) +
  ',avgGpu3dPercent=' + (Format-Num (Get-Average $arr) 2) +
  ',p95Gpu3dPercent=' + (Format-Num (Get-P95 $arr) 2) +
  ',maxGpu3dPercent=' + (Format-Num (Get-Max $arr) 2) +
  ',minGpu3dPercent=' + (Format-Num (Get-Min $arr) 2) +
  ',finishedAt=' + ([DateTime]::UtcNow.ToString('o', $inv))

if ($OutFile) {
  [IO.File]::AppendAllText($OutFile, ($summary + "`r`n"), (New-Object Text.UTF8Encoding($false)))
}

Write-Output ('# measure-gpu: adapter=' + $adapterListSafe)
Write-Output ('# measure-gpu: measurement=' + $measurement + ' samples=' + $arr.Count + ' unreadable=' + $unreadable)
if ($measurement -eq 'unavailable') {
  Write-Output '# measure-gpu: contador GPUEngine _engtype_3D indisponivel ou sem instancias legiveis; nenhum numero inventado.'
}
Write-Output $summary
