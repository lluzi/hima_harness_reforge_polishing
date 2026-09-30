import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, appendFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { loadPack, checkPack, loadSite, packStage, installPackMethod, strategyFrom } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeMomentScenario } from './support/moments.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { retainRunMaterial, runDelegations, BUILTIN_TCL_ADAPTER_DIGEST, WORKSHOP_ENTRY_SCHEMA, interactiveCommandsDigest } from '@hima/harness';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'agentic-timing-closure-system';
test('ATCS forks six self-driving worker branches: each branch\'s child authors its request, a refused request is revised in its own branch, slot w01\'s Operator works from its embedded request, parked slots pass as no-ops, and the join collects every slot with no owner turn inside the fork', async t => {
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  const prior = { binding: process.env.HIMA_TEST_INTERACTIVE_BINDING_ID, results: process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS };
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'atcs-local';
  // Every branch child is played by this test through the Ledger's production handoff shape.
  process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS = 'ledger';
  t.after(() => {
    if (prior.binding === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID; else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = prior.binding;
    if (prior.results === undefined) delete process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS; else process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS = prior.results;
  });
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
  for (const member of contract.agentTeams[0].members) member.budgetShare.maxElapsedMs = 60000;
  await writeFile(path.join(variant, 'contract.yml'), stringify(contract));
  const graph = parse(await readFile(path.join(variant, 'graph.yml'), 'utf8')) as any;
  // Start at the fork, which the owner opens here; pre-EDA preparation and the plan are the dry
  // path's and the Pack's Python tests'. The fork and the join-to-compose segment stay self-driving.
  graph.entry = 'prepare-workers';
  graph.autopilot = graph.autopilot.filter((item: any) => item.fork !== undefined || item.from?.[0] === 'check-worker-results');
  assert.equal(graph.autopilot.length, 2);
  // Each author's share is sized for this test's time box: six authors and an Operator are charged
  // against the Run's delegation time, and the Pack's own 15-minute share is a live Campaign's.
  graph.autopilot.find((item: any) => item.fork !== undefined).author.maxElapsedMs = 60000;
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
  t.after(async () => { if (cleanupRunId) { try { await host.ctx.hima.cancelRun(cleanupRunId); } catch { /* ended */ } } await host.dispose(); await h.dispose(); });
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  // #64 Track B (C28), reshaped 2026-09-29: one generation cannot reach the default two refreshes; the
  // Pack declares budget.minimumGenerations 2 and the Harness refuses such a Run at creation.
  await assert.rejects(host.ctx.hima.startRun({ pack: packId, site: 'local', goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0, max_physical_refreshes: 2 },
    ownerSessionId: actor, timeBoxMs: 300000, generationLimit: 1 }), /generation limit is 1, but Pack agentic-timing-closure-system declares it needs at least 2 generations/);
  // #64 Track B (from #63): the physical-refresh cap is a Goal value fixed when the Run is created.
  // 3, not the default 2, so the assertions below prove the creation value reached the Run's goal and
  // is what the refresh-budget Judge binds.
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local',
    goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0, max_physical_refreshes: 3 }, ownerSessionId: actor, timeBoxMs: 1_800_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  const runId = started.run.id; cleanupRunId = runId;
  const createdRun = host.ctx.hima.ledger.run(runId)!;
  assert.equal(createdRun.goal?.max_physical_refreshes, 3);
  assert.equal(createdRun.strategy?.max_physical_refreshes, undefined);
  const reference = (pack.graph.nodes.find(node => node.id === 'check-refresh-budget') as any).parameters.bind.max_physical_refreshes;
  assert.deepEqual(reference, { from: 'goal', name: 'max_physical_refreshes' });
  assert.equal(createdRun.goal?.[reference.name], 3, 'check-refresh-budget binds the Run\'s creation value');
  // An owner's next-strategy Explore decision (and a revision) is admitted through strategyFrom
  // over the Run's Strategy (fabric.ts completeAdmittedNode, revisionAction); the cap is no knob there.
  assert.ok('error' in strategyFrom(pack.contract.strategy, { ...createdRun.strategy, max_physical_refreshes: 4 }));
  const workspace = started.workspace;
  assert.ok(workspace);
  // Real Pack producers seed the base, the XTop context and one admitted campaign plan: slot w01
  // works one blocker cluster inside a scope of two commands and two mutations, and w02..w06 are
  // parked. All files are synthetic.
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
    'active={"taskId":"w01","baseStateId":base["id"],"problem":"synthetic sizing","targets":[],"editDomain":{"instances":["U1"],"nets":[],"regions":[]},"protected":{"instances":[],"nets":[]},"mayAffect":[],"actions":["size_cell"],"budget":{"xtopMinutes":1,"queries":1,"attempts":1},"targetPins":["U1/A"],"scope":{"commands":["atcs_size_cell","atcs_undo"],"maxMutations":2}}',
    'packages={s:({"taskId":s,"baseStateId":base["id"],"parked":True,"problem":"one blocker cluster; slot "+s+" has none"} if s!="w01" else active) for s in workspaces.TASK_IDS}',
    'f._write_json(w/"research/requests/campaign-plan.json",{"candidate":{"workPackages":packages,"reason":"one blocker cluster"},"baseState":base,"siteCapabilities":{"pgVerification":False}})',
    '[f._write_json(w/"seed"/("worker-request-"+s+".json"),{"candidate":p,"baseState":base,"siteCapabilities":{"pgVerification":False}}) for s,p in packages.items()]',
    // Live02's refused shape: a descriptive taskId instead of the slot key.
    'f._write_json(w/"seed"/"worker-request-w02-refused.json",{"candidate":dict(packages["w02"],taskId="w02-parked"),"baseState":base,"siteCapabilities":{"pgVerification":False}})',
  ].join('\n'), path.join(repoRoot, 'packs', packId, 'flow'),
    path.join(repoRoot, 'packs', packId, 'flow/tests'), workspace, capsPath], { encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);

  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const context = () => host.ctx.hima.executionContext(runId);
  const records = () => host.ctx.hima.ledger.records({ runId });
  const deps = () => (host.ctx.hima as any).deps();
  let serial = 0;
  const act = (action: string, fields: Record<string, unknown> = {}) => host.ctx.hima.executionAction({ runId, actor, origin: 'agent',
    action: action as never, requestId: `atcs-${++serial}`, expectedEpoch: control().epoch, expectedRevision: control().revision, ...fields });
  const slots = ['w01', 'w02', 'w03', 'w04', 'w05', 'w06'];
  const nn = (slot: string) => slot.slice(1);
  const branchNodes = slots.flatMap(slot => ['research-worker-', 'read-worker-request-', 'operate-worker-', 'capture-worker-', 'read-worker-result-'].map(prefix => prefix + nn(slot)));

  // The owner opens the fork at prepare-workers: six branches, one per slot.
  const begun = await act('begin', { nodeId: 'prepare-workers' });
  assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
  const prepare = begun.receipt!.executionId!;
  assert.equal((await act('work', { executionId: prepare })).kind, 'accepted');
  await waitUntil('prepare-workers settles', () => ['ready', 'failed'].includes(control().executions[prepare]?.phase ?? ''), 20000, 25);
  assert.equal(control().executions[prepare]?.phase, 'ready', JSON.stringify(control().executions[prepare]));
  assert.equal((await act('complete', { executionId: prepare })).kind, 'accepted');
  assert.ok(context().run.fork, 'the Run stands inside the worker fork');
  const workers = JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8'));
  assert.deepEqual(workers.requiredSlots, slots);
  assert.deepEqual(slots.filter(slot => workers.workers[slot].parked === true), slots.slice(1));
  // Inside the fork the owner's node turn is refused: the branches are the Pack's autopilot's.
  const fenced = await act('begin', { nodeId: 'research-worker-01' });
  assert.equal(fenced.kind, 'refused');
  assert.match(fenced.reason ?? '', /driven by this Pack's autopilot/);

  // Each branch's own child Agent authors its research Workshop; this test plays each child through
  // the Ledger's production handoff shape (deterministic stand-ins, no model-quality claim).
  const answer = async (delegationId: string, text: string) => {
    const row = runDelegations(deps(), runId).find(item => item.delegationId === delegationId)!;
    await host.ctx.hima.ledger.appendDelegation(runId, { delegationId, parentSessionId: actor, childSessionId: row.childSessionId,
      requestId: `result-${delegationId}-${++serial}`.slice(0, 160), requestDigest: 'a'.repeat(64), event: 'result-observed', payload: {
        candidate: true, source: 'native-live-session', handoff: {
          outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
          contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
          output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
          unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['synthetic model result'] },
        } } });
  };
  const own = (delegationId: string) => records().filter(record => record.type === 'delegation' && record.delegationId === delegationId);
  const authorAsked = async (slot: string): Promise<string> => {
    let id = '';
    await waitUntil(`research-worker-${nn(slot)}'s author is asked`, () => {
      const row = runDelegations(deps(), runId).find(item => item.delegationId.startsWith(`autopilot-author-research-worker-${nn(slot)}-`));
      if (row === undefined || row.state !== 'accepted') return false;
      const asked = own(row.delegationId).filter(record => record.type === 'delegation' && (record.event === 'created' || record.event === 'followup-sent')).at(-1)?.seq ?? 0;
      const answered = own(row.delegationId).filter(record => record.type === 'delegation' && record.event === 'result-observed').at(-1)?.seq ?? 0;
      id = row.delegationId;
      return asked > answered;
    }, 60000, 25);
    return id;
  };
  const copyEntry = (slot: string, seed: string) => JSON.stringify({ schema: WORKSHOP_ENTRY_SCHEMA,
    entry: `import shutil, sys\nshutil.copyfile(sys.argv[1] + "/seed/${seed}.json", sys.argv[1] + "/research/requests/worker-request-${slot}.json")\n` });
  await Promise.all(slots.map(async slot => {
    // #64 Track B: slot w02's first request is refused, as live02's were.
    await answer(await authorAsked(slot), copyEntry(slot, slot === 'w02' ? 'worker-request-w02-refused' : `worker-request-${slot}`));
    if (slot !== 'w02') return;
    // A refused request is revised in its own branch, in the same generation and without a person:
    // the Reader counts it and writes why beside it, and the autopilot restarts the branch at its
    // Workshop and asks the same author again with those problems.
    const followup = await authorAsked(slot);
    const why = await readFile(path.join(workspace, 'research/requests/worker-request-w02.problems.txt'), 'utf8');
    assert.match(why, /^2 problems in worker-request-w02\.json/);
    assert.match(why, /^- candidate\.taskId \(slot w02\): must be 'w02' for this slot, got 'w02-parked'/m);
    assert.match(why, /^- candidate\.taskId \(slot w02\): taskId must be one of .*required format: exactly the slot key/m);
    const refused = records().findLast(record => record.type === 'observation' && record.reader.id === 'atcs-worker-request-02');
    assert.ok(refused?.type === 'observation');
    assert.deepEqual(refused.values.map(value => [value.type, value.value]), [['tc_request_invalid_count', 2], ['tc_slot_parked', 1]]);
    await answer(followup, copyEntry(slot, 'worker-request-w02'));
  }));

  // Slot w01's Operator is materialized with its admitted request embedded in its task and bound to
  // that request's own scope; a parked slot's operate node is the Pack's batch no-op.
  let operator: ReturnType<typeof runDelegations>[number] | undefined;
  await waitUntil('slot w01\'s Operator is materialized', () => {
    operator = runDelegations(deps(), runId).find(row => row.effective.recipe?.teamId === 'atcs-worker-01' && row.effective.recipe.memberId === 'operator');
    return operator !== undefined;
  }, 60000, 25);
  const planReading = records().findLast(record => record.type === 'observation' && record.reader.id === 'atcs-worker-request-01');
  assert.ok(planReading?.type === 'observation');
  const planHash = planReading.contentSha256;
  const requestBytes = await readFile(path.join(workspace, 'research/requests/worker-request-w01.json'));
  assert.equal(planHash, createHash('sha256').update(requestBytes).digest('hex'));
  const request = JSON.parse(requestBytes.toString('utf8'));
  const task = operator!.contract.task;
  const at = task.indexOf('Exact input workerRequest01 ');
  assert.ok(at >= 0, `the Operator's task embeds workerRequest01: ${task.slice(0, 400)}`);
  const embedded = JSON.parse(task.slice(task.indexOf('\n', at) + 1).split('\n')[0]!);
  for (const field of ['taskId', 'editDomain', 'targetPins', 'problem', 'scope', 'actions']) {
    assert.deepEqual(embedded.candidate[field], request.candidate[field], `the embedded request carries candidate.${field}`);
  }
  assert.match(task, new RegExp(planHash), 'and its plan hash');
  assert.match(task, /before\.dump/); assert.match(task, /after\.dump/);
  assert.deepEqual((operator!.effective.recipe!.inlinePayload as any).scope, { commands: ['atcs_size_cell', 'atcs_undo'], maxMutations: 2 });
  const executionId = operator!.effective.recipe!.executionId;
  const interactive = (body: any) => host.ctx.hima.interactive(operator!.childSessionId, { runId, executionId,
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
  // Outside the request's scope, or under another plan hash, the Host refuses before the tool sees it.
  const outsideScope = await interactive({ action: 'input', requestId: 'outside', commandId: 'outside', toolSessionId,
    command: { name: 'atcs_remove_buffer', args: { instance: 'U1', planSha256: planHash } }, waitMs: 0 });
  assert.equal(outsideScope.status, 'refused', JSON.stringify(outsideScope));
  assert.match(outsideScope.reason, /outside the immutable/);
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
  await answer(operator!.delegationId, JSON.stringify({ schema: 'atcs-worker-session/1', planSha256: planHash, mutationReceipts: ['mutation'],
    stopReason: 'no-candidate-gains', limitations: ['synthetic Tcl; no commercial qualification'] }));

  // Every branch captures and reads its own result; the join judges all six and collects, with no
  // owner turn on the way.
  await waitUntil('the join collects every slot', () => records().some(record => record.type === 'node' && record.nodeId === 'collect' && record.state === 'done'), 120000, 50);
  assert.equal(context().run.fork, undefined, 'the join closed the fork');
  const ownerTurns = Object.values(control().requests).filter(request => request.origin !== 'autopilot' && request.origin !== 'human'
    && ['begin', 'work', 'write', 'complete'].includes(request.receipt.action)
    && [...branchNodes, 'check-worker-results', 'collect'].includes(control().executions[request.receipt.executionId ?? '']?.nodeId ?? ''));
  assert.deepEqual(ownerTurns, [], 'the owner took no turn inside the fork or at the join');
  assert.ok(own(operator!.delegationId).some(record => record.type === 'delegation' && record.event === 'result-adopted'), 'the Operator\'s schema-valid result was adopted');
  const restarts = records().filter(record => record.type === 'resumed' && record.kind === 'restart');
  assert.deepEqual(restarts.map(record => record.type === 'resumed' ? [record.nodeId, record.writer] : []), [['research-worker-02', 'executor']],
    'slot w02 was revised once, by the autopilot');
  assert.equal(records().filter(record => record.type === 'decision').length, 0, 'no Explore decided the revision');
  for (const slot of slots) {
    const reading = records().findLast(record => record.type === 'observation' && record.reader.id === `atcs-worker-request-${nn(slot)}`);
    assert.ok(reading?.type === 'observation');
    assert.equal(reading.branchId, `research-worker-${nn(slot)}`, `slot ${slot}'s request is read in its own branch`);
    assert.deepEqual(reading.values.map(value => [value.type, value.value]), [['tc_request_invalid_count', 0], ['tc_slot_parked', slot === 'w01' ? 0 : 1]], `slot ${slot}'s request is admitted`);
  }
  for (const slot of slots.slice(1)) {
    const receipt = JSON.parse(await readFile(path.join(workspace, workers.workers[slot].root, 'parked.json'), 'utf8'));
    assert.equal(receipt.taskId, slot);
  }
  const interactiveJobs = records().filter(record => record.type === 'job' && record.event === 'launched' && record.nodeId?.startsWith('operate-worker-'));
  assert.deepEqual(interactiveJobs.map(record => record.type === 'job' ? [record.nodeId, record.branchId] : []).sort(),
    slots.map(slot => [`operate-worker-${nn(slot)}`, `research-worker-${nn(slot)}`]), 'each operate Job runs in its own branch');
  // #64 Track B: a parked slot costs no Team, no interactive (XTop) Job and no licence claim; only the
  // active slot's interactive session holds the xtop seat.
  assert.deepEqual(interactiveJobs.map(record => record.type === 'job' ? [record.nodeId, record.licences ?? null] : []).sort(),
    slots.map(slot => [`operate-worker-${nn(slot)}`, slot === 'w01' ? { xtop: 1 } : null]), 'only the session holds a seat');
  const members = runDelegations(deps(), runId).filter(row => row.effective.recipe !== undefined);
  assert.deepEqual(members.map(row => [row.effective.recipe!.teamId, row.effective.recipe!.memberId]), [['atcs-worker-01', 'operator']],
    'the Run holds exactly slot w01\'s Operator: no Team for a parked slot, and the advisory Reviewer is never waited for');
  assert.deepEqual(records().filter(record => record.type === 'verdict').map(record => record.type === 'verdict' ? [record.branchId, record.ruleId, record.outcome] : []),
    slots.map(slot => [`research-worker-${nn(slot)}`, 'worker-result-admissible', 'PASS']), 'the join judged each slot\'s sealed result');

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
const atcsXtopOperatorWrapper = '/data/eda/project/hima_harness/operator-admin/atcs-v15/atcs-xtop-operator-v15.sh';

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
  // Issue #64 Task 6: the `autoFinish` knob (0/1, default 1) reaches `replay-prepare` as its 4th argument.
  assert.deepEqual(operatorNode('replay-prepare').parameters.arguments.AUTO_FINISH, { from: 'strategy', name: 'autoFinish' });
  const replayPrepare = pack.contract.tools.find(item => item.id === 'replay-prepare')!;
  assert.ok(replayPrepare.inputs.includes('AUTO_FINISH'));
  assert.equal(replayPrepare.argv[replayPrepare.argv.length - 1], '${AUTO_FINISH}');
  assert.deepEqual((pack.graph.edges as any[]).filter(edge => edge.to === 'bind-worker-slots').map(edge => [edge.from, edge.outcome]),
    [['check-refresh-budget', 'PASS']], 'every generation plans only past the refresh-budget gate');
  const planner = pack.contract.workshops.find(item => item.id === 'plan-campaign')!;
  for (const words of [/parked/, /workerSlots/, /worst setup check and the worst hold check/, /targetPins/, /share no instance/, /check key in the slot.s targets/, /share no edit-domain net/, /fail reasons/]) {
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
    assert.ok(workshop.purpose.includes(`knowledge ${file.replace(/\.md$/, '')}`), `${workshop.id}'s purpose names ${file}`);
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
  assert.deepEqual(active.candidate, activeExample, 'the example request is the prepared package');
  const noSafeMove = await knowledgeExample('example-worker-request.md', 'Active slot with no safe move');
  assert.deepEqual([noSafeMove.candidate, noSafeMove.sessionPlan], [activeExample, []]);
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
  for (const team of workerTeams) {
    const slot = team.id.slice(-2);
    assert.equal(team.triggerNode, `operate-worker-${slot}`);
    assert.equal(slotless(team, slot), slotless(team01, '01'), `${team.id} is Team 01 for slot w${slot}`);
  }
  const team = team01;
  assert.equal(team.version, '5');
  assert.deepEqual(team.members.map(item => item.id), ['reviewer', 'operator'], 'the Researcher is the branch\'s own author; no approval member');
  const reviewer = team.members.find(item => item.id === 'reviewer')!;
  const operatorMember = team.members.find(item => item.id === 'operator')!;
  assert.equal(reviewer.optional, true, 'the Reviewer is optional advice whose absence never blocks');
  assert.deepEqual(reviewer.resultSchema, { id: 'atcs-worker-review/3', required: ['schema', 'planSha256', 'evidenceRefs', 'limitations'] });
  assert.match(reviewer.taskTemplate, /Advisory only: nothing waits for you/);
  assert.equal(operatorMember.budgetShare.maxTokensPerTurn, 5000);
  assert.equal(operatorMember.budgetShare.maxFollowups, 1, 'one repair follow-up for a result failing its schema');
  assert.equal(operatorMember.followup, 'reuse-same-child');
  assert.deepEqual(team.batchWhen, [{ input: 'workerRequest01', value: 'tc_slot_parked', equals: 1 },
    { input: 'workerRequest01', value: 'tc_request_invalid_count', above: 0 }], 'a parked or refused slot runs the batch no-op');
  assert.match(operatorMember.taskTemplate, /Host refus[^.]*free/);
  assert.match(operatorMember.taskTemplate, /toolkit refus[^.]*costs one/);
  assert.deepEqual(operatorMember.reviewedAction, { mode: 'request-scope', planInput: 'workerRequest01', scopePath: ['candidate', 'scope'],
    commands: mutations, maxMutations: recipeCap, hostPlanHashArgument: 'planSha256' });
  // #64 M-T03-1: the Operator's task embeds its request; its template names the fields it works from
  // and the exact dump names the capture seals (#64 D-T03-2).
  assert.deepEqual(operatorMember.taskInputs, [{ input: 'workerRequest01', fields: ['candidate', 'sessionPlan', 'noSafeAction', 'siteCapabilities'] }]);
  for (const words of [/editDomain\.instances/, /editDomain\.nets/, /targetPins/, /Exact input workerRequest01/, /exactly this file name/]) {
    assert.match(operatorMember.taskTemplate, words, `the Operator template states ${words}`);
  }
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
  // The 2026-09-29 reshape (ADR-0016): plan -> six self-driving branches -> merge -> one refresh ->
  // evaluate -> automatic re-observation -> one owner decision. 136 nodes and 178 edges before.
  assert.equal(pack.graph.nodes.length, 81);
  assert.equal(pack.graph.edges.length, 103);
  assert.deepEqual((pack.graph.nodes as any[]).filter(node => node.kind === 'explore').map(node => node.id), ['decide'], 'one owner decision per generation');
  assert.deepEqual((pack.graph.nodes as any[]).filter(node => node.kind === 'wait').map(node => node.id), ['wait-for-person'], 'a person only as the honest end');
  assert.deepEqual((pack.graph as any).autopilot, [
    { from: ['bind-inputs'], until: ['plan', 'wait-for-person'] },
    { from: ['read-campaign-plan'], until: ['decide'] },
    { fork: 'prepare-workers', revisions: 2, author: { maxElapsedMs: 900000, maxFollowups: 4, maxTokensPerTurn: 16000 } },
    { from: ['check-worker-results'], until: ['compose'] },
    { from: ['read-integration-plan'], until: ['decide'] },
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
  assert.deepEqual(edgesTo('read-refresh-budget'), ['decide->revisit', 'residual-baseline->']);
  assert.deepEqual(edgesFrom('decide'), ['revisit->read-refresh-budget'], 'continue is the next generation from the working state');
  assert.deepEqual(edgesTo('implement'), ['read-precheck->']);
  assert.deepEqual(edgesTo('extract'), ['implement->']);
  assert.equal(nodeOf('apr-run'), undefined, 'no earlier-APR detour');
  assert.ok(pack.contract.rules.includes('refresh-budget'));
  // #64 Track B (C28), reshaped: every generation refreshes once, so the two refreshes of the default
  // cap need two generations; a Run created with fewer is refused at creation.
  assert.equal((pack.contract.budget as any).minimumGenerations, 2);
  assert.equal((pack.contract.goal as any).max_physical_refreshes.default, 2);

  // #64 Track B (from #63 slice 3 gap 1): every request output has an itemized `<output>Problems`
  // beside it (written by tools/read-atcs.py, no reader), read by the Workshop that produces it.
  for (const workshop of pack.contract.workshops) {
    const problems = pack.contract.outputs.find(output => output.name === `${workshop.produces}Problems`)!;
    const request = pack.contract.outputs.find(output => output.name === workshop.produces)!;
    assert.ok(problems, `${workshop.produces} has its Problems output`);
    assert.equal(problems.path, request.path.replace(/\.json$/, '.problems.txt'));
    assert.equal(problems.reader, undefined);
    assert.ok(workshop.reads.includes(problems.name), `${workshop.id} reads ${problems.name}`);
    assert.match(workshop.purpose, new RegExp(`read output ${problems.name} first`));
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
  assert.equal(generated.status, 0, generated.stderr);
  const document = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(document.bindings[0].environment.id, `linglong-atcs28:xtop-operator-v${version}`);
  assert.match(document.bindings[0].id, new RegExp(`^linglong-atcs28:xtop-operator-v${version}:`));
});
