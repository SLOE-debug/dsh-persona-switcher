"""Controlled integration; no running DSH process or model endpoint is used."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from transport import InspectorTransport, inspector_endpoint
from windows_process import CREATE_NO_WINDOW, HarnessProcess, default_install_dir


# A known sample used only by tests. Production discovery does not use this path.
SAMPLE_MEMBER = "node_modules/@deepseek-ai/dsh-llm/lib/index.js"
SYNTHETIC_RUNTIME = """
export class LlmRuntime {
  forAdapter(options, adapter) {
    // signature revision one
    const messages = options.messages.map(message => {
      if (message.role !== 'assistant') return message;
      const source = message.source;
      if (source.replayState === undefined) return message;
      if (this.adapters.get(source.provider)?.adapter === adapter) return message;
      return Object.freeze({...message, source: {
        kind: 'model', provider: source.provider, model: source.model
      }});
    });
    if (messages.every((message, index) => message === options.messages[index])) return options;
    const filtered = {...options, messages};
    return Object.isFrozen(options) ? Object.freeze(filtered) : filtered;
  }
  async *stream(options) {
    const adapter = {};
    const dispatch = () => ({async *[Symbol.asyncIterator]() {}});
    yield* dispatch(this.forAdapter(options, adapter))[Symbol.asyncIterator]();
  }
}
"""


@unittest.skipUnless(os.name == "nt", "Windows Electron fixture")
class PackagedRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.install = default_install_dir()
        cls.executable = cls.install / "DSH Desktop.exe"
        if not cls.executable.is_file():
            raise unittest.SkipTest("DSH packaged Node fixture is not installed")
        cls.fixture = ROOT / "tests/runtime_fixture.mjs"
        cls.transport = InspectorTransport(ROOT)

    @contextmanager
    def running_fixture(self, module_url, roots):
        env = {**os.environ, "ELECTRON_RUN_AS_NODE": "1"}
        env.pop("NODE_OPTIONS", None)
        child = subprocess.Popen(
            [str(self.executable), str(self.fixture), module_url],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
            env=env, creationflags=CREATE_NO_WINDOW,
        )
        try:
            line = child.stdout.readline()
            if not line:
                _, error = child.communicate(timeout=10)
                self.fail("Controlled runtime fixture failed to start: " + error[:1000])
            ready = json.loads(line)
            self.assertTrue(ready["ready"])
            self.assertEqual(ready["pid"], child.pid)
            process = HarnessProcess(
                child.pid, str(time.time_ns()), str(self.executable),
                (str(self.fixture),), tuple(map(str, roots)),
            )
            yield process
        finally:
            if child.poll() is None:
                child.terminate()
            child.communicate(timeout=10)

    def discover(self, process, cache_folder, *, force=False):
        return self.transport.request(
            process, "discover", roots=list(process.roots), cacheFolder=str(cache_folder),
            targetModule=str(ROOT / "runtime_target.mjs"), force=force,
        )

    def assert_temporary_inspector_closed(self, process):
        self.assertIsNone(inspector_endpoint(process.pid), "temporary Inspector must close")

    def test_attach_discover_switch_reset_and_restart_with_shipped_runtime(self):
        archive = self.install / "resources/app.asar"
        if not archive.is_file():
            self.skipTest("The known installed ASAR sample is unavailable")
        module_url = (archive / SAMPLE_MEMBER).as_uri()
        with TemporaryDirectory(prefix="dsh-runtime-cache-") as folder:
            with self.running_fixture(module_url, [self.install]) as process:
                discovery = self.discover(process, folder)
                self.assertFalse(discovery["cacheHit"])
                self.assertGreaterEqual(discovery["proof"]["verifiedInstances"], 1)
                self.assertEqual(discovery["candidate"]["methodName"], "forAdapter")
                cached = self.discover(process, folder)
                self.assertTrue(cached["cacheHit"])
                self.assertEqual(cached["candidate"], discovery["candidate"])
                rescanned = self.discover(process, folder, force=True)
                self.assertFalse(rescanned["cacheHit"])
                self.assertEqual(rescanned["candidate"], discovery["candidate"])
                expression = "runPersonaFixture(" + json.dumps(discovery["candidate"]) + ")"
                value = self.transport.request(process, "evaluate", expression=expression)
                self.assertTrue(value["passed"])
                self.assertGreaterEqual(value["checks"], 25)
                self.assertFalse(value["persistedInputChanged"])
                self.assertTrue(value["restartPending"])
                self.assert_temporary_inspector_closed(process)
            with self.running_fixture(module_url, [self.install]) as restarted:
                status = self.transport.control(restarted, "status")
                self.assertFalse(status["active"])
                self.assertEqual(status["phase"], "standard")
                self.assertEqual(status["appliedRequests"], 0)
                self.assert_temporary_inspector_closed(restarted)

    def test_discovery_cache_invalidates_when_loaded_method_signature_changes(self):
        with TemporaryDirectory(prefix="dsh-source-fixture-") as folder:
            directory = Path(folder)
            source = directory / "runtime.mjs"
            source.write_text(SYNTHETIC_RUNTIME, encoding="utf-8")
            cache = directory / "discovery-cache"
            with self.running_fixture(source.as_uri(), [directory]) as process:
                first = self.discover(process, cache)
                self.assertFalse(first["cacheHit"])
                self.assertGreaterEqual(first["proof"]["verifiedInstances"], 1)
                self.assertTrue(self.discover(process, cache)["cacheHit"])
                self.assertFalse(self.discover(process, cache, force=True)["cacheHit"])
                self.assert_temporary_inspector_closed(process)
            source.write_text(SYNTHETIC_RUNTIME.replace("revision one", "revision two"), encoding="utf-8")
            with self.running_fixture(source.as_uri(), [directory]) as changed:
                second = self.discover(changed, cache)
                self.assertFalse(second["cacheHit"], "changed loaded source must invalidate cache")
                self.assertEqual(first["candidate"]["url"], second["candidate"]["url"])
                self.assertNotEqual(first["candidate"]["sourceSha256"], second["candidate"]["sourceSha256"])
                self.assertNotEqual(first["candidate"]["methodSha256"], second["candidate"]["methodSha256"])
                with self.assertRaisesRegex(RuntimeError, "运行中的函数与发现结果不一致"):
                    self.transport.control(changed, "apply", candidate=first["candidate"], name="旧签名", text="必须拒绝")
                self.assertFalse(self.transport.control(changed, "status")["active"])
                status = self.transport.control(
                    changed, "apply", candidate=second["candidate"], name="新签名", text="简洁回答",
                )
                self.assertTrue(status["active"])
                self.assertEqual(status["phase"], "armed")
                self.assertFalse(self.transport.control(changed, "reset")["active"])
                self.assert_temporary_inspector_closed(changed)


if __name__ == "__main__":
    unittest.main()
