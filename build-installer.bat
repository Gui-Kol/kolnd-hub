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
rem        kolnd-hub\dist\Kolnd Hub Setup <versao>.exe
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
rem Preenche o PATH com o diretorio do Node.js para garantir que cmd.exe
rem encontre node e npm mesmo quando existem entradas corrompidas no PATH.
set "NODEJS_DIR="
if exist "C:\Program Files\nodejs\node.exe" set "NODEJS_DIR=C:\Program Files\nodejs"
if exist "%USERPROFILE%\desenv\tools\node-v22.23.4-win-x64\node.exe" set "NODEJS_DIR=%USERPROFILE%\desenv\tools\node-v22.23.4-win-x64"
if defined NODEJS_DIR set "PATH=%NODEJS_DIR%;%PATH%"

where node >nul 2>&1
if errorlevel 1 goto :node_missing
where npm >nul 2>&1
if errorlevel 1 goto :npm_missing
goto :node_ok
:node_missing
echo [ERRO] Node.js nao encontrado no PATH.
echo Instale o Node.js LTS em https://nodejs.org e tente novamente.
pause
exit /b 1
:npm_missing
echo [ERRO] npm nao encontrado no PATH.
echo Instale o Node.js LTS (que inclui o npm) em https://nodejs.org e tente novamente.
pause
exit /b 1
:node_ok

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

rem --- Le a versao do kolnd-hub\package.json para o resumo final ---
rem (via arquivo temporario; fallback para 1.4.0 se o node falhar)
set "HUB_VERSION="
node -p "require('%HUB%/package.json').version" > "%TEMP%\kolnd-hub-version.txt" 2>nul
set /p HUB_VERSION=< "%TEMP%\kolnd-hub-version.txt"
del /q "%TEMP%\kolnd-hub-version.txt" >nul 2>&1
if not defined HUB_VERSION set "HUB_VERSION=1.4.0"

echo.
echo =============================================================
echo  [OK] Tudo pronto!
echo =============================================================
echo  Kloud Games MSI : %HUB%\resources\programs\kloud-games\KLOUD_GAMES.msi
echo  Instalador Hub  : %HUB%\dist\Kolnd Hub Setup %HUB_VERSION%.exe
echo =============================================================
echo.
pause
endlocal
