param([switch]$UnitOnly, [string]$Executable)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$build = Join-Path $project 'build\native-tests'
New-Item -ItemType Directory -Force -Path $build | Out-Null
if (-not $Executable) {
    & (Join-Path $PSScriptRoot 'build.ps1') -SkipArchive
    $Executable = Join-Path $project 'dist\native\DSH人格切换器-C++.exe'
}
$Executable = [IO.Path]::GetFullPath($Executable)
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw '请安装 Visual Studio C++ 桌面开发工具。' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
$sources = @(
    Get-ChildItem -LiteralPath (Join-Path $project 'tests') -Filter '*.cpp' -File
    Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cpp' -File | Where-Object { $_.Name -notin @('main.cpp','gui.cpp') }
) | ForEach-Object { '"' + $_.FullName + '"' }
$resource = Join-Path $project 'build\native\assets.res'
if (-not (Test-Path -LiteralPath $resource)) { throw '缺少编译资源，请先运行 native/build.ps1。' }
$arguments = if ($UnitOnly) { '--unit-only' } else { '"' + $project + '" "' + $Executable + '"' }
$commands = @"
@echo off
chcp 65001 >nul
call "$vcvars" >nul
if errorlevel 1 exit /b 1
cd /d "$build"
cl /nologo /std:c++20 /utf-8 /MT /EHsc /W3 /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_WIN32_WINNT=0x0A00 $($sources -join ' ') "$resource" /Fe:native-tests.exe /link shell32.lib ole32.lib oleaut32.lib bcrypt.lib version.lib wbemuuid.lib iphlpapi.lib ws2_32.lib winhttp.lib
if errorlevel 1 exit /b 1
native-tests.exe $arguments
exit /b %errorlevel%
"@
$commandFile = Join-Path $build 'test.cmd'
[IO.File]::WriteAllText($commandFile, $commands.Replace("`r`n","`n").Replace("`n","`r`n"), [Text.UTF8Encoding]::new($false))
& $env:ComSpec /d /c $commandFile
if ($LASTEXITCODE -ne 0) { throw "原生检查失败：$LASTEXITCODE" }
