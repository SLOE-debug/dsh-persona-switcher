"""Read the user's local Markdown persona library without executing its contents."""

from dataclasses import dataclass
import os
from pathlib import Path


MAX_PERSONA_BYTES = 64 * 1024


class PersonaStoreError(ValueError):
    """A readable error concerning a local persona file or directory."""


@dataclass(frozen=True)
class Persona:
    name: str
    path: Path
    text: str


class PersonaStore:
    """Load each immediate .md file as one persona, named after its filename."""

    def __init__(self, directory: Path | str):
        self.directory = Path(directory).resolve()

    def list_personas(self) -> list[Persona]:
        try:
            if not self.directory.is_dir():
                raise PersonaStoreError(
                    f"找不到人格文件夹：{self.directory}。请恢复文件夹后刷新列表。"
                )
            paths = sorted(
                (
                    path
                    for path in self.directory.iterdir()
                    if path.is_file() and path.suffix.lower() == ".md"
                ),
                key=lambda path: (path.stem.casefold(), path.name),
            )
            return [self._read_persona(path) for path in paths]
        except OSError as exc:
            raise PersonaStoreError(
                f"无法读取人格文件夹：{self.directory}。请检查文件权限后刷新列表。"
            ) from exc

    @staticmethod
    def _read_persona(path: Path) -> Persona:
        try:
            with path.open("rb") as source:
                content = source.read(MAX_PERSONA_BYTES + 1)
        except OSError as exc:
            raise PersonaStoreError(
                f"无法读取“{path.name}”。请检查文件是否可访问后刷新列表。"
            ) from exc
        if len(content) > MAX_PERSONA_BYTES:
            raise PersonaStoreError(
                f"“{path.name}”超过 64 KiB。请缩短内容后刷新列表。"
            )
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise PersonaStoreError(
                f"“{path.name}”不是 UTF-8 文本。请另存为 UTF-8 后刷新列表。"
            ) from exc
        if not text.strip():
            raise PersonaStoreError(
                f"“{path.name}”没有内容。请写入人格说明后刷新列表。"
            )
        return Persona(name=path.stem, path=path, text=text)

    def open_folder(self) -> None:
        try:
            os.startfile(str(self.directory))
        except OSError as exc:
            raise PersonaStoreError(
                "无法打开人格文件夹。请检查文件夹是否存在，以及资源管理器是否可用。"
            ) from exc
