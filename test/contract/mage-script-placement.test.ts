import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { loadPack, checkPack, loadSite } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'mage-script-placement';

test('the MAGE script-method Pack runs one Engineer round inside one Fabric repeat and only the Engineer holds the MAGE seat', async () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(pack.contract.version, '0.1.0');
  assert.equal(pack.contract.budget.timeBoxMs, 21_600_000);
  assert.equal(pack.contract.budget.closingReserveMs, 900_000);

  const flow = pack.flow!;
  const repeat = Object.values(flow.blocks).find((block) => block.kind === 'repeat') as any;
  assert.ok(repeat, 'one repeat block');
  assert.equal(repeat.maxIterations, 6);
  assert.equal(repeat.budget, 'original-run');
  assert.deepEqual(repeat.stop, { output: { taskId: 'decide-round', path: ['route'] }, equals: 'stop' });
  assert.deepEqual(Object.keys(repeat.carry), ['roundState']);

  const body = flow.blocks[repeat.body] as any;
  assert.equal(body.kind, 'sequence');
  assert.deepEqual(body.steps, ['engineer-script', 'decide-round']);

  const top = flow.blocks[flow.entry] as any;
  assert.equal(top.kind, 'sequence');
  assert.deepEqual(top.steps, [
    'prepare-case', 'measure-incumbent', repeat.id, 'evaluate-placement', 'deliver',
  ]);

  assert.equal(flow.tasks['evaluate-placement']?.budget, 'closing');
  assert.equal(flow.tasks.deliver?.budget, 'closing');

  const outsourcedTools = pack.contract.tools.filter((item: any) => item.outsourcing);
  assert.equal(outsourcedTools.length, 1, 'exactly one tool with outsourcing');
  const engineerTool = outsourcedTools[0] as any;
  assert.equal(engineerTool.id, 'engineer-script');
  assert.equal(engineerTool.outsourcing.role, 'resident-engineering-agent');
  assert.deepEqual(engineerTool.licences, { mage: 1 });
  assert.equal(engineerTool.outsourcing.produces, 'scriptCandidate');
  assert.equal(engineerTool.outsourcing.artifactPrefix, 'placement');
  assert.deepEqual(engineerTool.outsourcing.knowledge, [
    'script-method-playbook.md', 'mage-capabilities.md', 'state-and-evidence.md',
    'reference-method-guide.md', 'role-script-engineer.md',
  ]);

  assert.deepEqual(pack.contract.agentTeams ?? [], []);
  assert.deepEqual(pack.contract.workshops ?? [], []);

  const semantics = (parse(await readFile(path.join(repoRoot, 'packs', packId, 'semantics.yml'), 'utf8')) as any).values;
  const reader = parse(await readFile(path.join(repoRoot, 'packs', packId, 'readers/mage-script-candidate.yml'), 'utf8')) as any;
  assert.deepEqual(reader.emits, [
    'mage_candidate_error_count', 'mage_priority_unplaced_count', 'mage_dropped_count',
    'mage_dropped_length_um', 'mage_dropped_ordinary_count', 'mage_dropped_ordinary_length_um',
    'mage_target_distance_max_um', 'mage_target_over_limit_count', 'mage_order_deviation_max',
    'mage_order_deviation_max_lr', 'mage_order_deviation_max_tb', 'mage_priority_move_max_um',
    'mage_priority_moved_count', 'mage_native_overlap_rows', 'mage_native_space_rows',
    'mage_native_boundary_rows', 'mage_native_violation_total',
  ]);
  for (const type of reader.emits) assert.ok(semantics[type], `${type} declared`);

  for (const ruleId of pack.contract.rules) {
    const ruleFile = path.join(repoRoot, 'packs', packId, 'rules', `${ruleId}.yml`);
    await readFile(ruleFile, 'utf8');
  }
  assert.deepEqual([...pack.contract.rules].sort(), [
    'placement-delivery-ready', 'priority-all-placed', 'no-native-violation', 'drops-within-goal',
    'target-limit-met', 'order-lr-within-goal', 'order-tb-within-goal', 'priority-move-within-budget',
  ].sort());

  const goal = pack.contract.goal ?? {};
  assert.deepEqual(Object.keys(goal).sort(), [
    'target_dropped_count', 'max_target_distance_um', 'max_order_deviation_lr',
    'max_order_deviation_tb', 'max_priority_move_um',
  ].sort());
  assert.deepEqual(goal.target_dropped_count, { type: 'number', unit: 'count', min: 0, max: 100_000, default: 0 });
  assert.deepEqual(goal.max_target_distance_um, { type: 'number', unit: 'um', min: 0, max: 100_000, default: 100 });
  assert.deepEqual(goal.max_order_deviation_lr, { type: 'number', unit: 'rank', min: 0, max: 1_000, default: 2 });
  assert.deepEqual(goal.max_order_deviation_tb, { type: 'number', unit: 'rank', min: 0, max: 1_000, default: 1 });
  assert.deepEqual(goal.max_priority_move_um, { type: 'number', unit: 'um', min: 0, max: 100_000, default: 100 });

  assert.deepEqual(pack.contract.strategy, {
    incumbentComparison: { type: 'choice', options: ['retained', 'native'], default: 'retained' },
  });
});

