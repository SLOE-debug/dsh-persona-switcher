// Imported into the selected Harness process through its Node Inspector.
const KEY = Symbol.for('local.dsh-persona-switcher.v1');
const VERSION = 1;
const MAX_BYTES = 65536;

function snapshot(state) {
  return {
    active: Boolean(state?.text),
    persona: state?.name ?? '',
    appliedRequests: state?.appliedRequests ?? 0,
    pid: process.pid,
  };
}

function injectStyle(options, text) {
  const section = '\n\n<local-response-style>\n' + text + '\n</local-response-style>';
  let changed = false;
  const messages = options.messages.map(message => {
    if (message.role !== 'system' ||
        !message.content.some(block => block.type === 'text' && block.text.length)) {
      return message;
    }
    changed = true;
    return Object.freeze({
      ...message,
      content: Object.freeze([...message.content, Object.freeze({type: 'text', text: section})]),
    });
  });
  if (!changed) throw new Error('当前请求没有可附加人格的系统提示词，请恢复标准。');
  return Object.freeze({...options, messages: Object.freeze(messages)});
}

export async function control({action, name, text, moduleUrl}) {
  let state = globalThis[KEY];
  if (state && state.version !== VERSION) throw new Error('进程中已有不同版本的人格工具，请重启 DSH。');
  if (action === 'status') return snapshot(state);
  if (action === 'reset') {
    if (!state) return snapshot();
    if (state.prototype.forAdapter !== state.wrapper) {
      throw new Error('请求入口已被其他工具修改，请重启 DSH 恢复标准。');
    }
    Object.defineProperty(state.prototype, 'forAdapter', state.descriptor);
    delete globalThis[KEY];
    return snapshot();
  }
  if (action !== 'apply') throw new Error('未知的人格操作。');
  if (typeof name !== 'string' || !name.trim() || name.length > 128 ||
      typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    throw new Error('人格名称或 Markdown 内容无效。');
  }
  if (!state) {
    const {LlmRuntime} = await import(moduleUrl);
    const prototype = LlmRuntime?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'forAdapter');
    if (typeof descriptor?.value !== 'function') {
      throw new Error('此 DSH 构建的请求入口不匹配，未注入。');
    }
    state = {version: VERSION, prototype, descriptor, text: '', name: '', appliedRequests: 0};
    const original = descriptor.value;
    state.wrapper = function(options, adapter) {
      const outgoing = original.call(this, options, adapter);
      // Auxiliary calls (titles, compaction, etc.) keep their original behavior.
      if (!state.text || options.purpose !== undefined || options.sessionId === undefined) return outgoing;
      const agent = this.ctx.get('agents')?.get(options.sessionId);
      if (!agent || agent.session.header.origin === 'subagent') return outgoing;
      const preset = agent.ctx.sessionProjections.stateOf(agent.session, 'agentPreset');
      if (preset !== 'standard') return outgoing;
      const result = injectStyle(outgoing, state.text);
      state.appliedRequests++;
      return result;
    };
    Object.defineProperty(prototype, 'forAdapter', {...descriptor, value: state.wrapper});
    globalThis[KEY] = state;
  } else if (state.prototype.forAdapter !== state.wrapper) {
    throw new Error('请求入口已被其他工具修改，请重启 DSH 后再试。');
  }
  state.name = name;
  state.text = text;
  return snapshot(state);
}
