import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { loadPack, checkPack, loadSite, packStage, installPackMethod, readersDirName } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest } from '@hima/harness';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { copyLegacyAtcsPack } from './support/atcs-legacy.ts';

const packId = 'agentic-timing-closure-system';

test('ATCS readiness precedes engineering and retains the legacy endpoint resolver assets', async () => {
  const packDir = path.join(repoRoot, 'packs', packId);
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(readersDirName, 'hima-readers');
  assert.equal(pack.graph.entry, 'prepare-inputs');
  assert.deepEqual(pack.graph.edges.filter(edge => edge.from === 'prepare-inputs').map(edge => edge.to), ['prepare-baseline']);
  assert.equal(pack.flow?.tasks['prepare-inputs']?.tool, 'prepare-inputs');
  assert.equal(pack.contract.outputs.find(output => output.name === 'inputReadiness')!.reader, 'atcs-readiness');
  const reader = parse(await readFile(path.join(packDir, 'readers/atcs-readiness.yml'), 'utf8')) as any;
  assert.equal(reader.file, 'tools/read-atcs.py');
  assert.match(await readFile(path.join(packDir, 'knowledge/endpoint-resolution.md'), 'utf8'),
    /workspace \/ "hima-readers" \/ "atcs-readiness" \/ "read-atcs\.py"/);
});

test('ATCS 0.4 outsources one whole fix-timing task and keeps XTop engineering evidence separate from final signoff', async () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(pack.contract.version, '0.4.7');
  assert.equal(pack.contract.minimumHarnessVersion, '0.3.0');
  assert.equal(pack.contract.budget.timeBoxMs, 7_200_000);
  assert.equal(pack.contract.budget.closingReserveMs, 900000,
    'the original fifteen-minute reserve remains available to declared evaluation and delivery Tasks');
  assert.equal(pack.flow!.tasks['evaluate-timing']!.budget, 'closing');
  assert.equal(pack.flow!.tasks.deliver!.budget, 'closing');

  const tool = pack.contract.tools.find(item => item.id === 'fix-timing') as any;
  assert.ok(tool, 'the Pack declares one fix-timing tool');
  assert.deepEqual(tool.outsourcing, {
    role: 'resident-engineering-agent',
    reads: ['inputReadiness', 'baselineState', 'nativeContext', 'commonStage'],
    knowledge: ['resident-timing-playbook.md', 'xtop-capabilities.md', 'state-and-evidence.md', 'xtop-closure-ladder.tcl.txt'],
    artifactPrefix: 'engineering',
    produces: 'engineeringResult',
  });
  assert.equal(tool.interactive, undefined, 'outsourced work is not a second interactive protocol');
  assert.equal(pack.contract.outputs.some(item => item.name === 'autoFixReference'), false);
  assert.equal(pack.contract.tools.some(item => item.id === 'auto-fix-reference'), false);
  assert.ok(!pack.graph.nodes.some(node => node.kind === 'judge' || node.kind === 'explore'));

  assert.deepEqual(tool.licences, { xtop: 1 });

  const nodes = (pack.graph.nodes as any[]).map(node => node.id);
  assert.deepEqual(nodes, [
    'prepare-inputs', 'prepare-baseline', 'fix-timing', 'evaluate-timing', 'deliver',
  ]);
  assert.equal((pack.graph.nodes as any[]).find(node => node.id === 'fix-timing').kind, 'act');
  assert.deepEqual((pack.graph as any).autopilot ?? [], []);
  assert.equal(pack.flow?.blocks[pack.flow.entry]?.kind, 'sequence');
  assert.deepEqual(pack.contract.agentTeams ?? [], [], 'the new method declares no fixed internal repair team');
  assert.deepEqual(pack.contract.workshops ?? [], [], 'the new method does not make Hima author six work packages');
  assert.deepEqual(pack.contract.strategy, {
    nativeReportPaths: { type: 'number', unit: 'paths', min: 1000, max: 100000, default: 10000, precision: 0 },
  }, 'the only strategy controls raw evidence breadth, not seats, mutations or methods');

  const reachableTools = new Set((pack.graph.nodes as any[]).map(node => node.parameters?.tool).filter(Boolean));
  assert.deepEqual([...reachableTools], ['prepare-inputs', 'prepare-baseline', 'fix-timing', 'evaluate-timing', 'deliver']);
  for (const id of ['observe-baseline', 'physical-baseline', 'implement', 'extract', 'sta', 'physical-candidate']) {
    assert.equal(reachableTools.has(id), false, `${id} is not a producer or mandatory tail on the new route`);
  }

  const result = pack.contract.outputs.find(item => item.name === 'engineeringResult');
  assert.deepEqual(result && { path: result.path, reader: result.reader }, {
    path: 'state/engineering-result.json', reader: 'atcs-engineering-result',
  });
  const semanticValues = (parse(await readFile(path.join(repoRoot, 'packs', packId, 'semantics.yml'), 'utf8')) as any).values;
  for (const type of ['tc_engineering_result_error_count', 'tc_engineering_setup_wns_ns',
    'tc_engineering_hold_wns_ns', 'tc_engineering_setup_tns_ns', 'tc_engineering_hold_tns_ns',
    'tc_engineering_remaining_violation_count', 'tc_engineering_regression_count',
    'tc_engineering_collateral_unknown_count']) {
    assert.ok(semanticValues[type], `${type} is Pack-local`);
  }
  assert.equal(semanticValues.tc_final_setup_wns_ns, undefined,
    'the XTop-only Pack cannot emit or reinterpret legacy final physical-signoff facts');
  assert.equal(semanticValues.tc_final_hold_wns_ns, undefined);
  const legacySemantics = (parse(await readFile(
    path.join(repoRoot, 'packs', packId, 'legacy/0.2.10/semantics.yml'), 'utf8')) as any).values;
  assert.ok(legacySemantics.tc_final_setup_wns_ns && legacySemantics.tc_final_hold_wns_ns,
    'the retained 0.2.10 method keeps its original final physical-signoff meanings');
});

