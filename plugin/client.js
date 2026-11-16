window.__ModuleLoader__.load({id:'dsh-persona-switcher', factory(require) {
  const React = require('react');
  async function apply(ctx) {
    let disposed = false, current = '', child, loading = false;
    const pending = new Map(), loaded = new Map(), scripts = new Set();
    let problem = '', listeners = new Set();
    const status = {getSnapshot:()=>problem, subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
    const showError = error => {problem=error;for(const listener of listeners) listener();};
    const previousBridge = window.__DSH_PERSONA_CLIENT__;
    const bridge = {register(revision, factory) {
      const plugin = factory(require); loaded.set(revision,plugin);
      pending.get(revision)?.resolve(plugin); pending.delete(revision);
    }};
    window.__DSH_PERSONA_CLIENT__ = bridge;
    function Notice() {
      const text=React.useSyncExternalStore(status.subscribe,status.getSnapshot);
      return text?React.createElement('div',{role:'status',style:{fontSize:12,color:'var(--dsw-alias-label-secondary)'}},text):null;
    }
    ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'persona-loader-status',order:-101},Notice));
    function load(descriptor) {
      if(loaded.has(descriptor.revision)) return Promise.resolve(loaded.get(descriptor.revision));
      return new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        const timeout=setTimeout(()=>{pending.delete(descriptor.revision);script.remove();reject(new Error('人格界面加载超时。'));},15000);
        pending.set(descriptor.revision,{resolve:plugin=>{clearTimeout(timeout);resolve(plugin);}});
        script.src=new URL(descriptor.clientUrl,document.baseURI).href;
        script.onerror=()=>{clearTimeout(timeout);pending.delete(descriptor.revision);reject(new Error('人格界面加载失败，请刷新 DSH 窗口。'));};
        scripts.add(script); document.head.appendChild(script);
      });
    }
    async function refresh() {
      if(disposed||loading) return;
      loading=true;
      try {
        const response=await ctx.connection.rpc.call('/api','dsh-persona-runtime',{});
        if(!response.ok) throw new Error(response.error?.message||'无法读取人格插件版本。');
        const descriptor=response.value;
        showError(descriptor.error||'');
        if(!descriptor.revision||descriptor.revision===current) return;
        if(!/^[a-f0-9]{64}$/.test(descriptor.revision)||descriptor.clientUrl!==`/_dsh-persona/${descriptor.revision}.js`) throw new Error('人格界面版本信息不正确。');
        const plugin=await load(descriptor);
        if(disposed) return;
        await child?.dispose(); child=ctx.plugin(plugin); await child.await();
        if(child.state!==2) throw new Error('人格界面依赖未就绪。');
        current=descriptor.revision;showError('');
      } catch(error) {if(!disposed) showError(error.message);}
      finally {loading=false;}
    }
    const timer=setInterval(refresh,2000);
    ctx.effect(()=>async()=>{
      disposed=true;clearInterval(timer);await child?.dispose();
      if(window.__DSH_PERSONA_CLIENT__===bridge) window.__DSH_PERSONA_CLIENT__=previousBridge;
      for(const script of scripts) script.remove();
      listeners.clear();
    });
    await refresh();
  }
  return {inject:['slots','connection','uiSession'],apply};
}});
