import {readFile, mkdir, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

const BOOT_KEY = Symbol.for('dsh-persona-switcher.process-boot');
const BOOT_ID = globalThis[BOOT_KEY] ??= randomUUID();

export function sessionId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f]/.test(value)) {
    throw new Error('无效的对话标识。');
  }
  return value;
}

export class SessionState {
  #enabled = new Set();
  #selected = new Map();
  #pending = Promise.resolve();
  constructor(file, {bootId = BOOT_ID} = {}) { this.file = file; this.bootId = bootId; }
  async load() {
    try {
      const text = await readFile(this.file, 'utf8');
      if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('对话开关文件超过大小限制。');
      const data = JSON.parse(text);
      if (data.schema !== 2 || typeof data.bootId !== 'string' || !Array.isArray(data.enabledSessions) || !Array.isArray(data.selections)) throw new Error('对话开关文件格式不正确。');
      this.#enabled = data.bootId === this.bootId ? new Set(data.enabledSessions.map(sessionId)) : new Set();
      this.#selected = data.bootId === this.bootId ? new Map(data.selections.map(([id,name])=>[sessionId(id),sessionId(name)])) : new Map();
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  enabled(id) { return this.#enabled.has(id); }
  selection(id) { return this.#selected.get(id); }
  flush() { return this.#pending; }
  set(id, enabled, persona) {
    sessionId(id);
    if (typeof enabled !== 'boolean') throw new Error('开关值必须为布尔值。');
    if(persona!==undefined) sessionId(persona);
    return this.mutate((next,selected)=>{
      if (enabled) next.add(id); else next.delete(id);
      if(persona!==undefined) selected.set(id,persona);
    }).then(()=>this.enabled(id));
  }
  renamePersona(before,after) {
    return this.mutate((enabled,selected)=>{for(const [id,name] of selected) if(name===before) {
      if(after) selected.set(id,after); else {selected.delete(id);enabled.delete(id);}
    }});
  }
  mutate(change) {
    const save = this.#pending.then(async () => {
      const next = new Set(this.#enabled);
      const selected = new Map(this.#selected); change(next,selected);
      if (next.size > 10000 || selected.size > 10000) throw new Error('保存的对话设置过多。');
      await mkdir(dirname(this.file), {recursive: true});
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({schema: 2, bootId: this.bootId, enabledSessions: [...next], selections:[...selected]}), {mode: 0o600});
      await rename(temporary, this.file);
      this.#enabled = next;
      this.#selected = selected;
    });
    this.#pending = save.catch(() => {});
    return save;
  }
}
