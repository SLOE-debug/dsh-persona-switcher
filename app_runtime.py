"""Resolve source/bundled assets and keep injected modules alive after EXE exit."""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys


@dataclass(frozen=True)
class AppRuntime:
    code_dir: Path
    data_dir: Path
    personas_dir: Path
    node_executable: Path | None


def file_digest(path: Path) -> str:
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def materialize_runtime(source: Path, data_dir: Path) -> Path:
    manifest_bytes = (source / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    identity = hashlib.sha256(manifest_bytes).hexdigest()
    destination = data_dir / 'runtime' / identity
    for name, digest in manifest['files'].items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name:
            raise RuntimeError('内置运行文件的路径无效。')
        original = source.joinpath(*relative.parts)
        target = destination.joinpath(*relative.parts)
        if target.exists():
            if file_digest(target) != digest:
                raise RuntimeError('本地运行文件缓存校验失败。请删除用户目录中的 DSH-Persona-Switcher/runtime 后重试。')
            continue
        if file_digest(original) != digest:
            raise RuntimeError('内置运行文件校验失败，请重新获取完整 EXE。')
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + f'.{os.getpid()}.tmp')
        shutil.copyfile(original, temporary)
        temporary.replace(target)
    return destination


def seed_personas(source: Path, destination: Path) -> None:
    if destination.exists():
        return
    destination.mkdir(parents=True)
    for path in source.glob('*.md'):
        shutil.copyfile(path, destination / path.name)


def resolve_runtime() -> AppRuntime:
    if not getattr(sys, 'frozen', False):
        root = Path(__file__).resolve().parent
        return AppRuntime(root, root, root / 'personas', None)
    assets = Path(sys._MEIPASS)
    data = Path(os.environ['LOCALAPPDATA']) / 'DSH-Persona-Switcher'
    code = materialize_runtime(assets / 'runtime', data)
    personas = Path(sys.executable).resolve().parent / 'personas'
    seed_personas(assets / 'default_personas', personas)
    return AppRuntime(code, data, personas, code / 'node.exe')
