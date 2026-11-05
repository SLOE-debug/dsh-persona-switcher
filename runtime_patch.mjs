import {resolveTarget} from './runtime_target.mjs';
import {appendPersona, classifyScope} from './request_contract.mjs';

const KEY = Symbol.for('local.dsh-persona-switcher.v2');

function snapshot(state) {
  return {
    active: Boolean(state?.text), persona: state?.name ?? '', pid: process.pid,
    phase: state?.text ? state.appliedRequests ? 'observed' : 'armed' : 'standard',
    appliedRequests: state?.appliedRequests ?? 0, skippedRequests: state?.skippedRequests ?? 0,
    lastSkipReason: state?.lastSkipReason ?? '', lastShape: state?.lastShape ?? '',
    candidate: state?.candidate ?? null,
  };
}

export async function control({action, name, text, candidate}) {
  let state = globalThis[KEY];
  if (action === 'status') return snapshot(state);
  if (action === 'reset') {
    if (!state) return snapshot();
    if (state.prototype[state.method] !== state.wrapper) {
      throw new Error('入口已被其他工具修改，请重启 DSH 恢复标准。');
    }
    Object.defineProperty(state.prototype, state.method, state.descriptor);
    delete globalThis[KEY];
    return snapshot();
  }
  if (action !== 'apply') throw new Error('未知的人格操作。');
  if (typeof name !== 'string' || !name.trim() || name.length > 128 ||
      typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > 65536) {
    throw new Error('人格名称或 Markdown 内容无效。');
  }
  if (!state) {
    const target = await resolveTarget(candidate);
    state = {
      ...target, candidate, method: candidate.methodName, text: '', name: '',
      appliedRequests: 0, skippedRequests: 0, lastSkipReason: '', lastShape: '',
    };
    const original = state.descriptor.value;
    state.wrapper = function(...args) {
      const outgoing = Reflect.apply(original, this, args);
      const style = state.text;
      if (!style) return outgoing;
      let reason;
      let result;
      try {
        reason = classifyScope(this, args[0]);
        if (!reason) {
          result = appendPersona(outgoing, style);
          reason = result.reason;
        }
      } catch {
        reason = '运行时契约发生变化，原请求已保留';
      }
      if (reason) {
        state.skippedRequests++;
        state.lastSkipReason = reason;
        return outgoing;
      }
      state.appliedRequests++;
      state.lastShape = result.shape;
      return result.options;
    };
    Object.defineProperty(state.prototype, state.method, {...state.descriptor, value: state.wrapper});
    globalThis[KEY] = state;
  } else if (state.prototype[state.method] !== state.wrapper) {
    throw new Error('入口已被其他工具修改，请重启 DSH 后重新识别。');
  }
  state.name = name;
  state.text = text;
  state.appliedRequests = 0;
  state.skippedRequests = 0;
  state.lastSkipReason = '';
  return snapshot(state);
}
