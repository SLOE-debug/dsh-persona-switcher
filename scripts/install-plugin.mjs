import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {resolve, join} from 'node:path';
import {attach} from './installer-cdp.mjs';
import {hostContext} from './host-context.mjs';
import {copyPackage} from '../plugin/runtime-package.mjs';
import {installLinkedRuntime} from './profile-install.mjs';

const [rawPid, executable, entry, sourceDirectory] = process.argv.slice(2);
const pid = Number(rawPid);
if (!Number.isSafeInteger(pid) || pid <= 0 || !sourceDirectory) throw new Error('安装参数无效。');
const source = resolve(sourceDirectory);
const {stdout: revision} = await promisify(execFile)('git', ['-C', source, 'rev-parse', 'HEAD'], {windowsHide: true});
const installedCommit = revision.trim();
const {stdout: changes} = await promisify(execFile)('git', ['-C', source, 'status', '--porcelain'], {windowsHide: true});
if (!/^[a-f0-9]{40}$/.test(installedCommit)) throw new Error('请使用 git clone 获得完整仓库后再安装。');
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
if (manifest.name !== 'dsh-persona-switcher' || !manifest.dsh?.bundle) throw new Error('请选择完整的人格插件仓库。');
const session = await attach(pid, executable, entry);
let context;
try {
  context = await hostContext(session, entry);
  const {key, directory: profileDirectory} = context;
  console.log(`正在安装到 ${context.profile} profile…`);
  const reset = await session.evaluate(`(()=>{
    const key=Symbol.for('local.dsh-persona-switcher.v2'), old=globalThis[key];
    if(!old) return false;
    if(old.prototype[old.method]!==old.wrapper) throw new Error('旧人格入口被其他工具修改，请先恢复标准。');
    Object.defineProperty(old.prototype,old.method,old.descriptor); delete globalThis[key]; return true;
  })()`);
  if (reset) console.log('已撤销旧版独立切换器的全局人格，改用逐对话开关。');
  const dataDirectory = join(profileDirectory, '.dsh-persona-switcher');
  await mkdir(dataDirectory, {recursive: true});
  const prepared = join(dataDirectory, `prepared-${randomUUID()}`);
  await copyPackage(source, prepared);
  const helperPath = join(source, 'plugin/runtime-package.mjs');
  const helperHash = createHash('sha256').update(await readFile(helperPath)).digest('hex');
  const helperDirectory = join(dataDirectory, 'installer-code');
  await mkdir(helperDirectory, {recursive:true});
  const helperFile = join(helperDirectory, helperHash+'.mjs');
  await writeFile(helperFile, await readFile(helperPath));
  const result = await session.evaluate(`(${installLinkedRuntime.toString()})(globalThis[${JSON.stringify(key)}],${JSON.stringify(entry)},${JSON.stringify(prepared)},${JSON.stringify(join(dataDirectory,'runtime'))},${JSON.stringify(helperFile)})`);
  if (!['applied', 'restart-required'].includes(result.application)) throw new Error(result.error?.message || result.error?.diagnostic || `插件未激活：${JSON.stringify(result)}`);
  const sourcePath = join(dataDirectory, 'source.json');
  const temporary = `${sourcePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({schema: 1, repository: source, installedCommit, development: !!changes.trim()}), {mode: 0o600});
  await rename(temporary, sourcePath);
  console.log(result.application === 'applied' ? '安装完成。设置中可管理人格，输入框上方可选择并开启，新对话默认关闭。' : '安装已写入。请首次完整退出并重新打开 DSH Desktop，让插件入口生效。');
  console.log('后续可点击“检查更新”，从 GitHub 下载并热激活新提交。');
} finally {
  if (context) await session.evaluate(`delete globalThis[${JSON.stringify(context.key)}]`);
  await session.close();
}
