@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-PowerBI-OpenCode.ps1" -ProjectPath "%CD%" %*