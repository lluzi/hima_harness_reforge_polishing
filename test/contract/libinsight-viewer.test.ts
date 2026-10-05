import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createLibInsightViewer, type LibInsightViewerStatus } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const FAKE_SERVER = path.join(repoRoot, 'test/fixtures/libinsight-viewer/app/server.py');

async function fixture(kits: readonly string[] = ['tsmc28-180a']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-libinsight-'));
  const code = path.join(root, 'code'), data = path.join(root, 'checkout', 'data'), home = path.join(root, 'home');
  await mkdir(path.join(code, 'app'), { recursive: true });
  await copyFile(FAKE_SERVER, path.join(code, 'app', 'server.py'));
  await writeFile(path.join(code, 'LIBINSIGHT-SOURCE.json'), JSON.stringify({ source: 'lib_insight', commit: 'd463b8e0'.padEnd(40, '0') }));
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, 'app.json'), JSON.stringify({ data_root: 'data', kits: kits.map(id => ({ id, manifest: `kits/${id}.json` })) }));
  return { root, code, data, settingsFile: path.join(home, 'libinsight-viewer.json'), cleanup: () => rm(root, { recursive: true, force: true }) };
}

const ready = (status: LibInsightViewerStatus) => {
  assert.equal(status.state, 'ready', JSON.stringify(status));
  return status as Extract<LibInsightViewerStatus, { state: 'ready' }>;
};

test('an App without LibInsight code says so instead of framing nothing', async () => {
  const f = await fixture();
  try {
    const viewer = createLibInsightViewer({ settingsFile: f.settingsFile, defaultDataFolder: f.data });
    const status = await viewer.open();
    assert.equal(status.state, 'unavailable');
    assert.match((status as { reason: string }).reason, /not installed/);
  } finally { await f.cleanup(); }
});

test('a data folder must be the absolute folder holding an app.json that names a Kit', async () => {
  const f = await fixture();
  try {
    const viewer = createLibInsightViewer({ codeRoot: f.code, settingsFile: f.settingsFile });
    assert.equal((await viewer.status()).state, 'unavailable', 'no folder chosen yet');
    // Even when the Host's own working directory happens to hold a data/app.json.
    const previous = process.cwd(); process.chdir(path.dirname(f.data));
    const relative = await viewer.open({ dataFolder: 'data' }).finally(() => process.chdir(previous));
    assert.equal(relative.state, 'unavailable');
    assert.match((relative as { reason: string }).reason, /relative/);
    const wrong = await viewer.open({ dataFolder: f.root });
    assert.equal(wrong.state, 'unavailable');
    assert.match((wrong as { reason: string }).reason, /has no app\.json/);
    await writeFile(path.join(f.data, 'app.json'), JSON.stringify({ kits: [] }));
    const empty = await viewer.open({ dataFolder: f.data });
    assert.match((empty as { reason: string }).reason, /names no Kit/);
    await assert.rejects(readFile(f.settingsFile), 'a refused folder is not remembered');
  } finally { await f.cleanup(); }
});

