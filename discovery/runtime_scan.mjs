import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scanSource} from './semantic_scan.mjs';
import {fingerprint} from '../runtime_target.mjs';
import {evaluate} from '../inspector/session.mjs';
import {returnedValue} from '../inspector/connection.mjs';
import {cachePath, readCache, writeCache} from './cache.mjs';

function allowedUrl(url, roots) {
  try {
    if (!url.startsWith('file:') || /[?#]/.test(url)) return false;
    const file = path.win32.normalize(fileURLToPath(url)).toLowerCase();
    return /\.(?:mjs|cjs|js)$/.test(file) && roots.some(root => {
      const relative = path.win32.relative(root, file);
      return relative && relative !== '..' && !relative.startsWith('..\\') && !path.win32.isAbsolute(relative);
    });
  } catch { return false; }
}

function helperRequire(moduleFile) {
  return "process.getBuiltinModule('module').createRequire(" + JSON.stringify(moduleFile) +
    ")(" + JSON.stringify(moduleFile) + ')';
}

async function verifyLive(client, candidate, targetModule) {
  const expression = helperRequire(targetModule) + '.resolveTarget(' + JSON.stringify(candidate) + ').then(x=>x.prototype)';
  const prototype = await evaluate(client, expression, false);
  if (!prototype.objectId) throw new Error('候选导出没有可检查的原型。');
  let objects;
  try {
    objects = await client.call('Runtime.queryObjects', {prototypeObjectId: prototype.objectId});
    const proof = returnedValue(await client.call('Runtime.callFunctionOn', {
      objectId: objects.objects.objectId, returnByValue: true,
      functionDeclaration: `function() {
        let live = 0;
        for (let i = 0; i < Math.min(this.length, 32); i++) {
          const runtime = this[i];
          if (typeof runtime.ctx?.get !== 'function') continue;
          const agents = runtime.ctx.get('agents');
          const projections = runtime.ctx.get('sessionProjections');
          if (typeof agents?.get === 'function' && typeof projections?.stateOf === 'function') live++;
        }
        return {instances: this.length, verifiedInstances: live};
      }`,
    }));
    if (!proof.verifiedInstances) {
      const error = new Error('未发现带有会话归属能力的活动运行时。');
      error.code = 'NO_LIVE_RUNTIME';
      throw error;
    }
    return proof;
  } finally {
    await client.call('Runtime.releaseObject', {objectId: prototype.objectId});
    if (objects?.objects?.objectId) await client.call('Runtime.releaseObject', {objectId: objects.objects.objectId});
  }
}

export async function discoverRuntime(client, input) {
  const roots = input.roots.map(root => path.win32.normalize(root).toLowerCase());
  const scripts = [];
  const onEvent = event => {
    if (event.method === 'Debugger.scriptParsed' && allowedUrl(event.params.url, roots)) scripts.push(event.params);
  };
  client.listeners.add(onEvent);
  await client.call('Debugger.enable', {maxScriptsCacheSize: 64 * 1024 * 1024});
  try {
    const unique = new Map();
    for (const script of scripts) {
      const previous = unique.get(script.url);
      if (previous && previous.hash !== script.hash) throw new Error('同一模块存在多个运行代次，请重启 DSH 后识别。');
      unique.set(script.url, script);
    }
    const entries = [...unique.values()].sort((a, b) => a.url.localeCompare(b.url));
    if (entries.length > 4000) throw new Error('已加载模块超过扫描上限，未安装补丁。');
    const inventory = fingerprint(JSON.stringify(entries.map(item => [item.url, item.hash])));
    const cacheFile = cachePath(input.cacheFolder, roots);
    const cached = input.force ? null : await readCache(cacheFile);
    let examined = 0;
    let bytes = 0;
    const errors = [];
    const candidates = [];
    if (cached?.inventory === inventory && unique.has(cached.candidate.url)) {
      const script = unique.get(cached.candidate.url);
      const {scriptSource} = await client.call('Debugger.getScriptSource', {scriptId: script.scriptId});
      if (fingerprint(scriptSource) === cached.candidate.sourceSha256) {
        try {
          const matched = scanSource(scriptSource).candidates.filter(item =>
            item.exportName === cached.candidate.exportName && item.methodName === cached.candidate.methodName &&
            fingerprint(scriptSource.slice(item.methodStart, item.methodEnd)) === cached.candidate.methodSha256);
          if (matched.length !== 1) throw new Error('定位缓存不满足当前结构契约。');
          const proof = await verifyLive(client, cached.candidate, input.targetModule);
          return {candidate: cached.candidate, cacheHit: true, proof, examined: 1, loaded: entries.length};
        } catch (error) { errors.push(error.message); }
      }
    }
    for (const script of entries) {
      if (script.length > 4 * 1024 * 1024) throw new Error('运行模块超过单文件扫描上限，未安装补丁。');
      const {scriptSource} = await client.call('Debugger.getScriptSource', {scriptId: script.scriptId});
      bytes += Buffer.byteLength(scriptSource);
      if (bytes > 48 * 1024 * 1024) throw new Error('运行代码超过扫描预算，未安装补丁。');
      examined++;
      if (!scriptSource.includes('replayState') || !scriptSource.includes('asyncIterator')) continue;
      const parsed = scanSource(scriptSource);
      if (parsed.parseError) throw new Error('无法解析相关的已加载模块，未安装补丁：' + script.url);
      for (const found of parsed.candidates) {
        candidates.push({
          url: script.url, exportName: found.exportName, methodName: found.methodName,
          methodSha256: fingerprint(scriptSource.slice(found.methodStart, found.methodEnd)),
          sourceSha256: fingerprint(scriptSource), evidence: found.evidence,
        });
      }
    }
    if (!candidates.length || candidates.length > 8) {
      throw new Error(`无法唯一定位请求入口（${candidates.length} 个候选）。` + (errors[0] ?? ''));
    }
    const verified = [];
    for (const candidate of candidates) {
      if (candidate.exportName === null) throw new Error('结构候选没有可访问的导出，未安装补丁：' + candidate.url);
      try { verified.push({candidate, proof: await verifyLive(client, candidate, input.targetModule)}); }
      catch (error) { if (error.code !== 'NO_LIVE_RUNTIME') throw error; }
    }
    if (verified.length !== 1) throw new Error(`无法唯一确定带会话能力的运行入口（${verified.length} 个）。`);
    const {candidate, proof} = verified[0];
    let cacheWarning = '';
    // Recheck every candidate next time if inactive copies also exist in memory.
    if (candidates.length === 1) {
      try { await writeCache(cacheFile, candidate, inventory); } catch { cacheWarning = '定位成功，但本地缓存无法写入。'; }
    }
    return {candidate, cacheHit: false, proof, examined, loaded: entries.length, cacheWarning};
  } finally {
    client.listeners.delete(onEvent);
    await client.call('Debugger.disable');
  }
}
