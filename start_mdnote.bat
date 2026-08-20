@echo off
REM MDNote - Windows launcher
REM Launches Google Chrome or Microsoft Edge in "app mode": no address
REM bar, no tabs, just a standalone-looking window.

setlocal
set "APPDIR=%~dp0"
set "INDEX=%APPDIR%index.html"

set "CHROME1=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME2=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "EDGE1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%CHROME1%" (
  start "" "%CHROME1%" --app="file:///%INDEX:\=/%" --window-size=1280,860
  goto :eof
)
if exist "%CHROME2%" (
  start "" "%CHROME2%" --app="file:///%INDEX:\=/%" --window-size=1280,860
  goto :eof
)
if exist "%EDGE1%" (
  start "" "%EDGE1%" --app="file:///%INDEX:\=/%" --window-size=1280,860
  goto :eof
)
if exist "%EDGE2%" (
  start "" "%EDGE2%" --app="file:///%INDEX:\=/%" --window-size=1280,860
  goto :eof
)

echo Could not find Google Chrome or Microsoft Edge.
echo Please open index.html directly in your browser instead.
pause
