# build-kloud-games.ps1 -- Build KLOUD_GAMES.msi from source and drop it
# into the Kolnd Hub bundle (resources/programs/kloud-games/KLOUD_GAMES.msi).
#
# This is the automation used by the top-level build-installer.bat: it handles
#   1. Prerequisites  (MSYS2/ucrt64, native Node.js, .NET SDK 8 for WiX, git)
#   2. Snapshot fixes (the fork's file renames are NOT consistent with the
#      CMake/JS references -- the script renames them idempotently)
#   3. Git submodules (clone missing ones, init nested submodules, apply the
#      local moonlight-common-c stdatomic/extern-C patch)
#   4. Build (cmake + ninja, gcc/g++)
#   5. Package (cpack -G WIX -> KLOUD_GAMES.msi)
#   6. Copy the MSI into kolnd-hub/resources/programs/kloud-games/
#   7. Verificacao de autenticidade do MSI (informativa - nao bloqueia o build)
#
# Re-runnable: everything is idempotent; incremental builds reuse the
# cmake-build-windows directory.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\build-kloud-games.ps1
#
# Options:
#   -SkipSubmodules   do not touch git submodules
#   -SkipDeps         do not install/update MSYS2 pacman dependencies

[CmdletBinding()]
param(
    [switch]$SkipSubmodules,
    [switch]$SkipDeps
)

$ErrorActionPreference = 'Stop'

$HubRoot   = Split-Path -Parent $PSScriptRoot            # kolnd-hub/
$RepoRoot  = Split-Path -Parent $HubRoot                 # Kolnd Hub/
$KGRoot    = Join-Path $RepoRoot 'kloud-games'
$BundleDir = Join-Path $HubRoot 'resources\programs\kloud-games'
$BuildDir  = Join-Path $KGRoot 'cmake-build-windows'
$PatchDir  = Join-Path $PSScriptRoot 'patches'
$Msys2     = 'C:\msys64'
$MsysShell = Join-Path $Msys2 'msys2_shell.cmd'

if (-not (Test-Path (Join-Path $KGRoot 'CMakeLists.txt'))) {
    throw "KLOUD_GAMES nao encontrado em: $KGRoot"
}

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------
Step 'Verificando pre-requisitos...'

# git
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { throw 'git nao encontrado no PATH. Instale o Git for Windows.' }

# Node.js nativo (necessario para o build da Web UI via vite)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js nativo nao encontrado no PATH. Instale o Node.js LTS.' }
$nodeDir = Split-Path -Parent $node.Source
Write-Host "    node  : $($node.Source)"
$env:NODEJS_PATH = $nodeDir

# MSYS2
if (-not (Test-Path $MsysShell)) {
    Step 'MSYS2 nao encontrado - instalando via winget...'
    winget install --id MSYS2.MSYS2 -e --accept-package-agreements --accept-source-agreements
    if (-not (Test-Path $MsysShell)) { throw 'MSYS2 ainda nao encontrado em C:\msys64 apos a instalacao.' }
} else {
    Write-Host '    msys2 : C:\msys64'
}

# .NET SDK (necessario para o WiX/cpack gerar o .msi)
$hasSdk = $false
try {
    $sdks = dotnet --list-sdks 2>$null
    if ($sdks) { $hasSdk = $true }
} catch { }
if (-not $hasSdk) {
    Step '.NET SDK nao encontrado - instalando via winget (Microsoft.DotNet.SDK.8)...'
    winget install --id Microsoft.DotNet.SDK.8 -e --accept-package-agreements --accept-source-agreements
    $env:PATH = "C:\Program Files\dotnet;$env:PATH"
    $hasSdk = [bool](dotnet --list-sdks 2>$null)
    if (-not $hasSdk) { throw '.NET SDK 8 nao disponivel apos a instalacao. Abra um novo terminal e tente novamente.' }
} else {
    Write-Host '    dotnet: SDK presente'
}

