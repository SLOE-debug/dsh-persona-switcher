import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from payload_bundle import FILES, prepare_payload
from status_text import render_status
from windows_process import split_command
from windows_process import HarnessProcess
from bridge_client import PersonaController


class LocalStateTests(unittest.TestCase):
    def test_startup_does_not_open_inspector_or_auto_apply(self):
        process = HarnessProcess(42, 'start', 'C:/DSH/node.exe', ('C:/DSH/main.mjs',), ('C:/DSH',))
        controller = PersonaController(ROOT)
        with patch('bridge_client.discover_harness', return_value=[process]):
            with patch.object(controller.transport, 'control', side_effect=AssertionError('must not attach')):
                self.assertEqual(controller.status()['phase'], 'connected')

    def test_discovery_failure_reports_unsupported_without_an_active_candidate(self):
        process = HarnessProcess(42, 'start', 'C:/DSH/node.exe', ('C:/DSH/main.mjs',), ('C:/DSH',))
        controller = PersonaController(ROOT)
        with patch('bridge_client.discover_harness', return_value=[process]):
            with patch.object(controller, '_discover', side_effect=RuntimeError('multiple candidates')):
                result = controller.discover()
                self.assertEqual(result['phase'], 'unsupported')
                self.assertIsNone(controller._candidate)

    def test_runtime_code_changes_get_fresh_import_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for name in FILES:
                (folder / name).write_text('export const value=1;', encoding='utf-8')
            first = prepare_payload(folder)
            self.assertEqual(first, prepare_payload(folder))
            (folder / 'request_contract.mjs').write_text('export const value=2;', encoding='utf-8')
            second = prepare_payload(folder)
            self.assertNotEqual(first, second)
            self.assertIn('value=1', (first / 'request_contract.mjs').read_text())

    def test_corrupt_code_cache_is_not_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for name in FILES:
                (folder / name).write_text('export {};', encoding='utf-8')
            cached = prepare_payload(folder)
            (cached / 'runtime_patch.mjs').write_text('broken', encoding='utf-8')
            with self.assertRaises(RuntimeError):
                prepare_payload(folder)

    def test_windows_quoted_script_paths(self):
        args = split_command('"C:\\App Dir\\engine.exe" --flag "C:\\App Dir\\renamed.mjs"')
        self.assertEqual(args[-1], r'C:\App Dir\renamed.mjs')

    def test_prepared_state_is_distinct_from_request_observation(self):
        base = {'message': '', 'connected': True, 'persona': '可爱', 'appliedRequests': 0}
        self.assertIn('等待', render_status({**base, 'phase': 'armed'}).summary)
        self.assertIn('观测', render_status({**base, 'phase': 'observed', 'appliedRequests': 2}).summary)


if __name__ == '__main__':
    unittest.main()
