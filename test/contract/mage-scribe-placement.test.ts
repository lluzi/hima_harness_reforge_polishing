import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { loadPack, checkPack, loadSite } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'mage-scribe-placement';

test('the MAGE Pack runs five serial resident roles inside one Fabric repeat and only the Engineer holds the MAGE seat', async () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(pack.contract.version, '0.2.0');
  assert.equal(pack.contract.budget.timeBoxMs, 21_600_000);
  assert.equal(pack.contract.budget.closingReserveMs, 900_000);

  const flow = pack.flow!;
  const repeat = Object.values(flow.blocks).find((block) => block.kind === 'repeat') as any;
  assert.ok(repeat, 'one repeat block');
  assert.equal(repeat.maxIterations, 4);
  assert.equal(repeat.budget, 'original-run');
  assert.deepEqual(repeat.stop, { output: { taskId: 'decide-round', path: ['route'] }, equals: 'stop' });
  assert.deepEqual(Object.keys(repeat.carry), ['roundState']);

  const body = flow.blocks[repeat.body] as any;
  assert.equal(body.kind, 'sequence');
  assert.deepEqual(body.steps, [
    'engineer-place', 'review-litho-pie', 'review-metrology', 'review-alignment', 'review-wat', 'decide-round',
  ]);

  const top = flow.blocks[flow.entry] as any;
  assert.equal(top.kind, 'sequence');
  assert.deepEqual(top.steps, [
    'prepare-case', 'measure-incumbent', repeat.id, 'evaluate-placement', 'deliver',
  ]);

  assert.equal(flow.tasks['evaluate-placement']?.budget, 'closing');
  assert.equal(flow.tasks.deliver?.budget, 'closing');

  for (const id of ['engineer-place', 'review-litho-pie', 'review-metrology', 'review-alignment', 'review-wat']) {
    const tool = pack.contract.tools.find((item) => item.id === id) as any;
    assert.ok(tool, `tool ${id} declared`);
    assert.equal(tool.outsourcing.role, 'resident-engineering-agent');
    assert.deepEqual(tool.licences, id === 'engineer-place' ? { mage: 1 } : {});
  }
  const engineerTool = pack.contract.tools.find((item) => item.id === 'engineer-place') as any;
  assert.equal(engineerTool.outsourcing.produces, 'placementCandidate');
  const reviewProduces: Record<string, string> = {
    'review-litho-pie': 'reviewLithoPie',
    'review-metrology': 'reviewMetrology',
    'review-alignment': 'reviewAlignment',
    'review-wat': 'reviewWat',
  };
  for (const [id, produces] of Object.entries(reviewProduces)) {
    const tool = pack.contract.tools.find((item) => item.id === id) as any;
    assert.equal(tool.outsourcing.produces, produces);
  }

  assert.deepEqual(pack.contract.agentTeams ?? [], []);
  assert.deepEqual(pack.contract.workshops ?? [], []);

  const semantics = (parse(await readFile(path.join(repoRoot, 'packs', packId, 'semantics.yml'), 'utf8')) as any).values;
  for (const file of ['mage-placement-candidate', 'mage-consumer-review']) {
    const reader = parse(await readFile(path.join(repoRoot, 'packs', packId, `readers/${file}.yml`), 'utf8')) as any;
    assert.equal(reader.file, 'tools/read-mage.py');
    for (const type of reader.emits) assert.ok(semantics[type], `${type} declared`);
  }

  for (const ruleId of pack.contract.rules) {
    const ruleFile = path.join(repoRoot, 'packs', packId, 'rules', `${ruleId}.yml`);
    await readFile(ruleFile, 'utf8');
  }
  assert.deepEqual([...pack.contract.rules].sort(), [
    'drops-within-goal', 'no-native-violation', 'no-open-requests', 'order-within-goal',
    'placement-delivery-ready', 'priority-all-placed', 'target-limit-met',
  ].sort());

  const goal = pack.contract.goal ?? {};
  assert.deepEqual(Object.keys(goal).sort(), [
    'max_order_deviation', 'max_target_distance_um', 'target_dropped_count',
  ].sort());
  assert.deepEqual(goal.target_dropped_count, { type: 'number', unit: 'count', min: 0, max: 100_000, default: 0 });
  assert.deepEqual(goal.max_target_distance_um, { type: 'number', unit: 'um', min: 0, max: 100_000, default: 100 });
  assert.deepEqual(goal.max_order_deviation, { type: 'number', unit: 'rank', min: 0, max: 1_000, default: 1 });

  assert.deepEqual(pack.contract.strategy, {
    incumbentComparison: { type: 'choice', options: ['retained', 'native'], default: 'retained' },
  });
});

test('the MAGE Pack fits a Site that declares one MAGE seat and refuses one that declares none', async (t) => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);

  const h = await createHimaHome();
  t.after(() => h.dispose());
  const bindings = {
    mageCaseManifest: path.join(h.workspace, 'manifest.json'),
    consumerContext: path.join(h.workspace, 'consumer-context.json'),
    siteCapabilities: path.join(h.workspace, 'site-capabilities.json'),
    workspaceRoot: h.workspace,
    engineeringCapabilities: path.join(h.workspace, 'engineering-capabilities.json'),
  };
  const allowedWrappers = ['sh', 'make', 'python3', '/usr/bin/python3'];
  const fits = await writeLocalSite(h, { bindings, licences: { mage: 1 }, allowedWrappers });
  const fitCheck = checkPack(pack, loadSite(fits.sitesDir, fits.name));
  assert.equal(fitCheck.fit, true, JSON.stringify(fitCheck.errors));

  const h2 = await createHimaHome();
  t.after(() => h2.dispose());
  const none = await writeLocalSite(h2, { bindings, licences: {}, allowedWrappers });
  const check = checkPack(pack, loadSite(none.sitesDir, none.name));
  assert.equal(check.fit, false);
  const mageLicence = check.licences.find((entry) => entry.name === 'mage');
  assert.ok(mageLicence, 'the mage licence is reported');
  assert.match(mageLicence!.error ?? '', /does not declare/);
});
