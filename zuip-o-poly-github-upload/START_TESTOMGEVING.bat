@echo off
cd /d "%~dp0"
echo ============================================
echo   Zuip-O-Poly Nijmegen - Testomgeving
echo ============================================
echo.
echo Server wordt gestart op http://127.0.0.1:5173
echo Laat dit venster open zolang je test.
echo Sluit dit venster om de server te stoppen.
echo.
start "" "http://127.0.0.1:5173"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-server.ps1" -Port 5173
