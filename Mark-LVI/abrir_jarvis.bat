@echo off
cd /d "%~dp0"
py main.py
if errorlevel 1 (
    echo.
    echo O JARVIS encerrou com erro. Veja a mensagem acima.
    pause
)
