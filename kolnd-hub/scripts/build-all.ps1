# build-all.ps1 -- build everything and generate the single Kolnd Hub installer.
#
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-all.ps1
#
# Options:
#   -SkipMarkLvii      skip the Mark LVII PyInstaller build
#   -SkipKloudGames    skip the Kloud Games CMake build (heavy!)
#   -SkipAbsolem       skip the Absolem build (reuses the existing win-unpacked)
#   -SkipPackage       stop after the programs are staged; do not run npm run package
#
# The Kloud Games build is heavy (MSYS2 + full toolchain, ~30-60 min). If you
# just want the installer with Mark LVII, use -SkipKloudGames -- the installer
# will still work, the Kloud Games card just won't start until you build it.
#
# Order: Mark LVII -> Kloud Games -> Absolem -> installer.

[CmdletBinding()]
param(
    [switch]$SkipMarkLvii,
    [switch]$SkipKloudGames,
    [switch]$SkipAbsolem,
    [switch]$SkipPackage
)

$ErrorActionPreference = 'Stop'
$HubRoot = Split-Path -Parent $PSScriptRoot
$ScriptDir = $PSScriptRoot

if (-not $SkipMarkLvii) {
    Write-Host "############ 1/4 -- Mark LVII (PyInstaller) ############"
    & (Join-Path $ScriptDir 'build-mark-lvii.ps1')
    if ($LASTEXITCODE -ne 0) { throw "build-mark-lvii.ps1 falhou" }
} else {
    Write-Host "############ 1/4 -- Mark LVII IGNORADO (-SkipMarkLvii) ############"
}

if (-not $SkipKloudGames) {
    Write-Host "############ 2/4 -- Kloud Games (CMake) ############"
    & (Join-Path $ScriptDir 'build-kloud-games.ps1')
    if ($LASTEXITCODE -ne 0) { throw "build-kloud-games.ps1 falhou" }
} else {
    Write-Host "############ 2/4 -- Kloud Games IGNORADO (-SkipKloudGames) ############"
}

if (-not $SkipAbsolem) {
    Write-Host "############ 3/4 -- Absolem (Electron) ############"
    & (Join-Path $ScriptDir 'build-absolem.ps1')
    if ($LASTEXITCODE -ne 0) { throw "build-absolem.ps1 falhou" }
} else {
    Write-Host "############ 3/4 -- Absolem IGNORADO (-SkipAbsolem) ############"
}

if (-not $SkipPackage) {
    Write-Host "############ 4/4 -- Instalador (electron-builder) ############"
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
