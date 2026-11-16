export const METHODS = ['state', 'set', 'list', 'read', 'save', 'delete', 'check-update', 'update'];

// Connection's shared /api Fetch registry enforces authenticated owner access.
// It is also the path used by the packaged Desktop transport.
export function registerRoutes(ctx, dispatch) {
  for (const method of METHODS) {
    const endpoint = `dsh-persona-${method}`;
    ctx.connection.fetch.register({
      path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        let body;
        try { body = await request.json(); }
        catch { return new Response('请求正文不是 JSON。', {status: 400}); }
        if (body?.type !== 'client-request' || body.method !== endpoint ||
            typeof body.rpcId !== 'string' || body.rpcId.length > 256) {
          return new Response('无效的插件请求。', {status: 400});
        }
        const result = await dispatch(method, body.payload, request.signal, {principal: {kind: 'owner'}});
        return Response.json({type: 'server-response', rpcId: body.rpcId, result});
      },
    });
  }
}
