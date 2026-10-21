import http from 'node:http';
import path from 'node:path';

const MAX_INPUT_BYTES = 256 * 1024;
const activeSockets = new Set();
let completed = false;

function finish(value) {
  if (completed) return;
  completed = true;
  clearTimeout(deadline);
  for (const socket of activeSockets) socket.close();
  process.stdout.write(`${JSON.stringify(value)}\n`, () => {
    process.exit(value.ok ? 0 : 1);
  });
}

const deadline = setTimeout(() => {
  finish({ ok: false, error: 'Inspector operation exceeded 25 seconds' });
}, 25_000);

function positivePid(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fffffff) {
    throw new Error('pid must be a positive process ID');
  }
  return value;
}

function endpointUrl(value) {
  if (typeof value !== 'string') throw new Error('endpoint must be a URL');
  const endpoint = new URL(value);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
    throw new Error('endpoint must use HTTP on 127.0.0.1 or localhost');
  }
  if (!endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('endpoint must contain only a loopback host and explicit port');
  }
  return endpoint;
}

function readTargets(endpoint) {
  return new Promise((resolve, reject) => {
    // Native HTTP never consults proxy environment variables. Redirects are rejected.
    const request = http.get(new URL('/json/list', endpoint), { agent: false }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Inspector discovery returned HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_INPUT_BYTES) {
          response.destroy(new Error('Inspector discovery response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const targets = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!Array.isArray(targets)) throw new Error('Inspector discovery must return an array');
          resolve(targets);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error('Inspector discovery timed out')));
    request.on('error', reject);
  });
}

function targetSocketUrl(targets, endpoint) {
  const nodes = targets.filter((target) => target?.type === 'node');
  if (nodes.length !== 1) throw new Error('Expected exactly one Node Inspector target');
  const value = nodes[0].webSocketDebuggerUrl;
  if (typeof value !== 'string') throw new Error('Node target has no WebSocket URL');
  const address = new URL(value);
  if (address.protocol !== 'ws:' || address.hostname !== endpoint.hostname || address.port !== endpoint.port || address.username || address.password || address.hash) {
    throw new Error('Inspector WebSocket must use the same loopback host and port as endpoint');
  }
  return address.href;
}

function connect(address) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(address);
    activeSockets.add(socket);
    let nextId = 1;
    const pending = new Map();
    const fail = (error) => {
      reject(error);
      for (const operation of pending.values()) operation.reject(error);
      pending.clear();
    };
    socket.addEventListener('error', () => fail(new Error('Inspector WebSocket failed')));
    socket.addEventListener('close', () => {
      activeSockets.delete(socket);
      fail(new Error('Inspector WebSocket closed'));
    });
    socket.addEventListener('message', ({ data }) => {
      try {
        const message = JSON.parse(data);
        const operation = pending.get(message.id);
        if (!operation) return;
        pending.delete(message.id);
        if (message.error) operation.reject(new Error(message.error.message ?? 'Inspector protocol error'));
        else operation.resolve(message.result);
      } catch (error) {
        fail(error);
        socket.close();
      }
    });
    socket.addEventListener('open', () => resolve({
      socket,
      call(method, params) {
        return new Promise((resolveCall, rejectCall) => {
          const id = nextId++;
          pending.set(id, { resolve: resolveCall, reject: rejectCall });
          try {
            socket.send(JSON.stringify({ id, method, params }));
          } catch (error) {
            pending.delete(id);
            rejectCall(error);
          }
        });
      },
    }));
  });
}

function absoluteWindowsPath(value, name) {
  if (typeof value !== 'string' || !path.win32.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute Windows path`);
  }
  return path.win32.normalize(value).toLowerCase();
}

function returnedValue(response) {
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
    throw new Error(String(detail).split('\n').slice(0, 3).join('\n'));
  }
  if (!response.result || !Object.hasOwn(response.result, 'value')) {
    if (response.result?.type === 'undefined') return null;
    throw new Error('Inspector evaluation did not return a JSON value');
  }
  return response.result.value;
}

async function evaluate(input) {
  const endpoint = endpointUrl(input.endpoint);
  if (input.closeInspector !== undefined && typeof input.closeInspector !== 'boolean') {
    throw new Error('closeInspector must be a boolean');
  }
  if (typeof input.expression !== 'string' || !input.expression.trim()) {
    throw new Error('expression must be a non-empty string');
  }
  const hasExecutable = Object.hasOwn(input, 'expectedExecutable');
  const hasEntry = Object.hasOwn(input, 'expectedEntry');
  if (!hasExecutable || !hasEntry) throw new Error('expectedExecutable and expectedEntry are required');
  const executable = absoluteWindowsPath(input.expectedExecutable, 'expectedExecutable');
  const entry = absoluteWindowsPath(input.expectedEntry, 'expectedEntry');
  const address = targetSocketUrl(await readTargets(endpoint), endpoint);
  const client = await connect(address);
  let identityVerified = false;
  try {
    const identity = returnedValue(await client.call('Runtime.evaluate', {
      expression: '({pid:process.pid,execPath:process.execPath,argv:process.argv})',
      returnByValue: true,
      timeout: 5000,
      throwOnSideEffect: true,
    }));
    if (identity?.pid !== input.pid || absoluteWindowsPath(identity.execPath, 'target execPath') !== executable || !Array.isArray(identity.argv) || !identity.argv.some((argument) => typeof argument === 'string' && path.win32.isAbsolute(argument) && absoluteWindowsPath(argument, 'target argv') === entry)) {
      throw new Error('Inspector target does not match the expected PID, executable and entry');
    }
    identityVerified = true;
    return returnedValue(await client.call('Runtime.evaluate', {
      expression: input.expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 15_000,
    }));
  } finally {
    try {
      if (identityVerified && input.closeInspector === true) {
        returnedValue(await client.call('Runtime.evaluate', {
          expression: "setTimeout(()=>process.getBuiltinModule('inspector').close(),200).unref();true",
          returnByValue: true,
          timeout: 1000,
        }));
      }
    } finally {
      client.socket.close();
    }
  }
}

async function main(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object');
  positivePid(input.pid);
  if (input.action === 'activate') {
    process._debugProcess(input.pid);
    return { ok: true };
  }
  if (input.action === 'evaluate') return { ok: true, result: await evaluate(input) };
  throw new Error('action must be activate or evaluate');
}

const chunks = [];
let inputBytes = 0;
process.stdin.on('data', (chunk) => {
  inputBytes += chunk.length;
  if (inputBytes > MAX_INPUT_BYTES) {
    finish({ ok: false, error: 'Input exceeds 256 KiB' });
    return;
  }
  chunks.push(chunk);
});
process.stdin.on('error', (error) => finish({ ok: false, error: error.message }));
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    finish(await main(input));
  } catch (error) {
    finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
