import {mkdir, readdir, lstat, copyFile, readFile, rename} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

export async function copyPackage(source, destination) {
  let count = 0, bytes = 0;
  async function copy(relative) {
    const from = join(source, relative), to = join(destination, relative);
    const stat = await lstat(from);
    if (stat.isSymbolicLink()) throw new Error('插件代码包不允许包含符号链接。');
    if (stat.isDirectory()) {
      await mkdir(to, {recursive: true});
      for (const name of await readdir(from)) await copy(join(relative, name));
    } else {
      bytes += stat.size;
      if (!stat.isFile() || ++count > 500 || bytes > 2 * 1024 * 1024) throw new Error('插件代码包超过大小限制或包含特殊文件。');
      await mkdir(dirname(to), {recursive: true}); await copyFile(from, to);
    }
  }
  for (const file of ['package.json', 'cordis.patch.yml', 'plugin', 'personas/无法拒绝.md', 'README.md']) await copy(file);
  return destination;
}

export async function digestPackage(directory) {
  const hash=createHash('sha256');
  async function visit(relative) {
    const file=join(directory,relative), stat=await lstat(file);
    if(stat.isSymbolicLink()) throw new Error('插件代码包不允许包含符号链接。');
    if(stat.isDirectory()) for(const name of (await readdir(file)).sort()) await visit(join(relative,name));
    else {hash.update(relative.replaceAll('\\','/')+'\0');hash.update(await readFile(file));}
  }
  for(const file of ['package.json','cordis.patch.yml','plugin','personas/无法拒绝.md','README.md']) await visit(file);
  return hash.digest('hex');
}

export async function promoteRuntime(prepared, runtime) {
  if (dirname(prepared) !== dirname(runtime)) throw new Error('插件代码暂存目录不在安装目录旁。');
  const manifest = JSON.parse(await readFile(join(prepared, 'package.json'), 'utf8'));
  if (manifest.name !== 'dsh-persona-switcher' || manifest.exports?.['./client'] !== './plugin/client.js') throw new Error('暂存包不是人格插件。');
  const backup = `${runtime}.previous-${randomUUID()}`;
  let previous = false;
  try { await rename(runtime, backup); previous = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(prepared, runtime); }
  catch (error) { if (previous) await rename(backup, runtime); throw error; }
  return previous ? backup : null;
}

