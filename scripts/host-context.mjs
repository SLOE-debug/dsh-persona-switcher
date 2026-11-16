export async function hostContext(session, entry) {
  const key=`__persona_context_${process.pid}`;
  const prototype=await session.evaluate(`process.getBuiltinModule('module').createRequire(${JSON.stringify(entry)})('@deepseek-ai/cordis').Context.prototype`,false);
  const objects=await session.call('Runtime.queryObjects',{prototypeObjectId:prototype.objectId});
  try {
    const reply=await session.call('Runtime.callFunctionOn',{objectId:objects.objects.objectId,returnByValue:true,arguments:[{value:key}],
      functionDeclaration:`function(key){
        const roots=new Set();
        for(const context of this)try{const root=context.root;if(root?.get('profileContext')&&root.get('pluginManager')?.installBundle)roots.add(root);}catch{}
        if(roots.size!==1)throw new Error('无法唯一确定 DSH 插件管理上下文。');
        const root=[...roots][0];globalThis[key]=root;
        return {profile:root.get('profileContext').name,directory:root.get('profileContext').dir};
      }`});
    if(reply.exceptionDetails)throw new Error(reply.exceptionDetails.exception?.description||reply.exceptionDetails.text);
    return {key,...reply.result.value};
  }finally{
    await session.call('Runtime.releaseObject',{objectId:objects.objects.objectId});
    await session.call('Runtime.releaseObject',{objectId:prototype.objectId});
  }
}
