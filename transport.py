"""Short-lived Node Inspector sessions using a separate Node executable."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request

from windows_process import CREATE_NO_WINDOW, listening_ports
from payload_bundle import prepare_payload


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
            if isinstance(targets, list) and any(isinstance(row, dict) and row.get("type") == "node" for row in targets):
                return endpoint
        except (OSError, ValueError, urllib.error.URLError):
            continue
    return None


class InspectorTransport:
    def __init__(self, folder: Path, data_dir: Path | None = None, node_executable: Path | None = None):
        self.folder = folder
        self.data_dir = data_dir or folder
        self.node_executable = node_executable
        self._node = None

    @property
    def payload_folder(self):
        return prepare_payload(self.folder, self.data_dir / ".discovery-cache")

    def helper(self, request):
        env = dict(os.environ)
        env.pop("NODE_OPTIONS", None)
        env.pop("ELECTRON_RUN_AS_NODE", None)
        if self._node is None:
            node = str(self.node_executable) if self.node_executable else shutil.which("node")
            if not node:
                raise RuntimeError("请安装独立的 Node.js 22.15 或更高版本，再重新打开切换器。")
            version = subprocess.run([node, "-p", "JSON.stringify(process.versions.node)"], capture_output=True,
                                     text=True, timeout=10, env=env, creationflags=CREATE_NO_WINDOW)
            parts = tuple(map(int, json.loads(version.stdout).split(".")))
            if version.returncode or parts < (22, 15, 0):
                raise RuntimeError("Node.js 需要 22.15 或更高版本。")
            if not (self.folder / "node_modules/acorn/package.json").is_file():
                raise RuntimeError("缺少代码解析器，请在切换器目录执行 npm ci。")
            self._node = node
        result = subprocess.run([self._node, str(self.folder / "inspector_client.mjs")],
                                input=json.dumps(request, ensure_ascii=True), capture_output=True,
                                encoding="utf-8", errors="replace", env=env, timeout=70,
                                creationflags=CREATE_NO_WINDOW)
        try:
            reply = json.loads(result.stdout)
        except ValueError as exc:
            raise RuntimeError("识别助手没有返回有效结果，请重新连接。") from exc
        if result.returncode or not reply.get("ok"):
            raise RuntimeError(str(reply.get("error", "调试连接失败"))[:700])
        return reply["result"]

    def request(self, process, action, **payload):
        endpoint = inspector_endpoint(process.pid)
        opened_here = endpoint is None
        if opened_here:
            self.helper({"action": "activate", "pid": process.pid})
            deadline = time.monotonic() + 6
            while endpoint is None and time.monotonic() < deadline:
                time.sleep(0.15)
                endpoint = inspector_endpoint(process.pid)
        if endpoint is None:
            raise RuntimeError("目标进程没有开放可用的 Node 调试入口，未注入。")
        request = {
            "action": action, "pid": process.pid, "endpoint": endpoint,
            "expectedExecutable": process.executable, "expectedEntries": list(process.entries),
            "closeInspector": opened_here, **payload,
        }
        try:
            return self.helper(request)
        finally:
            if opened_here:
                # Let the target close the temporary endpoint before another UI operation.
                time.sleep(0.25)

    def control(self, process, action, **payload):
        patch = str(self.payload_folder / "runtime_patch.mjs")
        expression = (
            "process.getBuiltinModule('module').createRequire(" + json.dumps(patch) + ")(" + json.dumps(patch) +
            ").control(" + json.dumps({"action": action, **payload}, ensure_ascii=True) + ")"
        )
        return self.request(process, "evaluate", expression=expression)
