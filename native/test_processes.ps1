$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$build = Join-Path $project 'build\native-process-tests'
New-Item -ItemType Directory -Force -Path $build | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw '请安装 Visual Studio C++ 桌面开发工具。' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
$commands = @"
@echo off
chcp 65001 >nul
call "$vcvars" >nul
if errorlevel 1 exit /b 1
cd /d "$build"
cl /nologo /std:c++20 /utf-8 /MT /EHsc /W3 /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN "$project\tests\native_host_discovery.cpp" "$PSScriptRoot\host_discovery.cpp" "$PSScriptRoot\host_settings.cpp" "$PSScriptRoot\common.cpp" /Fe:host-tests.exe /link shell32.lib ole32.lib bcrypt.lib version.lib
if errorlevel 1 exit /b 1
host-tests.exe
exit /b %errorlevel%
"@
$commandFile = Join-Path $build 'test.cmd'
[IO.File]::WriteAllText($commandFile, $commands.Replace("`r`n", "`n").Replace("`n", "`r`n"), [Text.UTF8Encoding]::new($false))
& $env:ComSpec /d /c $commandFile
if ($LASTEXITCODE -ne 0) { throw "进程发现测试失败：$LASTEXITCODE" }