# ---------------------------------------------------------------
# 2. Idempotent fixes for the snapshot's incomplete KLOUD_GAMES rename
#    (files on disk use "kloud-games-*"/lowercase, while CMake/JS expect
#    "KLOUD_GAMES*"). Safe to re-run.
# ---------------------------------------------------------------
Step 'Aplicando correcoes de renomeacao do snapshot (idempotente)...'

$renames = @(
    @{ from = 'kloud-games.ico';                                     to = 'KLOUD_GAMES.ico' },
    @{ from = 'kloud-games.png';                                     to = 'KLOUD_GAMES.png' },
    @{ from = 'kloud-games.svg';                                     to = 'KLOUD_GAMES.svg' },
    @{ from = 'tools\kloud-gamessvc.cpp';                            to = 'tools\KLOUD_GAMESsvc.cpp' },
    @{ from = 'cmake\dependencies\Boost_kloud-games.cmake';          to = 'cmake\dependencies\Boost_KLOUD_GAMES.cmake' },
    @{ from = 'cmake\packaging\wix_resources\kloud-games-installer.wxs'; to = 'cmake\packaging\wix_resources\KLOUD_GAMES-installer.wxs' },
    @{ from = 'src_assets\windows\misc\kloud-games-setup.ps1';        to = 'src_assets\windows\misc\KLOUD_GAMES-setup.ps1' },
    @{ from = 'src_assets\windows\misc\kloud-games-setup-process.ps1'; to = 'src_assets\windows\misc\KLOUD_GAMES-setup-process.ps1' },
    @{ from = 'src_assets\linux\misc\60-kloud-games.conf';            to = 'src_assets\linux\misc\60-KLOUD_GAMES.conf' },
    @{ from = 'src_assets\linux\misc\60-kloud-games.rules';           to = 'src_assets\linux\misc\60-KLOUD_GAMES.rules' },
    @{ from = 'src_assets\common\assets\web\kloud-games.css';        to = 'src_assets\common\assets\web\KLOUD_GAMES.css' },
    @{ from = 'src_assets\common\assets\web\kloud-games_version.js'; to = 'src_assets\common\assets\web\KLOUD_GAMES_version.js' },
    @{ from = 'src_assets\common\assets\web\public\images\kloud-games-locked.svg';  to = 'src_assets\common\assets\web\public\images\KLOUD_GAMES-locked.svg' },
    @{ from = 'src_assets\common\assets\web\public\images\kloud-games-playing.svg'; to = 'src_assets\common\assets\web\public\images\KLOUD_GAMES-playing.svg' },
    @{ from = 'src_assets\common\assets\web\public\images\kloud-games-pausing.svg'; to = 'src_assets\common\assets\web\public\images\KLOUD_GAMES-pausing.svg' },
    @{ from = 'src_assets\common\assets\web\public\images\logo-kloud-games-16.png'; to = 'src_assets\common\assets\web\public\images\logo-KLOUD_GAMES-16.png' },
    @{ from = 'src_assets\common\assets\web\public\images\logo-kloud-games-45.png'; to = 'src_assets\common\assets\web\public\images\logo-KLOUD_GAMES-45.png' }
)
foreach ($r in $renames) {
    $from = Join-Path $KGRoot $r.from
    $to   = Join-Path $KGRoot $r.to
    if ((Test-Path $from) -and -not (Test-Path $to)) {
        # Windows is case-insensitive; use a temp name when only the case changes.
        if ($from.ToLower() -eq $to.ToLower()) {
            $tmp = "$to.tmp-rename"
            Rename-Item $from $tmp -Force
            Rename-Item $tmp $to -Force
        } else {
            Rename-Item $from $to -Force
        }
        Write-Host "    rename: $($r.from) -> $($r.to)"
    }
}

