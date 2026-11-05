"""Build a single Windows EXE with its own Node and JavaScript dependencies."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request


ROOT = Path(__file__).resolve().parent


def prepare_assets():
    stage = ROOT / 'build' / 'embedded-runtime'
    stage.mkdir(parents=True, exist_ok=True)
    for name in ['inspector_client.mjs', 'runtime_patch.mjs', 'runtime_target.mjs', 'request_contract.mjs']:
        shutil.copyfile(ROOT / name, stage / name)
    for name in ['inspector', 'discovery']:
        shutil.copytree(ROOT / name, stage / name, dirs_exist_ok=True)
    parser = ROOT / 'node_modules' / 'acorn'
    if not parser.is_dir():
        raise RuntimeError('请先运行 npm ci 安装 Acorn。')
    shutil.copytree(parser, stage / 'node_modules' / 'acorn', dirs_exist_ok=True)
    node = shutil.which('node')
    if not node:
        raise RuntimeError('打包需要 Node.js。')
    version = subprocess.check_output([node, '-p', 'process.versions.node'], text=True).strip()
    shutil.copyfile(node, stage / 'node.exe')
    licenses = stage / 'licenses'
    licenses.mkdir(exist_ok=True)
    url = f'https://raw.githubusercontent.com/nodejs/node/v{version}/LICENSE'
    with urllib.request.urlopen(url, timeout=30) as response:
        (licenses / 'NODE-LICENSE.txt').write_bytes(response.read())
    shutil.copyfile(parser / 'LICENSE', licenses / 'ACORN-LICENSE.txt')
    files = {}
    for path in sorted(stage.rglob('*')):
        if path.is_file() and path.name != 'manifest.json':
            with path.open('rb') as source:
                files[path.relative_to(stage).as_posix()] = hashlib.file_digest(source, 'sha256').hexdigest()
    (stage / 'manifest.json').write_text(json.dumps({'node': version, 'files': files}, indent=2), encoding='utf-8')
    return stage


def main():
    stage = prepare_assets()
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onefile', '--windowed',
               '--name', 'DSH人格切换器', '--distpath', str(ROOT / 'dist'),
               '--workpath', str(ROOT / 'build' / 'pyinstaller'), '--specpath', str(ROOT / 'build'),
               '--add-data', str(stage) + ':runtime',
               '--add-data', str(ROOT / 'personas') + ':default_personas', str(ROOT / 'main.py')]
    subprocess.run(command, cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
