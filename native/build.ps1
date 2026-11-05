param([switch]$SkipArchive)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$build = Join-Path $project 'build\native'
$release = Join-Path $project 'dist\native'
New-Item -ItemType Directory -Force -Path $build, $release | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, $utf8) }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw '请安装 Visual Studio C++ 桌面开发工具。' }
$vcvars = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
$acorn = Join-Path $project 'node_modules\acorn\dist\acorn.js'
if (-not (Test-Path -LiteralPath $acorn)) { throw '缺少 Acorn，请先在项目目录执行 npm ci。' }
$scanner = [IO.File]::ReadAllText((Join-Path $project 'discovery\semantic_scan.mjs'))
$scanner = $scanner.Replace("import { parse } from 'acorn';", '').Replace('export function scanSource', 'function scanSource')
Write-Utf8 (Join-Path $build 'scanner.js') $scanner
$personas = [ordered]@{}
Get-ChildItem -LiteralPath (Join-Path $project 'personas') -Filter '*.md' -File | ForEach-Object { $personas[$_.Name] = [IO.File]::ReadAllText($_.FullName) }
Write-Utf8 (Join-Path $build 'personas.json') ($personas | ConvertTo-Json -Depth 4 -Compress)
$licenses = "Acorn (MIT)`r`n" + [IO.File]::ReadAllText((Join-Path $project 'node_modules\acorn\LICENSE')) + "`r`nnlohmann/json (MIT)`r`n" + [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'vendor\JSON-LICENSE.txt'))
Write-Utf8 (Join-Path $build 'licenses.txt') $licenses
$manifest = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
 <assemblyIdentity version="3.0.0.0" processorArchitecture="amd64" name="DSH.Persona.Native" type="win32"/>
 <description>DSH Persona Switcher</description>
 <dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="amd64" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency>
 <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
</assembly>
'@
Write-Utf8 (Join-Path $build 'app.manifest') $manifest
$resources = @{
    101 = $acorn
    102 = Join-Path $build 'scanner.js'
    103 = Join-Path $project 'runtime_patch.mjs'
    104 = Join-Path $project 'runtime_target.mjs'
    105 = Join-Path $project 'request_contract.mjs'
    106 = Join-Path $build 'personas.json'
    107 = Join-Path $build 'licenses.txt'
}
$rc = "#include <windows.h>`r`n1 RT_MANIFEST `"$((Join-Path $build 'app.manifest').Replace('\','/'))`"`r`n"
foreach ($id in ($resources.Keys | Sort-Object)) { $rc += "$id RCDATA `"$($resources[$id].Replace('\','/'))`"`r`n" }
Write-Utf8 (Join-Path $build 'assets.rc') $rc
$sources = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cpp' -File | ForEach-Object { '"' + $_.FullName + '"' }
$exe = Join-Path $release 'DSH人格切换器-C++.exe'
$commands = @"
@echo off
chcp 65001 >nul
call "$vcvars" >nul
if errorlevel 1 exit /b 1
cd /d "$build"
rc /nologo /c65001 /fo assets.res assets.rc
if errorlevel 1 exit /b 1
cl /nologo /std:c++20 /utf-8 /MT /O1 /GL /Gy /Gw /EHsc /W3 /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_WIN32_WINNT=0x0A00 $($sources -join ' ') assets.res /Fe:"$exe" /link /LTCG /OPT:REF /OPT:ICF /SUBSYSTEM:WINDOWS user32.lib gdi32.lib comctl32.lib shell32.lib ole32.lib oleaut32.lib wbemuuid.lib iphlpapi.lib ws2_32.lib winhttp.lib bcrypt.lib
exit /b %errorlevel%
"@
# Use UTF-8 and CRLF so cmd.exe reads Chinese paths correctly.
[IO.File]::WriteAllText((Join-Path $build 'compile.cmd'), $commands.Replace("`r`n","`n").Replace("`n","`r`n"), [Text.UTF8Encoding]::new($false))
& $env:ComSpec /d /c (Join-Path $build 'compile.cmd')
if ($LASTEXITCODE -ne 0) { throw "C++ 编译失败：$LASTEXITCODE" }
Write-Utf8 (Join-Path $release '第三方许可.txt') $licenses
$usage = @'
DSH 人格切换器 · 原生 C++ 版（Windows x64）
双击 EXE，打开 DSH 后选择人格，点击“切换人格”。
首次运行会在 EXE 旁生成 personas 文件夹；编辑 UTF-8 .md 文件后点击“刷新列表”。
切换只对当前 DSH 进程生效，DSH 重启后需要重新切换。
“恢复标准”会撤销人格；关闭切换器会保留已经应用的人格。
支持标准预设，跳过其他预设和辅助请求。请求命中不代表模型已成功响应。
不需要安装 Python 或 Node。少量 JavaScript 在 DSH 自己的运行时中执行。
运行缓存位于 %LOCALAPPDATA%\DSH-Persona-Switcher\native-cache。
更新后如果无法唯一核验入口，会停止注入；不能保证任意未来内部改动都能自动适配。
'@
Write-Utf8 (Join-Path $release '使用说明.txt') $usage
if (-not $SkipArchive) {
    Compress-Archive -LiteralPath $exe, (Join-Path $release '第三方许可.txt'), (Join-Path $release '使用说明.txt') -DestinationPath (Join-Path $project 'dist\DSH人格切换器-C++-Windows-x64.zip') -Force
}
$hash = Get-FileHash -LiteralPath $exe -Algorithm SHA256
Write-Utf8 (Join-Path $release 'SHA256.txt') ($hash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($exe) + "`r`n")
Write-Output ("EXE: {0} ({1} bytes)" -f $exe, (Get-Item -LiteralPath $exe).Length)
Write-Output ("SHA256: {0}" -f $hash.Hash)
