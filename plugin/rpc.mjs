import {sessionId} from './session-state.mjs';

export function createRpcHandler({state, updater, store}) {
  const snapshot = id => {
    const chosen = state.selection(id);
    const persona = store.list().some(item=>item.name===chosen) ? chosen : store.defaultName();
    return {sessionId:id,enabled:state.enabled(id)&&!!chosen&&chosen===persona,persona};
  };
  return async (endpoint, payload, signal, peer) => {
    if (peer?.principal?.kind !== 'owner') return failure('forbidden', '当前连接没有管理此插件的权限。');
    try {
      signal?.throwIfAborted();
      let value;
      switch (endpoint) {
        case 'state': {
          const id = sessionId(payload?.sessionId);
          value = snapshot(id);
          break;
        }
        case 'set': {
          const id = sessionId(payload?.sessionId);
          const persona = payload?.persona ?? snapshot(id).persona;
          if(!persona) throw new Error('请先到“人格管理”创建一个人格。');
          store.get(persona);
          await state.set(id, payload?.enabled, persona);
          value = snapshot(id);
          break;
        }
        case 'list': value = {personas:store.list()}; break;
        case 'read': value = store.get(payload?.name); break;
        case 'save':
          value = await store.save(payload ?? {});
          if(payload.original && payload.original!==value.name) await state.renamePersona(payload.original,value.name);
          break;
        case 'delete':
          value = await store.remove(payload ?? {});
          await state.renamePersona(payload.name,null);
          break;
        case 'check-update': value = await updater.check(); break;
        case 'update': value = await updater.update(); break;
        default: return failure('unknown-method', '未知的插件操作。');
      }
      return {ok: true, value};
    } catch (error) { return failure('operation-failed', error.message || String(error)); }
  };
}
function failure(code, message) { return {ok: false, error: {code: `persona/${code}`, message, details: {}}}; }
