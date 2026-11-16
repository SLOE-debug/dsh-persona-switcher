param([switch]$Verify)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$hosts = @()
foreach ($process in (Get-CimInstance Win32_Process)) {
    if (-not $process.ExecutablePath -or -not $process.CommandLine -or $process.CommandLine -match '--type=') { continue }
    $scripts = [regex]::Matches($process.CommandLine, '(?:"([^"\r\n]+\.(?:mjs|cjs|js))"|(\S+\.(?:mjs|cjs|js)))(?=\s|$)')
    if ($scripts.Count -eq 0) { continue }
    $entry = if ($scripts[0].Groups[1].Success) { $scripts[0].Groups[1].Value } else { $scripts[0].Groups[2].Value }
    $application = Get-Item -LiteralPath $process.ExecutablePath -ErrorAction SilentlyContinue
    if ($application.VersionInfo.ProductName -ne 'DSH Desktop') { continue }
    $package = Join-Path $application.DirectoryName 'resources\app.asar'
    if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { continue }
    if (-not $entry.StartsWith($package+'\',[StringComparison]::OrdinalIgnoreCase)) { continue }
    $hosts += [pscustomobject]@{Pid=$process.ProcessId;Executable=$application.FullName;Entry=$entry}
}
if ($hosts.Count -ne 1) { throw '请先打开一个 DSH Desktop，等待聊天界面加载后再次双击安装。' }
$target = $hosts[0]
$priorRunAsNode = $env:ELECTRON_RUN_AS_NODE
$priorNodeOptions = $env:NODE_OPTIONS
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:NODE_OPTIONS = $null
    $program=if($Verify){Join-Path $repository 'tests\probe_live_plugin.mjs'}else{Join-Path $PSScriptRoot 'install-plugin.mjs'}
    $arguments = @($program,[string]$target.Pid,$target.Executable,$target.Entry,$repository)
    $quoted = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $logBase = Join-Path ([IO.Path]::GetTempPath()) ('dsh-persona-install-' + [guid]::NewGuid().ToString('N'))
    Write-Host '正在连接 DSH 并安装插件，请稍候…'
    $child = Start-Process -FilePath $target.Executable -ArgumentList $quoted -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput ($logBase+'.out') -RedirectStandardError ($logBase+'.err')
    $child.WaitForExit()
    function Read-InstallLog([string]$path) {
        $file = [IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
        $reader = [IO.StreamReader]::new($file,[Text.Encoding]::UTF8)
        try { $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    [Console]::Write((Read-InstallLog ($logBase+'.out')))
    if($child.ExitCode -ne 0) { [Console]::Error.Write((Read-InstallLog ($logBase+'.err'))); throw "插件安装失败，退出码：$($child.ExitCode)" }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $priorRunAsNode
    $env:NODE_OPTIONS = $priorNodeOptions
}
