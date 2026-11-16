// Runs in the verified DSH host. Use its public CLI operations to install an
// ordinary development link, whose directory remains stable across hot updates.
export async function installLinkedRuntime(root, entry, prepared, runtime, helperFile) {
  const require = process.getBuiltinModule('module').createRequire(entry);
  const path = process.getBuiltinModule('path');
  const fs = process.getBuiltinModule('fs');
  const profile = root.get('profileContext'), hmr = root.get('hmr'), manager = root.get('pluginManager');
  const helpers = require(helperFile);
  const manifest = JSON.parse(fs.readFileSync(path.join(profile.dir, 'package.json'), 'utf8'));
  const name = 'dsh-persona-switcher';
  const coreRequest = async(endpoint,payload={})=>root.get('connection').createSharedFetchHandler('/api').fetch(new Request('http://localhost/api/'+endpoint,
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'persona-install',method:endpoint,payload})}),root.get('connection').browserPeer);
  const status = await coreRequest('dsh-persona-runtime');
  if(status.status===200) {
    const activated=await(await coreRequest('dsh-persona-install-runtime',{directory:prepared})).json();
    if(!activated.result.ok) throw new Error(activated.result.error.message);
    return activated.result.value;
  }
  if(status.status!==404) throw new Error('插件加载器没有响应，请重启 DSH 后重试。');
  const declared = manifest.dependencies?.[name];
  const projected = manifest.dsh?.desktop?.generationProjection?.plugins?.[name];
  const normalize = value => path.resolve(value).toLowerCase();
  const alreadyLinked = !projected && typeof declared === 'string' && declared.startsWith('link:') &&
    normalize(path.resolve(profile.dir, declared.slice(5))) === normalize(runtime);
  if (declared && !alreadyLinked) {
    const removed = await manager.removeBundle(name);
    if (!['applied', 'restart-required'].includes(removed.application)) return removed;
  }
  return hmr.runExclusive(async () => {
    const basePrepared=runtime+'.prepared-'+Date.now();
    await helpers.copyPackage(prepared,basePrepared);
    await helpers.promoteRuntime(basePrepared, runtime);
    fs.writeFileSync(path.join(profile.dir,'.dsh-persona-switcher/current.json'),JSON.stringify({schema:1,directory:prepared,revision:await helpers.digestPackage(prepared)}));
    if(alreadyLinked) return {application:'restart-required',restartReason:'initial-loader'};
    const {runPluginCommand} = require('@deepseek-ai/dsh-plugin-manager/operations');
    const pnpmManifest = require('pnpm');
    const pnpmEntry = path.join(path.dirname(require.resolve('pnpm')), pnpmManifest.bin.pnpm);
    const modules = require('js-yaml').load(fs.readFileSync(path.join(profile.dir,'node_modules/.modules.yaml'),'utf8'));
    if (typeof modules.virtualStoreDir !== 'string' || typeof modules.storeDir !== 'string') throw new Error('现有 pnpm 依赖目录缺少存储位置配置。');
    const result = await runPluginCommand({profile: profile.name, dir: profile.dir, installAnchor: profile.installAnchor, cwd: runtime},
      ['add', `link:${runtime.replaceAll('\\', '/')}`, '--virtual-store-dir', modules.virtualStoreDir, '--store-dir', modules.storeDir], {command:process.execPath, args:[pnpmEntry], env:{ELECTRON_RUN_AS_NODE:'1'}, execution: 'service',
        outputBytes: 16384, lockWaitMs: 120000, lookupTimeoutMs: 120000, idleTimeoutMs: 120000});
    if (result.exitCode !== 0) throw new Error(`插件依赖安装失败：${result.output}`);
    return {application:'restart-required',restartReason:'initial-loader'};
  });
}
