import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAesDomainFixture, sha256, writeSyntheticStageRecord, aesDomainPack } from './support/aes-domain-fixture.ts';

test('the selection scaffold retains stale outputs and validates ids before its successful exit', async t => {
  const fixture = await createAesDomainFixture(); t.after(() => fixture.dispose());
  const flow = path.join(fixture.workspace, 'flow');
  await cp(path.join(aesDomainPack, 'flow/domain'), path.join(flow, 'domain'), { recursive: true });
  await cp(path.join(aesDomainPack, 'tools/read-stage.py'), path.join(flow, 'read-stage.py'));
  const folder = path.join(flow, 'mining/structure_frequency'); await mkdir(folder, { recursive: true });
  const raw = path.join(folder, 'raw.json'); const rawBytes = JSON.stringify({ report_schema: 'xspace_cell-pattern-search/v2', strategy_id: 'structure_frequency', generation_requests: [] });
  await writeFile(raw, rawBytes);
  const minerHash = sha256('explicit synthetic source producer');
  await writeSyntheticStageRecord(fixture.workspace, 'mine-structure_frequency', [{ role: 'mining_raw', path: raw }], { codeSha256: minerHash });
  const old = { sourceSha256: sha256(rawBytes), codeSha256: minerHash, selected: [] };
  await writeFile(path.join(folder, 'selected.json'), JSON.stringify(old));
  const template = await readFile(path.join(aesDomainPack, 'flow/selection-template.py'), 'utf8');
  const execute = async (name: string, choose?: string) => {
    const entry = path.join(fixture.workspace, name + '.py');
    await writeFile(entry, choose ? template.replace('raise NotImplementedError("Implement a data-dependent route selection algorithm here")', choose) : template);
    return spawnSync('/usr/bin/python3', [entry, fixture.workspace, 'structure_frequency', '0'], { encoding: 'utf8' });
  };
  const incomplete = await execute('unimplemented'); assert.equal(incomplete.status, 1, incomplete.stderr);
  await assert.rejects(readFile(path.join(folder, 'selected.json')), { code: 'ENOENT' });
  const wrong = await execute('objects-instead-of-ids', 'return [{"id":"invented"}]');
  assert.equal(wrong.status, 1, wrong.stderr); assert.match(wrong.stderr, /not objects/);
  const nonexistent = await execute('unknown-id', 'return ["invented"]');
  assert.equal(nonexistent.status, 1, nonexistent.stderr);
  const valid = await execute('valid-empty-finding', 'return []'); assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'selected.json'), 'utf8')), old);
  const attempts = path.join(flow, 'selection-attempts/structure_frequency'); const dirs = await readdir(attempts);
  assert.equal(dirs.length, 4);
  const previous = await Promise.all(dirs.map(d => readFile(path.join(attempts, d, 'previous-selected.json'), 'utf8').catch(() => undefined)));
  assert.ok(previous.includes(JSON.stringify(old)), 'old output remains evidence but cannot make an unimplemented program successful');
  assert.equal(await readFile(raw, 'utf8'), rawBytes);
});
