@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0.."
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"

if not exist "%VSWHERE%" (
  echo Visual Studio Build Tools were not found. 1>&2
  exit /b 1
)

for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSINSTALL=%%I"
if not defined VSINSTALL (
  echo Visual C++ Build Tools were not found. 1>&2
  exit /b 1
)

call :build x64
if errorlevel 1 exit /b %errorlevel%
call :build arm64
if errorlevel 1 exit /b %errorlevel%
exit /b 0

:build
set "TARGET_ARCH=%~1"
call "%VSINSTALL%\Common7\Tools\VsDevCmd.bat" -no_logo -host_arch=x64 -arch=%TARGET_ARCH%
if errorlevel 1 exit /b %errorlevel%

set "OUTPUT_DIR=%PROJECT_ROOT%\build\native\windows\%TARGET_ARCH%"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

cl /nologo /std:c++17 /O2 /EHsc /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00 ^
  "%PROJECT_ROOT%\native\windows\SystemAudioCapture.cpp" ^
  /Fe:"%OUTPUT_DIR%\minuteframe-audio-capture.exe" ^
  /link Ole32.lib Uuid.lib
exit /b %errorlevel%
