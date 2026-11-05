"""Exercise the native EXE against controlled DSH Node processes, never a model API."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from test_runtime import SYNTHETIC_RUNTIME, SAMPLE_MEMBER
from transport import inspector_endpoint

EXE = ROOT / "dist/native/DSH人格切换器-C++.exe"
DSH = Path(os.environ["LOCALAPPDATA"]) / "Programs/DSH Desktop/DSH Desktop.exe"
FIXTURE = ROOT / "tests/runtime_fixture.mjs"


class NativeTests(unittest.TestCase):
    def invoke(self, arguments, report):
        env = {**os.environ, "PATH": str(Path(os.environ["SystemRoot"]) / "System32")}
        result = subprocess.run([str(EXE), *map(str, arguments), str(report)], env=env,
                                timeout=70, creationflags=subprocess.CREATE_NO_WINDOW)
        data = json.loads(report.read_text(encoding="utf-8"))
        self.assertEqual(result.returncode, 0, data)
        self.assertTrue(data["ok"], data)
        return data

    def fixture(self, source, root, report):
        env = {**os.environ, "ELECTRON_RUN_AS_NODE": "1"}
        env.pop("NODE_OPTIONS", None)
        child = subprocess.Popen([str(DSH), str(FIXTURE), source.as_uri()], env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            ready = child.stdout.readline()
            self.assertTrue(ready, "Fixture exited before ready")
            self.assertEqual(json.loads(ready)["pid"], child.pid)
            data = self.invoke(["--fixture-test", child.pid, DSH, FIXTURE, root], report)
            self.assertTrue(data["checks"]["passed"])
            self.assertGreaterEqual(data["checks"]["checks"], 30)
            self.assertTrue(data["cacheHit"])
            self.assertIsNone(inspector_endpoint(child.pid), "Temporary Inspector must close")
            return data
        finally:
            child.terminate()
            child.communicate(timeout=10)

    def test_shipped_runtime(self):
        with tempfile.TemporaryDirectory(prefix="dsh-native-shipped-") as temp:
            install = DSH.parent
            self.fixture(install / "resources/app.asar" / SAMPLE_MEMBER, install, Path(temp) / "report.json")

    def test_layout_and_signature_changes(self):
        with tempfile.TemporaryDirectory(prefix="dsh-native-改名-") as temp:
            folder = Path(temp)
            source = folder / "不固定的模块名.mjs"
            source.write_text(SYNTHETIC_RUNTIME.replace("export class LlmRuntime", "class RenamedRuntime")
                              + "\nexport {RenamedRuntime as LlmRuntime};\n", encoding="utf-8")
            first = self.fixture(source, folder, folder / "first.json")
            source.write_text(source.read_text(encoding="utf-8").replace("revision one", "revision two"), encoding="utf-8")
            second = self.fixture(source, folder, folder / "second.json")
            self.assertNotEqual(first["candidate"]["methodSha256"], second["candidate"]["methodSha256"])
            self.assertNotEqual(first["candidate"]["sourceSha256"], second["candidate"]["sourceSha256"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
