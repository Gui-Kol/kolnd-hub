<#
.SYNOPSIS
    Summarises KLOUD_GAMES_TRACE_LATENCY log output.

.DESCRIPTION
    Reads a KLOUD_GAMES log produced with KLOUD_GAMES_TRACE_LATENCY=1 and prints the p50/p95/p99 of
    the two host-side pipeline stages (capture->encode and encode->queue) plus the total
    (capture->queue). Each "latency_trace window=" line already carries the percentiles of a 5 second
    window, so the run level numbers are the median of those window percentiles, matching the
    aggregation rule of gerente/tasks/Kloud Games Otimizacao/protocolo-medicao.md (field 4).

    Pure PowerShell: no modules, no external executables, no network access. It only reads the log.

.PARAMETER LogPath
    Path to KLOUD_GAMES.log, or to a copy such as exec1-KLOUD_GAMES.log.

.PARAMETER Run
    Label written to the CSV and to the report header. Defaults to the log file base name.

.PARAMETER CsvDirectory
    Directory that receives "<Run>-latency.csv" (long format: run,source,metric,percentile,value_ms).
    Omit to skip the CSV.

.PARAMETER Detailed
    Also print one row per 5 second window instead of only the run level medians.

.EXAMPLE
    .\measure-latency.ps1 -LogPath .\exec1-KLOUD_GAMES.log -Run exec1 -CsvDirectory .\medicoes

