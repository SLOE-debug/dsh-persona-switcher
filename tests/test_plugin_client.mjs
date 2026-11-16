import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {renderer,settle} from './client-renderer.mjs';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }

test('composer control uses the session slot and ignores previous-conversation RPC results', async () => {
  const ui = renderer(); let plugin, Controls, registration, settings;
  vm.runInNewContext(await readFile(new URL('../plugin/client-runtime.js', import.meta.url), 'utf8'), {
    DSH_PERSONA_REVISION:'test',window: {__DSH_PERSONA_CLIENT__: {register(revision,factory) { plugin = factory(name => {
      assert.equal(name, 'react'); return ui.React;
    }); }}}, AbortController,document:{createElement:()=>({dataset:{},remove(){}}),head:{appendChild(){}}},
  });
  const pending = new Map(), calls = [],effects=[];
  plugin.apply({effect(fn){effects.push(fn());},slots: {inject(name, callback) { callback(); },
    register(options, component) { if(options.name==='settings.section'){settings=options;return;} registration = options; Controls = component; }},
    connection: {rpc: {call(channel, method, payload) {
      calls.push({channel, method, payload});
      if (method === 'dsh-persona-state') {
        const request = deferred(); pending.set(payload.sessionId, request); return request.promise;
      }
      if(method==='dsh-persona-list')return Promise.resolve({ok:true,value:{personas:[{name:'无法拒绝'},{name:'可爱'}]}});
      return Promise.resolve({ok: true, value: {sessionId: payload.sessionId, enabled: payload.enabled,persona:payload.persona}});
    }}}});
  assert.equal(registration.name, 'conversation.input.dock');
  assert.equal(settings.id,'dsh-persona-manager');assert.equal(settings.label(),'人格管理');
  function find(predicate,node=ui.tree()) {
    if(!node||typeof node!=='object')return;
    if(predicate(node))return node;
    for(const child of node.children??[]){const result=find(predicate,child);if(result)return result;}
  }
  const switchNode=()=>find(node=>node.props.role==='switch');
  const properties = id => ({sessionId: id, useProjection: () => 'standard'});
  ui.mount(Controls, properties('A')); await settle();
  ui.render(properties('B')); await settle();
  pending.get('A').resolve({ok: true, value: {sessionId: 'A', enabled: true,persona:'无法拒绝'}});
  await settle();
  let button = switchNode();
  assert.equal(button.props['aria-checked'], false); assert.equal(button.props.disabled, true);
  pending.get('B').resolve({ok: true, value: {sessionId: 'B', enabled: false,persona:'无法拒绝'}});
  await settle();
  button = switchNode();
  assert.equal(button.props.disabled, false);
  await button.props.onClick(); await settle();
  assert.equal(switchNode().props['aria-checked'], true);
  assert.equal(calls.at(-1).payload.sessionId, 'B');
  assert.equal(calls.at(-1).payload.enabled, true);
  await find(node=>typeof node.type==='function'&&Array.isArray(node.props.items)).props.onChange('可爱');await settle();
  assert.equal(calls.at(-1).payload.sessionId,'B');assert.equal(calls.at(-1).payload.persona,'可爱');assert.equal(calls.at(-1).payload.enabled,true);
  ui.render(properties('C')); await settle();
  assert.equal(switchNode().props['aria-checked'], false);
  ui.close();
  for(const effect of effects)effect();
});
