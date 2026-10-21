"""Find only this installation's Harness processes and PID-owned loopback ports."""
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
import json
import os
from pathlib import Path
import socket
import subprocess


CREATE_NO_WINDOW = 0x08000000


@dataclass(frozen=True)
class HarnessProcess:
    pid: int
    created: str


def default_install_dir() -> Path:
    return Path(os.environ["LOCALAPPDATA"]) / "Programs" / "DSH Desktop"


def discover_harness(install_dir: Path) -> list[HarnessProcess]:
    if os.name != "nt":
        raise RuntimeError("此工具用于 Windows 版 DSH Desktop。")
    script = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$target = $env:DSH_PERSONA_EXPECTED_EXE
$rows = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -ieq $target -and
    $_.CommandLine -match '(?i)[\\/]harness-node-entry\.mjs(?:"|\s|$)'
} | ForEach-Object {
    @{pid = $_.ProcessId; created = $_.CreationDate.ToUniversalTime().ToString('o')}
})
ConvertTo-Json -InputObject $rows -Compress
"""
    env = {**os.environ, "DSH_PERSONA_EXPECTED_EXE": str(install_dir / "DSH Desktop.exe")}
    system_root = Path(os.environ["SystemRoot"])
    powershell = system_root / "System32/WindowsPowerShell/v1.0/powershell.exe"
    result = subprocess.run(
        [str(powershell), "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True, encoding="utf-8-sig", errors="replace", timeout=15,
        creationflags=CREATE_NO_WINDOW, env=env,
    )
    if result.returncode:
        raise RuntimeError("无法读取 DSH 进程，请以与 DSH 相同的用户权限运行。")
    return [HarnessProcess(int(row["pid"]), row["created"]) for row in json.loads(result.stdout)]


class _TcpRow(ctypes.Structure):
    _fields_ = [(name, wintypes.DWORD) for name in
                ("state", "local_addr", "local_port", "remote_addr", "remote_port", "pid")]


def listening_ports(pid: int) -> list[int]:
    api = ctypes.WinDLL("iphlpapi", use_last_error=True).GetExtendedTcpTable
    api.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.ULONG), wintypes.BOOL,
                    wintypes.ULONG, ctypes.c_int, wintypes.ULONG]
    api.restype = wintypes.DWORD
    size = wintypes.ULONG(0)
    code = api(None, ctypes.byref(size), False, socket.AF_INET, 5, 0)
    if code not in (0, 122):
        raise RuntimeError("无法读取 DSH 监听端口。")
    for _ in range(3):
        buffer = ctypes.create_string_buffer(size.value)
        code = api(buffer, ctypes.byref(size), False, socket.AF_INET, 5, 0)
        if code == 122:
            continue
        if code:
            raise RuntimeError("无法读取 DSH 监听端口。")
        count = ctypes.cast(buffer, ctypes.POINTER(wintypes.DWORD))[0]
        rows = ctypes.cast(ctypes.addressof(buffer) + 4, ctypes.POINTER(_TcpRow))
        ports = []
        for index in range(count):
            row = rows[index]
            address = socket.inet_ntoa(int(row.local_addr).to_bytes(4, "little"))
            if row.pid == pid and row.state == 2 and address == "127.0.0.1":
                ports.append(socket.ntohs(row.local_port & 0xffff))
        return sorted(set(ports))
    raise RuntimeError("DSH 端口正在变化，请重试。")
