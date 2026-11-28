# verify-release.ps1 -- Verifica o instalador compilado do Hub (Kolnd Hub Setup *.exe)
# com o bundle REAL de programas, apos `npm run package` na maquina do dev:
#
#   1. acha o `Kolnd Hub Setup *.exe` mais recente em dist/ (glob pelo artifactName
#      fixado em electron-builder.yml - `Kolnd Hub Setup ${version}.exe`);
#   2. confere o tamanho minimo (o instalador com o MSI real passa do limite;
#      builds truncadas/placeholder ficam abaixo);
#   3. lista o payload do .exe com 7-Zip (`7z l`, sem extrair nada) e confirma a
#      presenca de:
#        - programs/kloud-games/KLOUD_GAMES.msi  (na saida do 7z aparece com prefixo,
#                                                ex.: resources\programs\...);
#   4. se existir `dist/win-unpacked/` (intermediario do electron-builder), confere
#      o mesmo arquivo la tambem.
#
# Hash NAO e verificado aqui - quem gera o SHA-256 dos artefatos finais e o
# gen-sha256sums.ps1 (dono dessa logica; nao duplicar).
#
# Falha (saida != 0) com mensagem clara se qualquer item faltar. Sucesso imprime OK.
#
# Exit codes:
#   0 = instalador OK (payload confere)
#   1 = verificacao falhou (tamanho insuficiente ou payload ausente/invalido)
#   2 = nenhum instalador encontrado em -DistDir
#   3 = 7-Zip nao encontrado
#
# Uso:
#   powershell -NoProfile -File kolnd-hub\scripts\verify-release.ps1
#
# Opcoes (todas opcionais; os padroes cobrem o fluxo normal):
#   -DistDir    pasta do dist          (default: <repo>\kolnd-hub\dist)
#   -MinSizeMB  tamanho minimo em MB   (default: 80)
#   -SevenZip   caminho do 7z.exe/7za.exe (default: procura no PATH e em
#               "$env:ProgramFiles\7-Zip\7z.exe" / "${env:ProgramFiles(x86)}\7-Zip\7z.exe")
#
# NOTA (tarefa 03-3.4): a Opcao A (workflow release.yml com o bundle real) depende
# de onde o bundle pode morar (runner self-hosted / asset privado) - decisao do
# usuario PENDENTE. Este script e a Opcao B (script local) e nao embute nem le o
# bundle real: ele so LISTA o payload do instalador.

[CmdletBinding()]
param(
    [string]$DistDir,
    [int]$MinSizeMB = 80,
    [string]$SevenZip
)

$ErrorActionPreference = 'Stop'

$HubRoot = Split-Path -Parent $PSScriptRoot                   # kolnd-hub/
if (-not $DistDir) { $DistDir = Join-Path $HubRoot 'dist' }

Write-Host "    Verificacao do instalador (bundle real) - $DistDir"

# --- 1. Localiza o instalador mais recente -----------------------------------
if (-not (Test-Path $DistDir -PathType Container)) {
    Write-Host "    [ERRO] pasta do dist nao encontrada: $DistDir" -ForegroundColor Red
    exit 2
}

$installers = @(Get-ChildItem -Path $DistDir -Filter 'Kolnd Hub Setup *.exe' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)
if ($installers.Count -eq 0) {
    Write-Host "    [ERRO] nenhum instalador encontrado (Kolnd Hub Setup *.exe) em $DistDir" -ForegroundColor Red
    Write-Host '    Rode `npm run package` antes de verificar.' -ForegroundColor Yellow
    exit 2
}

$setup = $installers[0]
if ($installers.Count -gt 1) {
    Write-Host "    [aviso] $($installers.Count) instaladores encontrados - verificando o mais recente: $($setup.Name)" -ForegroundColor Yellow
}
Write-Host "    Instalador: $($setup.FullName)"
Write-Host "    Tamanho:    $([math]::Round($setup.Length / 1MB, 1)) MB (minimo $MinSizeMB MB)"

# --- 2. Tamanho minimo --------------------------------------------------------
if ($setup.Length -lt ($MinSizeMB * 1MB)) {
    Write-Host "    [ERRO] instalador menor que o minimo de $MinSizeMB MB - o bundle real nao foi embutido (placeholder ou build incompleta?)." -ForegroundColor Red
    exit 1
}

