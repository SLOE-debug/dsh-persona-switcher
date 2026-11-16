import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RuntimeHost} from '../plugin/host.mjs';

function context(directory) {
  const active=new Set(),resources=new Map();
  return {active,resources,profileContext:{dir:directory},webServer:{register:route=>resources.set(route.path,route)},
    plugin(definition) {
      const cleanup=[];
      const scope={effect(fn){cleanup.push(fn());},active};
      const fiber={state:1,async await(){await ready;return fiber;},async dispose(){await ready.catch(()=>{});for(const fn of cleanup.reverse())await fn?.();fiber.state=0;}};
      const ready=Promise.resolve().then(()=>definition.apply(scope)).then(()=>{fiber.state=2;});
      return fiber;
    }};
}
async function packageAt(root, name, fail=false) {
  const dir=join(root,name);await mkdir(join(dir,'plugin'),{recursive:true});await mkdir(join(dir,'personas'));
  await writeFile(join(dir,'package.json'),JSON.stringify({name:'dsh-persona-switcher',dsh:{personaProtocol:1}}));
  await writeFile(join(dir,'plugin/runtime.mjs'),`export const inject=[];export function apply(ctx){${fail?'throw new Error("bad update")':`ctx.effect(()=>{ctx.active.add(${JSON.stringify(name)});return()=>ctx.active.delete(${JSON.stringify(name)})})`}}`);
  await writeFile(join(dir,'plugin/client-runtime.js'),'window.__DSH_PERSONA_CLIENT__.register(DSH_PERSONA_REVISION,()=>({apply(){},inject:[]}));');
  for(const file of ['cordis.patch.yml','README.md','personas/无法拒绝.md'])await writeFile(join(dir,file),name);
  return dir;
}
test('versioned Cordis child replacement changes backend and client asset without touching the host',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'persona-kernel-'));
  try {
    const ctx=context(dir),host=new RuntimeHost(ctx);await mkdir(host.directory);
    const first=await packageAt(host.directory,'first'),second=await packageAt(host.directory,'second');
    await host.activate(first);const firstRevision=host.status().revision;
    assert.deepEqual([...ctx.active],['first']);
    await host.activate(second);
    assert.deepEqual([...ctx.active],['second']);assert.notEqual(host.status().revision,firstRevision);
    const asset=ctx.resources.get(host.status().clientUrl);assert.equal((await asset.resource()).status,200);
    const bad=await packageAt(host.directory,'bad',true);
    await assert.rejects(host.activate(bad),/bad update/);
    assert.deepEqual([...ctx.active],['second']);
    await host.stop();assert.equal(ctx.active.size,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