test('the MAGE script-method Pack fits a Site that declares one MAGE seat and refuses one that declares none', async (t) => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);

  const h = await createHimaHome();
  t.after(() => h.dispose());
  const bindings = {
    mageCaseManifest: path.join(h.workspace, 'manifest-script.json'),
    siteCapabilities: path.join(h.workspace, 'site-capabilities.json'),
    workspaceRoot: h.workspace,
    engineeringCapabilities: path.join(h.workspace, 'engineering-capabilities.json'),
    consumerContext: path.join(h.workspace, 'consumer-context.json'),
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

test('the MAGE script-method Pack fits the real linglong-mage-script Site and refuses a copy that drops its licence', async (t) => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const siteSourceDir = path.join(repoRoot, 'sites/linglong-mage-script');
  const siteText = await readFile(path.join(siteSourceDir, 'site.yml'), 'utf8');
  const permitText = await readFile(path.join(siteSourceDir, 'permit.yml'), 'utf8');

  // Installed the way `prepareHimaHome`/the kit install Sites: the site file under its own name,
  // the permit beside it under the name the site file gives (here, `permit.yml`, as `site.yml`
  // itself declares `permit: ./permit.yml`).
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const sitesDir = path.join(h.home, 'hima/sites');
  await mkdir(sitesDir, { recursive: true });
  await cp(path.join(siteSourceDir, 'site.yml'), path.join(sitesDir, 'linglong-mage-script.yml'));
  await cp(path.join(siteSourceDir, 'permit.yml'), path.join(sitesDir, 'permit.yml'));
  const fitCheck = checkPack(pack, loadSite(sitesDir, 'linglong-mage-script'));
  assert.equal(fitCheck.fit, true, JSON.stringify(fitCheck.errors));

  const h2 = await createHimaHome();
  t.after(() => h2.dispose());
  const sitesDir2 = path.join(h2.home, 'hima/sites');
  await mkdir(sitesDir2, { recursive: true });
  const noLicenceText = siteText.replace('  licences:\n    mage: 1\n', '  licences: {}\n');
  assert.notEqual(noLicenceText, siteText, 'the reference site file holds no "licences:\\n    mage: 1\\n" to vary');
  await writeFile(path.join(sitesDir2, 'linglong-mage-script.yml'), noLicenceText);
  await writeFile(path.join(sitesDir2, 'permit.yml'), permitText);
  const check = checkPack(pack, loadSite(sitesDir2, 'linglong-mage-script'));
  assert.equal(check.fit, false);
  const mageLicence = check.licences.find((entry) => entry.name === 'mage');
  assert.ok(mageLicence, 'the mage licence is reported');
  assert.match(mageLicence!.error ?? '', /does not declare/);
});