test('the viewer starts on the chosen folder, is reused, survives a Host restart by its remembered folder and port, and stops', async () => {
  const f = await fixture(['tsmc28-180a', 'n12-100']);
  try {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, HIMA_MODEL_API_KEY: 'must-not-reach-python' };
    const first = createLibInsightViewer({ codeRoot: f.code, settingsFile: f.settingsFile, env });
    const opened = ready(await first.open({ dataFolder: f.data }));
    assert.deepEqual(opened.kits, ['tsmc28-180a', 'n12-100']);
    assert.equal(opened.code.commit, 'd463b8e0'.padEnd(40, '0'));
    assert.match(opened.url, /^http:\/\/localhost:\d+\/$/, 'framed as localhost, so the Host cookie for 127.0.0.1 never reaches it');
    assert.equal(ready(await first.open()).url, opened.url, 'an open viewer is kept, not restarted');
    assert.equal(ready(await first.status()).url, opened.url);
    const childEnv = await (await fetch(`${opened.url}env`)).json() as string[];
    assert.ok(!childEnv.includes('HIMA_MODEL_API_KEY'), 'the Host environment does not reach LibInsight');
    assert.ok(childEnv.includes('PYTHONDONTWRITEBYTECODE'), 'no bytecode is written beside the packaged code');
    assert.deepEqual(JSON.parse(await readFile(f.settingsFile, 'utf8')).dataFolder, f.data);

    await first.stop();
    await assert.rejects(fetch(`${opened.url}api/kits`), 'the stopped viewer no longer answers');
    assert.equal((await first.status()).state, 'stopped');

    const second = createLibInsightViewer({ codeRoot: f.code, settingsFile: f.settingsFile, env });
    const reopened = ready(await second.open());
    assert.equal(reopened.dataFolder, f.data, 'the remembered folder is used');
    assert.equal(reopened.url, opened.url, 'the same origin, so LibInsight keeps its own saved selection');
    await second.stop();
  } finally { await f.cleanup(); }
});

test('a viewer that cannot start reports why, with its own output', async () => {
  const f = await fixture(['crash']);
  try {
    const viewer = createLibInsightViewer({ codeRoot: f.code, settingsFile: f.settingsFile, defaultDataFolder: f.data });
    const status = await viewer.open();
    assert.equal(status.state, 'failed');
    const failed = status as Extract<LibInsightViewerStatus, { state: 'failed' }>;
    assert.match(failed.reason, /code 3/);
    assert.ok(failed.log.some(line => /No module named 'numpy'/.test(line)), failed.log.join('\n'));
    assert.equal((await viewer.status()).state, 'failed', 'the failure stays visible until the next attempt');
  } finally { await f.cleanup(); }
});

test('a viewer that dies behind an open page is reported as stopped with a reason', async () => {
  const f = await fixture();
  try {
    const viewer = createLibInsightViewer({ codeRoot: f.code, settingsFile: f.settingsFile, defaultDataFolder: f.data });
    const opened = ready(await viewer.open());
    const port = Number(new URL(opened.url).port);
    const pid = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).toString().trim();
    process.kill(Number(pid), 'SIGKILL');
    for (let i = 0; i < 40 && (await viewer.status()).state === 'ready'; i += 1) await new Promise(resolve => setTimeout(resolve, 50));
    const status = await viewer.status();
    assert.equal(status.state, 'failed');
    assert.match((status as { reason: string }).reason, /stopped: exited with SIGKILL/);
    ready(await viewer.open({ restart: true }));
    await viewer.stop();
  } finally { await f.cleanup(); }
});

const viewers = (code: string): number => {
  try { return execFileSync('pgrep', ['-f', path.join(code, 'app', 'server.py')]).toString().trim().split('\n').filter(Boolean).length; }
  catch { return 0; }
};

test('looks that arrive together start one viewer, and a stop during start leaves none', async () => {
  const f = await fixture();
  try {
    const viewer = createLibInsightViewer({ codeRoot: f.code, settingsFile: f.settingsFile, defaultDataFolder: f.data });
    const [a, b, c] = await Promise.all([viewer.open(), viewer.open(), viewer.open()]);
    assert.equal(ready(a).url, ready(b).url); assert.equal(ready(c).url, ready(a).url);
    assert.equal(viewers(f.code), 1, 'one process for three simultaneous looks');
    assert.equal(ready(await viewer.status()).url, ready(a).url);
    await viewer.stop();
    assert.equal(viewers(f.code), 0);

    const late = viewer.open({ restart: true });
    await new Promise(resolve => setTimeout(resolve, 30));
    await viewer.stop();
    const outcome = await late;
    assert.notEqual(outcome.state, 'ready', 'a start overtaken by stop does not report a live viewer');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(viewers(f.code), 0, 'and leaves no process behind');
  } finally { await f.cleanup(); }
});
