"""Temporary, process-local control. No installation/configuration writes."""
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.error
import urllib.request

from asar_reader import BuildMismatchError, validate_build
from persona_store import PersonaStore
from windows_process import CREATE_NO_WINDOW, default_install_dir, discover_harness, listening_ports


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def inspector_endpoint(pid: int) -> str | None:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    for port in listening_ports(pid):
        endpoint = f"http://127.0.0.1:{port}"
        try:
            with opener.open(endpoint + "/json/list", timeout=0.5) as response:
                targets = json.loads(response.read(65536))
            if isinstance(targets, list) and any(
                isinstance(row, dict) and row.get("type") == "node"
                and isinstance(row.get("webSocketDebuggerUrl"), str) for row in targets
            ):
                return endpoint
        except (OSError, ValueError, urllib.error.URLError):
            continue
    return None


class PersonaController:
    def __init__(self, folder: Path, install_dir: Path | None = None):
        self.folder = folder.resolve()
        self.install_dir = (install_dir or default_install_dir()).resolve()
        self.store = PersonaStore(self.folder / "personas")
        self._lock = threading.Lock()
        self._identity = None
        self._persona = ""

    def _process(self):
        processes = discover_harness(self.install_dir)
        if not processes:
            raise RuntimeError("请先打开 DSH Desktop，等待聊天界面加载后再切换。")
        if len(processes) != 1:
            raise RuntimeError("检测到多个 DSH 宿主进程。请只保留一个 DSH 实例后重试。")
        return processes[0]

    def _helper(self, request):
        env = dict(os.environ)
        env["ELECTRON_RUN_AS_NODE"] = "1"
        env.pop("NODE_OPTIONS", None)
        result = subprocess.run(
            [str(self.install_dir / "DSH Desktop.exe"), str(self.folder / "inspector_client.mjs")],
            input=json.dumps(request, ensure_ascii=True), capture_output=True,
            encoding="utf-8", errors="replace", env=env, timeout=30,
            creationflags=CREATE_NO_WINDOW,
        )
        try:
            reply = json.loads(result.stdout)
        except ValueError as exc:
            raise RuntimeError("DSH 调试连接未返回有效结果，请关闭工具后重试。") from exc
        if result.returncode or not reply.get("ok"):
            detail = str(reply.get("error", "连接失败"))[:500]
            raise RuntimeError(f"无法切换人格：{detail}")
        return reply.get("result")

    def status(self):
        with self._lock:
            processes = discover_harness(self.install_dir)
            if not processes:
                self._identity, self._persona = None, ""
                return {"connected": False, "message": "未找到 DSH。请先打开 DSH Desktop。"}
            if len(processes) != 1:
                return {"connected": False, "message": "检测到多个 DSH 宿主进程，请只保留一个实例。"}
            current = processes[0]
            identity = (current.pid, current.created)
            if self._identity is not None and self._identity != identity:
                self._identity, self._persona = identity, ""
                return {"connected": True, "message": "DSH 已重新启动，临时人格已清除。"}
            self._identity = identity
            message = f"当前人格：{self._persona}。下一次请求生效。" if self._persona else "DSH 已运行，可选择人格并切换。"
            return {"connected": True, "message": message}

    def _control(self, action: str, name="", text=""):
        try:
            module_url = validate_build(self.install_dir)
        except (OSError, ValueError, KeyError, BuildMismatchError) as exc:
            if isinstance(exc, BuildMismatchError):
                raise
            raise RuntimeError("无法核验 DSH 安装目录，请检查安装是否完整。") from exc
        process = self._process()
        endpoint = inspector_endpoint(process.pid)
        opened_here = endpoint is None
        if opened_here:
            self._helper({"action": "activate", "pid": process.pid})
            deadline = time.monotonic() + 6
            while endpoint is None and time.monotonic() < deadline:
                time.sleep(0.15)
                endpoint = inspector_endpoint(process.pid)
        if endpoint is None:
            raise RuntimeError("未能连接 DSH 的临时调试端口。请确认两者权限一致后重试。")
        payload = {"action": action, "name": name, "text": text, "moduleUrl": module_url}
        patch_path = str(self.folder / "runtime_patch.mjs")
        expression = (
            "(async () => { const module = process.getBuiltinModule('module').createRequire("
            + json.dumps(patch_path) + ")(" + json.dumps(patch_path) + ");"
            " return await module.control(" + json.dumps(payload, ensure_ascii=True) + "); })()"
        )
        reply = self._helper({
            "action": "evaluate", "pid": process.pid, "endpoint": endpoint,
            "expectedExecutable": str(self.install_dir / "DSH Desktop.exe"),
            "expectedEntry": str(self.install_dir / "resources" / "app.asar" /
                                 "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"),
            "expression": expression, "closeInspector": opened_here,
        })
        self._identity = (process.pid, process.created)
        self._persona = reply["persona"]
        return reply

    def apply(self, name: str, text: str):
        if not name.strip() or not text.strip() or len(text.encode("utf-8")) > 65536:
            raise ValueError("请选择有内容且不超过 64 KiB 的 Markdown 人格。")
        with self._lock:
            reply = self._control("apply", name, text)
        return {"connected": True, "message": f"已切换为「{reply['persona']}」，标准模式的下一次请求生效。"}

    def reset(self):
        with self._lock:
            self._control("reset")
        return {"connected": True, "message": "已恢复标准提示词，下一次请求生效。"}
