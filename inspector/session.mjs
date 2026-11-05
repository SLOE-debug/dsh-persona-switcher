import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {connect, returnedValue} from './connection.mjs';

export function normalizedPath(value) {
  if (typeof value !== 'string' || !path.win32.isAbsolute(value)) throw new Error('目标路径必须是 Windows 绝对路径。');
  return path.win32.normalize(value).toLowerCase();
}

export async function evaluate(client, expression, byValue = true) {
  const key = 'local.dsh-persona-switcher.pending.' + randomUUID();
  try {
    const response = await client.call('Runtime.evaluate', {
      expression: `globalThis[${JSON.stringify(key)}] = (${expression})`,
      returnByValue: byValue, awaitPromise: true, timeout: 15000,
    });
    if (!byValue) {
      if (response.exceptionDetails) returnedValue(response);
      return response.result;
    }
    return returnedValue(response);
  } finally {
    await client.call('Runtime.evaluate', {
      expression: `delete globalThis[${JSON.stringify(key)}]`, returnByValue: true, timeout: 1000,
    });
  }
}

export async function withSession(input, operation) {
  if (!Number.isSafeInteger(input.pid) || input.pid <= 0) throw new Error('目标进程编号无效。');
  const executable = normalizedPath(input.expectedExecutable);
  if (!Array.isArray(input.expectedEntries) || !input.expectedEntries.length) throw new Error('缺少已核验的进程入口。');
  const entries = input.expectedEntries.map(normalizedPath);
  const client = await connect(input.endpoint);
  let verified = false;
  try {
    const identity = returnedValue(await client.call('Runtime.evaluate', {
      expression: '({pid:process.pid,execPath:process.execPath,entry:process.argv[1]})',
      returnByValue: true, throwOnSideEffect: true, timeout: 5000,
    }));
    if (identity.pid !== input.pid || normalizedPath(identity.execPath) !== executable ||
        !entries.includes(normalizedPath(identity.entry))) {
      throw new Error('调试目标与 expected PID、可执行文件或入口不一致。');
    }
    verified = true;
    return await operation(client, identity);
  } finally {
    try {
      if (verified && input.closeInspector === true) {
        await evaluate(client, "(setTimeout(()=>process.getBuiltinModule('inspector').close(),200).unref(),true)");
      }
    } finally { client.socket.close(); }
  }
}
