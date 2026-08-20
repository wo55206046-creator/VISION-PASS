@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -File "%~dp0deploy-github.ps1"
if %errorlevel% neq 0 pause
