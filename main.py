"""Launch the desktop personality picker. Requires Python 3.10+ with Tkinter."""
from pathlib import Path

from bridge_client import PersonaController
from ui import run_app


if __name__ == "__main__":
    run_app(PersonaController(Path(__file__).resolve().parent))
