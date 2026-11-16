# gen-sha256sums.ps1 -- Generate SHA256SUMS.txt (SHA-256) for the final release
# artifacts:
#   1. KLOUD_GAMES.msi       (kolnd-hub/resources/programs/kloud-games/)
#   2. Kolnd Hub Setup *.exe (kolnd-hub/dist/, nome com versao - ver electron-builder.yml)
#
# Saida: kolnd-hub/dist/SHA256SUMS.txt, uma linha por arquivo presente, no
# formato `<hash>  <nome do arquivo>` (hash em minusculas, duas espacos - mesmo
# formato do `sha256sum` e do guia de release em docs/RELEASE.md). O arquivo e
# recriado a cada execucao (nao acumula linhas de builds anteriores).
#
# Arquivos ausentes sao pulados com aviso no console (o build local e o CI nao
# tem, necessariamente, os dois artefatos no mesmo momento). Falha inesperada
# (ex.: dist/ sem permissao de escrita) sai com exit code != 0 para o chamador
# decidir - no build-installer.bat o passo e best-effort e so avisa.
#
# Uso:
#   powershell -NoProfile -File kolnd-hub\scripts\gen-sha256sums.ps1
#
# Opcoes (todas opcionais; os padroes cobrem o fluxo normal):
#   -MsiPath     caminho/glob do MSI    (default: ...\resources\programs\kloud-games\KLOUD_GAMES.msi)
#   -SetupPath   caminho/glob do Setup  (default: ...\dist\Kolnd Hub Setup *.exe)
#   -OutputPath  saida                  (default: ...\dist\SHA256SUMS.txt)
#
# NOTA (tarefa 01-1.5): este script e o DONO da logica de SHA-256 dos artefatos
# finais - a 01-1.5 (verificacao de autenticidade do MSI no build/runtime) deve
# reutiliza-lo em vez de duplicar a implementacao.

[CmdletBinding()]
param(
    [string]$MsiPath,
    [string]$SetupPath,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$HubRoot = Split-Path -Parent $PSScriptRoot                   # kolnd-hub/
$DefaultMsi   = Join-Path $HubRoot 'resources\programs\kloud-games\KLOUD_GAMES.msi'
$DefaultSetup = Join-Path $HubRoot 'dist\Kolnd Hub Setup *.exe'
$DefaultOut   = Join-Path $HubRoot 'dist\SHA256SUMS.txt'

if (-not $MsiPath)    { $MsiPath    = $DefaultMsi }
if (-not $SetupPath)  { $SetupPath  = $DefaultSetup }
if (-not $OutputPath) { $OutputPath = $DefaultOut }

# Resolve um caminho literal ou glob para a lista de arquivos presentes.
# Get-ChildItem com -ErrorAction SilentlyContinue devolve vazio para glob sem
# match e para caminho literal inexistente - o aviso fica a cargo do chamador.
function Resolve-Artifacts([string]$Path) {
    return @(Get-ChildItem -Path $Path -File -ErrorAction SilentlyContinue)
}

$targets = @(
    @{ Label = 'Kloud Games MSI'; Path = $MsiPath },
    @{ Label = 'Kolnd Hub Setup'; Path = $SetupPath }
)

$lines = @()
foreach ($t in $targets) {
    $files = Resolve-Artifacts $t.Path
    if ($files.Count -eq 0) {
        Write-Host "    [aviso] artefato ausente, pulando: $($t.Path)" -ForegroundColor Yellow
        continue
    }
    foreach ($f in $files) {
        $hash = (Get-FileHash -Algorithm SHA256 -Path $f.FullName).Hash.ToLower()
        $lines += "$hash  $($f.Name)"
        Write-Host "    $hash  $($f.Name)"
    }
}

if ($lines.Count -eq 0) {
    Write-Host '    [aviso] nenhum artefato encontrado - SHA256SUMS.txt nao foi gerado.' -ForegroundColor Yellow
    exit 0
}

$outDir = Split-Path -Parent $OutputPath
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }

# ASCII sem BOM, CRLF - compativel com sha256sum e com docs/RELEASE.md.
[System.IO.File]::WriteAllText($OutputPath, (($lines -join "`r`n") + "`r`n"), [System.Text.Encoding]::ASCII)
Write-Host "    SHA256SUMS.txt: $OutputPath ($($lines.Count) linha(s))"
