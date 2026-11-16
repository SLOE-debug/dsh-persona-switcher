import {readFile, writeFile, rename} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {digestPackage} from './runtime-package.mjs';
import {Script} from 'node:vm';

export class RuntimeHost {
  constructor(ctx) {
    this.ctx = ctx;
    this.directory = join(ctx.profileContext.dir, '.dsh-persona-switcher');
    this.queue = Promise.resolve(); this.current = null; this.child = null; this.closed = false;
    this.resources = new Set();
  }
  async start() {
    const descriptor = JSON.parse(await readFile(join(this.directory, 'current.json'), 'utf8'));
    await this.activate(descriptor.directory);
  }
  status() { return {revision: this.current?.revision ?? null, clientUrl: this.current?.clientUrl ?? null, error: this.error ?? ''}; }
  activate(directory) {
    const task = this.queue.then(() => this.replace(directory));
    this.queue = task.catch(() => {}); return task;
  }
  async mount(module, directory) {
    const coordinator = {activate: next => this.activate(next), hotReload: true};
    const child = this.ctx.plugin({name: 'dsh-persona-payload', inject: module.inject,
      apply: scope => module.apply(scope, {coordinator, directory})});
    try { await child.await(); if (child.state !== 2) throw new Error('插件运行依赖未就绪。'); }
    catch (error) { await child.dispose(); throw error; }
    return child;
  }
  async replace(directory) {
    if (this.closed) throw new Error('插件正在关闭。');
    directory = resolve(directory);
    if (!directory.startsWith(resolve(this.directory) + sep)) throw new Error('代码目录必须位于此插件的数据目录内。');
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (manifest.name !== 'dsh-persona-switcher' || manifest.dsh?.personaProtocol !== 1) throw new Error('更新包的插件加载协议不受支持，请重新运行安装器。');
    const revision = await digestPackage(directory);
    if (revision === this.current?.revision) return {application:'applied', revision};
    const source = await readFile(join(directory,'plugin/client-runtime.js'),'utf8');
    new Script(source,{filename:'persona-client-runtime.js'});
    const module = await import(pathToFileURL(join(directory,'plugin/runtime.mjs')).href + '?revision=' + revision);
    if (typeof module.apply !== 'function' || !Array.isArray(module.inject)) throw new Error('插件运行入口无效。');
    const previous = this.current;
    await this.child?.dispose(); this.child = null;
    try {
      this.child = await this.mount(module, directory);
      const clientUrl = `/_dsh-persona/${revision}.js`;
      if (!this.resources.has(revision)) {
        this.ctx.webServer.register({kind:'exact', path:clientUrl, resource:() => Promise.resolve(new Response(
          `(()=>{const DSH_PERSONA_REVISION=${JSON.stringify(revision)};\n${source}\n})();`,
          {headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'private, max-age=31536000, immutable'}}))});
        this.resources.add(revision);
      }
      const pointer = {schema:1,directory,revision};
      const file = join(this.directory,'current.json'), temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(pointer), {mode:0o600}); await rename(temporary,file);
      this.current = {...pointer, clientUrl, module}; this.error = '';
      return {application:'applied',revision};
    } catch (error) {
      await this.child?.dispose(); this.child = null;
      if (previous && !this.closed) this.child = await this.mount(previous.module, previous.directory);
      this.error = error.message; throw error;
    }
  }
  async stop() { this.closed = true; await this.queue; await this.child?.dispose(); }
}
