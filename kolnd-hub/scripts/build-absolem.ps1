# build-absolem.ps1 -- build Absolem and sync the packaged app (win-unpacked)
# into the Kolnd Hub bundle (resources/programs/Absolem).
#
# Absolem is shipped as the ready Electron build (no separate installer): the
# hub launches Absolem.exe straight from its own folder, so uninstalling the
# Hub removes it too. The app keeps its data in %APPDATA%\absolem.
#
# The Kolnd Hub installer picks up the bundle via electron-builder's
# extraResources, so rerun `npm run package` after this to refresh the .exe.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-absolem.ps1
#   ... -SkipBuild   # reuse the existing Absolem\dist\win-unpacked (no rebuild)

[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$HubRoot   = Split-Path -Parent $PSScriptRoot            # kolnd-hub/
$RepoRoot  = Split-Path -Parent $HubRoot                 # Kolnd Hub/
$AbsRoot   = Join-Path $RepoRoot 'Absolem'
$BuildDir  = Join-Path $AbsRoot 'dist\win-unpacked'
$BuildExe  = Join-Path $BuildDir 'Absolem.exe'
$BundleDir = Join-Path $HubRoot 'resources\programs\Absolem'

if (-not (Test-Path (Join-Path $AbsRoot 'package.json'))) {
    throw "Absolem nao encontrado em: $AbsRoot"
}

if (-not (Test-Path (Join-Path $AbsRoot 'node_modules'))) {
    throw "node_modules do Absolem nao encontrado. Rode 'npm ci' em $AbsRoot antes."
}

Write-Host "==> Absolem root: $AbsRoot"
Write-Host "==> Bundle target: $BundleDir"

# -- 1. Build the app + unpacked dir ------------------------------
if (-not $SkipBuild) {
    Push-Location $AbsRoot
    try {
        Write-Host "==> Rodando npm run build (isso demora alguns minutos)..."
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build falhou (codigo $LASTEXITCODE)" }

        Write-Host "==> Rodando npm run package:dir..."
        & npm run package:dir
        if ($LASTEXITCODE -ne 0) { throw "npm run package:dir falhou (codigo $LASTEXITCODE)" }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path $BuildExe)) {
    throw "Build nao gerou $BuildExe (use -SkipBuild apenas se o build ja existir)"
}

# -- 2. Mirror the unpacked build into the Hub bundle -------------
New-Item -ItemType Directory -Force $BundleDir | Out-Null

Write-Host "==> Copiando win-unpacked para o bundle (robocopy /MIR)..."
robocopy $BuildDir $BundleDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy falhou ao copiar Absolem (codigo $LASTEXITCODE)" }

# -- 3. Report ----------------------------------------------------
$size = (Get-ChildItem $BundleDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("==> Bundle pronto em {0} ({1:N1} MB)" -f $BundleDir, $size)
Write-Host "==> Proximo passo: npm run package (no kolnd-hub) para gerar o instalador"
