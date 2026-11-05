import {withSession, evaluate} from './inspector/session.mjs';
import {discoverRuntime} from './discovery/runtime_scan.mjs';
import {version as acornVersion} from 'acorn';

let completed = false;
const deadline = setTimeout(() => finish({ok: false, error: '识别连接超过 60 秒，请重试。'}), 60000);

function finish(value) {
  if (completed) return;
  completed = true;
  clearTimeout(deadline);
  process.stdout.write(JSON.stringify(value) + '\n', () => process.exit(value.ok ? 0 : 1));
}

async function main(input) {
  if (input?.action === 'diagnose') return {ok: true, result: {nodeVersion: process.versions.node, acornVersion}};
  if (!input || !Number.isSafeInteger(input.pid) || input.pid <= 0) throw new Error('目标进程编号无效。');
  if (input.action === 'activate') {
    process._debugProcess(input.pid);
    return {ok: true, result: null};
  }
  if (input.action === 'evaluate') {
    if (typeof input.expression !== 'string' || !input.expression.trim()) throw new Error('缺少目标操作。');
    return {ok: true, result: await withSession(input, client => evaluate(client, input.expression))};
  }
  if (input.action === 'discover') {
    if (!Array.isArray(input.roots) || !input.roots.length || typeof input.cacheFolder !== 'string' ||
        typeof input.targetModule !== 'string') throw new Error('缺少识别范围。');
    return {ok: true, result: await withSession(input, client => discoverRuntime(client, input))};
  }
  throw new Error('未知操作。');
}

const chunks = [];
let size = 0;
process.stdin.on('data', chunk => {
  size += chunk.length;
  if (size > 512 * 1024) return finish({ok: false, error: '操作内容超过上限。'});
  chunks.push(chunk);
});
process.stdin.on('error', error => finish({ok: false, error: error.message}));
process.stdin.on('end', async () => {
  try { finish(await main(JSON.parse(Buffer.concat(chunks)))); }
  catch (error) { finish({ok: false, error: error.message}); }
});
