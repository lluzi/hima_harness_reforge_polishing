import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, appendFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { loadPack, checkPack, loadSite, packStage, installPackMethod } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeMomentScenario } from './support/moments.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { retainRunMaterial, runDelegations, BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest } from '@hima/harness';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'agentic-timing-closure-system';
test('ATCS forks six worker branches: slot w01\'s Team runs its expert session, parked slots pass as no-ops, and the join collects every slot', async t => {
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  const prior = process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'atcs-local';
  t.after(() => { if (prior === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = prior; });
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const h = { ...local.h, workspace: await realpath(local.h.workspace) };
  const packsDir = path.join(h.home, 'hima/packs');
  const variant = path.join(packsDir, packId);
  await cp(path.join(repoRoot, 'packs', packId), variant, { recursive: true });
  const contract = parse(await readFile(path.join(variant, 'contract.yml'), 'utf8')) as any;
  const wrapper = await realpath('/usr/bin/tclsh');
  contract.environment.wrappers = [wrapper, 'python3', '/usr/bin/python3'];
  contract.budget.closingReserveMs = 1000;
  contract.workspace.copy.push('atcs-repl.tcl');
  const tool = contract.tools.find((item: any) => item.id === 'xtop-operator');
  // The interactive session is the synthetic REPL for slot w01; the batch path stays the Pack's own
  // `operate-parked` no-op, which is how a parked slot's operate node settles without XTop.
  tool.interactive.argv = [wrapper, '${WORKSPACE}/flow/atcs-repl.tcl', '${WORKSPACE}/workspaces/w01/r1'];
  tool.licences = {};
  for (const member of contract.agentTeams[0].members) member.budgetShare.maxElapsedMs = 10000;
  await writeFile(path.join(variant, 'contract.yml'), stringify(contract));
  const graph = parse(await readFile(path.join(variant, 'graph.yml'), 'utf8')) as any;
  graph.entry = 'prepare-workers'; // Start at the fork; pre-EDA preparation is separately Python-tested.
  await writeFile(path.join(variant, 'graph.yml'), stringify(graph));
  await cp(path.join(repoRoot, 'test/fixtures/interactive-job/atcs-repl.tcl'), path.join(variant, 'flow/atcs-repl.tcl'));
  const capsPath = path.join(h.workspace, 'caps.json');
  const site = await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper, 'python3', '/usr/bin/python3'], licences: { xtop: 2, innovus: 1, primetime: 1, starrc: 1 },
    bindings: { designStateManifest: path.join(h.workspace, 'manifest.json'),
      analysisContract: path.join(h.workspace, 'analysis'), siteCapabilities: capsPath,
      workspaceRoot: h.workspace },
  });
  const pack = loadPack(packsDir, packId);
  const digest = pack.folder.digest((await import('@hima/harness')).packDigestExcludes);
  const admin = path.join(h.home, 'admin'); await mkdir(admin);
  const environmentFile = path.join(admin, 'environment.json');
  const environment = {
    schema: 'hima-interactive-environment/1', site: 'local', toolId: tool.id,
    pack: { id: packId, digest }, adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST },
    commandsDigest: interactiveCommandsDigest(pack.contract.tools.find(item => item.id === tool.id)!),
    wrapper: { path: wrapper, sha256: createHash('sha256').update(await readFile(wrapper)).digest('hex') },
    image: { reference: 'local/atcs-test', digest: 'sha256:' + '0'.repeat(64) },
    sourceTemplate: { path: 'flow/templates/xtop-operator.tcl',
      sha256: createHash('sha256').update(await readFile(path.join(variant, 'flow/templates/xtop-operator.tcl'))).digest('hex') },
    confinement: { rootFilesystem: 'read-only', dataRoot: '/', dataMount: 'read-only',
      privateWriteRoot: await realpath(h.workspace), network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
    qualification: { status: 'passed', transcriptSha256: '1'.repeat(64), logicalEcoSha256: '2'.repeat(64),
      physicalEcoSha256: '3'.repeat(64), xtopReady: true, identityQuery: true, mutation: true, save: true,
      sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
  };
  const environmentText = JSON.stringify(environment);
  await writeFile(environmentFile, environmentText);
  const bindingsFile = path.join(admin, 'bindings.json');
  await writeFile(bindingsFile, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [{
    id: 'atcs-local', site: 'local', packDigest: digest, toolId: tool.id,
    adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST,
    commandsDigest: environment.commandsDigest, environment: { id: 'atcs-local', file: environmentFile,
      sha256: createHash('sha256').update(environmentText).digest('hex') }, mutation: 'qualified',
  }] }));
  await appendFile(path.join(h.profileDir, 'cordis.patch.yml'), '\n- id: hima\n  config:\n    sitesDir: ' + JSON.stringify(site.sitesDir)
    + '\n    packsDir: ' + JSON.stringify(packsDir) + '\n    knowledgeDir: ' + JSON.stringify(path.join(h.home, 'hima/knowledge/current'))
    + '\n    interactiveBindingsFile: ' + JSON.stringify(bindingsFile) + '\n');
  const replay = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: replay.file, overrideFile: replay.override, childFiles: replay.children });
  const host = await bootInProcess(h); let cleanupRunId: string | undefined;
  t.after(async () => { if (cleanupRunId) await host.ctx.hima.cancelRun(cleanupRunId); await host.dispose(); await h.dispose(); });
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local',
    goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0 }, ownerSessionId: actor, timeBoxMs: 300000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  const runId = started.run.id; cleanupRunId = runId;
  const workspace = started.workspace;
  assert.ok(workspace);
  // Real Pack producers seed the base, the XTop context and one admitted campaign plan: slot w01
  // works one blocker cluster and w02..w06 are parked. All files are synthetic.
  const seeded = spawnSync('python3', ['-c', [
    'import sys,json; from pathlib import Path',
    'sys.path.insert(0,sys.argv[1]); sys.path.insert(0,sys.argv[2])',
    // The stub XTop session (test/fixtures/interactive-job/atcs-repl.tcl) reports one scenario, func_ss,
    // so that is the required scenario whose rows the capture's gain gates read (Task 7 fix round 1).
    'import test_cli_state as f; from atcs import core,state,workspaces',
    'w=Path(sys.argv[3]); manifest=f._make_baseline_manifest(w)',
    'base=state.design_state(manifest); core.write_artifact(w/"state/working-state.json",base)',
    'caps={"design":"top","techLef":"tech.lef","cellLefGlob":"*.lef","pgVerification":False,**f._write_xtop_context(w,base["id"],("func_ss",))}',
    'f._write_json(Path(sys.argv[4]),caps)',
    'active={"taskId":"w01","baseStateId":base["id"],"problem":"synthetic sizing","targets":[],"editDomain":{"instances":["U1"],"nets":[],"regions":[]},"protected":{"instances":[],"nets":[]},"mayAffect":[],"actions":["size_cell"],"budget":{"xtopMinutes":1,"queries":1,"attempts":1},"targetPins":["U1/A"],"scope":{"commands":list(workspaces.MUTATE_COMMANDS),"maxMutations":workspaces.SCOPE_MAX_MUTATIONS}}',
    'packages={s:({"taskId":s,"baseStateId":base["id"],"parked":True,"problem":"one blocker cluster; slot "+s+" has none"} if s!="w01" else active) for s in workspaces.TASK_IDS}',
    'f._write_json(w/"research/requests/campaign-plan.json",{"candidate":{"workPackages":packages,"reason":"one blocker cluster"},"baseState":base,"siteCapabilities":{"pgVerification":False}})',
    '[f._write_json(w/"seed"/("worker-request-"+s+".json"),{"candidate":p,"baseState":base,"siteCapabilities":{"pgVerification":False}}) for s,p in packages.items()]',
  ].join('\n'), path.join(repoRoot, 'packs', packId, 'flow'),
    path.join(repoRoot, 'packs', packId, 'flow/tests'), workspace, capsPath], { encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);

  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const context = () => host.ctx.hima.executionContext(runId);
  const records = () => host.ctx.hima.ledger.records({ runId });
  let serial = 0;
  const act = (action: string, fields: Record<string, unknown> = {}) => host.ctx.hima.executionAction({ runId, actor,
    action: action as never, requestId: `atcs-${++serial}`, expectedEpoch: control().epoch, expectedRevision: control().revision, ...fields });
  const begin = async (nodeId: string): Promise<string> => {
    const begun = await act('begin', { nodeId });
    assert.equal(begun.kind, 'accepted', `begin ${nodeId}: ${JSON.stringify(begun)}`);
    return begun.receipt!.executionId!;
  };
  const workAndComplete = async (nodeId: string, id: string) => {
    const work = await act('work', { executionId: id });
    assert.equal(work.kind, 'accepted', `work ${nodeId}: ${JSON.stringify(work)}`);
    await waitUntil('ATCS node settles: ' + nodeId, () => ['ready', 'failed'].includes(control().executions[id]?.phase ?? ''), 20000, 25);
    assert.equal(control().executions[id]?.phase, 'ready', `${nodeId}: ${JSON.stringify(control().executions[id])}`);
    const done = await act('complete', { executionId: id });
    assert.equal(done.kind, 'accepted', `complete ${nodeId}: ${JSON.stringify(done)}`);
  };
  const node = async (nodeId: string) => { const id = await begin(nodeId); await workAndComplete(nodeId, id); return id; };
  const slots = ['w01', 'w02', 'w03', 'w04', 'w05', 'w06'];
  const nn = (slot: string) => slot.slice(1);

  // The fork opens at prepare-workers: six branches, one per slot, and nothing launched on its own.
  await node('prepare-workers');
  assert.deepEqual([...context().available].sort(), slots.map(slot => `research-worker-${nn(slot)}`));
  assert.ok(context().run.fork, 'the Run stands inside the worker fork');
  const workers = JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8'));
  assert.deepEqual(workers.requiredSlots, slots);
  assert.deepEqual(slots.filter(slot => workers.workers[slot].parked === true), slots.slice(1));

  // Each branch's Workshop writes its own slot's request, and its own Reader admits it.
  for (const slot of slots) {
    const id = await begin(`research-worker-${nn(slot)}`);
    assert.equal((await act('recommend', { executionId: id })).kind, 'accepted');
    const entry = `import shutil, sys\nshutil.copyfile(sys.argv[1] + "/seed/worker-request-${slot}.json", sys.argv[1] + "/research/requests/worker-request-${slot}.json")\n`;
    const written = await act('write', { executionId: id, path: 'entry.py', content: entry });
    assert.equal(written.kind, 'accepted', JSON.stringify(written));
    await workAndComplete(`research-worker-${nn(slot)}`, id);
    await node(`read-worker-request-${nn(slot)}`);
    const reading = records().findLast(record => record.type === 'observation' && record.reader.id === `atcs-worker-request-${nn(slot)}`);
    assert.ok(reading?.type === 'observation');
    assert.equal(reading.branchId, `research-worker-${nn(slot)}`, `slot ${slot}'s request is read in its own branch`);
    assert.deepEqual(reading.values.map(value => [value.type, value.value]), [['tc_request_invalid_count', 0]], `slot ${slot}'s request is admitted`);
  }
  assert.deepEqual([...context().available].sort(), slots.map(slot => `operate-worker-${nn(slot)}`));

  // A parked slot's operate node is the Pack's batch no-op: no Team, no interactive session, no XTop.
  for (const slot of slots.slice(1)) await node(`operate-worker-${nn(slot)}`);
  for (const slot of slots.slice(1)) {
    const receipt = JSON.parse(await readFile(path.join(workspace, workers.workers[slot].root, 'parked.json'), 'utf8'));
    assert.equal(receipt.taskId, slot);
  }
  assert.equal(runDelegations((host.ctx.hima as any).deps(), runId).length, 0, 'no Team member is created for a parked slot');

  // Slot w01's Team approves an expert scope and its Operator mutates only inside it.
  const planReading = records().findLast(record => record.type === 'observation' && record.reader.id === 'atcs-worker-request-01');
  assert.ok(planReading?.type === 'observation');
  const planHash = planReading.contentSha256;
  assert.equal(planHash, createHash('sha256').update(await readFile(path.join(workspace, 'research/requests/worker-request-w01.json'))).digest('hex'));
  const executionId = await begin('operate-worker-01');
  const create = (memberId: string) => host.ctx.hima.delegate({ runId, actor, action: 'create', requestId: 'create-' + memberId,
    expectedEpoch: control().epoch, expectedRevision: control().revision,
    recipe: { teamId: 'atcs-worker-01', version: '4', memberId, executionId } } as never) as Promise<any>;
  // Deterministic model stand-ins use the production Ledger handoff shape; no model-quality claim.
  const resultAndAdopt = async (child: any, value: any) => {
    const id = child.effectiveContract.delegationId;
    const row = runDelegations((host.ctx.hima as any).deps(), runId).find(item => item.delegationId === id)!;
    const text = JSON.stringify(value);
    const record = await host.ctx.hima.ledger.appendDelegation(runId, { delegationId: id, parentSessionId: actor,
      childSessionId: row.childSessionId, requestId: 'result-' + id, requestDigest: 'a'.repeat(64),
      event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
        outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
        contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
        output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
        unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['synthetic model result'] },
      } } });
    const adoption = await host.ctx.hima.delegate({ runId, actor, action: 'adopt', delegationId: id,
      resultRecordId: record.id, requestId: 'adopt-' + id,
      expectedEpoch: control().epoch, expectedRevision: control().revision } as never) as any;
    assert.equal(adoption.status, 'accepted', JSON.stringify(adoption));
  };
  const researcher = await create('researcher'); assert.equal(researcher.status, 'created', JSON.stringify(researcher));
  assert.deepEqual(researcher.effectiveContract.inputRefs, [planReading.id], 'the Researcher reads its own slot\'s request');
  await resultAndAdopt(researcher, { schema: 'atcs-worker-research/1', hypotheses: ['synthetic sizing'],
    evidenceRefs: researcher.effectiveContract.inputRefs, limitations: ['no EDA'] });
  const reviewer = await create('reviewer'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
  // The Reviewer approves a scope: two of the recipe's mutations and a budget below the recipe cap.
  await resultAndAdopt(reviewer, { schema: 'atcs-worker-review/2', planSha256: planHash,
    scope: { commands: ['atcs_size_cell', 'atcs_undo'], maxMutations: 2 },
    evidenceRefs: reviewer.effectiveContract.inputRefs, limitations: ['no EDA'] });
  const operator = await create('operator'); assert.equal(operator.status, 'created', JSON.stringify(operator));
  const operatorId = operator.receipt.childSessionId;
  const interactive = (body: any) => host.ctx.hima.interactive(operatorId, { runId, executionId,
    nodeId: 'operate-worker-01', ownerEpoch: control().epoch, controlRevision: control().revision, ...body }) as Promise<any>;
  const opened = await interactive({ action: 'open', requestId: 'open' }); assert.equal(opened.status, 'opened', JSON.stringify(opened));
  const toolSessionId = opened.session.toolSessionId;
  const slotRoot = path.join(workspace, 'workspaces/w01/r1');
  const send = async (name: string, args: any, id: string) => {
    const value = await interactive({ action: 'input', requestId: id, commandId: id, toolSessionId,
      command: { name, args }, waitMs: 1000 });
    assert.equal(value.status, 'completed', JSON.stringify(value)); return value;
  };
  await send('atcs_dump_cells', { path: path.join(slotRoot, 'before.dump') }, 'before');
  await send('atcs_ref', {}, 'reference');
  // Outside the approved scope, or under another plan hash, the Host refuses before the tool sees it.
  const outsideScope = await interactive({ action: 'input', requestId: 'outside', commandId: 'outside', toolSessionId,
    command: { name: 'atcs_remove_buffer', args: { instance: 'U1', planSha256: planHash } }, waitMs: 0 });
  assert.equal(outsideScope.status, 'refused', JSON.stringify(outsideScope));
  assert.match(outsideScope.reason, /outside the immutable owner-adopted reviewed scope/);
  const staleHash = await interactive({ action: 'input', requestId: 'stale', commandId: 'stale', toolSessionId,
    command: { name: 'atcs_size_cell', args: { instance: 'U1', toMaster: 'BUF2', planSha256: 'f'.repeat(64) } }, waitMs: 0 });
  assert.equal(staleHash.status, 'refused', JSON.stringify(staleHash));
  await send('atcs_size_cell', { instance: 'U1', toMaster: 'BUF2', planSha256: planHash }, 'mutation');
  const duplicate = await interactive({ action: 'input', requestId: 'mutation', commandId: 'mutation', toolSessionId,
    command: { name: 'atcs_size_cell', args: { instance: 'U1', toMaster: 'BUF2', planSha256: planHash } }, waitMs: 0 });
  assert.equal(duplicate.status, 'duplicate');
  await send('atcs_dump_cells', { path: path.join(slotRoot, 'after.dump') }, 'after');
  await send('atcs_export_changes', {}, 'export');
  await send('atcs_close', {}, 'exit');
  await waitUntil('ATCS synthetic Operator is ready', () => control().executions[executionId]?.phase === 'ready', 5000, 25);
  await resultAndAdopt(operator, { schema: 'atcs-worker-session/1', planSha256: planHash, mutationReceipts: ['mutation'],
    stopReason: 'no-candidate-gains', limitations: ['synthetic Tcl; no commercial qualification'] });
  const completed = await act('complete', { executionId });
  assert.equal(completed.kind, 'accepted', JSON.stringify(completed));
  const interactiveJobs = records().filter(record => record.type === 'job' && record.event === 'launched' && record.nodeId?.startsWith('operate-worker-'));
  assert.deepEqual(interactiveJobs.map(record => record.type === 'job' ? [record.nodeId, record.branchId] : []).sort(),
    slots.map(slot => [`operate-worker-${nn(slot)}`, `research-worker-${nn(slot)}`]), 'each operate Job runs in its own branch');

  // Every branch captures and reads its own result; the join then judges all six.
  for (const slot of slots) {
    await node(`capture-worker-${nn(slot)}`);
    await node(`read-worker-result-${nn(slot)}`);
  }
  assert.deepEqual(context().available, ['check-worker-results']);
  await node('check-worker-results');
  assert.equal(context().run.fork, undefined, 'the join closed the fork');
  assert.deepEqual(records().filter(record => record.type === 'verdict').map(record => record.type === 'verdict' ? [record.branchId, record.ruleId, record.outcome] : []),
    slots.map(slot => [`research-worker-${nn(slot)}`, 'worker-result-admissible', 'PASS']), 'the join judged each slot\'s sealed result');
  assert.deepEqual(context().available, ['collect']);
  await node('collect');

  const joined = JSON.parse(await readFile(path.join(workspace, 'state/contributions-collected.json'), 'utf8'));
  assert.deepEqual(joined.pending, [], 'every slot, active or parked, sealed a Contribution');
  assert.deepEqual(joined.contributions.map((item: any) => item.taskId).sort(), slots);
  const session = joined.contributions.find((item: any) => item.taskId === 'w01');
  assert.equal(session.kind, 'xtop-session');
  assert.equal(session.admissible, true, JSON.stringify(session.refusals));
  assert.deepEqual(session.commands.map((command: any) => [command.proc, command.args.toMaster]), [['atcs_size_cell', 'BUF2']]);
  assert.deepEqual(session.delta.mastersChanged, { U1: ['BUF1', 'BUF2'] });
  for (const parked of joined.contributions.filter((item: any) => item.taskId !== 'w01')) {
    assert.deepEqual([parked.kind, parked.parked, parked.admissible, parked.operations.length], ['no-fix', true, true, 0], parked.taskId);
  }
  assert.equal((await readFile(path.join(slotRoot, 'ops.jsonl'), 'utf8')).trim().split('\n').length, 1);
  assert.equal((await readFile(path.join(slotRoot, 'gain.jsonl'), 'utf8')).trim().split('\n').length, 2, 'the session reference and one mutation reading');
});
const atcsXtopOperatorWrapper = '/data/eda/project/hima_harness/operator-admin/atcs-v10/atcs-xtop-operator-v10.sh';

