import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanSource } from '../discovery/semantic_scan.mjs';

function body({ filter = 'filter', stream = 'run', options = 'options', adapter = 'adapter', message = 'message', source = 'source', registry = 'adapters' } = {}) {
  return `
    ${filter}(${options}, ${adapter}) {
      const mapped = ${options}.messages.map((${message}) => {
        if (${message}.role !== 'assistant') return ${message};
        const ${source} = ${message}.source;
        if (${source}.replayState === void 0) return ${message};
        if (this.${registry}.get(${source}.provider)?.adapter === ${adapter}) return ${message};
        return freezeMessage({ ...${message}, source: {
          kind: 'model', provider: ${source}.provider, model: ${source}.model
        }});
      });
      if (mapped.every((value, index) => value === ${options}.messages[index])) return ${options};
      const outgoing = { ...${options}, messages: mapped };
      return Object.isFrozen(${options}) ? deepFreeze(outgoing) : outgoing;
    }
    async *${stream}(request) {
      const adapter = resolve(), dispatch = callable;
      const projected = request;
      const iterator = dispatch(this.${filter}(projected, adapter))[Symbol.asyncIterator]();
      yield* iterator;
    }
  `;
}

function only(source) {
  const result = scanSource(source);
  assert.equal(result.parseError, undefined);
  assert.equal(result.candidates.length, 1);
  return result.candidates[0];
}

test('recognizes the complete contract and method offsets', () => {
  const source = `export class Runtime { ${body()} }`;
  const candidate = only(source);
  assert.equal(candidate.classLocalName, 'Runtime');
  assert.equal(candidate.exportName, 'Runtime');
  assert.equal(candidate.methodName, 'filter');
  assert.ok(source.slice(candidate.methodStart, candidate.methodEnd).startsWith('filter('));
  assert.equal(candidate.evidence.length, 8);
  assert.equal(candidate.score, candidate.evidence.length);
});

test('renamed classes, methods, parameters and registry remain discoverable', () => {
  const candidate = only(`class Arbitrary {
    ${body({ filter: 'x', stream: 'y', options: 'p', adapter: 'a', message: 'm', source: 's', registry: 'r' })}
  } export { Arbitrary as PublicRuntime };`);
  assert.equal(candidate.classLocalName, 'Arbitrary');
  assert.equal(candidate.exportName, 'PublicRuntime');
  assert.equal(candidate.methodName, 'x');
});

test('compressed source and unrelated path text do not affect discovery', () => {
  const source = `/* moved to a completely different package */
    const R = class {${body({ filter: 'a', stream: 'b', options: 'o', adapter: 'x', message: 'm', source: 's' })}};
    export {R as Runtime};`;
  const compressed = source.split('\n').map(line => line.trim()).join('');
  assert.equal(only(compressed).methodName, 'a');
});

test('class-expression variable binding wins over an internal class name', () => {
  const candidate = only(`const Public = class Internal {${body()}}; export {Public as API};`);
  assert.equal(candidate.classLocalName, 'Public');
  assert.equal(candidate.exportName, 'API');
});

test('named and anonymous default classes expose default', () => {
  assert.equal(only(`export default class Named {${body()}}`).exportName, 'default');
  const anonymous = only(`export default class {${body()}}`);
  assert.equal(anonymous.classLocalName, null);
  assert.equal(anonymous.exportName, 'default');
});

test('exported class-expression variable and default alias work', () => {
  const direct = only(`export const Public = class {${body()}};`);
  assert.equal(direct.exportName, 'Public');
  const alias = only(`const Local = class {${body()}}; export default Local;`);
  assert.equal(alias.classLocalName, 'Local');
  assert.equal(alias.exportName, 'default');
});

test('returned class in an immediately invoked factory resolves its outer binding', () => {
  const candidate = only(`let Public = (() => {
    const dependency = base;
    return class Internal extends dependency {${body()}};
  })(); export {Public as API, Public as default};`);
  assert.equal(candidate.classLocalName, 'Public');
  assert.equal(candidate.exportName, 'API');
});

