# fetch-winring0.ps1 -- baixa e valida o driver WinRing0 (OpenLibSys) x64.
#
# O binario NAO vai para o git (resources/drivers/ e ignorado). O app nunca
# baixa nada em runtime: este script e uma acao de desenvolvimento, executada
# uma vez, e a instalacao no Windows so acontece por clique explicito do
# usuario (com UAC) dentro do Kolnd Hub.
#
# Binario publicado pelo LibreHardwareMonitor (redistribuicao do WinRing0
# original); a assinatura Authenticode e do autor do OpenLibSys/WinRing0,
# Noriyuki MIYAZAKI. O SHA-256 abaixo e a fonte de verdade -- qualquer
# divergencia aborta sem gravar nada.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File kolnd-hub\scripts\fetch-winring0.ps1
#   ... -Force   # baixa de novo mesmo se o arquivo local ja estiver valido

[CmdletBinding()]
param(
    [string]$OutFile = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# $PSScriptRoot não está disponível dentro do bloco param em algumas versões.
if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $OutFile = Join-Path $PSScriptRoot '..\resources\drivers\WinRing0x64.sys'
}

$SourceUrl = 'https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/v0.9.4/LibreHardwareMonitorLib/Resources/WinRing0x64.sys'
$ExpectedSha256 = '11BD2C9F9E2397C9A16E0990E4ED2CF0679498FE0FD418A3DFDAC60B5C160EE5'
$ExpectedSize = 14544

function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $directory = Split-Path -Parent $OutFile
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }

    if (-not $Force -and (Test-Path -LiteralPath $OutFile)) {
        $current = Get-Sha256 $OutFile
        if ($current -eq $ExpectedSha256) {
            Write-Host "WinRing0x64.sys ja esta presente e valido."
            Write-Host "SHA256: $current"
            Write-Host "Arquivo: $OutFile"
            exit 0
        }
        Write-Host "Arquivo local com hash diferente; baixando de novo."
    }

    $temp = Join-Path $directory (".WinRing0x64-" + [Guid]::NewGuid().ToString('N') + ".tmp")
    try {
        Write-Host "Baixando $SourceUrl"
        Invoke-WebRequest -Uri $SourceUrl -OutFile $temp -UseBasicParsing
    } catch {
        throw "Falha ao baixar o WinRing0x64.sys. Verifique a rede/proxy e tente novamente. Detalhe: $($_.Exception.Message)"
    }

    try {
        $size = (Get-Item -LiteralPath $temp).Length
        $hash = Get-Sha256 $temp
        if ($hash -ne $ExpectedSha256) {
            throw "SHA-256 divergente: esperado $ExpectedSha256, recebido $hash. Nada foi gravado."
        }
        if ($size -ne $ExpectedSize) {
            throw "Tamanho divergente: esperado $ExpectedSize bytes, recebido $size. Nada foi gravado."
        }

        Move-Item -LiteralPath $temp -Destination $OutFile -Force
        Write-Host "WinRing0x64.sys baixado e validado."
        Write-Host "SHA256: $hash"
        Write-Host "Tamanho: $size bytes"
        Write-Host "Arquivo: $OutFile"
    } finally {
        if (Test-Path -LiteralPath $temp) {
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