test('the agentic timing closure system Pack loads, fits linglong-atcs28 and the local Site, and passes its Python contract tests', async (t) => {
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

  const packDir = path.join(repoRoot, 'packs', packId);
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  // Issue #64 Task 4: every worker slot's Team is v4 in Harness scope mode. The Reviewer approves
  // `{scope: {commands, maxMutations}, planSha256}` within the recipe; the Operator runs the expert loop.
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
    .map(edge => [edge.outcome, edge.to]).sort(), [['FAIL', 'collect'], ['PASS', 'collect']],
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
  // The `workerSlots` knob (1..6, default 6) is bound for the plan Reader on every way into `plan`.
  assert.deepEqual(pack.contract.strategy.workerSlots, { type: 'number', unit: 'slots', min: 1, max: 6, default: 6 });
  assert.deepEqual(operatorNode('bind-worker-slots').parameters,
    { tool: 'worker-slots', arguments: { WORKER_SLOTS: { from: 'strategy', name: 'workerSlots' } } });
  assert.deepEqual((pack.graph.edges as any[]).filter(edge => edge.to === 'plan').map(edge => edge.from), ['bind-worker-slots']);
  // Issue #64 Task 6: the `autoFinish` knob (0/1, default 1) reaches `replay-prepare` as its 4th argument.
  assert.deepEqual(operatorNode('replay-prepare').parameters.arguments.AUTO_FINISH, { from: 'strategy', name: 'autoFinish' });
  const replayPrepare = pack.contract.tools.find(item => item.id === 'replay-prepare')!;
  assert.ok(replayPrepare.inputs.includes('AUTO_FINISH'));
  assert.equal(replayPrepare.argv[replayPrepare.argv.length - 1], '${AUTO_FINISH}');
  assert.deepEqual((pack.graph.edges as any[]).filter(edge => edge.to === 'bind-worker-slots').map(edge => [edge.from, edge.revisit === true]).sort(),
    [['revisit-research', true], ['risk-query', false]]);
  const planner = pack.contract.workshops.find(item => item.id === 'plan-campaign')!;
  for (const words of [/parked/, /workerSlots/, /worst setup check and the worst hold check/, /targetPins/, /share no instance/, /check key in the slot.s targets/, /share no edit-domain net/, /fail reasons/]) {
    assert.match(planner.purpose, words, `plan-campaign purpose states ${words}`);
  }
  assert.doesNotMatch(planner.purpose, /may share edit-domain nets/, 'US8: active slots are disjoint in nets as well as instances');
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
  for (const team of workerTeams) {
    const slot = team.id.slice(-2);
    assert.equal(team.triggerNode, `operate-worker-${slot}`);
    assert.equal(slotless(team, slot), slotless(team01, '01'), `${team.id} is Team 01 for slot w${slot}`);
  }
  const team = team01;
  assert.equal(team.version, '4');
  const researcher = team.members.find(item => item.id === 'researcher')!;
  const reviewer = team.members.find(item => item.id === 'reviewer')!;
  const operatorMember = team.members.find(item => item.id === 'operator')!;
  assert.equal(researcher.budgetShare.maxTokensPerTurn, 8000);
  assert.equal(researcher.budgetShare.maxFollowups, 1);
  assert.match(researcher.taskTemplate, /targetPins/);
  assert.match(researcher.taskTemplate, /fail reason/);
  for (const [member, followups] of [[reviewer, 1], [operatorMember, 0]] as const) {
    assert.equal(member.budgetShare.maxTokensPerTurn, 5000);
    assert.equal(member.budgetShare.maxFollowups, followups);
  }
  assert.deepEqual(reviewer.resultSchema, { id: 'atcs-worker-review/2',
    required: ['schema', 'planSha256', 'scope', 'evidenceRefs', 'limitations'] });
  assert.match(reviewer.taskTemplate, /atcs_undo/);
  // Review fix round 1: only Host refusals are free; a toolkit refusal spends one approved mutation,
  // so the Reviewer sizes the budget to the loop (trials, their undos and refusals), not a token count.
  assert.match(reviewer.taskTemplate, /trials[^.]*undo[^.]*refusals/);
  assert.doesNotMatch(operatorMember.taskTemplate, /refused call costs nothing/);
  assert.match(operatorMember.taskTemplate, /Host refus[^.]*free/);
  assert.match(operatorMember.taskTemplate, /toolkit refus[^.]*costs one approved mutation/);
  assert.deepEqual(operatorMember.reviewedAction, { mode: 'scope', fromRole: 'reviewer', planInput: 'workerRequest01',
    commands: mutations, maxMutations: recipeCap, hostPlanHashArgument: 'planSha256', planHashField: 'planSha256',
    scopeField: 'scope' });
  assert.equal(recipeCap, 120, 'the recipe cap leaves room for dozens of trials and their undos, below the Harness 200');
  assert.deepEqual(operatorMember.resultSchema, { id: 'atcs-worker-session/1',
    required: ['schema', 'planSha256', 'mutationReceipts', 'stopReason', 'limitations'] });
  // The Operator template is the knowledge file's expert loop, in order.
  let step = 0;
  for (const word of ['before.dump', 'atcs_ref', 'atcs_paths', 'atcs_fail_reasons', 'atcs_gain', 'atcs_undo', 'after.dump',
    'atcs_export_changes', 'atcs_close']) {
    const found = operatorMember.taskTemplate.indexOf(word, step);
    assert.ok(found >= 0, `the Operator template runs the expert loop in order; ${word} is missing after offset ${step}`);
    step = found + word.length;
  }
  assert.ok(pack.contract.knowledge.some(item => item.file === 'xtop-expert-operator.md'));
  assert.equal(packStage(packDir).stage, 'compiled');
  assert.equal(pack.graph.nodes.length, 132);
  // Final review (Minor): +2 edges -- check-setup-goal/check-hold-goal each gain
  // an explicit UNDETERMINED edge to `residual` (an unknown final WNS is an
  // evidence gap, not a person-facing wait) instead of falling through to the
  // engine's own unlabelled-UNDETERMINED default (wait-for-person).
  assert.equal(pack.graph.edges.length, 172);

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
    ['atcs_ref', 'atcs_gain', 'atcs_paths', 'atcs_fail_reasons', 'atcs_candidates']);
  assert.deepEqual(interactiveTool.interactive.commands.mutate, [
    'atcs_size_cell', 'atcs_exchange_cell', 'atcs_insert_buffer', 'atcs_insert_dummy', 'atcs_split_load',
    'atcs_split_net', 'atcs_move_cell', 'atcs_remove_buffer', 'atcs_fix_hold_pins', 'atcs_fix_setup_pins', 'atcs_undo']);
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

  // The next-decision Reader (tools/read-atcs.py) refuses stateRef/observationRef that are not a
  // 20-hex artifact `id` and a budgetRef that is not a string; the Workshop purpose must say so, or
  // the Researcher guesses (Issue 63: objects of 64-hex content hashes, request-admissible FAIL).
  const decider = pack.contract.workshops.find((w: { produces?: string }) => w.produces === 'nextDecision');
  assert.ok(decider, 'a workshop produces nextDecision');
  assert.match(decider.purpose, /stateRef is the `id` \(20 lowercase hex\) of state\/working-state\.json/);
  assert.match(decider.purpose, /observationRef is the `id` \(20 lowercase hex\) of the observation/);
  assert.match(decider.purpose, /budgetRef is a non-empty string/);

  // A Team member whose reply is not exactly one JSON object is refused before result-observed, and its
  // delegation id is fixed per execution, so without one same-child follow-up the Team can never
  // complete and the execution stays begun (Issue 63: a reviewer reply missing one closing bracket).
  const workerTeam = pack.contract.agentTeams.find((t: { id: string }) => t.id === 'atcs-worker-01');
  for (const role of ['researcher', 'reviewer']) {
    const member = workerTeam.members.find((m: { id: string }) => m.id === role);
    assert.equal(member.followup, 'reuse-same-child', `${role} allows one repair follow-up`);
    assert.equal(member.budgetShare.maxFollowups, 1, `${role} allocates exactly one follow-up`);
    assert.match(member.taskTemplate, /If the owner returns a refusal of your reply, answer with the corrected single JSON object only/);
  }
  // The owner must know to use that follow-up, or it escalates a formatting refusal to a person.
  const teamKnowledge = await readFile(path.join(repoRoot, 'packs', packId, 'knowledge/agent-team.md'), 'utf8');
  assert.match(teamKnowledge, /The recipe allows one\nfollow-up to the same child/);

  installPackMethod({ from: packDir, to: path.join(h.home, 'hima/packs', packId) });
  const host = await bootInProcess(h);
  try {
    const throughHost = await himaCommand(host, h.workspace, `/hima pack check ${packId} --site local`);
    assert.equal(throughHost.kind, 'success', throughHost.text);
    assert.match(throughHost.text, /agentic-timing-closure-system@0\.2\.0.*fit/s);
  } finally { await host.dispose(); }

  const tests = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(packDir, 'flow/tests'), '-v'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});

test('the admin generator labels the ATCS binding with the installed wrapper version, not a fixed one', async (t) => {
  // Issue #64 Task 7 fix round 1: the atcs-v10 binding came out as `linglong-atcs28:xtop-operator-v5`.
  const h = await createHimaHome(); t.after(() => h.dispose());
  const pack = loadPack(path.join(repoRoot, 'packs'), 'agentic-timing-closure-system');
  const tool = pack.contract.tools.find((candidate) => candidate.id === 'xtop-operator')!;
  const wrapper = tool.interactive!.argv[0]!;
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
  assert.equal(generated.status, 0, generated.stderr);
  const document = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(document.bindings[0].environment.id, `linglong-atcs28:xtop-operator-v${version}`);
  assert.match(document.bindings[0].id, new RegExp(`^linglong-atcs28:xtop-operator-v${version}:`));
});
