<#
.SYNOPSIS
    Executa todos os testes automatizados do workspace Kolnd Hub.

.DESCRIPTION
    Suítes executadas, em ordem:

      1. Kloud Hub              - testes unitários (Vitest)           -> kolnd-hub: npm test
      2. Kloud Hub              - testes e2e (Playwright + Electron)  -> kolnd-hub: npm run test:e2e
      3. Kloud Games (web)      - testes da UI (Vitest)               -> kloud-games: npm test
      4. Kloud Games (scripts)  - testes dos instaladores (Pester 5)  -> kloud-games\tests\scripts
      5. Kloud Games (C++)      - testes gtest (binário já compilado) -> kloud-games\cmake-build-windows\tests\test_KLOUD_GAMES.exe
      6. Mark LVI               - ainda não tem suíte automatizada (04-4.5 pendente) - apenas reportado

    O binário gtest NÃO é recompilado por este script: ele reflete o último build
    em kloud-games\cmake-build-windows. A suíte Pester só roda se houver Pester 5+
    instalado (o Windows traz apenas o 3.4 por padrão).

    Cada suíte roda no seu diretório, com o código de saída capturado. No fim há
    um resumo e o caminho do log completo (transcript) em %TEMP%\kolnd-hub-testes.
    A janela permanece aberta no fim (Read-Host) para a leitura do resultado.

.PARAMETER SkipE2e
    Não roda a suíte e2e do Hub (a mais lenta: build + Playwright).

.PARAMETER SkipKloudGames
    Não roda nenhuma suíte do Kloud Games (web, Pester e C++).

.PARAMETER SkipKloudNative
    Não roda o binário de testes C++ do Kloud Games (mantém web e Pester).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-all-tests.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-all-tests.ps1 -SkipE2e
#>
[CmdletBinding()]
param(
    [switch]$SkipE2e,
    [switch]$SkipKloudGames,
    [switch]$SkipKloudNative
)

$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$hubDir = Join-Path $repoRoot 'kolnd-hub'
$kloudDir = Join-Path $repoRoot 'kloud-games'
$kloudTestExe = Join-Path $kloudDir 'cmake-build-windows\tests\test_KLOUD_GAMES.exe'
$pesterDir = Join-Path $kloudDir 'tests\scripts'

$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$logDir = Join-Path $env:TEMP 'kolnd-hub-testes'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir "testes-$stamp.log"
# Log separado para a saída das suítes: o arquivo do transcript fica aberto e
# travado durante a execução, então o Tee não pode escrever nele.
$outputLogPath = Join-Path $logDir "testes-$stamp.saida.log"

try { $Host.UI.RawUI.WindowTitle = 'Testes automatizados - Kolnd Hub' } catch { }

Start-Transcript -Path $logPath -Force | Out-Null

$results = New-Object System.Collections.Generic.List[object]
$startedAll = Get-Date

function Write-Header {
    $commit = 'desconhecido'
    $branch = 'desconhecida'
    try {
        $commit = (& git -C $repoRoot rev-parse --short HEAD 2>$null)
        $branch = (& git -C $repoRoot rev-parse --abbrev-ref HEAD 2>$null)
    } catch { }

    Write-Host ''
    Write-Host ('=' * 76) -ForegroundColor DarkCyan
    Write-Host '  TESTES AUTOMATIZADOS - KOLND HUB' -ForegroundColor Cyan
    Write-Host ("  {0}  |  commit {1} ({2})" -f (Get-Date -Format 'dd/MM/yyyy HH:mm'), $commit, $branch)
    Write-Host "  Log: $logPath"
    Write-Host '  Obs.: a suíte e2e faz build e pode levar alguns minutos.' -ForegroundColor DarkGray
    Write-Host ('=' * 76) -ForegroundColor DarkCyan
}

