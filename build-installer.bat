@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Kolnd Hub - Build completo (Kloud Games MSI + instalador .exe)

rem ============================================================
rem  Kolnd Hub - build completo em um unico comando:
rem
rem    [1] Compila o Kloud Games (cmake + ninja) e gera o
rem        KLOUD_GAMES.msi (WiX/cpack), copiando-o para
rem        kolnd-hub\resources\programs\kloud-games\
rem    [2] Empacota o Kolnd Hub (electron-builder) com o MSI
rem        embutido:
rem        kolnd-hub\dist\Kolnd Hub Setup 1.0.0.exe
rem
rem  Requisitos (o script instala o que faltar via winget):
rem    git, Node.js LTS, MSYS2 (C:\msys64), .NET SDK 8
rem ============================================================

set "ROOT=%~dp0"
set "HUB=%ROOT%kolnd-hub"

cd /d "%HUB%"

rem --- Garante que o Node.js esta no PATH ---
rem (Node: nao usar blocos com parenteses contendo %PATH% - o PATH pode
rem  conter "(x86)" e quebra o parser do cmd. Por isso usamos goto.)
where node >nul 2>&1
if not errorlevel 1 goto :node_ok
if exist "C:\Program Files\nodejs\node.exe" set "NODEJS_DIR=C:\Program Files\nodejs"
if exist "%USERPROFILE%\desenv\tools\node-v22.23.4-win-x64\node.exe" set "NODEJS_DIR=%USERPROFILE%\desenv\tools\node-v22.23.4-win-x64"
if defined NODEJS_DIR set "PATH=%NODEJS_DIR%;%PATH%"
:node_ok

where node >nul 2>&1
if errorlevel 1 goto :node_missing
goto :node_ok2
:node_missing
echo [ERRO] Node.js nao encontrado no PATH.
echo Instale o Node.js LTS em https://nodejs.org e tente novamente.
pause
exit /b 1
:node_ok2

echo Node:
node --version
echo npm:
call npm --version
echo.

rem --- 1. Kloud Games: compilar e gerar o MSI ------------------
echo =============================================================
echo  [1/2] Kloud Games - build do MSI
echo =============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%HUB%\scripts\build-kloud-games.ps1"
if errorlevel 1 (
    echo.
    echo [ERRO] O build do Kloud Games falhou. Veja as mensagens acima.
    pause
    exit /b 1
)

rem --- 2. Kolnd Hub: gerar o instalador .exe --------------------
echo.
echo =============================================================
echo  [2/2] Kolnd Hub - build do instalador .exe
echo =============================================================

if not exist "node_modules" (
    echo [INFO] node_modules nao encontrado. Rodando npm install...
    call npm install
    if errorlevel 1 (
        echo [ERRO] npm install falhou.
        pause
        exit /b 1
    )
)

echo.
echo [INFO] Gerando o instalador... (pode levar varios minutos)
echo.
call npm run package
if errorlevel 1 (
    echo.
    echo [ERRO] Build do Kolnd Hub falhou. Veja as mensagens acima.
    pause
    exit /b 1
)

echo.
echo =============================================================
echo  [OK] Tudo pronto!
echo =============================================================
echo  Kloud Games MSI : %HUB%\resources\programs\kloud-games\KLOUD_GAMES.msi
echo  Instalador Hub  : %HUB%\dist\Kolnd Hub Setup 1.0.0.exe
echo =============================================================
echo.
pause
endlocal
