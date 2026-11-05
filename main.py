"""Desktop entry point for source and the standalone EXE."""
from pathlib import Path
import sys

from app_runtime import resolve_runtime
from bridge_client import PersonaController
from ui import run_app


def main():
    runtime = resolve_runtime()
    controller = PersonaController(runtime.code_dir, data_dir=runtime.data_dir,
                                   personas_dir=runtime.personas_dir, node_executable=runtime.node_executable)
    if len(sys.argv) == 3 and sys.argv[1] == '--self-test':
        from packaging_smoke import run_smoke
        run_smoke(controller, runtime, Path(sys.argv[2]).resolve())
        return
    run_app(controller)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if '--self-test' in sys.argv:
            import json
            report = Path(sys.argv[-1])
            detail = json.loads(report.read_text(encoding='utf-8')) if report.exists() else {}
            detail.update({'ok': False, 'error': str(error)})
            report.write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding='utf-8')
            sys.exit(1)
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror('人格切换器未启动', str(error))
        root.destroy()
