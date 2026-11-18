# build-mark-lvi.ps1 -- freeze Mark LVI (JARVIS) with PyInstaller and sync it
# into the Kolnd Hub bundle (resources/programs/MarkLVI).
#
# The Kolnd Hub installer picks up the bundle via electron-builder's
# extraResources, so rerun `npm run package` after this to refresh the .exe.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-mark-lvi.ps1
#   ... -SkipDeps   # skip pip installs for faster rebuilds

[CmdletBinding()]
param(
    [switch]$SkipDeps
)

$ErrorActionPreference = 'Stop'

$HubRoot   = Split-Path -Parent $PSScriptRoot            # kolnd-hub/
$RepoRoot  = Split-Path -Parent $HubRoot                 # Kolnd Hub/
$MarkRoot  = Join-Path $RepoRoot 'Mark-LVI'
$BundleDir = Join-Path $HubRoot 'resources\programs\MarkLVI'

if (-not (Test-Path (Join-Path $MarkRoot 'main.py'))) {
    throw "Mark-LVI nao encontrado em: $MarkRoot"
}

Write-Host "==> Mark LVI root: $MarkRoot"
Write-Host "==> Bundle target: $BundleDir"

# -- 1. Python + deps ---------------------------------------------
$py = Get-Command py -ErrorAction SilentlyContinue
if (-not $py) { throw "Python launcher 'py' nao encontrado no PATH." }

# Lock (pinned + hashes) tem preferencia; requirements.txt (bounds) e o fallback.
$lockFile = Join-Path $MarkRoot 'requirements.lock'
$depsFile = Join-Path $MarkRoot 'requirements.txt'
$depsLabel = 'requirements.txt (bounds)'
if (Test-Path $lockFile) {
    $depsFile = $lockFile
    $depsLabel = 'requirements.lock (pinned + hashes)'
} else {
    Write-Warning "requirements.lock nao encontrado - usando requirements.txt (bounds, nao reproduzivel)."
}

if (-not $SkipDeps) {
    Write-Host "==> Instalando dependencias ($depsLabel)..."
    & py -m pip install -r $depsFile
    if ($LASTEXITCODE -ne 0) { throw "pip install -r $depsLabel falhou" }
    Write-Host "==> Instalando PyInstaller..."
    & py -m pip install pyinstaller
    if ($LASTEXITCODE -ne 0) { throw "pip install pyinstaller falhou" }
}

# -- 2. Freeze with PyInstaller -----------------------------------
$pyArgs = @(
    '-m', 'PyInstaller',
    '--noconfirm', '--clean',
    '--onedir', '--windowed',
    '--name', 'MarkLVI',
    '--icon', 'config/jarvis.ico',
    '--collect-submodules', 'providers',
    '--collect-submodules', 'core',
    '--collect-submodules', 'memory',
    '--collect-submodules', 'dashboard',
    '--collect-submodules', 'actions',
    '--collect-submodules', 'plugins',
    '--collect-submodules', 'yt_dlp',
    '--collect-data', 'sounddevice',
    '--collect-all', 'playwright',
    '--add-data', 'core/face_model.obj;core',
    '--hidden-import', 'wmi',
    '--hidden-import', 'pycaw.pycaw',
    '--hidden-import', 'pywinauto',
    '--hidden-import', 'comtypes',
    '--hidden-import', 'win32com.client',
    '--hidden-import', 'win10toast',
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

$FrozenDir = Join-Path $MarkRoot 'dist\MarkLVI'
$FrozenExe = Join-Path $FrozenDir 'MarkLVI.exe'
if (-not (Test-Path $FrozenExe)) {
    throw "Build nao gerou $FrozenExe"
}

# -- 3. Stage the bundle ------------------------------------------
# Mark LVI writes config/ and memory/ next to its exe -- a previous bundle may
# hold the user's API key and conversation data. Preserve them instead of
# deleting them when the bundle is rebuilt.
$backupRoot = Join-Path (Split-Path $HubRoot -Parent) 'kolnd-hub-userdata-backups'
$userDataItems = @(
    'config\api_keys.json',
    'config\certs',
    'config\whatsapp_web',
    'memory'
)

function Preserve-UserData {
    param([string]$SourceDir)
    if (-not (Test-Path $SourceDir)) { return }
    $found = @()
    foreach ($item in $userDataItems) {
        $p = Join-Path $SourceDir $item
        if (Test-Path $p) { $found += $p }
    }
    if ($found.Count -eq 0) { return }
    $backup = Join-Path $backupRoot ("MarkLVI-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force $backup | Out-Null
    foreach ($p in $found) {
        $rel = $p.Substring($SourceDir.Length).TrimStart('\')
        $dst = Join-Path $backup $rel
        New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
        Move-Item -Force $p $dst
    }
    Write-Warning "Dados de usuario preservados em: $backup"
}

if (Test-Path $BundleDir) {
    Preserve-UserData $BundleDir
    Write-Host "==> Limpando bundle anterior..."
    Remove-Item -Recurse -Force $BundleDir
}
New-Item -ItemType Directory -Force $BundleDir | Out-Null

Write-Host "==> Copiando resultado do PyInstaller..."
Copy-Item -Recurse -Force (Join-Path $FrozenDir '*') $BundleDir

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
    'core\prompt.txt',
    'dashboard\static',
    'config\jarvis.ico'
)) {
    Copy-RuntimeItem $item
}

# -- 4. Safety: never ship secrets or personal data ---------------
# The frozen build itself never contains these -- this is a last-resort check
# for leftovers from earlier staging steps. If anything is found it is moved
# to a backup folder, never silently deleted.
$safetyForbidden = @(
    'config\api_keys.json',
    'config\certs',
    'config\whatsapp_web',
    'memory\long_term.json',
    'memory'
)
foreach ($f in $safetyForbidden) {
    $p = Join-Path $BundleDir $f
    if (Test-Path $p) {
        Preserve-UserData $BundleDir
        break
    }
}
$stray = Get-ChildItem $BundleDir -Recurse -Force -Include '*.key','*.pem','client_secret*.json','token*.json' |
    Where-Object { $_.FullName -notlike '*\_internal\*' }
if ($stray) {
    $backup = Join-Path $backupRoot ("MarkLVI-safety-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force $backup | Out-Null
    $stray | ForEach-Object { Move-Item -Force $_.FullName $backup }
    Write-Warning "Arquivos sensiveis movidos para: $backup"
}

$size = (Get-ChildItem $BundleDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("==> Bundle pronto em {0} ({1:N1} MB)" -f $BundleDir, $size)
Write-Host "==> Proximo passo: npm run package (no kolnd-hub) para gerar o instalador"