# ---------------------------------------------------------------
# 3. Git submodules (clone missing; nested submodules; local patch)
# ---------------------------------------------------------------
if (-not $SkipSubmodules) {
    Step 'Sincronizando submodulos git (clone se ausente)...'

    $gm = Join-Path $KGRoot '.gitmodules'
    $lines = git config -f $gm --get-regexp '^submodule\.' 2>$null
    $subs = @{}
    foreach ($line in $lines) {
        if ($line -match '^submodule\.([^\.]+)\.(path|url|branch)\s+(.+)$') {
            $name, $key, $value = $matches[1], $matches[2], $matches[3].Trim()
            if (-not $subs.ContainsKey($name)) { $subs[$name] = @{} }
            $subs[$name][$key] = $value
        }
    }

    foreach ($name in $subs.Keys) {
        $s = $subs[$name]
        $dest = Join-Path $KGRoot $s.path
        if ((Test-Path (Join-Path $dest '.git')) -or ((Test-Path $dest) -and (Get-ChildItem $dest -Force | Select-Object -First 1))) {
            Write-Host "    ok: $($s.path)"
            continue
        }
        $cloneArgs = @('clone', '--depth', '1')
        if ($s.ContainsKey('branch')) { $cloneArgs += @('--branch', $s.branch) }
        $cloneArgs += @($s.url, $dest)
        Write-Host "    clone: $($s.url)"
        git @cloneArgs | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Falha ao clonar $($s.url)" }
    }

    # Nested submodules (skip the FFmpeg stack in build-deps - not needed and huge)
    foreach ($name in $subs.Keys) {
        if ($name -match 'build-deps|flatpak') { continue }
        $dest = Join-Path $KGRoot $subs[$name].path
        if (Test-Path (Join-Path $dest '.gitmodules')) {
            Write-Host "    nested: $($subs[$name].path)"
            git -C $dest submodule update --init --recursive --depth 1 | Out-Host
        }
    }

    # Local patch: extern "C" / stdatomic.h fix for moonlight-common-c (GCC 16)
    $patch = Join-Path $PatchDir 'moonlight-stdatomic-guards.patch'
    $mcc = Join-Path $KGRoot 'third-party\moonlight-common-c'
    if ((Test-Path $patch) -and (Test-Path (Join-Path $mcc '.git'))) {
        # Native git writes progress/errors to stderr; don't let them abort the script.
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        git -C $mcc apply --reverse --check $patch 2>&1 | Out-Null
        $rev = $LASTEXITCODE
        if ($rev -eq 0) {
            Write-Host '    patch moonlight-stdatomic-guards: ja aplicado'
        } else {
            git -C $mcc apply --check $patch 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                $ErrorActionPreference = $prevEap
                throw 'Nao foi possivel aplicar o patch de stdatomic/extern "C" no moonlight-common-c.'
            }
            git -C $mcc apply $patch 2>&1 | Out-Null
            Write-Host '    patch moonlight-stdatomic-guards: aplicado'
        }
        $ErrorActionPreference = $prevEap
    }
} else {
    Write-Host '    (ignorado: -SkipSubmodules)'
}

