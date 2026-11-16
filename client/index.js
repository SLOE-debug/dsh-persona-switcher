import css from '../build/client/tailwind.css';
import {createApi,createChanges} from './shared.js';
import {createComposer} from './composer.js';
import {createSettings} from './settings.js';
import {createUpdates} from './updates.js';

window.__DSH_PERSONA_CLIENT__.register(DSH_PERSONA_REVISION,function(require){
  const React=require('react');
  return {inject:['slots','uiSession','connection'],apply(ctx){
    const api=createApi(ctx.connection),changes=createChanges();
    const Updates=createUpdates(React,api),Composer=createComposer(React,api,changes),Settings=createSettings(React,api,changes,Updates);
    const sheet=document.createElement('style');sheet.dataset.personaRevision=DSH_PERSONA_REVISION;sheet.textContent=css;
    document.head.appendChild(sheet);ctx.effect(()=>()=>sheet.remove());
    ctx.slots.inject('conversation.input.dock',()=>ctx.slots.register({name:'conversation.input.dock',id:'dsh-persona-switcher',order:-100},Composer));
    ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'dsh-persona-manager',order:45,label:()=> '人格管理'},Settings));
  }};
});
