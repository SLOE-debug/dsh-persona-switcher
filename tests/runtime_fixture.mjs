// Controlled process: imports shipped code, but never starts DSH or sends an API call.
import assert from 'node:assert/strict';
import {control} from '../runtime_patch.mjs';
const moduleUrl = process.argv[2];
const {LlmRuntime} = await import(moduleUrl);
const original = LlmRuntime.prototype.forAdapter;
let preset = 'standard';
const agent = {session: {header: {}}, ctx: {sessionProjections: {stateOf: () => preset}}};
const runtime = {
  ctx: {get: name => name === 'agents' ? {get: id => id === 'fixture' ? agent : undefined} : undefined},
  adapters: new Map(),
};
const message = (role, text) => Object.freeze({
  role, source: Object.freeze({kind: 'fixture'}),
  content: Object.freeze(text === '' ? [] : [Object.freeze({type: 'text', text})]),
});
const base = Object.freeze({
  sessionId: 'fixture', messages: Object.freeze([
    message('system', 'Original system'), message('user', 'Hello'),
    message('system', 'Updated system'), message('system', ''), message('assistant', 'Answer'),
  ]), tools: Object.freeze([{name: 'unchanged_tool'}]),
});
const baseline = JSON.stringify(base);

globalThis.runPersonaFixture = async () => {
  assert.equal((await control({action: 'status'})).active, false);
  await assert.rejects(control({action: 'apply', name: '空', text: ' ', moduleUrl}));
  assert.equal(LlmRuntime.prototype.forAdapter, original, 'invalid persona does not install a hook');
  await control({action: 'apply', name: '可爱', text: '可爱表情 (｡･ω･｡)', moduleUrl});
  const result = LlmRuntime.prototype.forAdapter.call(runtime, base, {});
  assert.match(result.messages[0].content.at(-1).text, /可爱表情/);
  assert.match(result.messages[2].content.at(-1).text, /可爱表情/);
  assert.equal(result.messages[3].content.length, 0, 'dormant systems stay empty');
  assert.equal(result.messages[1], base.messages[1]);
  assert.equal(result.messages[4], base.messages[4]);
  assert.equal(result.tools, base.tools);
  assert.equal(JSON.stringify(base), baseline, 'durable messages are unchanged');
  assert.equal(LlmRuntime.prototype.forAdapter.call(runtime, base, {}).messages[0].content.length, 2);
  await control({action: 'apply', name: '专业', text: '简洁专业', moduleUrl});
  const switched = LlmRuntime.prototype.forAdapter.call(runtime, base, {});
  assert.match(switched.messages[0].content.at(-1).text, /简洁专业/);
  assert.doesNotMatch(switched.messages[0].content.at(-1).text, /可爱表情/);
  preset = 'minimal';
  assert.equal(LlmRuntime.prototype.forAdapter.call(runtime, base, {}), base);
  preset = 'standard';
  agent.session.header.origin = 'subagent';
  assert.equal(LlmRuntime.prototype.forAdapter.call(runtime, base, {}), base);
  delete agent.session.header.origin;
  for (const purpose of ['compaction', 'title']) {
    const auxiliary = {...base, purpose};
    assert.equal(LlmRuntime.prototype.forAdapter.call(runtime, auxiliary, {}), auxiliary);
  }
  const inactive = {...base, sessionId: 'other'};
  assert.equal(LlmRuntime.prototype.forAdapter.call(runtime, inactive, {}), inactive);
  const stats = await control({action: 'status'});
  assert.equal(stats.appliedRequests, 3);
  await control({action: 'reset'});
  assert.equal(LlmRuntime.prototype.forAdapter, original, 'original method restored exactly');
  assert.equal((await control({action: 'status'})).active, false);
  assert.equal(JSON.stringify(base), baseline);
  await control({action: 'apply', name: '重启前人格', text: '此人格必须随进程退出而消失。', moduleUrl});
  assert.equal((await control({action: 'status'})).active, true);
  return {passed: true, checks: 21, persistedInputChanged: false, restartPending: true};
};
process.stdout.write(JSON.stringify({ready: true, pid: process.pid}) + '\n');
setInterval(() => {}, 1000);
