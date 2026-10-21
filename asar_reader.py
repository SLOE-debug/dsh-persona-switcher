"""Read only the known DSH build; never extract or modify the installation."""
import hashlib
import json
import struct
from pathlib import Path


SUPPORTED_VERSION = "0.12.1"
RUNTIME_MEMBER = "node_modules/@deepseek-ai/dsh-llm/lib/index.js"
SUPPORTED_RUNTIME_SHA256 = "d18d8ae4c8d961e628708c1e4698e09716a0ebb80e55a672e0bde1029bec1155"


class BuildMismatchError(RuntimeError):
    pass


def validate_build(install_dir: Path) -> str:
    archive = install_dir / "resources" / "app.asar"
    with archive.open("rb") as stream:
        prefix = stream.read(16)
        if len(prefix) != 16:
            raise BuildMismatchError("DSH 安装包不完整。")
        _, header_size, _, json_size = struct.unpack("<4I", prefix)
        if not 0 < json_size <= 32 * 1024 * 1024 or header_size < json_size + 4:
            raise BuildMismatchError("DSH 安装包结构不匹配。")
        header = json.loads(stream.read(json_size))

        def read_member(path):
            entry = header
            for part in path.split("/"):
                entry = entry["files"][part]
            if entry.get("unpacked") or "link" in entry or entry["size"] > 1024 * 1024:
                raise BuildMismatchError("DSH 核心模块布局不匹配。")
            stream.seek(8 + header_size + int(entry["offset"]))
            data = stream.read(entry["size"])
            if len(data) != entry["size"]:
                raise BuildMismatchError("DSH 核心模块读取不完整。")
            return data

        package = json.loads(read_member("package.json"))
        runtime = read_member(RUNTIME_MEMBER)
    if package.get("name") != "dsh-desktop" or package.get("version") != SUPPORTED_VERSION:
        raise BuildMismatchError("当前仅支持已核验的 DSH Desktop 0.12.1，请先适配新版本。")
    if hashlib.sha256(runtime).hexdigest() != SUPPORTED_RUNTIME_SHA256:
        raise BuildMismatchError("DSH 请求模块已变化，未注入；请先核验当前构建。")
    return (archive / RUNTIME_MEMBER).as_uri()
