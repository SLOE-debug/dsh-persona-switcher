import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PersonaStore,personaName} from '../plugin/persona-store.mjs';
import {SessionState} from '../plugin/session-state.mjs';
import {personaSection} from '../plugin/prompt.mjs';
import {createRpcHandler} from '../plugin/rpc.mjs';

test('Markdown CRUD persists edits, detects conflicts, renames selections and disables deleted personas',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'persona-library-'));
  try{
    const store=await new PersonaStore(join(dir,'personas')).init('original {{literal}}');
    const state=await new SessionState(join(dir,'state.json')).load();
    const dispatch=createRpcHandler({store,state,updater:{}}),owner={principal:{kind:'owner'}};
    async function call(method,payload){const result=await dispatch(method,payload,undefined,owner);assert.equal(result.ok,true,JSON.stringify(result));return result.value;}
    const cute=await call('save',{name:'可爱',text:'温柔地回复 (｡･ω･｡)'});
    await call('set',{sessionId:'A',enabled:true,persona:'可爱'});
    assert.equal((await call('state',{sessionId:'B'})).enabled,false);
    assert.equal((await call('state',{sessionId:'B'})).persona,'无法拒绝');
    const section=personaSection(state,store),agent={session:{id:'A'},ctx:{get:()=>({stateOf:()=> 'standard'})}};
    assert.match(section.text({agent}),/温柔/);
    const changed=await call('save',{original:'可爱',name:'可爱',text:'更新的正文',expectedVersion:cute.version});
    assert.match(section.text({agent}),/更新的正文/);
    assert.equal((await dispatch('save',{original:'可爱',name:'可爱',text:'stale',expectedVersion:cute.version},undefined,owner)).ok,false);
    const renamed=await call('save',{original:'可爱',name:'陪伴',text:changed.text,expectedVersion:changed.version});
    assert.equal((await call('state',{sessionId:'A'})).persona,'陪伴');
    assert.equal(await readFile(join(dir,'personas','陪伴.md'),'utf8'),'更新的正文');
    const reloaded=await new PersonaStore(join(dir,'personas')).init('do not overwrite');
    assert.equal(reloaded.text('无法拒绝'),'original {{literal}}');
    await call('delete',{name:'陪伴',expectedVersion:renamed.version});
    assert.equal((await call('state',{sessionId:'A'})).enabled,false);assert.equal(section.text({agent}),'');
    await call('delete',{name:'无法拒绝',expectedVersion:store.get('无法拒绝').version});
    assert.equal((await new PersonaStore(join(dir,'personas')).init('no reseed')).list().length,0);
    assert.equal((await dispatch('set',{sessionId:'A',enabled:true},undefined,owner)).ok,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('persona names reject paths and reserved names; content and duplicate checks protect files',async()=>{
  for(const name of ['../x','a/b','CON','nul.md','x.',' x',''])assert.throws(()=>personaName(name));
  const dir=await mkdtemp(join(tmpdir(),'persona-validation-'));
  try{
    const store=await new PersonaStore(join(dir,'personas')).init('seed');
    await assert.rejects(store.save({name:'无法拒绝',text:'duplicate'}),/同名/);
    await assert.rejects(store.save({name:'empty',text:' '}),/正文/);
    await assert.rejects(store.save({name:'large',text:'中'.repeat(22000)}),/64 KiB/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
