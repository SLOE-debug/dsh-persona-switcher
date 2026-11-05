"""Coordinate discovery, persona changes and status without saving a persona."""
from pathlib import Path
import threading

from persona_store import PersonaStore
from transport import InspectorTransport
from windows_process import default_install_dir, discover_harness


class PersonaController:
    def __init__(self, folder: Path, install_dir: Path | None = None, *, data_dir: Path | None = None,
                 personas_dir: Path | None = None, node_executable: Path | None = None):
        self.folder = folder.resolve()
        self.data_dir = (data_dir or self.folder).resolve()
        self.install_dir = (install_dir or default_install_dir()).resolve()
        self.store = PersonaStore(personas_dir or self.folder / "personas")
        self.transport = InspectorTransport(self.folder, self.data_dir, node_executable)
        self._lock = threading.Lock()
        self._identity = None
        self._candidate = None
        self._discovery = None
        self._inspect_status = False

    def _process(self):
        processes = discover_harness(self.install_dir)
        if not processes:
            raise RuntimeError("请先打开 DSH Desktop，等待聊天界面加载后重试。")
        if len(processes) != 1:
            raise RuntimeError("检测到多个候选宿主，请只保留一个 DSH 实例后重试。")
        process = processes[0]
        identity = (process.pid, process.created, process.executable)
        if identity != self._identity:
            self._candidate = self._discovery = None
            self._inspect_status = False
            self._identity = identity
        return process

    def _present(self, state):
        result = {"connected": True, **state}
        phase = state.get("phase", "ready")
        name = state.get("persona", "")
        result["message"] = {
            "standard": "当前使用标准提示词。",
            "ready": "请求入口已识别，可以切换人格。",
            "armed": f"「{name}」已就绪，等待下一次标准会话请求。",
            "observed": f"已处理 {state.get('appliedRequests', 0)} 次符合范围的请求。",
        }.get(phase, "DSH 已连接。")
        if self._discovery:
            result["discovery"] = self._discovery
        return result

    def status(self):
        with self._lock:
            try:
                process = self._process()
            except RuntimeError as exc:
                return {"connected": False, "message": str(exc), "phase": "connected"}
            if not self._inspect_status:
                return {"connected": True, "phase": "connected", "message": "DSH 已运行，可以识别入口并切换人格。"}
            state = self.transport.control(process, "status")
            if not state["active"] and self._candidate:
                state["phase"] = "ready"
            return self._present(state)

    def _discover(self, process, force=False):
        # An already installed patch holds its exact runtime target in process memory.
        current = self.transport.control(process, "status")
        if current["active"]:
            self._candidate = current["candidate"]
            self._inspect_status = True
            self._discovery = {
                "module": self._candidate["url"], "exportName": self._candidate["exportName"],
                "methodName": self._candidate["methodName"], "cacheHit": False,
            }
            return self._present(current)
        report = self.transport.request(
            process, "discover", roots=list(process.roots), force=force,
            targetModule=str(self.transport.payload_folder / "runtime_target.mjs"),
            cacheFolder=str(self.data_dir / ".discovery-cache"),
        )
        self._candidate = report["candidate"]
        self._discovery = {"module": self._candidate["url"], "exportName": self._candidate["exportName"],
                           "methodName": self._candidate["methodName"], "cacheHit": report["cacheHit"]}
        self._inspect_status = True
        return self._present({"phase": "ready", "appliedRequests": 0, "skippedRequests": 0})

    def discover(self):
        with self._lock:
            process = self._process()
            try:
                return self._discover(process, force=True)
            except RuntimeError as exc:
                self._candidate = self._discovery = None
                return {"connected": True, "phase": "unsupported", "message": str(exc)}

    def apply(self, name, text):
        if not name.strip() or len(name) > 128 or not text.strip() or len(text.encode("utf-8")) > 65536:
            raise ValueError("请选择有内容且不超过 64 KiB 的 Markdown 人格。")
        with self._lock:
            process = self._process()
            if self._candidate is None:
                self._discover(process)
            state = self.transport.control(process, "apply", name=name, text=text, candidate=self._candidate)
            self._inspect_status = True
            return self._present(state)

    def reset(self):
        with self._lock:
            process = self._process()
            state = self.transport.control(process, "reset")
            self._inspect_status = False
            return self._present(state)
