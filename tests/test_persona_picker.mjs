import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonaPicker} from '../client/persona-picker.js';
import {renderer,settle} from './client-renderer.mjs';

test('custom persona list handles keyboard selection, dismissal and conversation changes',async()=>{
  const listeners=new Map(),toggleListeners=new Set(),chosen=[];
  const previous=globalThis.window;
  globalThis.window={innerWidth:800,innerHeight:600,
    addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  let visible=false,focused=false;
  const panel={style:{},addEventListener(name,fn){toggleListeners.add(fn);},removeEventListener(name,fn){toggleListeners.delete(fn);},
    showPopover(){visible=true;},hidePopover(){visible=false;},querySelectorAll(){return Array.from({length:3},()=>({scrollIntoView(){}}));}};
  const trigger={getBoundingClientRect:()=>({left:750,top:520,bottom:548}),focus(){focused=true;}};
  const ui=renderer({element:node=>node.props.popover?panel:trigger});
  try{
    const Picker=createPersonaPicker(ui.React),props={sessionId:'A',items:[{name:'无法拒绝'},{name:'可爱'},{name:'严谨'}],value:'无法拒绝',disabled:false,onChange:name=>chosen.push(name)};
    ui.mount(Picker,props);await settle();
    const combo=()=>ui.find(node=>node.props.role==='combobox');
    async function key(value){let prevented=false;combo().props.onKeyDown({key:value,preventDefault(){prevented=true;},stopPropagation(){}});await settle();return prevented;}
    await key('ArrowDown');
    assert.equal(visible,true);assert.equal(combo().props['aria-expanded'],true);
    assert.equal(panel.style.bottom,'86px');assert.equal(panel.style.left,'568px');
    await key('ArrowDown');await key('Enter');
    assert.deepEqual(chosen,['可爱']);assert.equal(visible,false);assert.equal(focused,true);
    await key('ArrowDown');await key('End');
    assert.match(combo().props['aria-activedescendant'],/-2$/);
    await key('Escape');assert.equal(visible,false);assert.equal(chosen.length,1);
    combo().props.onClick();await settle();
    for(const fn of toggleListeners)fn({newState:'closed'});await settle();
    assert.equal(combo().props['aria-expanded'],false);
    await key('ArrowDown');ui.render({...props,sessionId:'B'});await settle();
    assert.equal(visible,false);assert.equal(combo().props['aria-expanded'],false);
    await key('可');await key('Enter');assert.deepEqual(chosen,['可爱','可爱']);
    ui.close();assert.equal(listeners.size,0);assert.equal(toggleListeners.size,0);
  }finally{globalThis.window=previous;}
});
