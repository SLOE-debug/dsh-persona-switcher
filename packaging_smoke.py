"""Headless packaged-runtime check; never sends a model message or applies a style."""
import json
from pathlib import Path
import tkinter as tk


def run_smoke(controller, runtime, report_path: Path) -> None:
    root = tk.Tk()
    root.withdraw()
    root.update_idletasks()
    root.destroy()
    dependencies = controller.transport.helper({'action': 'diagnose'})
    personas = controller.store.list_personas()
    status = controller.status()
    discovery = controller.discover() if status['connected'] else None
    result = {
        'ok': bool(personas) and (discovery is None or discovery['phase'] in ('ready', 'armed', 'observed')),
        'tkinter': True, 'dependencies': dependencies, 'persona_count': len(personas),
        'code_dir': str(runtime.code_dir), 'personas_dir': str(runtime.personas_dir),
        'bundled_node': str(runtime.node_executable), 'status': status, 'discovery': discovery,
    }
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    if not result['ok']:
        raise RuntimeError('打包验证失败，请查看验证报告。')
