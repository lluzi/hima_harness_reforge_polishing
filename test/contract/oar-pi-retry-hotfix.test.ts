// L0 offline asset/projection checks. No Host, SDK session, provider or network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { repoRoot } from './support/dsh-home.ts';
const { stageOarPiRetryHotfix } = await import(pathToFileURL(path.join(repoRoot, 'scripts/stage-oar-pi-retry-hotfix.mjs')).href);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('fixed OAR hotfix refuses wrong version/hash and existing or overlapping destinations before modifying source', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-oar-reject-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), pkg = path.join(source, 'node_modules/@botiverse/oar');
  await mkdir(path.join(pkg, 'dist/runtimes/pi'), { recursive: true });
  await writeFile(path.join(pkg, 'dist/index.js'), '');
  const metadata = path.join(pkg, 'package.json'), projection = path.join(pkg, 'dist/runtimes/pi/projection.js');
  await writeFile(metadata, JSON.stringify({ name: '@botiverse/oar', version: '0.45.0' }));
  await writeFile(projection, 'wrong fixed bytes');
  await assert.rejects(stageOarPiRetryHotfix({ source, target: path.join(root, 'bad-version') }), /0\.46\.0/);
  await writeFile(metadata, JSON.stringify({ name: '@botiverse/oar', version: '0.46.0' }));
  await assert.rejects(stageOarPiRetryHotfix({ source, target: path.join(root, 'bad-hash') }), /SHA256/);
  await assert.rejects(stageOarPiRetryHotfix({ source, target: source }), /outside/);
  await assert.rejects(stageOarPiRetryHotfix({ source, target: path.join(source, 'overlap') }), /outside/);
  await assert.rejects(stageOarPiRetryHotfix({ source, target: root }), /outside|exists/);
  assert.equal(await readFile(projection, 'utf8'), 'wrong fixed bytes');
});

test('actual fixed OAR offline hotfix preserves raw/token facts and accepts only a successful native retry recovery', async t => {
  const source = process.env.HIMA_OAR_HOTFIX_SOURCE;
  if (!source) { t.skip('Actual retained OAR npm closure requires HIMA_OAR_HOTFIX_SOURCE; no SDK fixture substitutes for it'); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-oar-hotfix-')); t.after(() => rm(root, { recursive: true, force: true }));
  const originalFile = await realpath(path.join(source, 'node_modules/@botiverse/oar/dist/runtimes/pi/projection.js'));
  const originalBytes = await readFile(originalFile);
  const original = await import(pathToFileURL(originalFile).href);
  const error = { type: 'turn_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Request timed out.' } };
  const recovered = { type: 'auto_retry_end', success: true };
  const settled = { type: 'agent_settled', aborted: false };
  // Freeze the observed original defect before staging the independently selected copy.
  let before = original.foldPiEvent(original.initialPiProjection, error).state;
  before = original.foldPiEvent(before, recovered).state;
  assert.equal(original.foldPiEvent(before, settled).commands[0].body.events[0].outcome.kind, 'failed');
  const receipt = await stageOarPiRetryHotfix({ source, target: path.join(root, 'copy') });
  assert.equal(receipt.baseVersion, '0.46.0'); assert.equal(receipt.baseProjectionSha256, sha(originalBytes));
  assert.equal(sha(await readFile(originalFile)), sha(originalBytes));
  assert.ok(receipt.module.startsWith(receipt.target + path.sep));
  assert.equal(await realpath(receipt.module), receipt.module);
  assert.notEqual(receipt.projection, originalFile);
  const patched = await import(pathToFileURL(receipt.projection).href);
  assert.equal(sha(await readFile(receipt.projection)), receipt.projectionSha256);
  await assert.rejects(stageOarPiRetryHotfix({ source, target: receipt.target }), /exists/);
  for (const [name, events, expected] of [
    ['successful retry', [error, recovered, { type: 'turn_end', message: { role: 'assistant', stopReason: 'stop' } }, settled], 'completed'],
    ['unsuccessful retry', [error, { type: 'auto_retry_end', success: false }, settled], 'failed'],
    ['new error after recovery', [error, recovered, { ...error, message: { ...error.message, errorMessage: 'new native failure' } }, settled], 'failed'],
    ['native abort still wins', [error, recovered, { type: 'agent_settled', aborted: true }], 'aborted'],
  ] as const) await t.test(name, () => {
    let state = patched.foldPiEvent(patched.initialPiProjection, { type: 'message_end', message: { role: 'assistant', usage: { input: 11, output: 7, cacheRead: 3, cacheWrite: 2 } } }).state;
    const tokens = structuredClone(state.tokens); let outcome: { kind: string; reason?: string } | undefined;
    for (const event of events) {
      const next = patched.foldPiEvent(state, event); state = next.state;
      assert.deepEqual(next.commands[0].body.native, event, 'Actual raw native event remains intact');
      outcome = next.commands[0].body.events.find((v: {kind: string}) => v.kind === 'turn_ended')?.outcome ?? outcome;
    }
    assert.equal(outcome?.kind, expected); assert.deepEqual(state.tokens, tokens);
    if (name === 'new error after recovery') assert.equal(outcome?.reason, 'new native failure');
    if (name === 'unsuccessful retry') assert.equal(outcome?.reason, 'Request timed out.');
  });
});
