# fetch-pawnio.ps1 -- baixa o instalador do PawnIO e os modulos assinados usados
# pelo monitor de hardware do Kolnd Hub.
#
# Por que PawnIO: o driver anterior (OpenLibSys) e recusado pela Memoria Integrity
# (HVCI) no Windows 11 e consta na lista de drivers vulneraveis do Defender.
# O PawnIO e um driver assinado que executa modulos tambem assinados em ring0,
# e e a redistribuicao oficial do autor (namazso).
#
# Os binarios NAO vao para o git (resources/pawnio/*.bin e *.exe sao ignorados);
# o pins.json SIM, e e ele que o build usa para conferir o que foi embutido. O
# app nunca baixa nada em runtime: este script e uma acao de desenvolvimento,
# executada antes do empacotamento. A instalacao no Windows so acontece por
# clique explicito do usuario (com UAC) dentro do Kolnd Hub.
#
# Fontes oficiais (verificadas em 18/11/2026):
#   https://pawnio.eu/                 -> instalador (GitHub Releases)
#   https://github.com/namazso/PawnIO.Modules/releases
#
# O SHA-256 e o tamanho abaixo sao a fonte de verdade -- qualquer divergencia
# aborta sem gravar nada. O instalador ainda passa por Authenticode: um SHA
# pinado protege contra troca de arquivo, a assinatura protege contra um repo
# comprometido que publique outro binario com o mesmo nome.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\fetch-pawnio.ps1
#   ... -Force   # baixa de novo mesmo se os arquivos locais ja estiverem validos

[CmdletBinding()]
param(
    [string]$OutDir = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# $PSScriptRoot nao esta disponivel dentro do bloco param em algumas versoes.
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $PSScriptRoot '..\resources\pawnio'
}

# --- Pinos (atualizar SEMPRE os dois juntos: hash + tamanho) -----------------
$SetupUrl = 'https://github.com/namazso/PawnIO.Setup/releases/latest/download/PawnIO_setup.exe'
$SetupVersion = '2.2.0.0'
$SetupSha256 = '1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032'
$SetupSize = 3410960
# Assinatura Authenticode esperada (autor oficial do PawnIO).
$SetupSignerPattern = 'CN=namazso.eu'

$ModulesVersion = '0.2.12'
$ModulesUrl = 'https://github.com/namazso/PawnIO.Modules/releases/download/0.2.12/release_0_2_12.zip'
$ModulesSha256 = '09698897CE19B92F1043A2E322CFCF0B1FE823E0B576971B178A65244FB0AF9D'
$ModulesSize = 83556

# IntelMSR: ioctl_read_msr (RAPL 0x606/0x611, temperatura 0x1A2/0x1B1).
# AMDFamily17: ioctl_read_msr + ioctl_read_smn (RAPL Zen e Tctl), familias 0x17-0x1A.
# COPYING: licenca LGPL-2.1 dos modulos (exigida na redistribuicao).
# Cada arquivo tem hash + tamanho pinados: um modulo local corrompido e baixado
# de novo em vez de "abencoado" com um pins.json novo.
$ModulePins = @(
    @{ name = 'IntelMSR.bin'; sha256 = '30A5A302283DE1E080DFEE99E686ECA91D7E53E911095CB91A320FB961F1CE12'; size = 5452 },
    @{ name = 'AMDFamily17.bin'; sha256 = 'DAE74615761B78BDF064DFB3E136252DDCC6FC727D88F14738D0E5800D427A91'; size = 10652 },
    @{ name = 'COPYING'; sha256 = '1E7E6BAE5A5BDE32F1AE5A7C37A082D1AB03CF89354F7F936AC40BE9E39A6531'; size = 27032 }
)
$ModuleFiles = @($ModulePins | ForEach-Object { $_.name })

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Test-Pinned([string]$Path, [string]$Sha256, [long]$Size) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -ne $Size) { return $false }
    return (Get-Sha256 $Path) -eq $Sha256
}

