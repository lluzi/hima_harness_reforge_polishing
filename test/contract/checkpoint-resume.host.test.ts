// Native persisted Agent lifecycle, using deterministic replay and the real write tool.
// The scan sentinel is synthetic test data; no real credential or provider request is used.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { LiveCheck } from '../../scripts/live-check-workshop.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent, resumeTestAgent, sayAsUser, toolCalls } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '0';

const say = (text: string) => ({ kind: 'chunks', chunks: [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
] });
const write = { kind: 'chunks', chunks: [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'resumed-write', name: 'write', arguments: JSON.stringify({ file_path: 'resumed.txt', content: 'actual resumed tool output' }) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
] };

async function persisted(t: TestContext) {
  const h = await createHimaHome(); t.after(() => h.dispose());
  const file = path.join(h.home, 'replay.jsonl'); const override = path.join(h.home, 'replay.json');
  writeFileSync(file, JSON.stringify({ version: 0, type: 'session', id: 'fixture-resume', createdAt: 0, cwd: h.workspace }) + '\n');
  writeFileSync(override, JSON.stringify([say('original persisted turn')]));
  await writeReplayOverlay(h.home, { file, overrideFile: override });
  writeFileSync(path.join(h.profileDir, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n');
  const host = await bootInProcess(h);
  let id: string; let model: { provider: string; model: string };
  try {
    const original = await createRootAgent(host.ctx, h.workspace);
    await sayAsUser(original, 'Create the original persistent conversation.');
    id = String(original.id); model = { provider: original.options.provider!, model: original.options.model! };
  } finally { await host.dispose(); }
  writeFileSync(override, JSON.stringify([write, say('resumed tool finished')]));
  return { h, id, model };
}

function liveCheck(t: TestContext, out: string) {
  const saved = { argv: process.argv, key: process.env.DEEPSEEK_API_KEY, stdout: process.stdout.write, stderr: process.stderr.write, exitCode: process.exitCode };
  const env = Object.fromEntries(['TMPDIR', 'TMUX_TMPDIR', 'TMUX', 'SSH_AUTH_SOCK', 'HIMA_TEST_LEGACY_AUTO_DRIVE', 'HIMA_TEST_SILENT_AGENT', 'DSH_TELEMETRY_DISABLED'].map((key) => [key, process.env[key]]));
  process.argv = [process.execPath, 'keyless-lifecycle-test', '--out', out, '--timeout-ms', '30000'];
  process.env.DEEPSEEK_API_KEY = 'nonsecret-checkpoint-scan-sentinel';
  const check = new LiveCheck('live-check-pipeline-checkpoint', 2);
  process.argv = saved.argv;
  t.after(async () => {
    clearTimeout(check.hardTimer);
    check.stopJobs();
    await check.host?.dispose();
    process.stdout.write = saved.stdout; process.stderr.write = saved.stderr; process.exitCode = saved.exitCode;
    if (saved.key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = saved.key;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(check.temporary, { recursive: true, force: true });
  });
  return check;
}

test('native persisted resume restores the explicitly held model and finishes an actual tool before say returns', async (t) => {
  const { h, id, model } = await persisted(t);
  const check = liveCheck(t, path.join(h.home, 'completed-turn-evidence')); check.home = h;
  const host = await bootInProcess(h); check.attach(host);
  const handle = await resumeTestAgent(host.ctx, id, model); check.trackResumed(handle.agent);
  try {
    await check.say(handle.agent, 'Write resumed.txt using the real write tool.');
    assert.ok(existsSync(path.join(h.workspace, 'resumed.txt')), 'resume returned idle after a failed provider-less turn, without its actual tool write');
    assert.equal(readFileSync(path.join(h.workspace, 'resumed.txt'), 'utf8'), 'actual resumed tool output');
    assert.equal(String(handle.agent.id), id);
    assert.deepEqual(handle.agent.options, model);
    assert.equal(toolCalls(handle.agent).filter((call) => call.name === 'write').length, 1);
    const ended = handle.agent.session.snapshotEvents().findLast((event) => event.type === 'turn/end');
    assert.equal(ended?.data.reason.kind, 'completed');
    await check.finish(); // Host owns disposal after cancellation/snapshot, as in the live script.
    const evidence = JSON.parse(readFileSync(path.join(check.out, 'evidence.json'), 'utf8'));
    assert.equal(evidence.status, 'passed');
    assert.deepEqual(evidence.observed.secretScan.holding, []);
    assert.deepEqual(evidence.observed.secretScan.unreadable, []);
    assert.equal(evidence.costs.nativeSessionsCreated, 0); assert.equal(evidence.costs.nativeSessionsResumed, 1);
    assert.equal(host.ctx.get('agents'), undefined, 'Host disposal released its native Agent registry');
  } finally { await host.dispose(); }
});

test('LiveCheck reports a native turn failure instead of advancing to method assertions', async (t) => {
  const { h, id } = await persisted(t);
  const check = liveCheck(t, path.join(h.home, 'failed-turn-evidence'));
  check.home = h;
  const host = await bootInProcess(h); check.attach(host);
  const handle = await resumeTestAgent(host.ctx, id); // Deliberately no model, reproducing the defect.
  check.trackResumed(handle.agent);
  await assert.rejects(check.say(handle.agent, 'Write resumed.txt.'), /has no provider\/model/);
  assert.equal(existsSync(path.join(h.workspace, 'resumed.txt')), false);
  assert.equal(check.steps, 1, 'one pre-validation agent/request event is not one provider call');
  await handle.dispose();
});

test('cleanup survives an already disposed projection, records failure and scans the retained external home', async (t) => {
  const { h, id, model } = await persisted(t);
  const check = liveCheck(t, path.join(h.home, 'cleanup-evidence'));
  check.home = h;
  const host = await bootInProcess(h); check.attach(host);
  const handle = await resumeTestAgent(host.ctx, id, model); check.trackResumed(handle.agent);
  check.failure = 'deliberate failed-check fixture';
  const leaked = path.join(h.home, 'synthetic-scan.txt'); writeFileSync(leaked, check.key);
  await handle.dispose();
  await assert.doesNotReject(check.finish(), 'finish must not cancel a disposed inbox projection or skip final status and scan');
  const evidence = JSON.parse(readFileSync(path.join(check.out, 'evidence.json'), 'utf8'));
  assert.equal(evidence.status, 'failed'); assert.equal(evidence.failure, 'deliberate failed-check fixture');
  assert.ok(evidence.finishedAt);
  assert.ok(evidence.observed.secretScan.holding.includes(leaked));
  assert.equal(readFileSync(leaked, 'utf8'), '[REDACTED]');
});