const atcsXtopOperatorWrapper = '/data/eda/project/hima_harness/operator-admin/atcs-v31/atcs-xtop-operator-v31.sh';

test('the retained ATCS 0.2.10 snapshot loads, fits its Sites, and passes the focused native/Reader regressions', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const local = await writeLocalSite(h, {
    allowedWrappers: ['python3', '/usr/bin/python3', atcsXtopOperatorWrapper],
    bindings: {
      designStateManifest: path.join(h.workspace, 'designStateManifest.json'),
      analysisContract: path.join(h.workspace, 'analysisContract'),
      siteCapabilities: path.join(h.workspace, 'siteCapabilities.json'),
      workspaceRoot: h.workspace,
    },
    licences: { innovus: 1, primetime: 1, starrc: 1, xtop: 2 },
  });

  const legacyPacksDir = path.join(h.home, 'legacy-packs');
  const packDir = await copyLegacyAtcsPack(legacyPacksDir);
  const pack = loadPack(legacyPacksDir, packId);
  // Issue #64, reshaped 2026-09-29 (ADR-0016): every worker slot's Team is v5. The Operator works in
  // its admitted request's own `candidate.scope` within the recipe; the Reviewer is optional advice.
  const operatorTool = pack.contract.tools.find(item => item.id === 'xtop-operator')!;
  const mutations = operatorTool.interactive!.commands.mutate;
  const toolkit = spawnSync('python3', ['-c', 'import json,sys; sys.path.insert(0, sys.argv[1]); from atcs import workspaces; '
    + 'print(json.dumps([list(workspaces.MUTATE_COMMANDS), workspaces.SCOPE_MAX_MUTATIONS, list(workspaces.TASK_IDS)]))',
  path.join(packDir, 'flow')], { encoding: 'utf8' });
  assert.equal(toolkit.status, 0, toolkit.stderr);
  const [packageCommands, recipeCap, slots] = JSON.parse(toolkit.stdout) as [string[], number, string[]];
  assert.deepEqual(packageCommands, mutations, 'the work package scope admits exactly the toolkit mutations');
  assert.deepEqual(slots, ['w01', 'w02', 'w03', 'w04', 'w05', 'w06']);
  const operateNodes = (pack.graph.nodes as any[]).map(node => node.id as string).filter(id => /^operate-worker-\d\d$/.test(id));
  assert.deepEqual(operateNodes.sort(), slots.map(slot => `operate-worker-${slot.slice(1)}`), 'the graph operates all six worker slots');

  // Issue #64 Task 5: `prepare-workers` forks into six parallel worker branches, each a pure act
  // chain for one slot, joined at the judge `check-worker-results`, which leads to `collect`.
  const { forkFrom } = await import(new URL('../../packages/harness/lib/packs.js', import.meta.url).href);
  const prepare = (pack.graph.nodes as any[]).find(node => node.id === 'prepare-workers');
  const fork = forkFrom(pack.graph, prepare);
  assert.ok(fork?.ok, `prepare-workers forks: ${JSON.stringify(fork)}`);
  assert.equal(fork.join, 'check-worker-results');
  assert.deepEqual(fork.branches.map((branch: any) => branch.id), slots.map(slot => `research-worker-${slot.slice(1)}`));
  for (const branch of fork.branches as { id: string; nodes: string[] }[]) {
    const nn = branch.id.slice(-2);
    assert.deepEqual(branch.nodes, [`research-worker-${nn}`, `read-worker-request-${nn}`, `operate-worker-${nn}`,
      `capture-worker-${nn}`, `read-worker-result-${nn}`], `branch ${branch.id} runs slot w${nn}'s chain`);
  }
  const join = (pack.graph.nodes as any[]).find(node => node.id === 'check-worker-results');
  assert.equal(join.kind, 'judge');
  assert.deepEqual(join.parameters.rules, ['worker-result-admissible']);
  assert.deepEqual((pack.graph.edges as any[]).filter(edge => edge.from === 'check-worker-results')
    .map(edge => [edge.outcome, edge.to]).sort(), [['FAIL', 'collect'], ['PASS', 'collect'], ['UNDETERMINED', 'collect']],
  'every joined outcome collects: a refused slot is excluded by the ranked recipe, not by the route');
  const operatorNode = (id: string) => (pack.graph.nodes as any[]).find(node => node.id === id);
  for (const slot of slots) {
    assert.deepEqual(operatorNode(`operate-worker-${slot.slice(1)}`).parameters, { tool: 'xtop-operator', arguments: { SLOT: slot } });
    assert.deepEqual(operatorNode(`capture-worker-${slot.slice(1)}`).parameters, { tool: 'capture-contribution', arguments: { SLOT: slot } });
    const request = pack.contract.outputs.find(item => item.name === `workerRequest${slot.slice(1)}`)!;
    const result = pack.contract.outputs.find(item => item.name === `workerResult${slot.slice(1)}`)!;
    assert.equal(request.path, `research/requests/worker-request-${slot}.json`, 'each slot reads its own request path');
    assert.equal(result.path, `state/contribution-${slot}.json`, 'each slot reads its own result path');
  }
  // The `workerSlots` knob (0..6, default 6) is bound for the plan Reader on every way into `plan`;
  // #66 D8: 0 parks every seat, the qualified full-auto control arm.
  assert.deepEqual(pack.contract.strategy.workerSlots, { type: 'number', unit: 'slots', min: 0, max: 6, default: 6 });
  assert.deepEqual(operatorNode('bind-worker-slots').parameters,
    { tool: 'worker-slots', arguments: { WORKER_SLOTS: { from: 'strategy', name: 'workerSlots' } } });
  assert.deepEqual((pack.graph.edges as any[]).filter(edge => edge.to === 'plan').map(edge => edge.from), ['bind-worker-slots']);
  // The frozen 0.2.10 owner-lead route retained the replay helper but did not put it on the graph:
  // compose went directly to the persistent lead, and final AutoFinish stayed disabled.
  assert.equal(operatorNode('replay-prepare'), undefined);
  const replayPrepare = pack.contract.tools.find(item => item.id === 'replay-prepare')!;
  assert.ok(replayPrepare.inputs.includes('AUTO_FINISH'));
  assert.equal(replayPrepare.argv[replayPrepare.argv.length - 1], '${AUTO_FINISH}');
  assert.deepEqual((pack.graph.edges as any[]).filter(edge => edge.to === 'bind-worker-slots').map(edge => [edge.from, edge.outcome]),
    [['check-refresh-budget', 'PASS']], 'every generation plans only past the refresh-budget gate');
  const planner = pack.contract.workshops.find(item => item.id === 'plan-campaign')!;
  for (const words of [/post-auto residuals/, /commonStage\.nativeChecks/, /at most six unique disjoint work packages/,
    /Preserve disjoint cluster ownership/, /workerSlots 0 is the strong repeated-default-GBA control/,
    /maxMutations 600/, /full qualified toolkit/, /validate_work_package/]) {
    assert.match(planner.purpose, words, `plan-campaign purpose states ${words}`);
  }
  assert.doesNotMatch(planner.purpose, /may share edit-domain nets/, 'US8: active slots are disjoint in nets as well as instances');
  // Issue #64 live retest, Track B (from #63): every request-writing Workshop reads one admitted example
  // as declared knowledge (knowledge/example-*.md), and flow/tests/test_workshop_examples.py pins each
  // against its validator and Reader. Here: each example is declared, listed by its Workshop, named in
  // its purpose, and the loaded Pack holds the same parseable JSON.
  const examples: Record<string, string> = {
    'plan-campaign': 'example-campaign-plan.md', 'compose-contributions': 'example-integration-plan.md',
    ...Object.fromEntries(slots.map(slot => [`research-worker-${slot.slice(1)}`, 'example-worker-request.md'])) };
  for (const workshop of pack.contract.workshops) {
    const file = examples[workshop.id]!;
    assert.ok(file, `${workshop.id} has an example`);
    assert.ok(pack.contract.knowledge.some(item => item.file === file), `${file} is declared knowledge`);
    assert.ok(workshop.knowledge.includes(file), `${workshop.id} lists ${file}`);
    assert.ok(workshop.id === 'compose-contributions' ? /existing example/.test(workshop.purpose)
      : workshop.purpose.includes(file), `${workshop.id}'s purpose names its admitted example`);
  }
  const knowledgeExample = async (file: string, section?: string): Promise<any> => {
    let text = await readFile(path.join(packDir, 'knowledge', file), 'utf8');
    if (section !== undefined) text = text.split(`\n## ${section}\n`)[1]!.split('\n## ')[0]!;
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
    assert.equal(blocks.length, 1, `${file} ${section ?? ''} holds one json block`);
    return JSON.parse(blocks[0]![1]!);
  };
  const planExample = await knowledgeExample('example-campaign-plan.md');
  assert.deepEqual(Object.keys(planExample.candidate.workPackages), slots);
  for (const slot of slots) assert.equal(planExample.candidate.workPackages[slot].taskId, slot, 'taskId is exactly the slot key');
  const activeExample = planExample.candidate.workPackages.w01;
  assert.ok(activeExample.protected && activeExample.actions, 'the active example carries protected and actions');
  assert.ok(activeExample.scope.commands.includes('atcs_undo') && activeExample.scope.commands.every((c: string) => mutations.includes(c)));
  assert.equal(activeExample.scope.maxMutations, recipeCap);
  const active = await knowledgeExample('example-worker-request.md', 'Active slot');
  const { scope: activeScope, ...activeCore } = activeExample;
  const { scope: requestScope, ...requestCore } = active.candidate;
  assert.deepEqual(requestCore, activeCore, 'the example request preserves the prepared package identity and domain');
  assert.equal(requestScope.maxMutations, activeScope.maxMutations);
  assert.ok(requestScope.commands.includes('atcs_undo')
    && requestScope.commands.every((command: string) => activeScope.commands.includes(command)),
  'the request may use an admitted subset of the prepared toolkit scope');
  const noSafeMove = await knowledgeExample('example-worker-request.md', 'Active slot with no safe move');
  assert.deepEqual([noSafeMove.candidate, noSafeMove.sessionPlan], [active.candidate, []]);
  assert.ok(noSafeMove.noSafeAction.trim());
  const parked = await knowledgeExample('example-worker-request.md', 'Parked slot');
  assert.deepEqual(Object.keys(parked.candidate).sort(), ['baseStateId', 'parked', 'problem', 'taskId']);
  // US10/US34: the prior batch's post-auto-finish fail reasons reach the next generation's research.
  for (const workshop of pack.contract.workshops.filter(item => item.id === 'plan-campaign' || /^research-worker-\d\d$/.test(item.id))) {
    assert.ok(workshop.reads.includes('residualCases'), `${workshop.id} reads the residual cases and their batch fail reasons`);
  }
  // A parked slot's operate node is the batch no-op `operate-parked`, never an XTop session; an active
  // slot's stays the Team Operator's interactive session.
  const xtopOperator = pack.contract.tools.find(item => item.id === 'xtop-operator')!;
  assert.equal(xtopOperator.interactive!.mode, 'hybrid');
  assert.deepEqual(xtopOperator.argv, ['python3', '${WORKSPACE}/flow/atcs_cli.py', 'operate-parked', '${WORKSPACE}', '${SLOT}']);
  assert.equal(xtopOperator.interactive!.argv![0], atcsXtopOperatorWrapper);
  const workerTeams = pack.contract.agentTeams.filter(item => item.id.startsWith('atcs-worker-'));
  assert.deepEqual(workerTeams.map(item => item.triggerNode).sort(), operateNodes.sort(),
    'every operate-worker node has exactly one worker Team');
  const team01 = workerTeams.find(item => item.id === 'atcs-worker-01')!;
  const slotless = (value: unknown, slot: string) => JSON.stringify(value).replaceAll(`-${slot}`, '-NN')
    .replaceAll(`Request${slot}`, 'RequestNN').replaceAll(`w${slot}`, 'wNN');
  const structurallySlotless = (team: any, slot: string) => {
    const copy = structuredClone(team);
    const operator = copy.members.find((member: any) => member.id === 'operator');
    operator.taskTemplate = operator.taskTemplate.replace(/Expertise prior: [^;]+;/, 'Expertise prior: SLOT-SPECIFIC;');
    return slotless(copy, slot);
  };
  for (const team of workerTeams) {
    const slot = team.id.slice(-2);
    assert.equal(team.triggerNode, `operate-worker-${slot}`);
    assert.equal(structurallySlotless(team, slot), structurallySlotless(team01, '01'),
      `${team.id} preserves the shared Team structure while its expertise prior remains slot-specific`);
  }
  const team = team01;
  assert.equal(team.version, '6', '#66 D7: the Operator works its cluster as one batch');
  assert.deepEqual(team.members.map(item => item.id), ['reviewer', 'operator'], 'the Researcher is the branch\'s own author; no approval member');
  const reviewer = team.members.find(item => item.id === 'reviewer')!;
  const operatorMember = team.members.find(item => item.id === 'operator')!;
  assert.equal(reviewer.optional, true, 'the Reviewer is optional advice whose absence never blocks');
  assert.deepEqual(reviewer.resultSchema, { id: 'atcs-worker-review/3', required: ['schema', 'planSha256', 'evidenceRefs', 'limitations'] });
  assert.match(reviewer.taskTemplate, /Advisory only: nothing waits for you/);
  // #66 D7 (Harness H2a honours it): 40 minutes, four follow-ups and 12000 tokens a turn hold a batch.
  assert.deepEqual(operatorMember.budgetShare, { maxElapsedMs: 2400000, maxFollowups: 4, maxTokensPerTurn: 12000 });
  assert.equal(operatorMember.followup, 'reuse-same-child');
  assert.deepEqual(team.batchWhen, [{ input: 'workerRequest01', value: 'tc_slot_parked', equals: 1 },
    { input: 'workerRequest01', value: 'tc_request_invalid_count', above: 0 }], 'a parked or refused slot runs the batch no-op');
  assert.match(operatorMember.taskTemplate, /One operation or undo is not completion/);
  assert.match(operatorMember.taskTemplate, /actual Host budget remains/);
  assert.match(operatorMember.taskTemplate, /report missing capability precisely/);
  assert.deepEqual(operatorMember.reviewedAction, { mode: 'request-scope', planInput: 'workerRequest01', scopePath: ['candidate', 'scope'],
    commands: mutations, maxMutations: recipeCap, hostPlanHashArgument: 'planSha256' });
  // #64 M-T03-1: the Operator's task embeds its request; its template names the fields it works from
  // and the exact dump names the capture seals (#64 D-T03-2).
  assert.deepEqual(operatorMember.taskInputs, [{ input: 'workerRequest01', fields: ['operatorBrief', 'sessionPlan', 'siteCapabilities'] }]);
  // #64 T05 w03: the task holds a bounded brief; the Operator reads its exact request in bounded windows.
  assert.deepEqual(operatorMember.allowedTools, ['hima_interactive', 'hima_delegation_input']);
  assert.match(operatorMember.taskTemplate, /Use only granted input windows and typed interactive commands/);
  for (const words of [/Preserve exact planSha256, namePrefix, scope and regions/, /outside the declared domain/,
    /verify automatic before\.dump/, /Use native library candidates/, /current export with physical-risk limitations/]) {
    assert.match(operatorMember.taskTemplate, words, `the Operator template states ${words}`);
  }
  assert.equal(recipeCap, 600, '#66 D7: a batch of tens to hundreds of trials and their undos, at the Harness ceiling (H1)');
  assert.deepEqual(operatorMember.resultSchema, { id: 'atcs-worker-session/1',
    required: ['schema', 'planSha256', 'mutationReceipts', 'stopReason', 'limitations'] });
  // The Operator template is the knowledge file's expert loop, in order.
  let step = 0;
  for (const word of ['before.dump', 'atcs_ref', 'root-cause hypothesis', 'Try one coherent',
    'Measure HOLD WNS', 'keep or undo', 'after.dump', 'current export', 'atcs_close']) {
    const found = operatorMember.taskTemplate.indexOf(word, step);
    assert.ok(found >= 0, `the Operator template runs the expert loop in order; ${word} is missing after offset ${step}`);
    step = found + word.length;
  }
  assert.ok(pack.contract.knowledge.some(item => item.file === 'xtop-expert-operator.md'));
  assert.equal(packStage(packDir).stage, 'compiled');
  // The 2026-09-29 reshape (ADR-0016): plan -> six self-driving branches -> merge -> one refresh ->
  // evaluate -> automatic re-observation -> one owner decision. 136 nodes and 178 edges before.
  assert.equal(pack.graph.nodes.length, 72);
  assert.equal(pack.graph.edges.length, 86);
  assert.deepEqual((pack.graph.nodes as any[]).filter(node => node.kind === 'explore').map(node => node.id), ['decide'], 'one owner decision per generation');
  assert.deepEqual((pack.graph.nodes as any[]).filter(node => node.kind === 'wait').map(node => node.id), ['wait-for-person'], 'a person only as the honest end');
  assert.deepEqual((pack.graph as any).autopilot, [
    { from: ['bind-inputs'], until: ['plan', 'wait-for-person'] },
    { from: ['read-campaign-plan'], until: ['decide'] },
    { fork: 'prepare-workers', revisions: 2, author: { maxElapsedMs: 900000, maxFollowups: 4, maxTokensPerTurn: 48000 } },
    { from: ['check-worker-results'], until: ['compose'] },
    { from: ['prepare-lead'], until: ['timing-lead'] },
    { from: ['finalize-lead'], until: ['decide'] },
  ], 'the owner acts at plan, compose and decide only');
  // Every in-loop Judge labels all three outcomes: an UNDETERMINED never falls through to a person.
  for (const node of (pack.graph.nodes as any[]).filter(item => item.kind === 'judge' && item.id !== 'check-inputs' && item.id !== 'check-refresh-budget')) {
    const outcomes = (pack.graph.edges as any[]).filter(edge => edge.from === node.id).map(edge => edge.outcome).sort();
    assert.deepEqual(outcomes, ['FAIL', 'PASS', 'UNDETERMINED'], `${node.id} labels its outcomes`);
    assert.ok(!(pack.graph.edges as any[]).some(edge => edge.from === node.id && edge.to === 'wait-for-person'), `${node.id} never waits for a person`);
  }

  // #64 Track B (from #63 slice 2): every Explore revisit consumes a Harness generation, so
  // `generationLimit` bounds revisits, not Innovus/StarRC/PrimeTime refreshes (live02 spent both
  // generations with zero refreshes). The Run's Goal value `max_physical_refreshes` (default 2, the
  // #64 deal), fixed at Run creation, caps them: a fresh reading of the refresh ledger, then a Judge,
  // right before each physical refresh.
  assert.deepEqual((pack.contract.goal as any).max_physical_refreshes,
    { type: 'number', unit: 'count', min: 1, max: 4, default: 2, precision: 0 });
  assert.equal((pack.contract.words as any).max_physical_refreshes.unit, 'count');
  assert.deepEqual(Object.keys(pack.contract.strategy), ['maxPaths', 'workerSlots', 'autoFinish']);
  const workingState = pack.contract.outputs.find(output => output.name === 'workingState')!;
  assert.equal(workingState.reader, 'atcs-refresh-budget');
  const nodeOf = (id: string) => (pack.graph.nodes as any[]).find(node => node.id === id);
  const edgesFrom = (id: string) => (pack.graph.edges as any[]).filter(edge => edge.from === id)
    .map(edge => `${edge.outcome ?? ''}${edge.revisit ? 'revisit' : ''}->${edge.to}`).sort();
  const edgesTo = (id: string) => (pack.graph.edges as any[]).filter(edge => edge.to === id)
    .map(edge => `${edge.from}->${edge.outcome ?? ''}${edge.revisit ? 'revisit' : ''}`).sort();
  // One refresh per generation: its cap gate is read at the start of every generation, before the plan.
  assert.equal(nodeOf('read-refresh-budget').kind, 'act');
  assert.equal(nodeOf('read-refresh-budget').parameters.observes, 'workingState');
  assert.equal(nodeOf('check-refresh-budget').kind, 'judge');
  assert.deepEqual(nodeOf('check-refresh-budget').parameters.rules, ['refresh-budget']);
  assert.deepEqual(nodeOf('check-refresh-budget').parameters.bind, { max_physical_refreshes: { from: 'goal', name: 'max_physical_refreshes' } });
  assert.deepEqual(edgesFrom('read-refresh-budget'), ['->check-refresh-budget']);
  assert.deepEqual(edgesFrom('check-refresh-budget'), ['FAIL->wait-for-person', 'PASS->bind-worker-slots', 'UNDETERMINED->wait-for-person']);
  assert.deepEqual(edgesTo('read-refresh-budget'), ['common-autofix->', 'decide->revisit']);
  assert.deepEqual(edgesFrom('decide'), ['revisit->read-refresh-budget'], 'continue is the next generation from the working state');
  assert.deepEqual(edgesTo('implement'), ['finalize-lead->']);
  assert.deepEqual(edgesTo('extract'), ['implement->']);
  assert.equal(nodeOf('apr-run'), undefined, 'no earlier-APR detour');
  assert.ok(pack.contract.rules.includes('refresh-budget'));
  // #64 Track B (C28), reshaped: every generation refreshes once. #66 D9: one generation is the floor
  // (the decisive experiment is one generation, one refresh).
  assert.equal((pack.contract.budget as any).minimumGenerations, 1);
  assert.equal((pack.contract.goal as any).max_physical_refreshes.default, 2);

  // #64 Track B (from #63 slice 3 gap 1): every request output has an itemized `<output>Problems`
  // beside it (written by tools/read-atcs.py, no reader), read by the Workshop that produces it.
  for (const workshop of pack.contract.workshops) {
    const problems = pack.contract.outputs.find(output => output.name === `${workshop.produces}Problems`)!;
    const request = pack.contract.outputs.find(output => output.name === workshop.produces)!;
    assert.ok(problems, `${workshop.produces} has its Problems output`);
    assert.equal(problems.path, request.path.replace(/\.json$/, '.problems.txt'));
    assert.equal(problems.reader, undefined);
    if (workshop.id === 'compose-contributions') {
      assert.equal((workshop as any).revision, undefined, 'the owner composes once; no self-revision loop reads its own problems');
    } else {
      assert.ok(workshop.reads.includes(problems.name), `${workshop.id} reads ${problems.name}`);
    }
  }

  // Issue 63 (fresh03 `sta` blocked: "references ${MAX_PATHS}, which nothing bound"): every
  // `${NAME}` a node's tool command line uses is bound by that node or is a Harness-reserved value.
  const reserved = new Set(['WORKSPACE', 'SLOT', 'ENTRY', 'WORKSHOP', 'READER', 'REPORT', 'OUT']);
  const unbound: string[] = [];
  for (const node of pack.graph.nodes as any[]) {
    const toolId = node.parameters?.tool;
    if (typeof toolId !== 'string') continue;
    const tool = pack.contract.tools.find(item => item.id === toolId)!;
    const words = [...tool.argv, ...(tool.interactive?.argv ?? [])].join(' ');
    const bound = new Set(Object.keys(node.parameters.arguments ?? {}));
    for (const [, name] of words.matchAll(/\$\{([A-Z_]+)\}/g)) {
      if (!bound.has(name!) && !reserved.has(name!)) unbound.push(`${node.id}:${name}`);
    }
  }
  assert.deepEqual(unbound, []);

  const localCheck = checkPack(pack, loadSite(local.sitesDir, local.name));
  assert.equal(localCheck.fit, true, localCheck.errors.join('\n'));

  // `sites/linglong-atcs28/{site.yml,permit.yml}` are administrator-facing policy templates, published
  // into a Harness home's `hima/sites/` as `<name>.yml` (with the Permit beside it) exactly the way a
  // customer's CAD publishes the reference `sites/linglong/` Site (see `README.md`); `loadSite` reads
  // that published shape, not the repository's own generic filenames, so this reproduces it.
  const atcs28SourceDir = path.join(repoRoot, 'sites/linglong-atcs28');
  const atcs28SitesDir = path.join(h.home, 'reference-sites');
  await mkdir(atcs28SitesDir, { recursive: true });
  await cp(path.join(atcs28SourceDir, 'site.yml'), path.join(atcs28SitesDir, 'linglong-atcs28.yml'));
  await cp(path.join(atcs28SourceDir, 'permit.yml'), path.join(atcs28SitesDir, 'permit.yml'));
  const atcs28Site = loadSite(atcs28SitesDir, 'linglong-atcs28');
  const atcs28Check = checkPack(pack, atcs28Site);
  assert.equal(atcs28Check.fit, true, atcs28Check.errors.join('\n'));

  const interactiveTool = pack.contract.tools.find((tool) => tool.id === 'xtop-operator');
  assert.ok(interactiveTool?.interactive);
  const commandNames = Object.values(interactiveTool.interactive.commands).flat();
  for (const forbiddenCommand of ['source', 'exec', 'sh', 'bash']) {
    assert.equal(commandNames.includes(forbiddenCommand), false, `interactive catalog exposes ${forbiddenCommand}`);
  }
  // Issue #64 Task 3: the XTop expert toolkit. Reads never carry the plan hash; every mutation takes
  // it last, so a reviewed scope can name any of them.
  assert.deepEqual(interactiveTool.interactive.commands.read,
    ['atcs_ref', 'atcs_gain', 'atcs_paths', 'atcs_fail_reasons', 'atcs_candidates', 'atcs_point', 'atcs_gba']);
  assert.deepEqual(interactiveTool.interactive.commands.mutate, [
    'atcs_size_cell', 'atcs_exchange_cell', 'atcs_insert_buffer', 'atcs_insert_dummy', 'atcs_split_load',
    'atcs_split_net', 'atcs_move_cell', 'atcs_remove_buffer', 'atcs_fix_hold_pins', 'atcs_fix_setup_pins', 'atcs_undo',
    'atcs_path_pin_rank', 'atcs_legalization_range']);
  for (const command of interactiveTool.interactive.commands.mutate) {
    assert.deepEqual(interactiveTool.interactive.arguments[command]?.at(-1), { name: 'planSha256', type: 'string' },
      `${command} takes planSha256 last`);
  }
  for (const command of interactiveTool.interactive.commands.read) {
    assert.equal((interactiveTool.interactive.arguments[command] ?? []).some(item => item.name === 'planSha256'), false,
      `${command} is a read`);
  }
  const qualifiedWrapper = path.join(atcs28SourceDir, 'atcs-xtop-operator-v5.sh');
  const shellSyntax = spawnSync('/bin/bash', ['-n', qualifiedWrapper], { encoding: 'utf8' });
  assert.equal(shellSyntax.status, 0, shellSyntax.stderr);
  const wrapperText = await readFile(qualifiedWrapper, 'utf8');
  assert.match(wrapperText, /verify-worker-startup/);
  assert.match(wrapperText, /--profile-hash/);

  // No tool or workshop argv may reference the frozen old pack's design-zoo Foundation root or its
  // own Site's workspace-root folder name -- this Pack's own argv is workspace-relative only
  // (`${WORKSPACE}`-bound), never a literal path into another Pack's Site.
  const forbidden = [/\/data\/eda\/project\/design_zoo/, /xtop-timing-closure-runs/];
  const argvWords: string[] = [];
  for (const tool of pack.contract.tools) {
    argvWords.push(...tool.argv);
    if (tool.interactive?.argv) argvWords.push(...tool.interactive.argv);
  }
  for (const workshop of pack.contract.workshops) argvWords.push(...workshop.argv);
  for (const word of argvWords) {
    for (const pattern of forbidden) assert.doesNotMatch(word, pattern, `argv word "${word}" references a forbidden path`);
  }

  // The reshape removed the owner's in-loop decisions: no next-decision or observation-request
  // Workshop, Reader or output remains, and no rule routes on them.
  for (const gone of ['nextDecision', 'observationRequest', 'aprTask']) {
    assert.equal(pack.contract.outputs.find(output => output.name === gone), undefined, `${gone} is gone`);
  }
  assert.deepEqual(pack.contract.workshops.map(item => item.id).filter(id => !/^research-worker-\d\d$/.test(id)), ['plan-campaign', 'compose-contributions']);
  // Each branch Workshop declares its revision: a refused request is revised by the branch's author.
  for (const slot of slots) {
    const workshop = pack.contract.workshops.find(item => item.id === `research-worker-${slot.slice(1)}`)! as any;
    assert.deepEqual(workshop.revision, { refusedWhen: 'tc_request_invalid_count', problems: `workerRequest${slot.slice(1)}Problems` });
  }
  const teamKnowledge = await readFile(path.join(repoRoot, 'packs', packId, 'knowledge/agent-team.md'), 'utf8');
  assert.match(teamKnowledge, /the owner takes none/);
  assert.match(teamKnowledge, /Reviewer: optional and advisory/);

  installPackMethod({ from: packDir, to: path.join(h.home, 'hima/packs', packId) });
  const host = await bootInProcess(h);
  try {
    const throughHost = await himaCommand(host, h.workspace, `/hima pack check ${packId} --site local`);
    assert.equal(throughHost.kind, 'success', throughHost.text);
    assert.match(throughHost.text, /agentic-timing-closure-system@0\.2\.10.*fit/s);
  } finally { await host.dispose(); }

  const tests = spawnSync('python3', ['-m', 'unittest',
    'test_owner_timing_lead.py', 'test_engineering_result.py', 'test_resident_native_context.py', '-v'], {
    cwd: path.join(packDir, 'flow/tests'),
    env: { ...process.env, HIMA_TEST_REPO_ROOT: repoRoot },
    encoding: 'utf8',
  });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});