.NOTES
    Never reports numbers for a metric that is absent from the log: missing stages are shown as "-".
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$LogPath,

    [string]$Run = '',

    [string]$CsvDirectory = '',

    [switch]$Detailed
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# The log always uses invariant numbers ("0.421"), regardless of the Windows display language.
function ConvertTo-LogDouble {
    param([string]$Text)
    return [double]::Parse($Text, [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-Median {
    param([double[]]$Values)
    $items = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
    if ($items.Count -eq 0) {
        return $null
    }
    $middle = [int][math]::Floor($items.Count / 2)
    if ($items.Count % 2 -eq 1) {
        return [double]$items[$middle]
    }
    return ([double]$items[$middle - 1] + [double]$items[$middle]) / 2.0
}

function Format-Value {
    param($Value, [int]$Digits = 3)
    if ($null -eq $Value) {
        return '-'
    }
    return ([double]$Value).ToString("F$Digits", [System.Globalization.CultureInfo]::InvariantCulture)
}

$windowPattern = 'latency_trace window=(?<window>[0-9.]+)s frames=(?<frames>[0-9]+) fps=(?<fps>[0-9.]+)' +
    ' capture_to_encode_ms\[p50=(?<c2e50>[0-9.]+),p95=(?<c2e95>[0-9.]+),p99=(?<c2e99>[0-9.]+)\]' +
    ' encode_to_queue_ms\[p50=(?<e2q50>[0-9.]+),p95=(?<e2q95>[0-9.]+),p99=(?<e2q99>[0-9.]+)\]' +
    ' capture_to_queue_ms\[p50=(?<c2q50>[0-9.]+),p95=(?<c2q95>[0-9.]+),p99=(?<c2q99>[0-9.]+)\]'

$firstPacketPattern = 'latency_trace first_packet capture_to_queue_ms=(?<value>[0-9.]+)'

if (-not (Test-Path -LiteralPath $LogPath)) {
    throw "Log not found: $LogPath"
}

$logFullPath = (Resolve-Path -LiteralPath $LogPath).Path
if ([string]::IsNullOrWhiteSpace($Run)) {
    $Run = [System.IO.Path]::GetFileNameWithoutExtension($logFullPath)
}

$lines = Get-Content -LiteralPath $logFullPath
$windows = [System.Collections.Generic.List[object]]::new()
$firstPackets = [System.Collections.Generic.List[double]]::new()

foreach ($line in $lines) {
    $match = [regex]::Match($line, $windowPattern)
    if ($match.Success) {
        $windows.Add([pscustomobject]@{
            window_s = ConvertTo-LogDouble $match.Groups['window'].Value
            frames = [int]$match.Groups['frames'].Value
            fps = ConvertTo-LogDouble $match.Groups['fps'].Value
            c2e50 = ConvertTo-LogDouble $match.Groups['c2e50'].Value
            c2e95 = ConvertTo-LogDouble $match.Groups['c2e95'].Value
            c2e99 = ConvertTo-LogDouble $match.Groups['c2e99'].Value
            e2q50 = ConvertTo-LogDouble $match.Groups['e2q50'].Value
            e2q95 = ConvertTo-LogDouble $match.Groups['e2q95'].Value
            e2q99 = ConvertTo-LogDouble $match.Groups['e2q99'].Value
            c2q50 = ConvertTo-LogDouble $match.Groups['c2q50'].Value
            c2q95 = ConvertTo-LogDouble $match.Groups['c2q95'].Value
            c2q99 = ConvertTo-LogDouble $match.Groups['c2q99'].Value
        })
        continue
    }

    $first = [regex]::Match($line, $firstPacketPattern)
    if ($first.Success) {
        $firstPackets.Add((ConvertTo-LogDouble $first.Groups['value'].Value))
    }
}

Write-Host ''
Write-Host "Kloud Games latency report" -ForegroundColor Cyan
Write-Host "  run      : $Run"
Write-Host "  log      : $logFullPath"
Write-Host "  windows  : $($windows.Count) (5 s each)"
Write-Host "  first pkt: $($firstPackets.Count)"
Write-Host ''

if ($windows.Count -eq 0) {
    Write-Warning ('No "latency_trace window=" line found. Is KLOUD_GAMES_TRACE_LATENCY=1 set ' +
        'and did a real streaming session run?')
    if ($firstPackets.Count -eq 0) {
        exit 1
    }
}

$metrics = @(
    [pscustomobject]@{ key = 'capture_to_encode'; label = 'capture -> encode'; m50 = 'c2e50'; m95 = 'c2e95'; m99 = 'c2e99' },
    [pscustomobject]@{ key = 'encode_to_queue'; label = 'encode -> queue'; m50 = 'e2q50'; m95 = 'e2q95'; m99 = 'e2q99' },
    [pscustomobject]@{ key = 'capture_to_queue'; label = 'capture -> queue (total)'; m50 = 'c2q50'; m95 = 'c2q95'; m99 = 'c2q99' }
)

$csvRows = [System.Collections.Generic.List[object]]::new()

if ($Detailed -and $windows.Count -gt 0) {
    Write-Host 'Per window (ms)' -ForegroundColor Cyan
    $index = 0
    foreach ($w in $windows) {
        $index++
        Write-Host ("  window {0,2} frames={1,5} fps={2,6}  c2e p50/p95/p99={3}/{4}/{5}  e2q={6}/{7}/{8}  c2q={9}/{10}/{11}" -f `
            $index, $w.frames, (Format-Value $w.fps 2), (Format-Value $w.c2e50), (Format-Value $w.c2e95), (Format-Value $w.c2e99), `
            (Format-Value $w.e2q50), (Format-Value $w.e2q95), (Format-Value $w.e2q99), `
            (Format-Value $w.c2q50), (Format-Value $w.c2q95), (Format-Value $w.c2q99))
        foreach ($metric in $metrics) {
            foreach ($percentile in @('50', '95', '99')) {
                $field = $metric."m$percentile"
                $csvRows.Add([pscustomobject]@{
                    run = $Run; source = "window$index"; metric = $metric.key
                    percentile = "p$percentile"; value_ms = (Format-Value $w.$field)
                })
            }
        }
    }
    Write-Host ''
}

$summary = [System.Collections.Generic.List[object]]::new()
foreach ($metric in $metrics) {
    $summary.Add([pscustomobject]@{
        metric = $metric.label
        p50_ms = Format-Value (Get-Median @($windows | ForEach-Object { $_.($metric.m50) }))
        p95_ms = Format-Value (Get-Median @($windows | ForEach-Object { $_.($metric.m95) }))
        p99_ms = Format-Value (Get-Median @($windows | ForEach-Object { $_.($metric.m99) }))
    })
    foreach ($percentile in @('50', '95', '99')) {
        $field = $metric."m$percentile"
        $csvRows.Add([pscustomobject]@{
            run = $Run; source = 'median'; metric = $metric.key
            percentile = "p$percentile"; value_ms = (Format-Value (Get-Median @($windows | ForEach-Object { $_.($field) })))
        })
    }
}

$fpsMedian = Get-Median @($windows | ForEach-Object { $_.fps })
$framesMedian = Get-Median @($windows | ForEach-Object { $_.frames })
$firstPacketMedian = Get-Median @($firstPackets)

Write-Host 'Run level (median of the 5 s window percentiles, ms)' -ForegroundColor Cyan
$summary | Format-Table metric, p50_ms, p95_ms, p99_ms -AutoSize | Out-Host
Write-Host ("  fps (median of windows): {0}   frames per window (median): {1}" -f `
    (Format-Value $fpsMedian 2), (Format-Value $framesMedian 0))
if ($null -ne $firstPacketMedian) {
    Write-Host ("  first packet capture -> queue (median, ms): {0}  (n={1})" -f `
        (Format-Value $firstPacketMedian), $firstPackets.Count)
} else {
    Write-Host '  first packet capture -> queue (median, ms): - (no first_packet line)'
}

$csvRows.Add([pscustomobject]@{
    run = $Run; source = 'median'; metric = 'fps'; percentile = 'median'
    value_ms = (Format-Value $fpsMedian 2)
})
foreach ($value in $firstPackets) {
    $csvRows.Add([pscustomobject]@{
        run = $Run; source = 'first_packet'; metric = 'capture_to_queue'
        percentile = 'value'; value_ms = (Format-Value $value)
    })
}

if (-not [string]::IsNullOrWhiteSpace($CsvDirectory)) {
    New-Item -ItemType Directory -Force -Path $CsvDirectory | Out-Null
    $csvPath = Join-Path $CsvDirectory "$Run-latency.csv"
    $csvRows | Export-Csv -NoTypeInformation -LiteralPath $csvPath
    Write-Host ''
    Write-Host "CSV written: $csvPath"
}

Write-Host ''
