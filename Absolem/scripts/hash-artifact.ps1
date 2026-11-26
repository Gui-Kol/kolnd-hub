#Requires -Version 5.1
<#
.SYNOPSIS
  Gera SHA-256 do instalador Absolem e um release-notes.md. Sem assinatura.

.DESCRIPTION
  T6 da task 12. Calcula `Get-FileHash -Algorithm SHA256` sobre o artefato
  (ex.: dist\Absolem Setup <versao>.exe), grava `<arquivo>.sha256` ao lado no
  formato `<hash>  <arquivo>` (hash em minusculas) e produz `release-notes.md`
  com versao, data, requisitos, mudancas e hash.

  Fonte unica da versao: `version` em Absolem\package.json (mesmo valor usado
  no `artifactName` do electron-builder).

  Exemplo:
    powershell -NoProfile -ExecutionPolicy Bypass `
      -File scripts\hash-artifact.ps1 `
      -Path "dist\Absolem Setup <versao>.exe"

  Saida:
    dist\Absolem Setup <versao>.exe.sha256
    dist\release-notes.md
#>
[CmdletBinding()]
param(
  # Caminho do artefato (.exe). Aceita absoluto ou relativo ao diretorio atual.
  [Parameter(Mandatory = $true, Position = 0)]
  [Alias('Artifact', 'FilePath')]
  [string]$Path,

  # Diretorio de saida. Default: pasta do artefato.
  [string]$OutputDir,

  # Texto livre da secao "Mudancas". Default: nota honesta da versao.
  [string]$Changes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param([string]$FilePath, [string]$Content)
  [System.IO.File]::WriteAllText($FilePath, $Content, [System.Text.UTF8Encoding]::new($false))
}

# Resolve caminhos sem assumir diretorio atual.
$artifactPath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).ProviderPath)
if (-not (Test-Path -LiteralPath $artifactPath)) {
  throw "Artefato nao encontrado: $artifactPath"
}

$artifactName = [System.IO.Path]::GetFileName($artifactPath)
$artifactDir = [System.IO.Path]::GetDirectoryName($artifactPath)

$outDir =
  if ([string]::IsNullOrWhiteSpace($OutputDir)) { $artifactDir }
  else { [System.IO.Path]::GetFullPath($OutputDir) }
if (-not (Test-Path -LiteralPath $outDir)) {
  [System.IO.Directory]::CreateDirectory($outDir) | Out-Null
}

# Versao unica: package.json em Absolem\ (script vive em Absolem\scripts\).
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $projectRoot 'package.json'
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $packageJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw "package.json sem campo version: $packageJsonPath"
}

# SHA-256 (Get-FileHash -Algorithm SHA256); emitir em minusculas.
$fileHash = Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath
$hash = $fileHash.Hash.ToLowerInvariant()

# `<hash>  <arquivo>` (dois espacos), arquivo = nome do artefato.
$shaLine = "$hash  $artifactName"
$shaPath = Join-Path $outDir ($artifactName + '.sha256')
Write-Utf8NoBom -FilePath $shaPath -Content ($shaLine + "`n")

# Data ISO (dia) para as notas.
$dateIso = (Get-Date).ToString('yyyy-MM-dd')

if ([string]::IsNullOrWhiteSpace($Changes)) {
  $Changes = "Versao inicial empacotada (task 12). Ver docs\RELEASE.md para o processo e o historico."
}

# Requisitos conhecidos e honestos (nao promete vcredist; app Windows x64).
$requirements = @(
  'Windows 10/11 x64.',
  'Conta Gemini (Google AI Studio) com chave de API; microfone para conversa por voz.',
  'Instalacao por usuario (perMachine=false), sem Administrador; NSIS per-user.',
  'App nao assinado na v1: SmartScreen pode avisar; conferir SHA-256 antes de instalar.',
  'Nenhuma dependencia externa de runtime alem do Windows; modulo nativo better-sqlite3 empacotado fora do asar.'
) -join "`n- "

$notes = @"
# Absolem $version - release notes

- **Versao:** $version
- **Data:** $dateIso
- **Artefato:** $artifactName
- **SHA-256:** $hash
- **Assinatura:** nao assinado na v1 (ver docs\SIGNING.md)

## Requisitos

- $requirements

## Mudancas

$Changes

## Verificar antes de instalar

Comparar o hash publicado com `Get-FileHash -Algorithm SHA256 "$artifactName"`.
A linha esperada esta em ``$($artifactName).sha256`` no formato ``<hash>  <arquivo>``.
SmartScreen pode avisar porque o executavel nao e assinado; ver docs\SIGNING.md.
Nao instalar se o hash divergir.

## Desinstalacao

Desinstalar em Configuracoes > Aplicativos. Remove `%LOCALAPPDATA%\Programs\Absolem`;
**preserva** `%APPDATA%\absolem` (memoria, config, logs, chave cifrada).
`deleteAppDataOnUninstall: false`. Limpeza manual documentada no README.
"@

$notesPath = Join-Path $outDir 'release-notes.md'
Write-Utf8NoBom -FilePath $notesPath -Content ($notes + "`n")

Write-Output ("SHA-256  : " + $hash)
Write-Output ("Artefato : " + $artifactName)
Write-Output ("Sha256   : " + $shaPath)
Write-Output ("Notas    : " + $notesPath)
