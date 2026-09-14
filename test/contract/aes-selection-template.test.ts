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

test('the pilot subset audit rejects a hardcoded selector despite matching launch and output hashes', async t => {
  const fixture = await createAesDomainFixture(); t.after(() => fixture.dispose());
  const templateFile = path.join(aesDomainPack, 'flow/selection-template.py');
  const template = await readFile(templateFile, 'utf8');
  const stub = 'raise NotImplementedError("Implement a data-dependent route selection algorithm here")';
  const codeFile = path.join(fixture.workspace, 'retained.py');
  const rawFile = path.join(fixture.workspace, 'raw.json');
  const selectedFile = path.join(fixture.workspace, 'selected.json');
  const raw = JSON.stringify({ generation_requests: [
    { candidate_id: 'stronger', support: 9 }, { candidate_id: 'weaker', support: 2 },
  ] });
  const selected = JSON.stringify({ sourceSha256: sha256(raw), selected: ['stronger'] });
  await writeFile(rawFile, raw); await writeFile(selectedFile, selected);
  const routes = ['timing_criticality', 'timing_context', 'structure_frequency',
    'structure_compaction', 'mapper_compatibility', 'functional_diversity'];
  const runAudit = async (name: string, algorithm: string, helpers = '', alterInput = false) => {
    let code = template.replace(stub, algorithm).replace('def choose(', helpers + '\ndef choose(');
    if (alterInput) {
      const before = code;
      code = code.replace('folder / "raw.json"', 'folder / "untracked.json"');
      assert.notEqual(code, before, 'the counterexample changes the actual input read');
    }
    await writeFile(codeFile, code);
    const input = path.join(fixture.workspace, name + '-input.json');
    await writeFile(input, JSON.stringify({ template: templateFile, templateSha256: sha256(template),
      selectors: routes.map(route => ({ route, code: codeFile, codeSha256: sha256(code),
        raw: rawFile, rawSha256: sha256(raw), selection: selectedFile, selectionSha256: sha256(selected) })) }));
    return spawnSync('/usr/bin/python3', [path.resolve(aesDomainPack, '../../scripts/audit-dtco-pilot-selectors.py'),
      input, path.join(fixture.workspace, name + '-result.json')], { encoding: 'utf8', timeout: 10_000 });
  };
  const fixed = await runAudit('fixed', 'return ["stronger"]');
  assert.notEqual(fixed.status, 0); assert.match(fixed.stderr, /embeds actual candidate identities/);
  const dynamic = await runAudit('dynamic', 'return [max(candidates, key=lambda c: c["support"])["candidate_id"]] if candidates else []');
  assert.equal(dynamic.status, 0, dynamic.stderr);
  const result = JSON.parse(await readFile(path.join(fixture.workspace, 'dynamic-result.json'), 'utf8'));
  assert.deepEqual(result.results.map((row: { subsetSelection: string[] }) => row.subsetSelection),
    routes.map(() => ['weaker']), 'removing the higher-support candidate produces the lower-support candidate');
  const withHelper = await runAudit('helper', 'return [max(candidates, key=_score)["candidate_id"]] if candidates else []',
    'def _score(candidate):\n    return candidate["support"]\n');
  assert.equal(withHelper.status, 0, withHelper.stderr);
  const shadow = await runAudit('shadow', 'return []', 'def Path(value):\n    return value\n');
  assert.notEqual(shadow.status, 0); assert.match(shadow.stderr, /helper shadows an existing binding/);
  const changedInput = await runAudit('changed-input', 'return []', '', true);
  assert.notEqual(changedInput.status, 0); assert.match(changedInput.stderr, /fixed imports, main/);
});
