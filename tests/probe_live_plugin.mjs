import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {attach} from '../scripts/installer-cdp.mjs';
import {hostContext} from '../scripts/host-context.mjs';
import {copyPackage} from '../plugin/runtime-package.mjs';

const [rawPid,executable,entry]=process.argv.slice(2);
const session=await attach(Number(rawPid),executable,entry);
let context,original;
const fakeId='persona-probe-'+randomUUID(),newId=fakeId+'-new';
let temporaryPersona;
async function rpc(method,payload={}) {
  const name='dsh-persona-'+method;
  const value=await session.evaluate(`(async()=>{
    const connection=globalThis[${JSON.stringify(context.key)}].get('connection');
    const response=await connection.createSharedFetchHandler('/api').fetch(new Request('http://localhost/api/'+${JSON.stringify(name)},
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',method:${JSON.stringify(name)},rpcId:'persona-probe',payload:${JSON.stringify(payload)}})}),connection.browserPeer);
    if(response.status!==200)throw new Error('插件接口未激活：HTTP '+response.status);
    return response.json();
  })()`);
  assert.equal(value.result.ok,true,JSON.stringify(value));return value.result.value;
}
try {
  context=await hostContext(session,entry);
  const data=join(context.directory,'.dsh-persona-switcher');
  original=JSON.parse(await readFile(join(data,'current.json'),'utf8'));
  const status=await rpc('runtime');assert.match(status.revision,/^[a-f0-9]{64}$/);
  temporaryPersona=await rpc('save',{name:'验证-'+randomUUID(),text:'persona probe {{literal}}'});
  assert.equal((await rpc('state',{sessionId:fakeId})).enabled,false);
  assert.equal((await rpc('set',{sessionId:fakeId,enabled:true,persona:temporaryPersona.name})).enabled,true);
  assert.equal((await rpc('state',{sessionId:newId})).enabled,false);
  const prompt=await session.evaluate(`(()=>{
    const section=globalThis[${JSON.stringify(context.key)}].get('systemPrompt').layers.global.sections.get('dsh-persona-switcher:session-persona');
    const agent=id=>({session:{id,header:{}},ctx:{get:()=>({stateOf:()=> 'standard'})}});
    return {enabled:section.text({agent:agent(${JSON.stringify(fakeId)})}),disabled:section.text({agent:agent(${JSON.stringify(newId)})})};
  })()`);
  assert.match(prompt.enabled,/persona probe \{\{literal\}\}/);assert.equal(prompt.disabled,'');
  temporaryPersona=await rpc('save',{original:temporaryPersona.name,name:temporaryPersona.name+'改',text:'edited probe',expectedVersion:temporaryPersona.version});
  assert.equal((await rpc('state',{sessionId:fakeId})).persona,temporaryPersona.name);
  const next=join(data,'probe-'+randomUUID());await copyPackage(original.directory,next);
  await writeFile(join(next,'plugin/runtime.mjs'),(await readFile(join(next,'plugin/runtime.mjs'),'utf8'))+'\n// live hot-reload probe\n');
  const changed=await rpc('install-runtime',{directory:next});assert.notEqual(changed.revision,status.revision);
  assert.equal((await rpc('state',{sessionId:fakeId})).enabled,true);
  assert.equal((await rpc('state',{sessionId:newId})).enabled,false);
  const asset=await session.evaluate(`(async()=>{
    const root=globalThis[${JSON.stringify(context.key)}];const response=await root.get('webServer').readResource(new Request('http://localhost/_dsh-persona/'+${JSON.stringify(changed.revision)}+'.js'),root.get('connection').browserPeer);
    return {status:response.status,hasRevision:(await response.text()).includes(${JSON.stringify(changed.revision)})};
  })()`);
  assert.equal(asset.status,200);assert.equal(asset.hasRevision,true);
  const restored=await rpc('install-runtime',{directory:original.directory});assert.equal(restored.revision,status.revision);
  await rpc('delete',{name:temporaryPersona.name,expectedVersion:temporaryPersona.version});temporaryPersona=null;
  assert.equal((await rpc('state',{sessionId:fakeId})).enabled,false);
  console.log(JSON.stringify({ok:true,pid:Number(rawPid),markdownCrud:true,promptContribution:true,sessionIsolation:true,hotBackendReload:true,hotClientAsset:true,previousCodeRestored:true}));
}finally{
  if(context) {
    try{if(original)await rpc('install-runtime',{directory:original.directory});if(temporaryPersona)await rpc('delete',{name:temporaryPersona.name,expectedVersion:temporaryPersona.version});}catch{}
    await session.evaluate(`delete globalThis[${JSON.stringify(context.key)}]`);
  }
  await session.close();
}
