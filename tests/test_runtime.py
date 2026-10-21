"""Integration against this installation's packaged Node and actual LlmRuntime."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from asar_reader import validate_build
from bridge_client import PersonaController, inspector_endpoint
from windows_process import CREATE_NO_WINDOW, default_install_dir


class PackagedRuntimeTests(unittest.TestCase):
    def test_attach_switch_reset_and_restart(self):
        install = default_install_dir()
        module_url = validate_build(install)
        controller = PersonaController(ROOT)
        fixture = ROOT / "tests/runtime_fixture.mjs"
        env = {**os.environ, "ELECTRON_RUN_AS_NODE": "1"}
        env.pop("NODE_OPTIONS", None)
        for turn in range(2):
            process = subprocess.Popen(
                [str(install / "DSH Desktop.exe"), str(fixture), module_url],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                env=env, creationflags=CREATE_NO_WINDOW,
            )
            try:
                ready = json.loads(process.stdout.readline())
                self.assertTrue(ready["ready"])
                controller._helper({"action": "activate", "pid": process.pid})
                endpoint = None
                for _ in range(30):
                    endpoint = inspector_endpoint(process.pid)
                    if endpoint:
                        break
                    time.sleep(0.1)
                self.assertIsNotNone(endpoint)
                with self.assertRaisesRegex(RuntimeError, "expected PID"):
                    controller._helper({
                        "action": "evaluate", "pid": process.pid + 1, "endpoint": endpoint,
                        "expectedExecutable": str(install / "DSH Desktop.exe"),
                        "expectedEntry": str(fixture), "expression": "true",
                    })
                expression = "runPersonaFixture()" if turn == 0 else (
                    "process.getBuiltinModule('module').createRequire(" + json.dumps(str(fixture)) +
                    ")(" + json.dumps(str(ROOT / 'runtime_patch.mjs')) + ").control({action:'status'})"
                )
                value = controller._helper({
                    "action": "evaluate", "pid": process.pid, "endpoint": endpoint,
                    "expectedExecutable": str(install / "DSH Desktop.exe"),
                    "expectedEntry": str(fixture), "expression": expression, "closeInspector": True,
                })
                if turn == 0:
                    self.assertTrue(value["passed"])
                    self.assertTrue(value["restartPending"])
                else:
                    self.assertFalse(value["active"])
                time.sleep(0.4)
                self.assertIsNone(inspector_endpoint(process.pid), 'temporary Inspector closes')
            finally:
                process.terminate()
                process.communicate(timeout=10)


if __name__ == "__main__":
    unittest.main()
