const textBlock = block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string';
const styleSection = text => '\n\n<local-response-style>\n' + text + '\n</local-response-style>';

function withContent(message, section) {
  if (typeof message.content === 'string' && message.content.length) {
    return Object.freeze({...message, content: message.content + section});
  }
  if (Array.isArray(message.content) && message.content.length && message.content.every(textBlock) &&
      message.content.some(block => block.text.length)) {
    return Object.freeze({...message, content: Object.freeze([
      ...message.content, Object.freeze({type: 'text', text: section}),
    ])});
  }
  return message;
}

export function classifyScope(runtime, options) {
  if (!options || typeof options !== 'object') return '请求结构无法确认';
  if (options.purpose !== undefined) return '辅助请求保持原样';
  if (typeof options.sessionId !== 'string') return '请求缺少会话标识';
  if (typeof runtime?.ctx?.get !== 'function') return '无法读取运行时会话归属';
  const agents = runtime.ctx.get('agents');
  if (typeof agents?.get !== 'function') return '无法读取 Agent 注册表';
  const agent = agents.get(options.sessionId);
  if (!agent) return '请求不属于活动 Agent';
  if (!agent.session?.header || typeof agent.ctx?.sessionProjections?.stateOf !== 'function') {
    return '会话预设结构发生变化';
  }
  if (agent.session.header.origin === 'subagent') return '子代理请求保持原样';
  if (agent.ctx.sessionProjections.stateOf(agent.session, 'agentPreset') !== 'standard') {
    return '当前会话使用其他预设';
  }
  return null;
}

export function appendPersona(options, text) {
  if (!Array.isArray(options.messages) || options.messages.some(message =>
    !message || typeof message !== 'object' || typeof message.role !== 'string')) {
    return {reason: '消息结构发生变化，未修改请求'};
  }
  const section = styleSection(text);
  let changed = 0;
  const messages = options.messages.map(message => {
    if (message.role !== 'system') return message;
    const copy = withContent(message, section);
    if (copy !== message) changed++;
    return copy;
  });
  if (changed) return {options: Object.freeze({...options, messages: Object.freeze(messages)}), shape: 'system-messages'};
  const keys = ['system', 'instructions'].filter(key => typeof options[key] === 'string' && options[key].length);
  if (keys.length === 1) {
    return {options: Object.freeze({...options, [keys[0]]: options[keys[0]] + section}), shape: keys[0]};
  }
  return {reason: '未发现明确的系统指令结构，未修改请求'};
}
