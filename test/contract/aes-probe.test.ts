import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from './support/dsh-home.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const reader = path.join(repoRoot, 'packs/aes-tsmc28-dtco/flow/read-probe.py');
const identity = { schema: 1, inputs: { fixture: 'fixed' }, method: { fixture: 'fixed' }, tool: { version: 'synthetic' } };
async function pinIdentity(root: string) {
  const raw = JSON.stringify(identity);
  await writeFile(path.join(root, 'probe-inputs.json'), raw);
  return { effectiveIdentity: identity, identity: { path: 'probe-inputs.json', sha256: createHash('sha256').update(raw).digest('hex') } };
}

test('a later probe rejects changed library or copied method before launching another tool', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aes-input-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const flow = path.join(root, 'flow'); await mkdir(flow);
  const db = path.join(root, 'fixture.db'); await writeFile(db, 'original database fixture');
  await writeFile(path.join(root, 'aes.v'), 'module aes_cipher_top; endmodule\n');
  await writeFile(path.join(flow, 'synth.tcl'), '# method fixture\n');
  await writeFile(path.join(flow, 'inputs.json'), JSON.stringify({ design: 'aes_cipher_top', rtlGlob: path.join(root, '*.v'),
    foundryDb: db, edaWrapper: '/usr/bin/python3' }));
  const args = [path.join(repoRoot, 'packs/aes-tsmc28-dtco/flow/probe.py'), '--workspace', root, '--period', '0.35', '--check-inputs'];
  const first = spawnSync('python3', args, { encoding: 'utf8' }); assert.equal(first.status, 0, first.stderr);
  await writeFile(path.join(flow, 'probe-inputs.json'), JSON.stringify({ schema: 1, ...JSON.parse(first.stdout), tool: { version: 'fixture' } }));
  assert.equal(spawnSync('python3', args).status, 0);
  await writeFile(db, 'changed database fixture');
  const changed = spawnSync('python3', args, { encoding: 'utf8' });
  assert.notEqual(changed.status, 0); assert.match(changed.stderr, /effective inputs or method changed/);
  await writeFile(db, 'original database fixture');
  await writeFile(path.join(flow, 'synth.tcl'), '# changed method\n');
  const method = spawnSync('python3', args, { encoding: 'utf8' });
  assert.notEqual(method.status, 0); assert.match(method.stderr, /effective inputs or method changed/);
  await assert.rejects(readFile(path.join(flow, 'probe.json')), { code: 'ENOENT' });
});
test('AES reader holds measured period and slack to original hashed tool output; zero slack is not an estimated Fmax', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aes-probe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'trial'));
  const raw = 'asked_period_ns\t0.5\nworst_slack_ns\t0\ncell_area_um2\t1024\n';
  await writeFile(path.join(dir, 'trial/metrics.tsv'), raw);
  const digest = createHash('sha256').update(raw).digest('hex');
  const pin = await pinIdentity(dir);
  const report = path.join(dir, 'probe.json');
  const out = path.join(dir, 'values.json');
  await writeFile(report, JSON.stringify({ ...pin, format: 'aes-probe/2', toolExit: 0, askedPeriodNs: 0.5, evidence: { metrics: { path: 'trial/metrics.tsv', sha256: digest } } }));
  const result = spawnSync('python3', [reader, report, out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')).values, [
    { type: 'clock_period', unit: 'ns', value: 0.5 },
    { type: 'setup_wns', unit: 'ns', mode: 'setup', scope: 'all', value: 0 },
    { type: 'cell_area', unit: 'um2', value: 1024 },
  ]);
  await writeFile(path.join(dir, 'trial/metrics.tsv'), raw.replace('0.5', '0.4'));
  assert.notEqual(spawnSync('python3', [reader, report, out]).status, 0, 'changed bytes cannot pose as the saved measurement');
});

test('AES reader refuses mismatched periods, incomplete fields, duplicate/nonfinite measurements, failed tools and escaping evidence', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aes-probe-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pin = await pinIdentity(dir);
  const report = path.join(dir, 'probe.json');
  const raw = 'asked_period_ns\t0.5\nworst_slack_ns\t-0.1\ncell_area_um2\t1024\n';
  const cases = [
    { raw, period: 0.4 },
    { raw, changedIdentity: true },
    { raw: raw.replace('0.5', 'NaN') },
    { raw: raw.replace('cell_area_um2\t1024\n', '') },
    { raw: raw + 'worst_slack_ns\t0\n' },
    { raw, toolExit: 1 },
    { raw, at: '../metrics.tsv' },
  ];
  for (const [i, sample] of cases.entries()) {
    await writeFile(path.join(dir, 'metrics.tsv'), sample.raw);
    await writeFile(report, JSON.stringify({ ...pin, ...(sample.changedIdentity ? { effectiveIdentity: { ...identity, inputs: { fixture: 'changed' } } } : {}), format: 'aes-probe/2', toolExit: sample.toolExit ?? 0, askedPeriodNs: sample.period ?? 0.5,
      evidence: { metrics: { path: sample.at ?? 'metrics.tsv', sha256: createHash('sha256').update(sample.raw).digest('hex') } } }));
    const out = path.join(dir, `out-${i}.json`);
    assert.notEqual(spawnSync('python3', [reader, report, out]).status, 0, `counterexample ${i} must not yield evidence`);
    await assert.rejects(readFile(out), { code: 'ENOENT' });
  }
});
