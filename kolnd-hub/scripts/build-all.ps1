# build-all.ps1 -- build everything and generate the single Kolnd Hub installer.
#
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-all.ps1
#
# Options:
#   -SkipMarkLvi      skip the Mark LVI PyInstaller build
#   -SkipKloudGames   skip the Kloud Games CMake build (heavy!)
#   -SkipPackage      stop after the programs are staged; do not run npm run package
#
# The Kloud Games build is heavy (MSYS2 + full toolchain, ~30-60 min). If you
# just want the installer with Mark LVI, use -SkipKloudGames -- the installer
# will still work, the Kloud Games card just won't start until you build it.

[CmdletBinding()]
param(
    [switch]$SkipMarkLvi,
    [switch]$SkipKloudGames,
    [switch]$SkipPackage
)

$ErrorActionPreference = 'Stop'
$HubRoot = Split-Path -Parent $PSScriptRoot
$ScriptDir = $PSScriptRoot

if (-not $SkipMarkLvi) {
    Write-Host "############ 1/3 -- Mark LVI (PyInstaller) ############"
    & (Join-Path $ScriptDir 'build-mark-lvi.ps1')
    if ($LASTEXITCODE -ne 0) { throw "build-mark-lvi.ps1 falhou" }
}

if (-not $SkipKloudGames) {
    Write-Host "############ 2/3 -- Kloud Games (CMake) ############"
    & (Join-Path $ScriptDir 'build-kloud-games.ps1')
    if ($LASTEXITCODE -ne 0) { throw "build-kloud-games.ps1 falhou" }
} else {
    Write-Host "############ 2/3 -- Kloud Games IGNORADO (-SkipKloudGames) ############"
}

if (-not $SkipPackage) {
    Write-Host "############ 3/3 -- Instalador (electron-builder) ############"
    Push-Location $HubRoot
    try {
        npm run package
        if ($LASTEXITCODE -ne 0) { throw "npm run package falhou" }
    }
    finally {
        Pop-Location
    }
    Write-Host "==> Instalador em: $HubRoot\dist"
}
