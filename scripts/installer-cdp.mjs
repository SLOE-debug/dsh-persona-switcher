import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute = promisify(execFile);

async function ownedPorts(pid) {
  const {stdout} = await execute('powershell.exe', ['-NoProfile', '-Command',
    `@(Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -ExpandProperty LocalPort) | ConvertTo-Json -Compress`],
  {windowsHide: true, timeout: 15000});
  const value = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(value) ? value : [value];
}
async function findEndpoint(pid) {
  for (const port of await ownedPorts(pid)) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(1000), redirect: 'error'});
      if (!response.ok) continue;
      const rows = await response.json();
      const matches = rows.filter(row => row.type === 'node' && row.webSocketDebuggerUrl?.startsWith(`ws://127.0.0.1:${port}/`));
      if (matches.length === 1) return matches[0].webSocketDebuggerUrl;
    } catch {}
  }
}

export async function attach(pid, executable, entry) {
  let endpoint = await findEndpoint(pid);
  const opened = !endpoint;
  if (!endpoint) {
    process._debugProcess(pid);
    for (let i = 0; i < 6 && !endpoint; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      endpoint = await findEndpoint(pid);
    }
  }
  if (!endpoint) throw new Error('DSH 调试入口不可用，请确认 DSH 已打开且权限一致。');
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('DSH 调试连接已关闭。')); }
    pending.clear();
  });
  function call(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DSH 操作超时：${method}`)); }, 180000);
      pending.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params}));
    });
  }
  async function evaluate(expression, byValue = true) {
    const key = `__persona_installer_${process.pid}_${sequence + 1}`;
    try {
      const reply = await call('Runtime.evaluate', {expression: `globalThis[${JSON.stringify(key)}] = (${expression})`, returnByValue: byValue, awaitPromise: true});
      if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
      return byValue ? reply.result.value : reply.result;
    } finally {
      await call('Runtime.evaluate', {expression: `delete globalThis[${JSON.stringify(key)}]`});
    }
  }
  const identity = await evaluate('({pid:process.pid, executable:process.execPath, entry:process.argv[1]})');
  const normalize = value => value.replaceAll('/', '\\').toLowerCase();
  if (identity.pid !== pid || normalize(identity.executable) !== normalize(executable) || normalize(identity.entry) !== normalize(entry)) {
    socket.close(); throw new Error('DSH 的进程身份核验失败，已停止安装。');
  }
  return {
    call, evaluate,
    async close() {
      if (opened) await evaluate("(setTimeout(()=>process.getBuiltinModule('inspector').close(),200).unref(),true)");
      socket.close();
    },
  };
}
