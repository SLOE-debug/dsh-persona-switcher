import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendPersona, classifyScope} from '../request_contract.mjs';

const context = (preset = 'standard', origin) => ({ctx: {get: () => ({get: () => ({
  session: {header: origin ? {origin} : {}}, ctx: {sessionProjections: {stateOf: () => preset}},
})})}});

test('scope excludes auxiliary, subagent, other preset and unclassified calls', () => {
  const request = {sessionId: 'session'};
  assert.equal(classifyScope(context(), request), null);
  for (const purpose of ['title', 'compaction', 'unknown-purpose']) {
    assert.equal(classifyScope(context(), {...request, purpose}), '辅助请求保持原样');
  }
  assert.equal(classifyScope(context('standard', 'subagent'), request), '子代理请求保持原样');
  assert.equal(classifyScope(context('minimal'), request), '当前会话使用其他预设');
  assert.ok(classifyScope({}, request));
  assert.ok(classifyScope(context(), {}));
});

test('block messages preserve frozen original, tools, thinking and tool changes', () => {
  const assistant = {role: 'assistant', content: [{type: 'thinking', thinking: 'r', signature: 's'}, {type: 'tool_use', id: 't'}]};
  const developer = {role: 'developer', content: [{type: 'tool-addition', toolName: 'x'}]};
  const request = Object.freeze({messages: Object.freeze([
    Object.freeze({role: 'system', content: Object.freeze([Object.freeze({type: 'text', text: 'original'})])}),
    {role: 'system', content: []}, assistant, developer,
  ]), tools: Object.freeze([{name: 'x'}])});
  const original = JSON.stringify(request);
  const result = appendPersona(request, 'friendly').options;
  assert.equal(JSON.stringify(request), original);
  assert.equal(result.messages[0].content.length, 2);
  assert.equal(result.messages[1], request.messages[1]);
  assert.equal(result.messages[2], assistant);
  assert.equal(result.messages[3], developer);
  assert.equal(result.tools, request.tools);
});

test('string system and top-level envelopes use precise fields', () => {
  const request = {messages: [{role: 'system', content: 'original'}, {role: 'user', content: '{"system":"data"}'}]};
  const result = appendPersona(request, 'cute').options;
  assert.match(result.messages[0].content, /^original\n\n/);
  assert.equal(result.messages[1], request.messages[1]);
  for (const key of ['system', 'instructions']) {
    const top = {messages: [{role: 'user', content: 'hello'}], [key]: 'original'};
    assert.match(appendPersona(top, 'cute').options[key], /^original\n\n/);
  }
});

test('unknown and ambiguous instructions are passed through rather than guessed', () => {
  for (const request of [
    {messages: [{role: 'developer', content: [{type: 'tool-removal', toolName: 'x'}]}]},
    {messages: [{role: 'system', content: [{type: 'image'}]}]},
    {messages: [], system: 'one', instructions: 'two'},
    {messages: [null]},
  ]) assert.equal(appendPersona(request, 'cute').options, undefined);
});

test('switching from original inputs never accumulates persona text', () => {
  const source = {messages: [{role: 'system', content: 'base'}]};
  const first = appendPersona(source, 'first').options;
  const second = appendPersona(source, 'second').options;
  assert.match(first.messages[0].content, /first/);
  assert.doesNotMatch(second.messages[0].content, /first/);
  assert.equal(source.messages[0].content, 'base');
});