function Add-Result {
    param(
        [string]$Suite,
        [string]$Outcome,
        [int]$Code = -1,
        [int]$Seconds = 0
    )
    $results.Add([pscustomobject]@{
            Suite     = $Suite
            Resultado = $Outcome
            Codigo    = $Code
            Segundos  = $Seconds
        })
}

function Invoke-Suite {
    param(
        [Parameter(Mandatory = $true)][string]$Suite,
        [Parameter(Mandatory = $true)][string]$WorkDir,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    if (-not (Test-Path $WorkDir)) {
        Write-Host ''
        Write-Host "=== $Suite ===" -ForegroundColor Cyan
        Write-Host "  FALHOU: diretório não encontrado: $WorkDir" -ForegroundColor Red
        Add-Result -Suite $Suite -Outcome 'FALHOU' -Code 1
        return
    }

    Write-Host ''
    Write-Host "=== $Suite ===" -ForegroundColor Cyan

    $started = Get-Date
    Push-Location $WorkDir
    try {
        # Tee: o console mostra ao vivo e o log guarda a saída (o transcript do
        # Windows PowerShell não captura stdout de processos nativos).
        & $Command 2>&1 | Tee-Object -FilePath $outputLogPath -Append | Out-Host
        $code = $LASTEXITCODE
    } catch {
        Write-Host "  Erro: $($_.Exception.Message)" -ForegroundColor Red
        $code = 1
    } finally {
        Pop-Location
    }
    $elapsed = [int]((Get-Date) - $started).TotalSeconds

    if ($code -eq 0) {
        Write-Host "  OK ($elapsed s)" -ForegroundColor Green
        Add-Result -Suite $Suite -Outcome 'OK' -Code 0 -Seconds $elapsed
    } else {
        Write-Host "  FALHOU (código $code, $elapsed s)" -ForegroundColor Red
        Add-Result -Suite $Suite -Outcome 'FALHOU' -Code $code -Seconds $elapsed
    }
}

function Skip-Suite {
    param(
        [string]$Suite,
        [string]$Reason
    )
    Write-Host ''
    Write-Host "=== $Suite ===" -ForegroundColor Cyan
    Write-Host "  PULADO: $Reason" -ForegroundColor Yellow
    Add-Result -Suite $Suite -Outcome 'PULADO'
}

Write-Header

# 1) Kloud Hub - unitários (Vitest)
$hubReady = Test-Path (Join-Path $hubDir 'node_modules')
if (-not $hubReady) {
    Write-Host ''
    Write-Host '=== Kloud Hub - testes unitários (Vitest) ===' -ForegroundColor Cyan
    Write-Host '  FALHOU: kolnd-hub\node_modules ausente. Rode "npm ci" em kolnd-hub.' -ForegroundColor Red
    Add-Result -Suite 'Kloud Hub - unitários (Vitest)' -Outcome 'FALHOU' -Code 1
} else {
    Invoke-Suite -Suite 'Kloud Hub - unitários (Vitest)' -WorkDir $hubDir -Command { npm test }
}

# 2) Kloud Hub - e2e (Playwright + Electron)
if (-not $hubReady) {
    Skip-Suite -Suite 'Kloud Hub - e2e (Playwright)' -Reason 'kolnd-hub\node_modules ausente.'
} elseif ($SkipE2e) {
    Skip-Suite -Suite 'Kloud Hub - e2e (Playwright)' -Reason 'flag -SkipE2e.'
} else {
    # Contexto e2e próprio desta execução: duas rodadas simultâneas não apagam
    # o arquivo de contexto uma da outra (ver tests/e2e/global-setup.ts).
    $e2eContext = Join-Path $env:TEMP "kolnd-hub-e2e-context-$PID.json"
    $env:KOLDND_HUB_E2E_CONTEXT = $e2eContext
    try {
        Invoke-Suite -Suite 'Kloud Hub - e2e (Playwright)' -WorkDir $hubDir -Command { npm run test:e2e }
    } finally {
        Remove-Item Env:\KOLDND_HUB_E2E_CONTEXT -ErrorAction SilentlyContinue
        Remove-Item $e2eContext -ErrorAction SilentlyContinue
    }
}

# 3) Kloud Games - UI web (Vitest)
$kloudReady = Test-Path (Join-Path $kloudDir 'node_modules')
if ($SkipKloudGames) {
    Skip-Suite -Suite 'Kloud Games - web (Vitest)' -Reason 'flag -SkipKloudGames.'
} elseif (-not $kloudReady) {
    Skip-Suite -Suite 'Kloud Games - web (Vitest)' -Reason 'kloud-games\node_modules ausente (rode "npm ci" em kloud-games).'
} else {
    Invoke-Suite -Suite 'Kloud Games - web (Vitest)' -WorkDir $kloudDir -Command { npm test }
}

# 4) Kloud Games - scripts dos instaladores (Pester 5)
$pester = Get-Module -ListAvailable -Name Pester |
    Sort-Object Version -Descending |
    Select-Object -First 1

if ($SkipKloudGames) {
    Skip-Suite -Suite 'Kloud Games - scripts (Pester)' -Reason 'flag -SkipKloudGames.'
} elseif (-not (Test-Path $pesterDir)) {
    Skip-Suite -Suite 'Kloud Games - scripts (Pester)' -Reason 'pasta tests\scripts não encontrada.'
} elseif (-not $pester -or $pester.Version.Major -lt 5) {
    Skip-Suite -Suite 'Kloud Games - scripts (Pester)' -Reason (
        'Pester 5+ não instalado (encontrado: {0}). Instale com: Install-Module Pester -MinimumVersion 5.0 -Scope CurrentUser' -f $(if ($pester) { $pester.Version } else { 'nenhum' })
    )
} else {
    Write-Host ''
    Write-Host '=== Kloud Games - scripts (Pester) ===' -ForegroundColor Cyan
    $started = Get-Date
    $code = 1
    try {
        Import-Module Pester -MinimumVersion 5.0 -ErrorAction Stop
        Push-Location $kloudDir
        try {
            $pesterResult = Invoke-Pester -Path $pesterDir -Output Normal -PassThru
            if ($pesterResult.TotalCount -gt 0 -and $pesterResult.FailedCount -eq 0) { $code = 0 }
        } finally {
            Pop-Location
        }
    } catch {
        Write-Host "  Erro: $($_.Exception.Message)" -ForegroundColor Red
        $code = 1
    }
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    if ($code -eq 0) {
        Write-Host "  OK ($elapsed s)" -ForegroundColor Green
        Add-Result -Suite 'Kloud Games - scripts (Pester)' -Outcome 'OK' -Code 0 -Seconds $elapsed
    } else {
        Write-Host "  FALHOU ($elapsed s)" -ForegroundColor Red
        Add-Result -Suite 'Kloud Games - scripts (Pester)' -Outcome 'FALHOU' -Code 1 -Seconds $elapsed
    }
}

# 5) Kloud Games - C++ (gtest, build existente)
if ($SkipKloudGames) {
    Skip-Suite -Suite 'Kloud Games - C++ (gtest)' -Reason 'flag -SkipKloudGames.'
} elseif ($SkipKloudNative) {
    Skip-Suite -Suite 'Kloud Games - C++ (gtest)' -Reason 'flag -SkipKloudNative.'
} elseif (-not (Test-Path $kloudTestExe)) {
    Skip-Suite -Suite 'Kloud Games - C++ (gtest)' -Reason (
        'test_KLOUD_GAMES.exe não encontrado (Kloud Games não compilado). Build: scripts\build-kloud-games.ps1'
    )
} else {
    # O binário é dinâmico: precisa das DLLs do MSYS2 ucrt64 no PATH.
    $ucrtBin = 'C:\msys64\ucrt64\bin'
    if (Test-Path $ucrtBin) {
        $env:PATH = "$ucrtBin;$env:PATH"
    }

    $builtAt = (Get-Item $kloudTestExe).LastWriteTime.ToString('dd/MM/yyyy HH:mm')
    $testDir = Split-Path -Parent $kloudTestExe
    Write-Host ''
    Write-Host "=== Kloud Games - C++ (gtest; build de $builtAt) ===" -ForegroundColor Cyan
    Write-Host '  (sem recompilar: o binário reflete o último build em cmake-build-windows)'

    $started = Get-Date
    $code = 1
    try {
        # Job com timeout: captura a saída (para o log), evita travar a janela
        # num teste que não retorna e devolve o exit code do binário. `Start-Process
        # -PassThru` não popula ExitCode depois de WaitForExit(ms) no PowerShell 5.1.
        $job = Start-Job -ScriptBlock {
            $ErrorActionPreference = 'Continue'
            Set-Location $using:testDir
            $lines = & $using:kloudTestExe 2>&1 | ForEach-Object { $_.ToString() }
            [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $lines }
        }
        $finished = Wait-Job -Job $job -Timeout 600
        if (-not $finished) {
            Stop-Job -Job $job
            Write-Host '  Timeout de 10 minutos - processo encerrado.' -ForegroundColor Red
        }
        $run = Receive-Job -Job $job |
            Where-Object { $_.PSObject.Properties['Code'] } |
            Select-Object -Last 1
        Remove-Job -Job $job -Force

        if ($run -and $run.Lines) {
            $run.Lines | Tee-Object -FilePath $outputLogPath -Append | Out-Host
        }
        if (-not $finished) {
            $code = 124
        } elseif ($run) {
            $code = [int]$run.Code
        } else {
            $code = 1
        }
    } catch {
        Write-Host "  Erro ao executar o binário: $($_.Exception.Message)" -ForegroundColor Red
        $code = 1
    }
    $elapsed = [int]((Get-Date) - $started).TotalSeconds

    if ($code -eq 0) {
        Write-Host "  OK ($elapsed s)" -ForegroundColor Green
        Add-Result -Suite 'Kloud Games - C++ (gtest)' -Outcome 'OK' -Code 0 -Seconds $elapsed
    } else {
        Write-Host "  FALHOU (código $code, $elapsed s)" -ForegroundColor Red
        Add-Result -Suite 'Kloud Games - C++ (gtest)' -Outcome 'FALHOU' -Code $code -Seconds $elapsed
    }
}

# 6) Mark LVI - sem suíte automatizada
Skip-Suite -Suite 'Mark LVI' -Reason 'ainda não existe suíte automatizada no repositório (task 04-4.5 pendente).'

# Resumo
$totalSeconds = [int]((Get-Date) - $startedAll).TotalSeconds
$failed = @($results | Where-Object { $_.Resultado -eq 'FALHOU' }).Count
$passed = @($results | Where-Object { $_.Resultado -eq 'OK' }).Count
$skipped = @($results | Where-Object { $_.Resultado -eq 'PULADO' }).Count

Write-Host ''
Write-Host ('=' * 76) -ForegroundColor DarkCyan
Write-Host '  RESUMO' -ForegroundColor Cyan
Write-Host ('=' * 76) -ForegroundColor DarkCyan
$results | Format-Table -AutoSize | Out-Host

if ($failed -eq 0) {
    Write-Host ("  TUDO OK: {0} suíte(s) passaram, {1} pulada(s), {2} s no total." -f $passed, $skipped, $totalSeconds) -ForegroundColor Green
} else {
    Write-Host ("  ATENÇÃO: {0} suíte(s) falharam, {1} passaram, {2} pulada(s), {3} s no total." -f $failed, $passed, $skipped, $totalSeconds) -ForegroundColor Red
}
Write-Host "  Log completo: $logPath"
Write-Host "  Saída das suítes: $outputLogPath"
Write-Host ''

Stop-Transcript | Out-Null

Write-Host 'Pressione Enter para fechar esta janela...'
try { Read-Host | Out-Null } catch { }

if ($failed -gt 0) { exit 1 }
exit 0
