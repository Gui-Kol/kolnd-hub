# build-mark-lvii.ps1 -- freeze Mark LVII (JARVIS) with PyInstaller and sync it
# into the Kolnd Hub bundle (resources/programs/MarkLVII).
#
# The Kolnd Hub installer picks up the bundle via electron-builder's
# extraResources, so rerun `npm run package` after this to refresh the .exe.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-mark-lvii.ps1
#   ... -SkipDeps   # skip pip installs for faster rebuilds

[CmdletBinding()]
param(
    [switch]$SkipDeps
)

$ErrorActionPreference = 'Stop'

$HubRoot   = Split-Path -Parent $PSScriptRoot            # kolnd-hub/
$RepoRoot  = Split-Path -Parent $HubRoot                 # Kolnd Hub/
$MarkRoot  = Join-Path $RepoRoot 'Mark-LVII'
$BundleDir = Join-Path $HubRoot 'resources\programs\MarkLVII'
$FrozenDir = Join-Path $MarkRoot 'dist\MarkLVII'
$FrozenExe = Join-Path $FrozenDir 'MarkLVII.exe'

if (-not (Test-Path (Join-Path $MarkRoot 'main.py'))) {
    throw "Mark-LVII nao encontrado em: $MarkRoot"
}

Write-Host "==> Mark LVII root: $MarkRoot"
Write-Host "==> Bundle target: $BundleDir"

# -- 1. Python + deps ---------------------------------------------
$py = Get-Command py -ErrorAction SilentlyContinue
if (-not $py) { throw "Python launcher 'py' nao encontrado no PATH." }

$depsFile = Join-Path $MarkRoot 'requirements.txt'
if (-not (Test-Path $depsFile)) { throw "requirements.txt nao encontrado em: $depsFile" }

if (-not $SkipDeps) {
    Write-Host "==> Instalando dependencias (requirements.txt)..."
    & py -m pip install -r $depsFile
    if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements.txt falhou" }
    Write-Host "==> Instalando PyInstaller..."
    & py -m pip install pyinstaller
    if ($LASTEXITCODE -ne 0) { throw "pip install pyinstaller falhou" }
}

# -- 2. Freeze with PyInstaller -----------------------------------
# The GUI (gui/), the task engine (core/tasks) and routines (core/routines) are
# packages imported at runtime, so every one needs its submodules collected.
# agents/*.md and dashboard/static are data read from the bundle at runtime.
$pyArgs = @(
    '-m', 'PyInstaller',
    '--noconfirm', '--clean',
    '--onedir', '--windowed',
    '--name', 'MarkLVII',
    # Spec file inside build/ (gitignored) instead of the Mark-LVII checkout root.
    '--specpath', 'build',
    '--icon', 'config/jarvis.ico',
    '--collect-submodules', 'providers',
    '--collect-submodules', 'core',
    '--collect-submodules', 'core.tasks',
    '--collect-submodules', 'core.routines',
    '--collect-submodules', 'memory',
    '--collect-submodules', 'dashboard',
    '--collect-submodules', 'gui',
    '--collect-submodules', 'actions',
    '--collect-submodules', 'plugins',
    '--collect-submodules', 'yt_dlp',
    '--collect-data', 'sounddevice',
    '--collect-all', 'playwright',
    '--add-data', 'core/face_model.obj;core',
    '--add-data', 'dashboard/static;dashboard/static',
    '--add-data', 'agents;agents',
    '--hidden-import', 'wmi',
    '--hidden-import', 'pycaw.pycaw',
    '--hidden-import', 'pywinauto',
    '--hidden-import', 'comtypes',
    '--hidden-import', 'win32com.client',
    '--hidden-import', 'win32api',
    '--hidden-import', 'pythoncom',
    '--hidden-import', 'pywintypes',
    '--hidden-import', 'win10toast',
    '--hidden-import', 'uvicorn.logging',
    '--hidden-import', 'uvicorn.loops.auto',
    '--hidden-import', 'uvicorn.protocols.http.auto',
    '--hidden-import', 'uvicorn.protocols.websockets.auto',
    '--hidden-import', 'uvicorn.lifespan.on',
    'main.py'
)

