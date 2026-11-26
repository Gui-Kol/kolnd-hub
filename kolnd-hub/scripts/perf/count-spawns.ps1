# count-spawns.ps1 -- conta PIDs NOVOS por nome de processo num periodo.
#
# Por que existe: o ofensor #1 do Hub (A1/A3) e o hwmon criando processes
# (powershell.exe para CIM/NVML, nvidia-smi) a cada tick. Medir CPU/RAM nao
# mostra a CHURN de processos; este script mostra.
#
# Metodo: amostra Win32_Process a cada 100 ms. A primeira amostra e a linha de
# base (PIDs ja existentes nao contam); cada PID que aparece depois conta uma
# vez, mesmo que o processo morra antes da proxima amostra. Com jogos/apps
# abrindo no mesmo periodo, use -RootPid para contar so descendentes do Hub.
#
# Saida: CSV name,spawns,spawnsPerMinute + linha TOTAL, com eventos
# #SPAWN,timestamp,name,pid (comentario) para depuracao.
#
# Exemplo:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\perf\count-spawns.ps1 `
#     -RootPid 1234 -Seconds 60 -OutFile .\out\perf\b1-spawns.csv

[CmdletBinding()]
param(
  [int]$Seconds = 60,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string[]]$Names = @('powershell', 'nvidia-smi', 'winget', 'msiexec', 'node'),
  [int]$RootPid = 0
)

$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture

if ($Seconds -lt 1) { throw 'Seconds precisa ser >= 1.' }

# Nomes normalizados: sem .exe, minusculos (Win32_Process.Name vem com .exe).
# `-File` no PowerShell 5.1 trata virgula como separador de POSICIONAIS: aceitar
# tanto `-Names "a,b"` (um token) quanto uma lista ja separada pelo chamador.
$wanted = @{}
foreach ($name in $Names) {
  foreach ($part in ([string]$name).Split(',')) {
    $clean = $part.Trim().ToLowerInvariant()
    if ($clean.EndsWith('.exe')) { $clean = $clean.Substring(0, $clean.Length - 4) }
    if ($clean) { $wanted[$clean] = $true }
  }
}

$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$known = @{}
$counts = @{}
foreach ($name in $wanted.Keys) { $counts[$name] = 0 }
$events = New-Object System.Collections.Generic.List[string]

function Test-Descendant([int]$pidValue, [int]$root, [hashtable]$map) {
  if ($root -le 0) { return $true }
  $current = $pidValue
  $guard = 0
  while ($current -gt 0 -and $guard -lt 64) {
    if ($current -eq $root) { return $true }
    if (-not $map.ContainsKey($current)) { return $false }
    $current = [int]$map[$current].ParentProcessId
    $guard += 1
  }
  return $false
}

$startedAt = [DateTime]::UtcNow
$firstSample = $true
# Cadencia alvo de 100 ms ALINHADA ao relogio: a consulta CIM custa ~100 ms
# nesta maquina (ver gerente/memory.md), entao sem alinhar o periodo real
# dobraria e `-Seconds` mediria o dobro do pedido.
$nextAt = $startedAt

while (([DateTime]::UtcNow - $startedAt).TotalSeconds -lt $Seconds) {
  $map = @{}
  foreach ($item in (Get-CimInstance -ClassName Win32_Process)) {
    $map[[int]$item.ProcessId] = $item
  }

  $stampText = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fff', $inv)
  foreach ($item in $map.Values) {
    $name = [string]$item.Name
    if ($name.EndsWith('.exe')) { $name = $name.Substring(0, $name.Length - 4) }
    $name = $name.ToLowerInvariant()
    if (-not $wanted.ContainsKey($name)) { continue }
    $pidValue = [int]$item.ProcessId
    if (-not (Test-Descendant -pidValue $pidValue -root $RootPid -map $map)) { continue }
    $key = $name + ':' + $pidValue
    if ($known.ContainsKey($key)) { continue }
    $known[$key] = $true
    if (-not $firstSample) {
      $counts[$name] = [int]$counts[$name] + 1
      $events.Add('#SPAWN,' + $stampText + ',' + $name + ',' + $pidValue)
    }
  }
  $firstSample = $false
  $nextAt = $nextAt.AddMilliseconds(100)
  $remaining = ($nextAt - [DateTime]::UtcNow).TotalMilliseconds
  if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Round($remaining)) }
  if ($nextAt -lt [DateTime]::UtcNow) { $nextAt = [DateTime]::UtcNow }
}

$elapsed = ([DateTime]::UtcNow - $startedAt).TotalSeconds
if ($elapsed -le 0) { $elapsed = 1 }

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('# count-spawns: seconds=' + $Seconds + ', rootPid=' + $RootPid + ', names=' + (($wanted.Keys | Sort-Object) -join '|'))
foreach ($event in $events) { $lines.Add($event) }
$lines.Add('name,spawns,spawnsPerMinute')

$total = 0
foreach ($name in ($wanted.Keys | Sort-Object)) {
  $count = [int]$counts[$name]
  $total += $count
  $perMinute = ($count / $elapsed) * 60.0
  $lines.Add($name + ',' + $count + ',' + $perMinute.ToString('F2', $inv))
}
$lines.Add('TOTAL,' + $total + ',' + ((($total / $elapsed) * 60.0).ToString('F2', $inv)))

[IO.File]::WriteAllText($OutFile, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
Write-Output ('# count-spawns: seconds=' + $Seconds + ', rootPid=' + $RootPid + ', total=' + $total)
