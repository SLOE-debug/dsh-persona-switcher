import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app_runtime import materialize_runtime, seed_personas


class BundledAssetsTests(unittest.TestCase):
    def create_source(self, root):
        source = root / 'embedded'
        source.mkdir()
        body = b'export const marker=1;'
        (source / 'runtime_patch.mjs').write_bytes(body)
        (source / 'manifest.json').write_text(json.dumps({'files': {
            'runtime_patch.mjs': hashlib.sha256(body).hexdigest(),
        }}), encoding='utf-8')
        return source

    def test_materialized_modules_outlive_temporary_assets(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.create_source(root)
            cached = materialize_runtime(source, root / 'persistent')
            (source / 'runtime_patch.mjs').unlink()
            self.assertEqual(materialize_runtime(source, root / 'persistent'), cached)
            self.assertEqual((cached / 'runtime_patch.mjs').read_bytes(), b'export const marker=1;')

    def test_modified_cache_and_modified_embedded_files_are_rejected(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.create_source(root)
            cached = materialize_runtime(source, root / 'persistent')
            (cached / 'runtime_patch.mjs').write_text('corrupt', encoding='utf-8')
            with self.assertRaises(RuntimeError):
                materialize_runtime(source, root / 'persistent')
            with self.assertRaises(RuntimeError):
                (source / 'runtime_patch.mjs').write_text('corrupt', encoding='utf-8')
                materialize_runtime(source, root / 'other')

    def test_manifest_cannot_write_outside_cache(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.create_source(root)
            (source / 'manifest.json').write_text(json.dumps({'files': {'../outside': 'a' * 64}}))
            with self.assertRaises(RuntimeError):
                materialize_runtime(source, root / 'persistent')

    def test_default_personas_are_seeded_once_without_overwriting_user_files(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'seed'
            source.mkdir()
            (source / '可爱.md').write_text('default', encoding='utf-8')
            destination = root / 'personas'
            seed_personas(source, destination)
            (destination / '可爱.md').write_text('my edits', encoding='utf-8')
            seed_personas(source, destination)
            self.assertEqual((destination / '可爱.md').read_text(encoding='utf-8'), 'my edits')


if __name__ == '__main__':
    unittest.main()
