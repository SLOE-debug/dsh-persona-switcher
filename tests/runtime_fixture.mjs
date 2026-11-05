// Controlled process: imports shipped code, but never starts DSH or sends an API call.
import assert from 'node:assert/strict';
import {control} from '../runtime_patch.mjs';
const moduleUrl = process.argv[2];
const {LlmRuntime} = await import(moduleUrl);
const original = LlmRuntime.prototype.forAdapter;
let preset = 'standard';
const projections = {stateOf: () => preset};
const agent = {session: {header: {}}, ctx: {sessionProjections: projections}};
const agents = {get: id => id === 'fixture' ? agent : undefined};
// queryObjects must find a genuine instance of the imported public prototype.
const runtime = Object.assign(Object.create(LlmRuntime.prototype), {
  ctx: {get: name => name === 'agents' ? agents : name === 'sessionProjections' ? projections : undefined},
  adapters: new Map(),
});
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

globalThis.runPersonaFixture = async candidate => {
  let checks = 0;
  const check = (label, verify) => {
    assert.doesNotThrow(verify, label);
    checks++;
  };
  assert.equal((await control({action: 'status'})).active, false);
  await assert.rejects(control({action: 'apply', name: '空', text: ' ', candidate}));
  check('invalid persona installs no hook', () => assert.equal(LlmRuntime.prototype.forAdapter, original));
  const armed = await control({action: 'apply', name: '可爱', text: '可爱表情 (｡･ω･｡)', candidate});
  check('armed until a qualifying request is seen', () => assert.equal(armed.phase, 'armed'));
  check('runtime discovery candidate is recorded', () => assert.equal(armed.candidate.methodName, candidate.methodName));
  const call = options => runtime.forAdapter(options, {});
  const result = call(base);
  check('initial system receives persona', () => assert.match(result.messages[0].content.at(-1).text, /可爱表情/));
  check('historical system snapshot receives persona', () => assert.match(result.messages[2].content.at(-1).text, /可爱表情/));
  check('dormant systems stay empty', () => assert.equal(result.messages[3].content.length, 0));
  check('user message identity is preserved', () => assert.equal(result.messages[1], base.messages[1]));
  check('assistant message identity is preserved', () => assert.equal(result.messages[4], base.messages[4]));
  check('tools are unchanged', () => assert.equal(result.tools, base.tools));
  check('durable input is unchanged', () => assert.equal(JSON.stringify(base), baseline));
  check('repeated calls never accumulate persona', () => assert.equal(call(base).messages[0].content.length, 2));
  const observed = await control({action: 'status'});
  check('applied request is observed', () => assert.equal(observed.phase, 'observed'));
  check('recognized shape is exposed', () => assert.equal(observed.lastShape, 'system-messages'));
  check('each qualifying call is counted once', () => assert.equal(observed.appliedRequests, 2));
  const rearmed = await control({action: 'apply', name: '专业', text: '简洁专业', candidate});
  check('switch resets request observations', () => assert.equal(rearmed.appliedRequests, 0));
  const switched = call(base);
  check('new persona replaces previous persona', () => {
    assert.match(switched.messages[0].content.at(-1).text, /简洁专业/);
    assert.doesNotMatch(switched.messages[0].content.at(-1).text, /可爱表情/);
  });
  preset = 'minimal';
  check('other presets are skipped', () => assert.equal(call(base), base));
  preset = 'standard';
  agent.session.header.origin = 'subagent';
  check('subagents are skipped', () => assert.equal(call(base), base));
  delete agent.session.header.origin;
  for (const purpose of ['compaction', 'session-title']) {
    const auxiliary = {...base, purpose};
    check(`${purpose} auxiliary calls are skipped`, () => assert.equal(call(auxiliary), auxiliary));
  }
  const inactive = {...base, sessionId: 'other'};
  check('unregistered agents are skipped', () => assert.equal(call(inactive), inactive));
  const unknownShape = {...base, messages: [message('user', 'No system')]};
  check('unknown instruction structure is preserved', () => assert.equal(call(unknownShape), unknownShape));
  const stats = await control({action: 'status'});
  check('only qualifying calls count toward application', () => assert.equal(stats.appliedRequests, 1));
  check('skipped calls are counted separately', () => assert.equal(stats.skippedRequests, 6));
  check('skip reason is available', () => assert.match(stats.lastSkipReason, /系统指令结构/));
  const reset = await control({action: 'reset'});
  check('original method is restored exactly', () => assert.equal(LlmRuntime.prototype.forAdapter, original));
  check('reset returns to standard', () => assert.equal(reset.phase, 'standard'));
  check('reset removes active persona', () => assert.equal((reset.active), false));
  check('original request survives all switching', () => assert.equal(JSON.stringify(base), baseline));
  await control({action: 'apply', name: '重启前人格', text: '此人格必须随进程退出而消失。', candidate});
  const beforeExit = await control({action: 'status'});
  check('persona is active before fixture exits', () => assert.equal(beforeExit.active, true));
  return {passed: true, checks, persistedInputChanged: false, restartPending: true};
};
process.stdout.write(JSON.stringify({ready: true, pid: process.pid}) + '\n');
setInterval(() => {}, 1000);
