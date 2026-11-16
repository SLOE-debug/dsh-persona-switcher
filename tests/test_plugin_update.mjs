import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {GitUpdater} from '../plugin/update.mjs';

const github = 'https://github.com/SLOE-debug/dsh-persona-switcher.git';
const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], {windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'persona-git-'));
  const repository = join(directory, 'clone'), remote = join(directory, 'remote.git'), dataDirectory = join(directory, 'data');
  await mkdir(repository); await mkdir(dataDirectory);
  git(repository, 'init', '-b', 'main');
  git(repository, 'config', 'user.name', 'Plugin tests'); git(repository, 'config', 'user.email', 'tests@example.invalid');
  await mkdir(join(repository, 'plugin')); await mkdir(join(repository, 'personas'));
  const manifest = {name: 'dsh-persona-switcher', version: '3.0.0', dsh: {personaProtocol:1,bundle: {patch: './cordis.patch.yml'}}, exports: {'./client': './plugin/client.js'}};
  await writeFile(join(repository, 'package.json'), JSON.stringify(manifest));
  for (const file of ['plugin/index.mjs','plugin/runtime.mjs', 'plugin/client.js','plugin/client-runtime.js', 'cordis.patch.yml', 'personas/无法拒绝.md', 'README.md']) await writeFile(join(repository, file), 'first revision');
  git(repository, 'add', '.'); git(repository, 'commit', '-m', '初始测试版本');
  const current = git(repository, 'rev-parse', 'HEAD');
  execFileSync('git', ['clone', '--bare', repository, remote], {windowsHide: true, stdio: 'pipe'});
  git(repository, 'remote', 'add', 'origin', github);
  git(repository, 'config', `url.${pathToFileURL(remote).href}.insteadOf`, github);
  await writeFile(join(repository, 'plugin/runtime.mjs'), 'second revision');
  git(repository, 'commit', '-am', '更新测试版本');
  const latest = git(repository, 'rev-parse', 'HEAD');
  git(repository, 'push', 'origin', 'main');
  git(repository, 'reset', '--hard', current);
  await writeFile(join(dataDirectory, 'source.json'), JSON.stringify({schema: 1, repository, installedCommit: current}));
  return {directory, repository, dataDirectory, current, latest};
}

test('GitHub update installs a clean pinned generation and preserves local work and conversation state', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.repository, 'local-edit.txt'), 'keep my edits');
    await writeFile(join(f.dataDirectory, 'sessions.json'), '{"enabledSessions":["A"]}');
    const requests = [];
    const updater = new GitUpdater({dataDirectory: f.dataDirectory, coordinator:{hotReload:true,async activate(directory) {
      requests.push(directory);
      assert.equal(await readFile(join(directory,'plugin/runtime.mjs'), 'utf8'), 'second revision');
      return {application: 'applied'};
    }}});
    assert.equal((await updater.check()).available, true);
    const result = await updater.update();
    assert.equal(result.latest, f.latest); assert.equal(result.updated, true);
    assert.equal(requests.length,1);
    assert.equal(git(f.repository, 'rev-parse', 'HEAD'), f.current);
    assert.equal(await readFile(join(f.repository, 'local-edit.txt'), 'utf8'), 'keep my edits');
    assert.equal(await readFile(join(f.dataDirectory, 'sessions.json'), 'utf8'), '{"enabledSessions":["A"]}');
    assert.equal((await updater.check()).available, false);
  } finally { await rm(f.directory, {recursive: true, force: true}); }
});

test('failed activation does not advance the installed revision; missing HMR refuses updates', async () => {
  const f = await fixture();
  try {
    const updater = new GitUpdater({dataDirectory: f.dataDirectory,coordinator:{hotReload:true,activate:async()=>({application:'failed'})}});
    await assert.rejects(updater.update(), /未完成热激活/);
    assert.equal(JSON.parse(await readFile(join(f.dataDirectory, 'source.json'), 'utf8')).installedCommit, f.current);
    updater.coordinator.hotReload = false;
    await assert.rejects(updater.update(), /未提供热重载/);
  } finally { await rm(f.directory, {recursive: true, force: true}); }
});
