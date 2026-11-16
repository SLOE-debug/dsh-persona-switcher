import {execFile as execute} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, readFile, open, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {copyPackage} from './runtime-package.mjs';
import {randomUUID} from 'node:crypto';

const execFile = promisify(execute);
const PACKAGE = 'dsh-persona-switcher';
const SOURCE = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)SLOE-debug\/dsh-persona-switcher(?:\.git)?\/?$/i;
export class GitUpdater {
  constructor({dataDirectory, coordinator}) {
    Object.assign(this, {dataDirectory, coordinator});
  }
  async source() {
    const file = join(this.dataDirectory, 'source.json');
    let source;
    try { source = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('请从保留的 Git clone 目录双击“安装插件.cmd”，登记 GitHub 更新来源。');
      throw error;
    }
    if (source.schema !== 1 || typeof source.repository !== 'string' || !/^[a-f0-9]{40}$/.test(source.installedCommit)) throw new Error('插件更新来源配置无效，请重新运行安装器。');
    this.repository = source.repository;
    return source;
  }
  async git(...args) {
    try {
      const {stdout} = await execFile('git', ['-C', this.repository, ...args], {
        windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024,
        env: {...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never'},
      });
      return stdout.trim();
    } catch (error) {
      const detail = String(error.stderr || error.message).replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[已隐藏凭据]@').slice(0, 700);
      throw new Error(`Git 操作失败，请检查 GitHub 登录和网络：${detail}`);
    }
  }
  async check() {
    const source = await this.source();
    const origin = await this.git('config', '--get', 'remote.origin.url');
    if (!SOURCE.test(origin)) throw new Error('插件更新只接受 SLOE-debug/dsh-persona-switcher 的 GitHub 仓库。请从该仓库 clone 后安装。');
    await this.git('fetch', '--no-tags', 'origin', 'main');
    const current = source.installedCommit;
    const latest = await this.git('rev-parse', 'FETCH_HEAD');
    if (!/^[a-f0-9]{40}$/.test(current) || !/^[a-f0-9]{40}$/.test(latest)) throw new Error('Git 提交标识无效。');
    return {current, latest, available: current !== latest, hotReload: this.coordinator?.hotReload === true, development: source.development === true};
  }
  async update() {
    if (!this.coordinator?.hotReload) throw new Error('当前 DSH 未提供热重载服务，无法热更新此插件。');
    await mkdir(this.dataDirectory, {recursive: true});
    const lockPath = join(this.dataDirectory, 'update.lock');
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('已有更新正在运行；若上次 DSH 被强制结束，请删除插件数据目录中的 update.lock 后重试。');
      throw error;
    }
    try {
      await lock.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
      const target = await this.check();
      if (!target.available) return {...target, updated: false};
      const generation = join(this.dataDirectory, 'releases', target.latest);
      await mkdir(join(this.dataDirectory, 'releases'), {recursive: true});
      try { await readFile(join(generation, 'package.json')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await this.git('worktree', 'add', '--detach', generation, target.latest);
      }
      const manifest = JSON.parse(await readFile(join(generation, 'package.json'), 'utf8'));
      if (manifest.name !== PACKAGE || manifest.dsh?.personaProtocol !== 1 || manifest.dsh?.bundle?.patch !== './cordis.patch.yml' || manifest.exports?.['./client'] !== './plugin/client.js') {
        throw new Error('GitHub 提交中没有完整的此插件，已停止更新。');
      }
      for (const file of ['plugin/runtime.mjs', 'plugin/client-runtime.js', 'personas/无法拒绝.md', 'cordis.patch.yml']) await readFile(join(generation, file));
      const revision = await execFile('git', ['-C', generation, 'rev-parse', 'HEAD'], {windowsHide: true});
      const changes = await execFile('git', ['-C', generation, 'status', '--porcelain'], {windowsHide: true});
      if (revision.stdout.trim() !== target.latest || changes.stdout.trim()) throw new Error('更新目录不是目标提交的干净副本，已停止更新。');
      const prepared = join(this.dataDirectory, `prepared-${randomUUID()}`);
      await copyPackage(generation, prepared);
      const result = await this.coordinator.activate(prepared);
      if (result.application !== 'applied') {
        throw new Error(result.error?.message || `宿主未完成热激活（${result.application ?? '未知状态'}），请到插件页查看详情。`);
      }
      const source = await this.source();
      const {writeFile, rename} = await import('node:fs/promises');
      const sourcePath = join(this.dataDirectory, 'source.json');
      const temporary = `${sourcePath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({...source, installedCommit: target.latest, development:false}), {mode: 0o600});
      await rename(temporary, sourcePath);
      return {...target, updated: true, version: manifest.version, application: result.application};
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
