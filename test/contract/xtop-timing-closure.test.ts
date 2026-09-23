import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { choose, loadPack, checkPack, packStage, loadSite, resolveChooser, type ObservationRecord, type VerdictRecord } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'xtop-timing-closure';

test('the XTop closure Pack loads, fits its declared execution surface and passes its cheap data-contract tests', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const local = await writeLocalSite(h, {
    allowedWrappers: ['/usr/bin/python3'],
    bindings: {
      inputInnovusDatabase: path.join(h.workspace, 'input.enc.dat'),
      siteProfile: path.join(h.workspace, 'site-profile.json'),
      sourceManifest: path.join(h.workspace, 'source-manifest.sha256'),
      workspaceRoot: h.workspace,
    },
    licences: { Innovus: 1, StarRC: 1, PrimeTime: 1, XTop: 1 },
  });
  const packDir = path.join(repoRoot, 'packs', packId);
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(packStage(packDir).stage, 'compiled');
  assert.equal(pack.graph.nodes.length, 28);
  assert.equal(pack.graph.edges.length, 28);
  const check = checkPack(pack, loadSite(local.sitesDir, local.name));
  assert.equal(check.fit, true, check.errors.join('\n'));

  const tests = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(packDir, 'flow/tests'), '-v'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});

test('XTop recommendation cannot claim completion while any required verdict fails or is undetermined', () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const chooser = resolveChooser(pack, 'xtop-next-iteration', 'the reading').chooser;
  const base = { runId: 'run-xtop', siteId: 'site-local', seq: 1, at: '2026-09-23T00:00:00.000Z', generation: 1 } as const;
  const observation: ObservationRecord = {
    ...base, id: 'observation-xtop', writer: 'executor', type: 'observation', path: '/work/iteration.json',
    contentSha256: 'a'.repeat(64), bytes: 1, reader: {
      id: 'xtop-iteration-result', version: '1', reportKind: 'xtop-timing-closure-iteration/1',
      emits: ['xtop_closure_score', 'xtop_endpoint_remaining_count'], file: 'tools/read-output.py', sha256: 'b'.repeat(64),
    }, values: [
      { type: 'xtop_closure_score', unit: 'score', value: 1 },
      { type: 'xtop_endpoint_remaining_count', unit: 'count', value: 1 },
    ],
  };
  const verdict = (outcome: VerdictRecord['outcome'], ruleId: string, reason?: string): VerdictRecord => ({
    ...base, id: `verdict-${ruleId}`, writer: 'judge', type: 'verdict', outcome, ruleId, ruleVersion: '1',
    cites: [observation.id], valuesAsRead: [], ...(reason === undefined ? {} : { reason }),
  });
  const input = {
    bound: { revisionStep: 1 }, knobs: pack.contract.strategy, strategy: { strategyRevision: 0 },
    observation,
    constraint: verdict('PASS', 'xtop-iteration-evidence-valid'),
    goal: verdict('PASS', 'xtop-setup-clean'),
  };
  assert.deepEqual(choose(chooser, { ...input, verdicts: [...[input.constraint, input.goal], verdict('PASS', 'xtop-hold-clean')] }),
    { ok: true, chosen: { goalMet: true }, rationale: { score: 1, iteration: 1, revisionStep: 1 } });
  for (const outcome of ['FAIL', 'UNDETERMINED'] as const) {
    const result = choose(chooser, { ...input, verdicts: [...[input.constraint, input.goal], verdict(outcome, 'xtop-hold-clean', 'held evidence')] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /xtop-hold-clean is/);
  }
  assert.deepEqual(choose(chooser, input), { ok: true, chosen: { goalMet: true }, rationale: { score: 1, iteration: 1, revisionStep: 1 } },
    'two-rule callers retain their existing chooser behavior');
});
