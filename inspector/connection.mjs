import http from 'node:http';

export function endpointUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('调试地址必须是带端口的本机回环 HTTP 地址。');
  }
  return url;
}

async function targets(endpoint) {
  return new Promise((resolve, reject) => {
    const request = http.get(new URL('/json/list', endpoint), {agent: false}, response => {
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error('调试目标列表读取失败。')); return;
      }
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 262144) response.destroy(new Error('调试目标列表过大。'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks))); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error('调试连接超时。')));
    request.on('error', reject);
  });
}

export async function connect(value) {
  const endpoint = endpointUrl(value);
  const nodes = (await targets(endpoint)).filter(target => target.type === 'node');
  if (nodes.length !== 1) throw new Error('无法唯一确定 Node 调试目标。');
  const url = new URL(nodes[0].webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || url.host !== endpoint.host || url.username || url.password || url.hash) {
    throw new Error('调试 WebSocket 与目标端口不一致。');
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let sequence = 0;
    const pending = new Map();
    const listeners = new Set();
    const fail = error => {
      reject(error);
      for (const operation of pending.values()) operation.reject(error);
      pending.clear();
    };
    socket.addEventListener('error', () => fail(new Error('调试连接失败。')));
    socket.addEventListener('close', () => fail(new Error('调试连接已关闭。')));
    socket.addEventListener('message', ({data}) => {
      try {
        const message = JSON.parse(data);
        if (message.method) for (const listener of listeners) listener(message);
        const operation = pending.get(message.id);
        if (!operation) return;
        pending.delete(message.id);
        if (message.error) operation.reject(new Error(message.error.message));
        else operation.resolve(message.result);
      } catch (error) { fail(error); socket.close(); }
    });
    socket.addEventListener('open', () => resolve({
      socket, listeners,
      call(method, params = {}) {
        return new Promise((resolveCall, rejectCall) => {
          const id = ++sequence;
          pending.set(id, {resolve: resolveCall, reject: rejectCall});
          socket.send(JSON.stringify({id, method, params}));
        });
      },
    }));
  });
}

export function returnedValue(response) {
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
    throw new Error(String(detail).split('\n').slice(0, 3).join('\n'));
  }
  if (response.result?.type === 'undefined') return null;
  if (!response.result || !Object.hasOwn(response.result, 'value')) throw new Error('调试结果不是可传输的数据。');
  return response.result.value;
}