Push-Location $MarkRoot
try {
    Write-Host "==> Rodando PyInstaller (isso demora alguns minutos)..."
    & py @pyArgs
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller falhou (codigo $LASTEXITCODE)" }
}
finally {
    Pop-Location
}

if (-not (Test-Path $FrozenExe)) {
    throw "Build nao gerou $FrozenExe"
}

# -- 3. Stage the bundle ------------------------------------------
# Mark LVII writes config/ and memory/ next to its exe. A previous bundle may be
# in use as the dev install, so those folders are preserved (moved aside) and
# merged back over the fresh build instead of being lost on a rebuild.
$backupRoot = Join-Path $RepoRoot 'kolnd-hub-userdata-backups'
$backup = $null
$preserved = @()

if (Test-Path $BundleDir) {
    $backup = Join-Path $backupRoot ("MarkLVII-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    foreach ($sub in @('config', 'memory')) {
        $p = Join-Path $BundleDir $sub
        if (Test-Path $p) {
            New-Item -ItemType Directory -Force (Split-Path (Join-Path $backup $sub) -Parent) | Out-Null
            Move-Item -Force $p (Join-Path $backup $sub)
            $preserved += $sub
        }
    }
    if ($preserved.Count -gt 0) {
        Write-Warning ("Dados de usuario preservados em: {0} ({1})" -f $backup, ($preserved -join ', '))
    }

    Write-Host "==> Limpando bundle anterior..."
    Remove-Item -Recurse -Force $BundleDir
}
New-Item -ItemType Directory -Force $BundleDir | Out-Null

Write-Host "==> Copiando resultado do PyInstaller..."
Copy-Item -Recurse -Force (Join-Path $FrozenDir '*') $BundleDir

# Restore the user data that was set aside, merging over the fresh build.
foreach ($sub in @('config', 'memory')) {
    if ($preserved -notcontains $sub) { continue }
    $from = Join-Path $backup $sub
    if (Test-Path $from) {
        robocopy $from (Join-Path $BundleDir $sub) /E /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy falhou ao restaurar $sub (codigo $LASTEXITCODE)" }
    }
}

# Runtime files the frozen app loads from disk next to the exe.
function Copy-RuntimeItem([string]$Relative) {
    $src = Join-Path $MarkRoot $Relative
    $dst = Join-Path $BundleDir $Relative
    if (Test-Path $src -PathType Container) {
        # exclude __pycache__
        robocopy $src $dst /E /XD __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy falhou para $Relative (codigo $LASTEXITCODE)" }
    } elseif (Test-Path $src) {
        New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
        Copy-Item -Force $src $dst
    } else {
        Write-Warning "Nao encontrado (ignorado): $Relative"
    }
}

foreach ($item in @(
    'actions',
    'plugins',
    'agents',
    'core\prompt.txt',
    'config\jarvis.ico'
)) {
    Copy-RuntimeItem $item
}

# gui/ resolves the window icon relative to the package (inside _internal/),
# not to the exe, so the icon also has to live there.
$internalDir = Join-Path $BundleDir '_internal'
if (Test-Path $internalDir) {
    New-Item -ItemType Directory -Force (Join-Path $internalDir 'config') | Out-Null
    Copy-Item -Force (Join-Path $MarkRoot 'config\jarvis.ico') (Join-Path $internalDir 'config\jarvis.ico')
}

# -- 4. Safety: the installer must never ship secrets or personal data -----
# The frozen build itself never contains them. config/ and memory/ may hold the
# user's settings (including the API key) because the app writes beside its exe;
# electron-builder excludes those files via extraResources.filter, so this is a
# warning for whoever rebuilds the installer, not a destructive step.
$userDataPresent = @(
    'config\api_keys.json',
    'config\certs',
    'config\whatsapp_web',
    'memory'
) | Where-Object { Test-Path (Join-Path $BundleDir $_) }

if ($userDataPresent) {
    Write-Warning ("Bundle contem dados de usuario ({0}) - o filter de extraResources os exclui do instalador." -f ($userDataPresent -join ', '))
}

$size = (Get-ChildItem $BundleDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("==> Bundle pronto em {0} ({1:N1} MB)" -f $BundleDir, $size)
Write-Host "==> Proximo passo: npm run package (no kolnd-hub) para gerar o instalador"
