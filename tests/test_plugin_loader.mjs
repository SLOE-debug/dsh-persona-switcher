import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('fixed client loader replaces mounted payloads and releases its resources', async () => {
  const source = await readFile(new URL('../plugin/client.js', import.meta.url), 'utf8');
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  let revision = first, rootPlugin, refresh, cleanup;
  const active = new Set(), scripts = new Set(), timeouts = new Set();
  const previousBridge = {};
  const window = {__DSH_PERSONA_CLIENT__:previousBridge,
    __ModuleLoader__:{load({factory}){rootPlugin=factory(()=>({}));}}};
  const document = {baseURI:'http://localhost/', createElement(){return {remove(){scripts.delete(this);}};},
    head:{appendChild(script){
      scripts.add(script);
      const requested = new URL(script.src).pathname.match(/([ab]{64})\.js$/)?.[1];
      window.__DSH_PERSONA_CLIENT__.register(requested,()=>({inject:[],apply(ctx){
        active.add(requested);ctx.effect(()=>()=>active.delete(requested));
      }}));
    }}};
  runInNewContext(source,{window,document,URL,
    setInterval(fn){refresh=fn;return 1;},clearInterval(){refresh=null;},
    setTimeout(fn){timeouts.add(fn);return fn;},clearTimeout(fn){timeouts.delete(fn);}});
  const ctx = {connection:{rpc:{async call(){return {ok:true,value:{revision,clientUrl:`/_dsh-persona/${revision}.js`}};}}},
    slots:{inject(name,fn){fn();},register(){}},effect(fn){cleanup=fn();},
    plugin(definition){
      const effects=[];
      const fiber={state:1,async await(){await ready;},async dispose(){await ready;for(const effect of effects)await effect();fiber.state=0;}};
      const ready=Promise.resolve().then(()=>definition.apply({effect(fn){effects.push(fn());}})).then(()=>{fiber.state=2;});
      return fiber;
    }};
  await rootPlugin.apply(ctx);
  assert.deepEqual([...active],[first]);
  revision=second;await refresh();
  assert.deepEqual([...active],[second]);
  assert.equal(timeouts.size,0);
  await cleanup();
  assert.equal(active.size,0);assert.equal(scripts.size,0);assert.equal(refresh,null);
  assert.equal(window.__DSH_PERSONA_CLIENT__,previousBridge);
});
