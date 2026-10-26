@echo off
if "%1"=="--version" (
  echo opencode fixture 1.19.4
  exit /b 0
)
if "%1 %2"=="debug config" (
  type "%OPENCODE_CONFIG%"
  exit /b 0
)
if not "%OPENCODE_CAPTURE%"=="" copy /y "%OPENCODE_CONFIG%" "%OPENCODE_CAPTURE%" >nul
exit /b 0
