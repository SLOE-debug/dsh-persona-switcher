import {mkdir, readdir, readFile, writeFile, rename, unlink, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export function personaName(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 80 ||
      /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)) throw new Error('名称需为 1–80 个字符，不能包含路径或 Windows 文件名保留字符。');
  return value;
}
function content(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写人格正文。');
  if (Buffer.byteLength(value, 'utf8') > 65536) throw new Error('人格正文不能超过 64 KiB。');
  return value;
}
const version = text => createHash('sha256').update(text).digest('hex');

export class PersonaStore {
  constructor(directory) { this.directory = directory; this.items = new Map(); this.pending = Promise.resolve(); }
  async init(seed) {
    let fresh = false;
    try { await mkdir(this.directory); fresh = true; } catch(error) { if(error.code !== 'EEXIST') throw error; }
    if(fresh) await writeFile(join(this.directory,'无法拒绝.md'), content(seed), {flag:'wx'});
    for(const file of await readdir(this.directory)) {
      if(!file.endsWith('.md')) continue;
      const name = personaName(file.slice(0,-3)), path = join(this.directory,file);
      if(!(await lstat(path)).isFile()) throw new Error(`人格文件必须是普通文件：${file}`);
      const text = content(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path)));
      this.items.set(name,{name,text,version:version(text)});
    }
    return this;
  }
  list() { return [...this.items.values()].map(({name,version,text})=>({name,version,bytes:Buffer.byteLength(text)})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')); }
  get(name) { const item = this.items.get(personaName(name)); if(!item) throw new Error('该人格已被删除，请重新选择。'); return {...item}; }
  defaultName() { return this.items.has('无法拒绝') ? '无法拒绝' : this.list()[0]?.name ?? null; }
  text(name) { return this.items.get(name)?.text ?? ''; }
  run(task) { const pending = this.pending.then(task); this.pending = pending.catch(()=>{}); return pending; }
  save({original, name, text, expectedVersion}) {
    return this.run(async()=>{
      personaName(name); content(text);
      const previous = original ? this.get(original) : null;
      if(previous && previous.version !== expectedVersion) throw new Error('人格已在其他窗口修改。请重新载入后再保存。');
      if([...this.items.keys()].some(key=>key.toLowerCase()===name.toLowerCase() && key!==original)) throw new Error('已有同名人格，请换一个名称。');
      if(original && original!==name && original.toLowerCase()===name.toLowerCase()) throw new Error('仅修改大小写时，请先使用一个临时名称。');
      const path = join(this.directory,name+'.md'), temp = join(this.directory,'.write-'+randomUUID());
      await writeFile(temp,text,{flag:'wx'});
      try { await rename(temp,path); } catch(error) { await unlink(temp).catch(()=>{}); throw error; }
      if(original && original!==name) {
        try { await unlink(join(this.directory,original+'.md')); }
        catch(error) { await unlink(path); throw error; }
        this.items.delete(original);
      }
      const item = {name,text,version:version(text)}; this.items.set(name,item); return {...item};
    });
  }
  remove({name,expectedVersion}) {
    return this.run(async()=>{
      const item = this.get(name);
      if(item.version!==expectedVersion) throw new Error('人格已在其他窗口修改。请重新载入后再删除。');
      await unlink(join(this.directory,name+'.md')); this.items.delete(name); return {deleted:name};
    });
  }
}