test('the retained interactive binding generator refuses to qualify the new outsourced Pack as an old Operator startup', async (t) => {
  // Issue #64 Task 7 fix round 1: the atcs-v10 binding came out as `linglong-atcs28:xtop-operator-v5`.
  const h = await createHimaHome(); t.after(() => h.dispose());
  const legacyPacksDir = path.join(h.home, 'legacy-packs');
  await copyLegacyAtcsPack(legacyPacksDir);
  const pack = loadPack(legacyPacksDir, 'agentic-timing-closure-system');
  const tool = pack.contract.tools.find((candidate) => candidate.id === 'xtop-operator')!;
  const wrapper = tool.interactive?.argv?.[0] ?? '';
  const version = /atcs-v(\d+)\/atcs-xtop-operator-v\1\.sh$/.exec(wrapper)?.[1];
  assert.ok(version, `the contract names an installed atcs-vN wrapper: ${wrapper}`);
  const { packDigestExcludes } = await import('@hima/harness');
  const template = await readFile(path.join(repoRoot, `sites/linglong-atcs28/xtop-operator-environment-v${version}.template.json`), 'utf8');
  const evidence = template
    .replace('<current-pack-digest>', pack.folder.digest(packDigestExcludes))
    .replace('<current-adapter-digest>', BUILTIN_TCL_ADAPTER_DIGEST)
    .replace('<current-commands-digest>', interactiveCommandsDigest(tool))
    .replace('<passed-after-fresh-production-root-qualification>', 'passed')
    .replaceAll('<64-lowercase-hex>', 'a'.repeat(64));
  assert.equal(JSON.parse(evidence).wrapper.path, wrapper, 'the environment template names the contract wrapper');
  const environment = path.join(h.home, 'xtop-operator-environment.json');
  const output = path.join(h.home, 'interactive-bindings.json');
  await writeFile(environment, evidence);
  const generated = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/generate-xtop-operator-binding.mjs'),
    '--environment', environment, '--output', output], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(generated.status, 1);
  assert.match(generated.stderr, /current retained XTop Pack has no matching production Operator startup/);
});