# ---------------------------------------------------------------
# 4. MSYS2 pacman dependencies (ucrt64)
# ---------------------------------------------------------------
if (-not $SkipDeps) {
    Step 'Instalando/atualizando dependencias no MSYS2 (ucrt64)...'
    $deps = @(
        'git', 'ninja', 'mingw-w64-ucrt-x86_64-boost', 'mingw-w64-ucrt-x86_64-cmake',
        'mingw-w64-ucrt-x86_64-cppwinrt', 'mingw-w64-ucrt-x86_64-curl-winssl',
        'mingw-w64-ucrt-x86_64-doxygen', 'mingw-w64-ucrt-x86_64-gcc',
        'mingw-w64-ucrt-x86_64-graphviz', 'mingw-w64-ucrt-x86_64-miniupnpc',
        'mingw-w64-ucrt-x86_64-nlohmann-json', 'mingw-w64-ucrt-x86_64-onevpl',
        'mingw-w64-ucrt-x86_64-openssl', 'mingw-w64-ucrt-x86_64-opus',
        'mingw-w64-ucrt-x86_64-nsis', 'mingw-w64-ucrt-x86_64-qt6-static',
        'mingw-w64-ucrt-x86_64-MinHook', 'mingw-w64-ucrt-x86_64-binutils',
        'mingw-w64-ucrt-x86_64-crt', 'mingw-w64-ucrt-x86_64-headers',
        'mingw-w64-ucrt-x86_64-libgomp', 'mingw-w64-ucrt-x86_64-libstdc++',
        'mingw-w64-ucrt-x86_64-libwinpthread', 'mingw-w64-ucrt-x86_64-make',
        'mingw-w64-ucrt-x86_64-pkgconf', 'mingw-w64-ucrt-x86_64-winpthreads'
    ) -join ' '
    & $MsysShell -defterm -here -no-start -ucrt64 -c "pacman -S --needed --noconfirm $deps"
    if ($LASTEXITCODE -ne 0) { throw 'pacman falhou' }
} else {
    Write-Host '    (ignorado: -SkipDeps)'
}

# ---------------------------------------------------------------
# 5. Configure (wipe build dir if it was configured with another toolchain)
# ---------------------------------------------------------------
Step 'Configurando o build (cmake/gcc)...'
$cache = Join-Path $BuildDir 'CMakeCache.txt'
if (Test-Path $cache) {
    $cacheContent = Get-Content $cache -Raw
    if ($cacheContent -notmatch 'g\+\+\.exe') {
        Write-Host '    cmake-build-windows veio de outro toolchain - apagando para reconfigurar...'
        Remove-Item $BuildDir -Recurse -Force
    }
}

$kgRootCyg = $KGRoot -replace '\\', '/'
if ($kgRootCyg -match '^([A-Za-z]):') { $kgRootCyg = '/' + $matches[1].ToLower() + $kgRootCyg.Substring(2) }
$buildCyg = "$kgRootCyg/cmake-build-windows"
$nodeCyg = $env:NODEJS_PATH -replace '\\', '/'
if ($nodeCyg -match '^([A-Za-z]):') { $nodeCyg = '/' + $matches[1].ToLower() + $nodeCyg.Substring(2) }

$shContent = @"
#!/bin/bash
set -e
export NODEJS_PATH='$nodeCyg'
export PATH="`$NODEJS_PATH:`$PATH"
export CC=gcc
export CXX=g++
mkdir -p '$buildCyg'
cmake -B '$buildCyg' -G Ninja -S '$kgRootCyg' -DBUILD_WERROR=OFF -DCMAKE_BUILD_TYPE=RelWithDebInfo -DKLOUD_GAMES_ASSETS_DIR=assets -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++
ninja -C '$buildCyg'
"@
$shPath = Join-Path $env:TEMP 'kolnd-build-kloud-games.sh'
[System.IO.File]::WriteAllText($shPath, $shContent, (New-Object System.Text.UTF8Encoding($false)))
$shPathCyg = $shPath -replace '\\', '/'
if ($shPathCyg -match '^([A-Za-z]):') { $shPathCyg = '/' + $matches[1].ToLower() + $shPathCyg.Substring(2) }

Step 'Compilando (isto pode demorar bastante na primeira vez)...'
& $MsysShell -defterm -here -no-start -ucrt64 -c "bash '$shPathCyg'"
if ($LASTEXITCODE -ne 0) { throw 'cmake/ninja falhou' }

$exe = Join-Path $BuildDir 'KLOUD_GAMES.exe'
if (-not (Test-Path $exe)) { throw "Build nao gerou $exe" }

