import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionState} from '../plugin/session-state.mjs';
import {personaSection, loadPersona} from '../plugin/prompt.mjs';
import {createRpcHandler} from '../plugin/rpc.mjs';
import {registerRoutes} from '../plugin/routes.mjs';

const owner = {principal: {kind: 'owner'}};
test('session switches persist separately; new conversations and forks start off', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'persona-state-'));
  try {
    const file = join(directory, 'sessions.json');
    const state = await new SessionState(file).load();
    assert.equal(state.enabled('A'), false);
    await Promise.all([state.set('A', true,'可爱'), state.set('B', true,'严谨')]);
    assert.equal(state.enabled('A'), true);
    assert.equal(state.enabled('B'), true);
    assert.equal(state.enabled('A-fork'), false);
    const reloaded = await new SessionState(file).load();
    assert.equal(reloaded.enabled('A'), true);
    assert.equal(reloaded.selection('A'),'可爱');
    await reloaded.set('A', false);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).enabledSessions, ['B']);
    const restarted = await new SessionState(file, {bootId: 'a-different-process'}).load();
    assert.equal(restarted.enabled('B'), false);
    assert.equal(restarted.selection('B'),undefined);
    assert.throws(() => state.set('C', 'true'));
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('official prompt contribution only affects enabled standard parent conversations', async () => {
  const state = {enabled: id => id === 'A',selection:()=> 'test'};
  const section = personaSection(state, {text:()=> 'literal {{braces}}'});
  const agent = (id, preset = 'standard', origin) => ({session: {id, header: {origin}},
    ctx: {get: name => name === 'sessionProjections' ? {stateOf: () => preset} : undefined}});
  assert.match(section.text({agent: agent('A')}), /literal \{\{braces\}\}/);
  assert.equal(section.interpolate, false);
  assert.equal(section.text({agent: agent('B')}), '');
  assert.equal(section.text({agent: agent('A', 'minimal')}), '');
  assert.equal(section.text({agent: agent('A', 'standard', 'subagent')}), '');
  assert.equal(section.text({}), '');
  assert.equal(section.text(), '');
  assert.ok((await loadPersona()).length > 0);
});

test('owner-gated shared API routes validate envelopes and round-trip explicit settings', async () => {
  const values = new Map(), selections = new Map();
  const dispatch = createRpcHandler({state: {enabled: id => values.get(id) === true,
    selection:id=>selections.get(id),
    set: async (id, enabled, persona) => { values.set(id, enabled);selections.set(id,persona); return enabled; }},
    store:{list:()=>[{name:'无法拒绝'}],defaultName:()=> '无法拒绝',get:()=>({name:'无法拒绝'})},updater: {}});
  assert.equal((await dispatch('set', {sessionId: 'A', enabled: true}, undefined, {principal: {kind: 'guest'}})).ok, false);
  assert.equal(values.size, 0);
  assert.equal((await dispatch('state', {}, undefined, owner)).ok, false);
  const routes = new Map();
  registerRoutes({connection: {fetch: {register: route => routes.set(route.path, route)}}}, dispatch);
  const invoke = async (method, payload) => {
    const endpoint = `dsh-persona-${method}`;
    const request = new Request(`http://localhost/api/${endpoint}`, {method: 'POST',
      body: JSON.stringify({type: 'client-request', method: endpoint, rpcId: 'test', payload})});
    return (await routes.get(`/api/${endpoint}`).fetch(request)).json();
  };
  assert.equal((await invoke('set', {sessionId: 'A', enabled: true})).result.value.enabled, true);
  assert.equal((await invoke('state', {sessionId: 'B'})).result.value.enabled, false);
  const malformed = await routes.get('/api/dsh-persona-state').fetch(new Request('http://localhost', {method: 'POST', body: '{}'}));
  assert.equal(malformed.status, 400);
});
