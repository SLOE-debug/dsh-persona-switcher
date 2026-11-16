export function registerCoreRoutes(ctx, host) {
  for (const endpoint of ['runtime','install-runtime']) {
    const method = `dsh-persona-${endpoint}`;
    ctx.connection.fetch.register({path:`/api/${method}`,methods:['POST'],requestBody:'buffered',
      async fetch(request) {
        let body;
        try { body = await request.json(); } catch { return new Response('Bad JSON',{status:400}); }
        if(body?.type!=='client-request'||body.method!==method||typeof body.rpcId!=='string') return new Response('Bad request',{status:400});
        let result;
        try { result = {ok:true,value:endpoint==='runtime'?host.status():await host.activate(body.payload?.directory)}; }
        catch(error) { result={ok:false,error:{code:'persona/runtime-failed',message:error.message,details:{}}}; }
        return Response.json({type:'server-response',rpcId:body.rpcId,result});
      }});
  }
}
