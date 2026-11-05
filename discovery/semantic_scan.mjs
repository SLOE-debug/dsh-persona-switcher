import { parse } from 'acorn';

const FUNCTION_NODES = new Set(['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression']);

function children(node) {
  const result = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (item?.type) result.push(item);
    } else if (value?.type) result.push(value);
  }
  return result;
}

function walk(root, visit, ownFunctionOnly = false) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    visit(node);
    if (node !== root && ownFunctionOnly && (FUNCTION_NODES.has(node.type) || node.type.startsWith('Class'))) continue;
    stack.push(...children(node).reverse());
  }
}

function unwrap(node) {
  return node?.type === 'ChainExpression' ? unwrap(node.expression) : node;
}

function key(node) {
  node = unwrap(node);
  if (!node) return null;
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  if (node.property?.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

function identifier(node, name) {
  return node?.type === 'Identifier' && node.name === name;
}

function propertyName(property) {
  if (!property.computed && property.key?.type === 'Identifier') return property.key.name;
  if (property.key?.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return null;
}

function member(node, name) {
  node = unwrap(node);
  return node?.type === 'MemberExpression' && key(node) === name;
}

function nodesIn(root) {
  const nodes = [];
  walk(root, node => nodes.push(node), true);
  return nodes;
}

function spreadOf(node, name) {
  return node?.type === 'ObjectExpression' && node.properties.some(property => property.type === 'SpreadElement' && identifier(property.argument, name));
}

function objectField(node, name) {
  return node?.type === 'ObjectExpression' ? node.properties.find(property => property.type === 'Property' && propertyName(property) === name)?.value : undefined;
}

function pathOf(node, aliases) {
  node = unwrap(node);
  if (node?.type === 'Identifier') return aliases.get(node.name);
  if (node?.type !== 'MemberExpression') return undefined;
  const base = pathOf(node.object, aliases);
  const field = key(node);
  return base && field ? [...base, field] : undefined;
}

function samePath(node, expected, aliases) {
  const found = pathOf(node, aliases);
  return found?.length === expected.length && found.every((part, index) => part === expected[index]);
}

function callbackAliases(nodes, messageName) {
  const mutated = new Set();
  for (const node of nodes) {
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') mutated.add(node.left.name);
    if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') mutated.add(node.argument.name);
  }
  if (mutated.has(messageName)) return new Map();
  const aliases = new Map([[messageName, [messageName]]]);
  const declarations = nodes.filter(node => node.type === 'VariableDeclarator' && node.id.type === 'Identifier');
  for (let pass = 0; pass < declarations.length; pass++) {
    let changed = false;
    for (const declaration of declarations) {
      const name = declaration.id.name;
      if (aliases.has(name) || mutated.has(name)) continue;
      const value = pathOf(declaration.init, aliases);
      if (value) {
        aliases.set(name, value);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return aliases;
}

function comparison(node, left, right) {
  return node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator) && ((left(node.left) && right(node.right)) || (left(node.right) && right(node.left)));
}

function replayFilterEvidence(callback, adapterName) {
  if (!FUNCTION_NODES.has(callback?.type) || callback.params[0]?.type !== 'Identifier') return [];
  const messageName = callback.params[0].name;
  const nodes = nodesIn(callback);
  const aliases = callbackAliases(nodes, messageName);
  const sourcePath = [messageName, 'source'];
  const roleCheck = nodes.some(node => comparison(node,
    value => samePath(value, [messageName, 'role'], aliases),
    value => value?.type === 'Literal' && value.value === 'assistant'));
  const replayCheck = nodes.some(node => samePath(node, [...sourcePath, 'replayState'], aliases));
  const isOwnedAdapter = value => {
    value = unwrap(value);
    if (!member(value, 'adapter')) return false;
    const lookup = unwrap(value.object);
    if (lookup?.type !== 'CallExpression' || !member(lookup.callee, 'get')) return false;
    const registry = unwrap(lookup.callee.object);
    return registry?.type === 'MemberExpression' && registry.object.type === 'ThisExpression' &&
      lookup.arguments.length === 1 && samePath(lookup.arguments[0], [...sourcePath, 'provider'], aliases);
  };
  const adapterCheck = nodes.some(node => comparison(node, isOwnedAdapter, value => identifier(value, adapterName)));
  const retainsMessage = nodes.some(node => node.type === 'ReturnStatement' && identifier(node.argument, messageName));
  const clonesSource = nodes.some(node => spreadOf(node, messageName) && objectField(node, 'source')?.type === 'ObjectExpression' &&
    objectField(objectField(node, 'source'), 'replayState') === undefined &&
    samePath(objectField(objectField(node, 'source'), 'provider'), [...sourcePath, 'provider'], aliases) &&
    samePath(objectField(objectField(node, 'source'), 'model'), [...sourcePath, 'model'], aliases));
  return [roleCheck, replayCheck, adapterCheck, retainsMessage, clonesSource].every(Boolean) ? [
    'assistant-role-check', 'source-replay-state', 'route-owned-adapter-check',
    'retains-original-message', 'clones-message-without-replay-state',
  ] : [];
}

function filterMethodEvidence(method) {
  const fn = method.value;
  if (fn.async || fn.generator || fn.params[0]?.type !== 'Identifier' || fn.params[1]?.type !== 'Identifier') return [];
  const optionsName = fn.params[0].name;
  const nodes = nodesIn(fn);
  const maps = nodes.filter(node => node.type === 'CallExpression' && member(node.callee, 'map') &&
    member(node.callee.object, 'messages') && identifier(node.callee.object.object, optionsName));
  for (const map of maps) {
    const callbackEvidence = replayFilterEvidence(map.arguments[0], fn.params[1].name);
    if (!callbackEvidence.length) continue;
    const mappedNames = new Set(nodes.filter(node => node.type === 'VariableDeclarator' && node.init === map && node.id.type === 'Identifier').map(node => node.id.name));
    const isMapped = value => value === map || value?.type === 'Identifier' && mappedNames.has(value.name);
    const clones = nodes.filter(node => spreadOf(node, optionsName) && isMapped(objectField(node, 'messages')));
    const cloneNames = new Set(nodes.filter(node => node.type === 'VariableDeclarator' && clones.includes(node.init) && node.id.type === 'Identifier').map(node => node.id.name));
    const returnsOriginal = nodes.some(node => node.type === 'ReturnStatement' && identifier(node.argument, optionsName));
    const returnsClone = nodes.some(node => {
      if (node.type !== 'ReturnStatement' || !node.argument) return false;
      let found = false;
      walk(node.argument, value => {
        if (clones.includes(value) || value.type === 'Identifier' && cloneNames.has(value.name)) found = true;
      }, true);
      return found;
    });
    if (returnsOriginal && returnsClone) return ['maps-request-messages', ...callbackEvidence, 'returns-original-or-message-copy'];
  }
  return [];
}

function hasIteratorDispatch(method, methodName) {
  if (!method.value.async || !method.value.generator) return false;
  return nodesIn(method.value).some(node => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression' || !node.callee.computed) return false;
    const iterator = node.callee.property;
    if (!member(iterator, 'asyncIterator') || !identifier(iterator.object, 'Symbol')) return false;
    const dispatch = unwrap(node.callee.object);
    if (dispatch?.type !== 'CallExpression') return false;
    return dispatch.arguments.some(argument => argument.type === 'CallExpression' && member(argument.callee, methodName) &&
      argument.callee.object.type === 'ThisExpression' && argument.arguments.length >= 2);
  });
}

function classBinding(node, parents) {
  const parent = parents.get(node);
  if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'Identifier') return { name: parent.id.name, owner: parent };
  if (parent?.type === 'ReturnStatement') {
    const block = parents.get(parent);
    const fn = parents.get(block);
    const call = parents.get(fn);
    const declaration = parents.get(call);
    if (block?.type === 'BlockStatement' && FUNCTION_NODES.has(fn?.type) && call?.type === 'CallExpression' &&
        call.callee === fn && declaration?.type === 'VariableDeclarator' && declaration.init === call && declaration.id.type === 'Identifier') {
      return { name: declaration.id.name, owner: declaration };
    }
  }
  return { name: node.id?.name ?? null, owner: node.type === 'ClassDeclaration' ? node : null };
}

function discardedFactoryResult(node, parents) {
  const returned = parents.get(node);
  const block = parents.get(returned);
  const factory = parents.get(block);
  const call = parents.get(factory);
  return returned?.type === 'ReturnStatement' && returned.argument === node &&
    block?.type === 'BlockStatement' && FUNCTION_NODES.has(factory?.type) &&
    call?.type === 'CallExpression' && call.callee === factory &&
    parents.get(call)?.type === 'ExpressionStatement';
}

function exportedName(node, binding, exports, parents) {
  if (parents.get(node)?.type === 'ExportDefaultDeclaration') return 'default';
  if (parents.get(node)?.type === 'ExportNamedDeclaration' && node.id) return node.id.name;
  let owner = binding.owner;
  if (owner?.type === 'VariableDeclarator') owner = parents.get(owner);
  let scope = owner && parents.get(owner);
  if (scope?.type === 'ExportNamedDeclaration') scope = parents.get(scope);
  if (scope?.type !== 'Program') return null;
  const names = binding.name === null ? [] : exports.get(binding.name) ?? [];
  return names.find(name => name !== 'default') ?? names[0] ?? null;
}

/** Find complete pre-adapter replay-filter contracts without executing target code. */
export function scanSource(source) {
  let ast;
  try {
    if (typeof source !== 'string') throw new TypeError('Source must be a string');
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  } catch (error) {
    return { candidates: [], parseError: error.message };
  }
  const parents = new WeakMap();
  const classes = [];
  const exports = new Map();
  walk(ast, node => {
    for (const child of children(node)) parents.set(child, node);
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') classes.push(node);
    if (node.type === 'ExportNamedDeclaration' && node.source === null) {
      for (const specifier of node.specifiers) {
        const local = specifier.local.name;
        const name = specifier.exported.name ?? specifier.exported.value;
        exports.set(local, [...exports.get(local) ?? [], name]);
      }
      if (node.declaration?.type === 'VariableDeclaration') {
        for (const declaration of node.declaration.declarations) {
          if (declaration.id.type === 'Identifier') exports.set(declaration.id.name, [declaration.id.name]);
        }
      }
    }
    if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'Identifier') {
      const name = node.declaration.name;
      exports.set(name, [...exports.get(name) ?? [], 'default']);
    }
  });
  const candidates = [];
  for (const node of classes) {
    if (discardedFactoryResult(node, parents)) continue;
    const methods = node.body.body.filter(method => method.type === 'MethodDefinition' && method.kind === 'method' && !method.static && propertyName(method) !== null);
    for (const method of methods) {
      const methodName = propertyName(method);
      const evidence = filterMethodEvidence(method);
      if (!evidence.length || !methods.some(other => other !== method && hasIteratorDispatch(other, methodName))) continue;
      evidence.push('same-class-async-iterator-dispatch');
      const binding = classBinding(node, parents);
      candidates.push({
        classLocalName: binding.name,
        exportName: exportedName(node, binding, exports, parents),
        methodName,
        methodStart: method.start,
        methodEnd: method.end,
        evidence,
        score: evidence.length,
      });
    }
  }
  return { candidates };
}