# ---------------------------------------------------------------
# 6. Package the MSI with WiX (cpack)
# ---------------------------------------------------------------
Step 'Empacotando KLOUD_GAMES.msi (cpack -G WIX)...'
$cpackSh = @"
#!/bin/bash
set -e
cd '$buildCyg'
cmake .
cpack -G WIX --config CPackConfig.cmake
"@
$cpackPath = Join-Path $env:TEMP 'kolnd-cpack-kloud-games.sh'
[System.IO.File]::WriteAllText($cpackPath, $cpackSh, (New-Object System.Text.UTF8Encoding($false)))
$cpackCyg = $cpackPath -replace '\\', '/'
if ($cpackCyg -match '^([A-Za-z]):') { $cpackCyg = '/' + $matches[1].ToLower() + $cpackCyg.Substring(2) }
& $MsysShell -defterm -here -no-start -ucrt64 -c "bash '$cpackCyg'"
if ($LASTEXITCODE -ne 0) { throw 'cpack (WiX) falhou. Veja cmake-build-windows/cpack_artifacts/_CPack_Packages/win64/WIX/wix.log' }

$msi = Join-Path $BuildDir 'cpack_artifacts\KLOUD_GAMES.msi'
if (-not (Test-Path $msi)) { throw "MSI nao gerado: $msi" }

# ---------------------------------------------------------------
# 7. Copy the MSI into the Hub bundle
# ---------------------------------------------------------------
Step 'Copiando o MSI para o bundle do Kolnd Hub...'
if (-not (Test-Path $BundleDir)) { New-Item -ItemType Directory -Force $BundleDir | Out-Null }
Copy-Item -Force $msi (Join-Path $BundleDir 'KLOUD_GAMES.msi')
$sizeMB = [math]::Round((Get-Item (Join-Path $BundleDir 'KLOUD_GAMES.msi')).Length / 1MB, 1)
Write-Host ("    bundle: {0} ({1} MB)" -f (Join-Path $BundleDir 'KLOUD_GAMES.msi'), $sizeMB)

# ---------------------------------------------------------------
# 8. Verificacao de autenticidade do MSI (informativa)
#    O MSI ainda nao e assinado (assinatura de codigo: tarefa 02-2.4), entao
#    aqui apenas REGISTRAMOS no log de build - nunca falhamos o build:
#    status Authenticode (+ subject/issuer quando assinado) e o SHA-256 do
#    artefato empacotado. Quando o certificado existir, esta checagem pode
#    passar de informativa para bloqueante.
#    O SHA256SUMS.txt dos artefatos finais e gerado pelo build-installer.bat /
#    CI via scripts\gen-sha256sums.ps1 (dono da logica de hash) - nao duplicar aqui.
# ---------------------------------------------------------------
Step 'Verificando autenticidade do MSI (informativa)...'
$bundleMsi = Join-Path $BundleDir 'KLOUD_GAMES.msi'
try {
    $sig = Get-AuthenticodeSignature -FilePath $bundleMsi
    Write-Host "    Authenticode: $($sig.Status)"
    if ($sig.SignerCertificate) {
        Write-Host "    subject: $($sig.SignerCertificate.Subject)"
        Write-Host "    issuer : $($sig.SignerCertificate.Issuer)"
    }
    if ($sig.Status -ne 'Valid') {
        Write-Host ('    [aviso] MSI sem assinatura valida ({0}) - registro apenas; a checagem vira bloqueante quando a assinatura (02-2.4) estiver em vigor.' -f $sig.Status) -ForegroundColor Yellow
    }
    $msiHash = (Get-FileHash -Algorithm SHA256 -Path $bundleMsi).Hash.ToLower()
    Write-Host "    SHA-256: $msiHash  KLOUD_GAMES.msi"
    Write-Host '    (o SHA256SUMS.txt final e gerado por scripts\gen-sha256sums.ps1 - build-installer.bat/CI)'
} catch {
    # Informativa: qualquer falha na verificacao so avisa - o build segue.
    Write-Host "    [aviso] nao foi possivel verificar o MSI ($($_.Exception.Message)) - o build continua." -ForegroundColor Yellow
}

Step 'Kloud Games MSI pronto. Rode agora o npm run package (ou build-installer.bat) para gerar o instalador do Hub.'
