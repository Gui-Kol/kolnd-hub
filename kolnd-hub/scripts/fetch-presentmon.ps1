# fetch-presentmon.ps1 -- baixa o PresentMon (motor de FPS do HUD) e grava o pin.
#
# Por que PresentMon: a T0 provou que o console app 2.6.0 entrega FPS por
# processo sem o MSI de 169 MB, sem servico e sem injetar DLL no jogo (D2).
# O binario NAO vai para o git (resources/fps/*.exe e ignorado); o pins.json
# SIM, e e ele que o build/empacotamento usa para conferir o que foi embutido.
# O app nunca baixa nada em runtime: este script e uma acao de desenvolvimento,
# executada antes do empacotamento.
#
# Fonte oficial (verificada em 26/11/2026):
#   https://github.com/GameTechDev/PresentMon/releases/tag/v2.6.0
#
# O SHA-256 e o tamanho abaixo sao a fonte de verdade -- qualquer divergencia
# aborta sem gravar nada. O executavel ainda passa por Authenticode quando
# assinado; um SHA pinado protege contra troca de arquivo, a assinatura protege
# contra um repo comprometido que publique outro binario com o mesmo nome.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\fetch-presentmon.ps1
#   ... -Force   # baixa de novo mesmo se o arquivo local ja estiver valido

[CmdletBinding()]
param(
    [string]$OutDir = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $PSScriptRoot '..\resources\fps'
}

# --- Pinos (atualizar SEMPRE os dois juntos: hash + tamanho) -----------------
$EngineName = 'PresentMon'
$EngineVersion = '2.6.0'
$EngineFile = "PresentMon-$EngineVersion-x64.exe"
$EngineUrl = "https://github.com/GameTechDev/PresentMon/releases/download/v$EngineVersion/$EngineFile"
$EngineSha256 = 'B2A706BC6AD475749E3B7E3409263AA1E6906D45BDCF993F6DBC0F660188F1AF'
$EngineSize = 980320
$EngineLicense = 'MIT'

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Test-Pinned([string]$Path, [string]$Sha256, [long]$Size) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -ne $Size) { return $false }
    return (Get-Sha256 $Path) -eq $Sha256
}

function Save-Pins([string]$Directory) {
    $pins = [ordered]@{
        comment = 'Gerado por scripts/fetch-presentmon.ps1. Nao editar a mao.'
        engine = [ordered]@{
            name = $EngineName
            version = $EngineVersion
            file = $EngineFile
            url = $EngineUrl
            sha256 = $EngineSha256
            size = $EngineSize
            license = $EngineLicense
        }
        licenseFile = 'COPYING'
    }
    # UTF-8 sem BOM: o pins.json e lido por humanos e por ferramentas de build.
    $json = $pins | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $Directory 'pins.json'), $json, (New-Object Text.UTF8Encoding($false)))
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    if (-not (Test-Path -LiteralPath $OutDir)) {
        New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    }
    $OutDir = (Resolve-Path -LiteralPath $OutDir).Path

    $enginePath = Join-Path $OutDir $EngineFile
    $valid = Test-Pinned $enginePath $EngineSha256 $EngineSize

    if (-not $Force -and $valid) {
        Write-Host "$EngineFile ja esta presente e valido."
        Save-Pins $OutDir
        Write-Host "Pins: $(Join-Path $OutDir 'pins.json')"
        exit 0
    }
    if ($Force) {
        Write-Host 'Force: baixando de novo.'
    } elseif (-not $valid) {
        Write-Host 'Arquivo ausente ou divergente. Baixando.'
    }

    $temp = Join-Path ([IO.Path]::GetTempPath()) ('presentmon-fetch-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    try {
        $tempEngine = Join-Path $temp $EngineFile
        Write-Host "Baixando $EngineUrl"
        try {
            Invoke-WebRequest -Uri $EngineUrl -OutFile $tempEngine -UseBasicParsing
        } catch {
            throw "Falha ao baixar o PresentMon. Verifique a rede/proxy e tente novamente. Detalhe: $($_.Exception.Message)"
        }

        $hash = Get-Sha256 $tempEngine
        $bytes = (Get-Item -LiteralPath $tempEngine).Length
        if ($hash -ne $EngineSha256) {
            throw "SHA-256 divergente: esperado $EngineSha256, recebido $hash. Nada foi gravado."
        }
        if ($bytes -ne $EngineSize) {
            throw "Tamanho divergente: esperado $EngineSize bytes, recebido $bytes. Nada foi gravado."
        }

        # Assinatura e defesa extra, nao o criterio: o hash pinado e a fonte de
        # verdade. Binario assinado com status invalido aborta; sem assinatura
        # segue com aviso (o release oficial do PresentMon pode nao ser assinado).
        $signature = Get-AuthenticodeSignature -LiteralPath $tempEngine
        $signer = ''
        if ($signature.Status -eq 'Valid') {
            if ($null -ne $signature.SignerCertificate) { $signer = $signature.SignerCertificate.Subject }
        } elseif ($signature.Status -ne 'NotSigned') {
            throw "Assinatura Authenticode invalida ($($signature.Status)). Nada foi gravado."
        }

        # Copia so depois de TUDO validado: um download parcial nunca deixa o
        # resources/fps/ num estado misto que o build embutiria sem perceber.
        Copy-Item -LiteralPath $tempEngine -Destination $enginePath -Force
        Save-Pins $OutDir

        Write-Host "$EngineFile baixado e validado."
        Write-Host "  SHA256:   $hash"
        Write-Host "  Tamanho:  $bytes bytes"
        Write-Host "  Licenca:  $EngineLicense (COPYING ao lado)"
        if ($signer) { Write-Host "  Signature: $signer" } else { Write-Host '  Signature: nao assinado (hash pinado)' }
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
