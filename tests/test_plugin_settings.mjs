import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettings} from '../client/settings.js';
import {renderer,settle} from './client-renderer.mjs';

test('settings editor guards unsaved work, saves renamed Markdown and confirms deletion',async()=>{
  const ui=renderer(),files=new Map([['原人格',{name:'原人格',text:'original',version:'v1'}]]),calls=[];
  let notifications=0;
  async function api(method,payload){
    calls.push({method,payload});
    if(method==='list')return {personas:[...files.values()]};
    if(method==='read')return {...files.get(payload.name)};
    if(method==='save'){
      assert.equal(payload.original,'原人格');assert.equal(payload.expectedVersion,'v1');
      const value={name:payload.name,text:payload.text,version:'v2'};files.delete(payload.original);files.set(value.name,value);return value;
    }
    if(method==='delete'){files.delete(payload.name);return {deleted:payload.name};}
    throw new Error('unexpected method');
  }
  const Settings=createSettings(ui.React,api,{emit(){notifications++;}},()=>null);
  const button=label=>ui.find(node=>node.type==='button'&&node.children.includes(label));
  ui.mount(Settings,{});await settle();
  assert.equal(ui.find(node=>node.type==='textarea').props.value,'original');
  ui.find(node=>node.type==='input').props.onChange({target:{value:'可爱'}});await settle();
  ui.find(node=>node.type==='textarea').props.onChange({target:{value:'reply (｡･ω･｡)'}});await settle();
  const reads=calls.filter(call=>call.method==='read').length;
  button('新增').props.onClick();await settle();
  assert.equal(ui.find(node=>node.type==='input').props.value,'可爱');
  assert.equal(calls.filter(call=>call.method==='read').length,reads);
  await button('保存人格').props.onClick();await settle();
  assert.equal(files.get('可爱').text,'reply (｡･ω･｡)');assert.equal(notifications,1);
  button('删除人格').props.onClick();await settle();
  assert.equal(files.size,1);assert.ok(button('确认删除'));
  await button('确认删除').props.onClick();await settle();
  assert.equal(files.size,0);assert.equal(notifications,2);
  button('新增').props.onClick();await settle();
  assert.equal(ui.find(node=>node.type==='input').props.value,'');
  assert.equal(ui.find(node=>node.type==='textarea').props.value,'');
  ui.close();
});