# --- 3. Localiza o 7-Zip ------------------------------------------------------
if (-not $SevenZip) {
    $cmd = Get-Command 7z -ErrorAction SilentlyContinue
    if ($cmd) {
        $SevenZip = $cmd.Source
    } else {
        foreach ($candidate in @(
            (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
            (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe')
        )) {
            if ($candidate -and (Test-Path $candidate -PathType Leaf)) { $SevenZip = $candidate; break }
        }
    }
}
if (-not $SevenZip -or -not (Test-Path $SevenZip -PathType Leaf)) {
    Write-Host '    [ERRO] 7-Zip nao encontrado; instale o 7-Zip ou passe -SevenZip <path> (ex.: -SevenZip "C:\Program Files\7-Zip\7z.exe").' -ForegroundColor Red
    exit 3
}
Write-Host "    7-Zip:      $SevenZip"

# --- 4. Lista o payload e confere os arquivos do bundle -----------------------
# 7z sai com 0 (OK) ou 1 (warnings - ex.: "data after end of archive", normal em
# NSIS); >= 2 e erro fatal. A listagem vai por arquivos temporarios via
# Start-Process (em vez de capturar o pipe) porque no Windows PowerShell 5.1
# stderr de comando nativo vira ErrorRecord e derruba scripts com 'Stop'
# (NativeCommandError) - alem de poluir o texto com o stack da excecao.
$stdoutFile = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
$stderrFile = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
$proc = Start-Process -FilePath $SevenZip -ArgumentList ('l "' + $setup.FullName + '"') `
    -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
$sevenZipExit = $proc.ExitCode
$listing = if (Test-Path $stdoutFile -PathType Leaf) { Get-Content $stdoutFile -Raw } else { '' }
$stderrText = if (Test-Path $stderrFile -PathType Leaf) { Get-Content $stderrFile -Raw } else { '' }
Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
if ($sevenZipExit -ge 2) {
    Write-Host "    [ERRO] 7-Zip falhou ao listar o instalador (exit $sevenZipExit):" -ForegroundColor Red
    Write-Host ($listing + $stderrText)
    exit 1
}

# Tolera separadores \ ou / e qualquer prefixo (o electron-builder/NSIS lista como
# `resources\programs\...`), em qualquer caixa. `Relative` e o caminho dentro de
# `win-unpacked/` (o electron-builder extraResources leva `programs/` para
# `resources/programs/` no instalado).
$expected = @(
    @{ Label = 'KLOUD_GAMES.msi'; Pattern = 'programs[\\/]kloud-games[\\/]KLOUD_GAMES\.msi'; Relative = 'resources\programs\kloud-games\KLOUD_GAMES.msi' }
)

$failed = $false
foreach ($e in $expected) {
    if ($listing -match $e.Pattern) {
        Write-Host "    [OK] payload contem $($e.Label)" -ForegroundColor Green
    } else {
        Write-Host "    [ERRO] payload NAO contem $($e.Label) - o bundle real nao foi embutido (placeholder ou extraResources quebrado?)." -ForegroundColor Red
        $failed = $true
    }
}

# --- 5. win-unpacked (intermediario), quando existir ---------------------------
$winUnpacked = Join-Path $DistDir 'win-unpacked'
if (Test-Path $winUnpacked -PathType Container) {
    foreach ($e in $expected) {
        $relative = $e.Relative
        $target = Join-Path $winUnpacked $relative
        if (Test-Path $target -PathType Leaf) {
            Write-Host "    [OK] win-unpacked contem $relative" -ForegroundColor Green
        } else {
            Write-Host "    [ERRO] win-unpacked NAO contem $relative" -ForegroundColor Red
            $failed = $true
        }
    }
} else {
    Write-Host '    [aviso] win-unpacked ausente em dist/ - conferindo so o instalador.' -ForegroundColor Yellow
}

if ($failed) {
    Write-Host '    VERIFICACAO FALHOU - o instalador nao contem o bundle real de programas.' -ForegroundColor Red
    exit 1
}
Write-Host '    VERIFICACAO OK - o instalador contem o bundle real de programas.' -ForegroundColor Green
exit 0
