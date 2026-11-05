import {createHash} from 'node:crypto';
import {readFile, mkdir, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

export function cachePath(folder, roots) {
  const key = createHash('sha256').update(JSON.stringify(roots)).digest('hex');
  return path.join(folder, key + '.json');
}

export async function readCache(file) {
  try {
    const data = await readFile(file, 'utf8');
    if (data.length > 262144) return null;
    const parsed = JSON.parse(data);
    return parsed.schema === 1 && parsed.candidate ? parsed : null;
  } catch { return null; }
}

export async function writeCache(file, candidate, inventory) {
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = file + '.' + process.pid + '.tmp';
  await writeFile(temporary, JSON.stringify({schema: 1, candidate, inventory}), 'utf8');
  await rename(temporary, file);
}