test('unrelated messages.map is not accepted', () => {
  const result = scanSource(`export class Unrelated {
    filter(options, adapter) {
      const messages = options.messages.map(message => ({...message}));
      if (!messages.length) return options;
      return {...options, messages};
    }
    async *run(options) { yield* dispatch(this.filter(options, adapter))[Symbol.asyncIterator](); }
  }`);
  assert.deepEqual(result.candidates, []);
});

test('the same-class iterator dispatch is mandatory', () => {
  const source = `class R {${body()}}`;
  assert.deepEqual(scanSource(source.replace('[Symbol.asyncIterator]()', '[Symbol.iterator]()')).candidates, []);
  assert.deepEqual(scanSource(source.replace('this.filter(projected, adapter)', 'other.filter(projected, adapter)')).candidates, []);
});

test('route ownership must use source.provider and compare to the adapter parameter', () => {
  const source = `class R {${body()}}`;
  assert.deepEqual(scanSource(source.replace('get(source.provider)', 'get(source.model)')).candidates, []);
  assert.deepEqual(scanSource(source.replace('?.adapter === adapter', '?.adapter === unrelated')).candidates, []);
});

test('mutated aliases do not establish source identity', () => {
  const source = `class R {${body()}}`.replace('const source = message.source;', 'let source = message.source; source = foreign;');
  assert.deepEqual(scanSource(source).candidates, []);
});

test('static filter methods cannot be mistaken for an instance boundary', () => {
  const source = `class R {${body()}}`.replace('filter(options, adapter)', 'static filter(options, adapter)');
  assert.deepEqual(scanSource(source).candidates, []);
});

test('multiple complete candidates are all retained for caller ambiguity checks', () => {
  const result = scanSource(`export class First {${body()}} export class Second {${body()}}`);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map(candidate => candidate.exportName), ['First', 'Second']);
});

test('discarded factory class copies are not treated as usable runtime bindings', () => {
  const candidate = only(`(()=>{ return class Unused {${body()}}; })(); export class Active {${body()}}`);
  assert.equal(candidate.exportName, 'Active');
});

test('invalid syntax returns a parse error and no candidates', () => {
  const result = scanSource('export class Broken { filter( {');
  assert.deepEqual(result.candidates, []);
  assert.equal(typeof result.parseError, 'string');
});

test('target code is parsed without execution', () => {
  const source = `throw new Error('must not execute'); export class R {${body()}}`;
  assert.equal(only(source).classLocalName, 'R');
});

test('a nested class cannot borrow an unrelated module export of the same name', () => {
  const candidate = only(`const R = unrelated; export {R}; function factory() { class R {${body()}} return R; }`);
  assert.equal(candidate.classLocalName, 'R');
  assert.equal(candidate.exportName, null);
});

const extractedSource = process.env.DSH_RUNTIME_SOURCE ?? fileURLToPath(new URL(
  '../../dsh-analysis/extracted/node_modules/@deepseek-ai/dsh-llm/lib/index.js', import.meta.url,
));

test('real extracted DSH runtime resolves the public class and replay filter', {
  skip: !existsSync(extractedSource) ? 'No extracted DSH runtime; set DSH_RUNTIME_SOURCE to supply it' : false,
}, () => {
  const candidate = only(readFileSync(extractedSource, 'utf8'));
  assert.equal(candidate.classLocalName, 'LlmRuntime');
  assert.equal(candidate.exportName, 'LlmRuntime');
  assert.equal(candidate.methodName, 'forAdapter');
});

const reminderSource = fileURLToPath(new URL(
  '../../dsh-analysis/extracted/node_modules/@deepseek-ai/dsh-repeat-tool-reminder/lib/index.js', import.meta.url,
));
test('shipped reminder plugin bundled an unused runtime copy, not an active entry', {
  skip: !existsSync(reminderSource),
}, () => assert.deepEqual(scanSource(readFileSync(reminderSource, 'utf8')).candidates, []));
