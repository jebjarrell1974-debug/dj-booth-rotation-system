@echo off
rem NEON DJ demo updater — double-click to update the demo to the same code the
rem fleet runs. Close the NEON DJ window first. Keys/music/settings are kept.
cd /d "%~dp0"
if exist runtime\node.exe (
  runtime\node.exe updater\update.mjs
) else (
  echo [X] Cannot find runtime\node.exe - place this file in the NEON DJ demo folder (next to NEON DJ.exe).
)
echo.
pause