function Save-Pins([string]$Directory) {
    $files = @()
    foreach ($pin in $ModulePins) {
        $files += [ordered]@{
            name = $pin.name
            sha256 = $pin.sha256
            size = $pin.size
        }
    }
    $pins = [ordered]@{
        comment = 'Gerado por scripts/fetch-pawnio.ps1. Nao editar a mao.'
        installer = [ordered]@{
            url = $SetupUrl
            version = $SetupVersion
            sha256 = $SetupSha256
            size = $SetupSize
            signer = $SetupSignerPattern
        }
        modules = [ordered]@{
            version = $ModulesVersion
            url = $ModulesUrl
            sha256 = $ModulesSha256
            size = $ModulesSize
            files = $files
        }
    }
    # UTF-8 sem BOM: o pins.json e lido por Node (JSON.parse) e por humanos.
    $json = $pins | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $Directory 'pins.json'), $json, (New-Object Text.UTF8Encoding($false)))
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    if (-not (Test-Path -LiteralPath $OutDir)) {
        New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    }
    $OutDir = (Resolve-Path -LiteralPath $OutDir).Path

    $setupPath = Join-Path $OutDir 'PawnIO_setup.exe'
    $missing = @()
    if (-not (Test-Pinned $setupPath $SetupSha256 $SetupSize)) { $missing += 'PawnIO_setup.exe' }
    foreach ($pin in $ModulePins) {
        if (-not (Test-Pinned (Join-Path $OutDir $pin.name) $pin.sha256 $pin.size)) { $missing += $pin.name }
    }

    if (-not $Force -and $missing.Count -eq 0) {
        Write-Host 'PawnIO_setup.exe e modulos ja estao presentes e validos.'
        Save-Pins $OutDir
        Write-Host "Pins: $(Join-Path $OutDir 'pins.json')"
        exit 0
    }
    if ($Force) {
        Write-Host 'Force: baixando tudo de novo.'
    } else {
        Write-Host "Faltando/divergente: $($missing -join ', '). Baixando."
    }

    $temp = Join-Path ([IO.Path]::GetTempPath()) ('pawnio-fetch-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    try {
        # --- Instalador -------------------------------------------------------
        $setupTemp = Join-Path $temp 'PawnIO_setup.exe'
        Write-Host "Baixando $SetupUrl"
        try {
            Invoke-WebRequest -Uri $SetupUrl -OutFile $setupTemp -UseBasicParsing
        } catch {
            throw "Falha ao baixar o instalador do PawnIO. Verifique a rede/proxy e tente novamente. Detalhe: $($_.Exception.Message)"
        }

        $setupHash = Get-Sha256 $setupTemp
        $setupBytes = (Get-Item -LiteralPath $setupTemp).Length
        if ($setupHash -ne $SetupSha256) {
            throw "SHA-256 do instalador divergente: esperado $SetupSha256, recebido $setupHash. Nada foi gravado."
        }
        if ($setupBytes -ne $SetupSize) {
            throw "Tamanho do instalador divergente: esperado $SetupSize bytes, recebido $setupBytes. Nada foi gravado."
        }

        $signature = Get-AuthenticodeSignature -LiteralPath $setupTemp
        if ($signature.Status -ne 'Valid') {
            throw "Assinatura Authenticode do instalador invalida ($($signature.Status)). Nada foi gravado."
        }
        $subject = ''
        if ($null -ne $signature.SignerCertificate) { $subject = $signature.SignerCertificate.Subject }
        if (-not $subject.Contains($SetupSignerPattern)) {
            throw "Assinatura do instalador nao e de $SetupSignerPattern (recebido: $subject). Nada foi gravado."
        }

        $fileVersion = (Get-Item -LiteralPath $setupTemp).VersionInfo.FileVersion
        if ($fileVersion -ne $SetupVersion) {
            throw "Versao do instalador divergente: esperado $SetupVersion, recebido $fileVersion. Atualize os pinos. Nada foi gravado."
        }

        # --- Modulos assinados ------------------------------------------------
        $zipTemp = Join-Path $temp 'release_0_2_12.zip'
        Write-Host "Baixando $ModulesUrl"
        try {
            Invoke-WebRequest -Uri $ModulesUrl -OutFile $zipTemp -UseBasicParsing
        } catch {
            throw "Falha ao baixar os modulos do PawnIO. Verifique a rede/proxy e tente novamente. Detalhe: $($_.Exception.Message)"
        }

        $zipHash = Get-Sha256 $zipTemp
        $zipBytes = (Get-Item -LiteralPath $zipTemp).Length
        if ($zipHash -ne $ModulesSha256) {
            throw "SHA-256 dos modulos divergente: esperado $ModulesSha256, recebido $zipHash. Nada foi gravado."
        }
        if ($zipBytes -ne $ModulesSize) {
            throw "Tamanho dos modulos divergente: esperado $ModulesSize bytes, recebido $zipBytes. Nada foi gravado."
        }

        $extract = Join-Path $temp 'modules'
        Expand-Archive -LiteralPath $zipTemp -DestinationPath $extract -Force
        foreach ($pin in $ModulePins) {
            $source = Join-Path $extract $pin.name
            if (-not (Test-Pinned $source $pin.sha256 $pin.size)) {
                throw "O arquivo $($pin.name) do pacote de modulos nao confere com o hash/tamanho pinados. Nada foi gravado."
            }
        }

        # Copia so depois de TUDO validado: um download parcial nunca deixa o
        # resources/pawnio/ num estado misto que o build embutiria sem perceber.
        Copy-Item -LiteralPath $setupTemp -Destination $setupPath -Force
        foreach ($name in $ModuleFiles) {
            Copy-Item -LiteralPath (Join-Path $extract $name) -Destination (Join-Path $OutDir $name) -Force
        }

        Save-Pins $OutDir

        Write-Host 'PawnIO_setup.exe baixado e validado.'
        Write-Host "  SHA256:   $setupHash"
        Write-Host "  Tamanho:  $setupBytes bytes"
        Write-Host "  Versao:   $fileVersion"
        Write-Host "  Signature: $subject"
        Write-Host 'Modulos 0.2.12 extraidos e validados:'
        foreach ($name in $ModuleFiles) {
            $path = Join-Path $OutDir $name
            Write-Host "  $name | $((Get-Item -LiteralPath $path).Length) bytes | $(Get-Sha256 $path)"
        }
        Write-Host "Pins: $(Join-Path $OutDir 'pins.json')"
    } finally {
        if (Test-Path -LiteralPath $temp) {
            Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
