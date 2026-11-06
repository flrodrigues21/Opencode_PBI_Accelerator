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
if not "%OPENCODE_ENV_CAPTURE%"=="" (
  >"%OPENCODE_ENV_CAPTURE%" echo %POWERBI_EXECUTION_TASK_ID%
  >>"%OPENCODE_ENV_CAPTURE%" echo %POWERBI_EXECUTION_MODE%
  >>"%OPENCODE_ENV_CAPTURE%" echo %POWERBI_INTERACTIVE_SESSION_ID%
)
exit /b 0
