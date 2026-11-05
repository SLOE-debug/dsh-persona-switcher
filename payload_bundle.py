"""Use immutable module URLs so a running DSH never imports stale tool code."""
import hashlib
from pathlib import Path


FILES = ("runtime_patch.mjs", "runtime_target.mjs", "request_contract.mjs")


def prepare_payload(folder: Path, cache_folder: Path | None = None) -> Path:
    sources = {name: (folder / name).read_bytes() for name in FILES}
    fingerprint = hashlib.sha256()
    for name, source in sources.items():
        fingerprint.update(name.encode("utf-8") + b"\0" + source)
    destination = (cache_folder or folder / ".discovery-cache") / "payload" / fingerprint.hexdigest()
    destination.mkdir(parents=True, exist_ok=True)
    for name, source in sources.items():
        target = destination / name
        if target.exists():
            if target.read_bytes() != source:
                raise RuntimeError("人格工具的本地代码缓存损坏，请删除 .discovery-cache 后重试。")
        else:
            target.write_bytes(source)
    return destination
