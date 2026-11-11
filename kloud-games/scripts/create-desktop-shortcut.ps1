<#
.SYNOPSIS
    Cria um atalho na área de trabalho para abrir o Kloud Games (antigo Sunshine).

.DESCRIPTION
    Gera um arquivo .lnk no Desktop do usuário atual apontando para
    kloud-games.exe, com ícone personalizado e descrição.

.NOTES
    Execute com: powershell -ExecutionPolicy Bypass -File create-desktop-shortcut.ps1
#>

param(
    [string]$TargetExe = "$env:USERPROFILE\Documents\My Games\kloud-games\kloud-games.exe",
    [string]$IconPath  = "$PSScriptRoot\..\kloud-games.ico",
    [string]$ShortcutName = "Kloud Games.lnk"
)

$ErrorActionPreference = 'Stop'

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Atalho do Kloud Games (Novo Sunshine)" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# ── Caminho da área de trabalho ───────────────────────
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath $ShortcutName

Write-Host "Área de trabalho: $desktopPath" -ForegroundColor Gray
Write-Host "Executável alvo : $TargetExe" -ForegroundColor Gray

# ── Verifica se o executável existe ───────────────────
if (-not (Test-Path $TargetExe)) {
    Write-Warning "Executável não encontrado: $TargetExe"
    Write-Host "Deseja criar o atalho mesmo assim? (o atalho apontará para o caminho informado)" -ForegroundColor Yellow
    $confirm = Read-Host "Digite [s] para continuar ou qualquer tecla para cancelar"
    if ($confirm -ne 's' -and $confirm -ne 'S') {
        Write-Host "Operação cancelada pelo usuário." -ForegroundColor Red
        exit 0
    }
} else {
    Write-Host "Executável encontrado.`n" -ForegroundColor Green
}

# ── Verifica o ícone ──────────────────────────────────
if (-not (Test-Path $IconPath)) {
    Write-Warning "Ícone não encontrado: $IconPath (será usado o ícone padrão do executável)"
    $IconPath = $TargetExe
}

# ── Cria o atalho via WScript.Shell ─────────────────────
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)

$shortcut.TargetPath = $TargetExe
$shortcut.WorkingDirectory = Split-Path -Parent $TargetExe
$shortcut.IconLocation = "$IconPath,0"
$shortcut.Description = "Kloud Games - Servidor de streaming de jogos (antigo Sunshine)"
$shortcut.WindowStyle = 1  # Janela normal
$shortcut.Save()

# ── Confirmação ───────────────────────────────────────
if (Test-Path $shortcutPath) {
    Write-Host "Atalho criado com sucesso!" -ForegroundColor Green
    Write-Host "Local: $shortcutPath" -ForegroundColor Green
    Write-Host "Clique duas vezes em `"$ShortcutName`" na área de trabalho para abrir o Kloud Games." -ForegroundColor Cyan
} else {
    Write-Host "Falha ao criar o atalho." -ForegroundColor Red
    exit 1
}
