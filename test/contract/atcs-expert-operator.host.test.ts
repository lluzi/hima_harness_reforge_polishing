// Issue #64 Track B: the ATCS expert Operator's loop, through the worker Team seam, with no model and
// no EDA. The Pack's own fork runs from `prepare-workers` (slots w01 and w02 active, w03..w06 parked);
// each active slot's Team (atcs-worker-NN version 4, scope mode) adopts a synthetic Researcher and a
// Reviewer approving `{commands: [atcs_size_cell, atcs_undo], maxMutations: 3}`, and each Operator
// session is the dry-path REPL (test/fixtures/atcs-dry-path/atcs-dry-repl.tcl): `tclsh` on the very
// session Tcl `prepare-workers` rendered for the slot -- the Pack's typed `atcs_*` toolkit with its
// edit domain, reference, gain and undo -- over the in-memory XTop of xtop-standin.tcl. The Operator's
// commands are this test's script. The real XTop qualification of the same procedures is Task 7's
// chain dry run (.hima-tmp/hltbf/issue64-t7), not repeated here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendFile, cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest, loadPack, packDigestExcludes, runDelegations } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeMomentScenario } from './support/moments.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'agentic-timing-closure-system';
const dry = path.join(repoRoot, 'test/fixtures/atcs-dry-path');
const SLOTS = ['w01', 'w02', 'w03', 'w04', 'w05', 'w06'];
const ACTIVE = ['w01', 'w02'];
const SCOPE = { commands: ['atcs_size_cell', 'atcs_undo'], maxMutations: 3 };

test('ATCS expert Operator through the Team seam: a scope of three mutations admits three and refuses the fourth, undo is logged, an out-of-domain object is refused, and the kept log drops what was undone', async (t) => {
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  const prior = process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'atcs-expert';
  t.after(() => { if (prior === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = prior; });
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const h = { ...local.h, workspace: await realpath(local.h.workspace) };
  const packsDir = path.join(h.home, 'hima/packs');
  const variant = path.join(packsDir, packId);
  await cp(path.join(repoRoot, 'packs', packId), variant, { recursive: true, filter: (src) => !src.includes('__pycache__') });
  const contract = parse(await readFile(path.join(variant, 'contract.yml'), 'utf8')) as any;
  const wrapper = await realpath('/usr/bin/tclsh');
  contract.environment.wrappers = [wrapper, 'python3', '/usr/bin/python3'];
  contract.budget.closingReserveMs = 1000;
  contract.workspace.copy.push('atcs-dry-repl.tcl', 'xtop-standin.tcl');
  const tool = contract.tools.find((item: any) => item.id === 'xtop-operator');
  // The qualified wrapper's own call shape, `<workspace> <slot>`; the batch path stays operate-parked.
  tool.interactive.argv = [wrapper, '${WORKSPACE}/flow/atcs-dry-repl.tcl', '${WORKSPACE}', '${SLOT}'];
  await writeFile(path.join(variant, 'contract.yml'), stringify(contract));
  const graph = parse(await readFile(path.join(variant, 'graph.yml'), 'utf8')) as any;
  graph.entry = 'prepare-workers'; // the fork; the stages before it are the dry path's (atcs-dry group)
  await writeFile(path.join(variant, 'graph.yml'), stringify(graph));
  for (const file of ['atcs-dry-repl.tcl', 'xtop-standin.tcl']) await cp(path.join(dry, file), path.join(variant, 'flow', file));
  const capsPath = path.join(h.workspace, 'caps.json');
  const site = await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper, 'python3', '/usr/bin/python3'], parallelJobs: 2, licences: { xtop: 2, innovus: 1, primetime: 1, starrc: 1 },
    bindings: { designStateManifest: path.join(h.workspace, 'manifest.json'), analysisContract: path.join(h.workspace, 'analysis'),
      siteCapabilities: capsPath, workspaceRoot: h.workspace },
  });
  const pack = loadPack(packsDir, packId);
  const digest = pack.folder.digest(packDigestExcludes);
  const admin = path.join(h.home, 'admin'); await mkdir(admin);
  const environmentFile = path.join(admin, 'environment.json');
  const environment = {
    schema: 'hima-interactive-environment/1', site: 'local', toolId: tool.id,
    pack: { id: packId, digest }, adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST },
    commandsDigest: interactiveCommandsDigest(pack.contract.tools.find(item => item.id === tool.id)!),
    wrapper: { path: wrapper, sha256: createHash('sha256').update(await readFile(wrapper)).digest('hex') },
    image: { reference: 'local/atcs-expert', digest: 'sha256:' + '0'.repeat(64) },
    sourceTemplate: { path: 'flow/templates/xtop-operator.tcl',
      sha256: createHash('sha256').update(await readFile(path.join(variant, 'flow/templates/xtop-operator.tcl'))).digest('hex') },
    confinement: { rootFilesystem: 'read-only', dataRoot: '/', dataMount: 'read-only',
      privateWriteRoot: h.workspace, network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
    qualification: { status: 'passed', transcriptSha256: '1'.repeat(64), logicalEcoSha256: '2'.repeat(64),
      physicalEcoSha256: '3'.repeat(64), xtopReady: true, identityQuery: true, mutation: true, save: true,
      sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
  };
  const environmentText = JSON.stringify(environment);
  await writeFile(environmentFile, environmentText);
  const bindingsFile = path.join(admin, 'bindings.json');
  await writeFile(bindingsFile, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [{
    id: 'atcs-expert', site: 'local', packDigest: digest, toolId: tool.id, adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST,
    commandsDigest: environment.commandsDigest, environment: { id: 'atcs-expert', file: environmentFile,
      sha256: createHash('sha256').update(environmentText).digest('hex') }, mutation: 'qualified',
  }] }));
  await appendFile(path.join(h.profileDir, 'cordis.patch.yml'), '\n- id: hima\n  config:\n    sitesDir: ' + JSON.stringify(site.sitesDir)
    + '\n    packsDir: ' + JSON.stringify(packsDir) + '\n    knowledgeDir: ' + JSON.stringify(path.join(h.home, 'hima/knowledge/current'))
    + '\n    interactiveBindingsFile: ' + JSON.stringify(bindingsFile) + '\n');
  const replay = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: replay.file, overrideFile: replay.override, childFiles: replay.children });
  const host = await bootInProcess(h); let runId: string | undefined;
  t.after(async () => { if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined); await host.dispose(); await h.dispose(); });
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local',
    goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0, max_physical_refreshes: 2 }, ownerSessionId: actor, timeBoxMs: 3_600_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  runId = started.run.id; const workspace = started.workspace;
  // Real Pack producers seed the base (the dry path's six-block design), the XTop context and one
  // admitted plan: w01 works block u_a, w02 block u_b, w03..w06 parked. All files are synthetic.
  const seeded = spawnSync('python3', ['-c', [
    'import sys,json,shutil; from pathlib import Path',
    'sys.path.insert(0,sys.argv[1]); sys.path.insert(0,sys.argv[2])',
    'import test_cli_state as f; from atcs import core,state,workspaces',
    'w=Path(sys.argv[3]); manifest=f._make_baseline_manifest(w); shutil.copyfile(sys.argv[5], w/"netlist.v")',
    '(w/"design.def").write_text("VERSION 5.8 ;\\nDESIGN top ;\\nEND DESIGN\\n"); manifest["def"]="design.def"',
    '(w/"lef").mkdir(); (w/"lef"/"tech.lef").write_text("VERSION 5.8 ;\\n"); (w/"lef"/"cells.lef").write_text("VERSION 5.8 ;\\n")',
    'base=state.design_state(manifest); core.write_artifact(w/"state/working-state.json",base)',
    'caps={"design":"top","techLef":str(w/"lef"/"tech.lef"),"cellLefGlob":str(w/"lef"/"cells.lef"),"pgVerification":False,**f._write_xtop_context(w,base["id"],("func_ssg_rcworst","func_ffg_cbest"))}',
    'f._write_json(Path(sys.argv[4]),caps)',
    'def active(slot, block): return {"taskId":slot,"baseStateId":base["id"],"problem":"setup at "+block+"/reg0/I","targets":["func_ssg_rcworst|setup|"+block+"/reg0/I"],"editDomain":{"instances":[block+"/reg0",block+"/reg1"],"nets":[],"regions":[]},"protected":{"instances":[],"nets":[]},"mayAffect":[],"actions":["size_cell"],"budget":{"xtopMinutes":1,"attempts":1},"targetPins":[block+"/reg0/I"],"scope":{"commands":list(workspaces.MUTATE_COMMANDS),"maxMutations":workspaces.SCOPE_MAX_MUTATIONS},"observe":"fast"}',
    'packages={s:({"taskId":s,"baseStateId":base["id"],"parked":True,"problem":"no blocker cluster left"} if s not in ("w01","w02") else active(s, "u_a" if s=="w01" else "u_b")) for s in workspaces.TASK_IDS}',
    'f._write_json(w/"research/requests/campaign-plan.json",{"candidate":{"workPackages":packages,"reason":"one block each"},"baseState":base,"siteCapabilities":{"pgVerification":False}})',
  ].join('\n'), path.join(repoRoot, 'packs', packId, 'flow'), path.join(repoRoot, 'packs', packId, 'flow/tests'), workspace, capsPath,
  path.join(dry, 'design/top.v')], { encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);

  const control = () => host.ctx.hima.ledger.run(runId!)!.control!;
  const records = () => host.ctx.hima.ledger.records({ runId: runId! });
  let serial = 0;
  const act = (action: string, fields: Record<string, unknown> = {}) => host.ctx.hima.executionAction({ runId: runId!, actor,
    action: action as never, requestId: `expert-${++serial}`, expectedEpoch: control().epoch, expectedRevision: control().revision, ...fields });
  const begin = async (nodeId: string) => {
    const begun = await act('begin', { nodeId }); assert.equal(begun.kind, 'accepted', `begin ${nodeId}: ${JSON.stringify(begun)}`);
    return begun.receipt!.executionId!;
  };
  const node = async (nodeId: string, entry?: string) => {
    const id = await begin(nodeId);
    if (entry !== undefined) {
      assert.equal((await act('recommend', { executionId: id })).kind, 'accepted');
      assert.equal((await act('write', { executionId: id, path: 'entry.py', content: entry })).kind, 'accepted');
    }
    assert.equal((await act('work', { executionId: id })).kind, 'accepted', nodeId);
    await waitUntil(`${nodeId} settles`, () => ['ready', 'failed'].includes(control().executions[id]?.phase ?? ''), 30_000, 25);
    assert.equal(control().executions[id]?.phase, 'ready', `${nodeId}: ${JSON.stringify(control().executions[id])}`);
    assert.equal((await act('complete', { executionId: id })).kind, 'accepted', nodeId);
    return id;
  };
  await node('prepare-workers');
  const workers = JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8'));
  // Each branch's Workshop writes its slot's request from the prepared package.
  const entry = (slot: string) => [
    'import json, sys', 'from pathlib import Path', 'w = Path(sys.argv[1])',
    'workers = json.loads((w / "state/workers.json").read_text())',
    `package = {k: v for k, v in workers["workers"]["${slot}"]["workPackage"].items() if k not in ("schema", "id")}`,
    'request = {"candidate": package, "baseState": json.loads((w / "state/working-state.json").read_text()), "siteCapabilities": {"pgVerification": False}}',
    `(w / "research/requests/worker-request-${slot}.json").write_text(json.dumps(request))`, ''].join('\n');
  for (const slot of SLOTS) {
    await node(`research-worker-${slot.slice(1)}`, entry(slot));
    await node(`read-worker-request-${slot.slice(1)}`);
  }
  for (const slot of SLOTS.filter(slot => !ACTIVE.includes(slot))) await node(`operate-worker-${slot.slice(1)}`);

  // Each active slot's Team: Researcher, a Reviewer approving SCOPE, the Operator's session.
  const resultAndAdopt = async (delegationId: string, value: unknown) => {
    const row = runDelegations((host.ctx.hima as any).deps(), runId!).find(item => item.delegationId === delegationId)!;
    const text = JSON.stringify(value);
    const record = await host.ctx.hima.ledger.appendDelegation(runId!, { delegationId, parentSessionId: actor,
      childSessionId: row.childSessionId, requestId: 'result-' + delegationId, requestDigest: 'a'.repeat(64),
      event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
        outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
        contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
        output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
        unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['synthetic model result'] },
      } } });
    const adoption = await host.ctx.hima.delegate({ runId, actor, action: 'adopt', delegationId, resultRecordId: record.id,
      requestId: 'adopt-' + delegationId, expectedEpoch: control().epoch, expectedRevision: control().revision } as never) as any;
    assert.equal(adoption.status, 'accepted', JSON.stringify(adoption));
  };
  const sessions = new Map<string, { executionId: string; planHash: string; operatorId: string; delegationId: string; toolSessionId?: string; root: string }>();
  for (const slot of ACTIVE) {
    const executionId = await begin(`operate-worker-${slot.slice(1)}`);
    const planHash = createHash('sha256').update(await readFile(path.join(workspace, `research/requests/worker-request-${slot}.json`))).digest('hex');
    const create = (memberId: string): Promise<any> => host.ctx.hima.delegate({ runId, actor, action: 'create', requestId: `create-${memberId}-${slot}`,
      expectedEpoch: control().epoch, expectedRevision: control().revision,
      recipe: { teamId: `atcs-worker-${slot.slice(1)}`, version: '4', memberId, executionId } } as never) as Promise<any>;
    const researcher: any = await create('researcher'); assert.equal(researcher.status, 'created', JSON.stringify(researcher));
    await resultAndAdopt(researcher.effectiveContract.delegationId, { schema: 'atcs-worker-research/1', hypotheses: ['size the block\'s reg0 up one step'],
      evidenceRefs: researcher.effectiveContract.inputRefs, limitations: ['synthetic'] });
    const reviewer: any = await create('reviewer'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
    await resultAndAdopt(reviewer.effectiveContract.delegationId, { schema: 'atcs-worker-review/2', planSha256: planHash, scope: SCOPE,
      evidenceRefs: reviewer.effectiveContract.inputRefs, limitations: ['synthetic'] });
    const operator: any = await create('operator'); assert.equal(operator.status, 'created', JSON.stringify(operator));
    sessions.set(slot, { executionId, planHash, operatorId: operator.receipt.childSessionId, delegationId: operator.effectiveContract.delegationId,
      root: path.join(workspace, workers.workers[slot].root) });
  }
  const interactive = (slot: string, body: any) => {
    const session = sessions.get(slot)!;
    return host.ctx.hima.interactive(session.operatorId, { runId, executionId: session.executionId, nodeId: `operate-worker-${slot.slice(1)}`,
      ownerEpoch: control().epoch, controlRevision: control().revision,
      ...(session.toolSessionId === undefined ? {} : { toolSessionId: session.toolSessionId }), ...body }) as Promise<any>;
  };
  for (const slot of ACTIVE) {
    const opened = await interactive(slot, { action: 'open', requestId: `open-${slot}` });
    assert.equal(opened.status, 'opened', JSON.stringify(opened).slice(0, 2000));
    sessions.get(slot)!.toolSessionId = opened.session.toolSessionId;
  }
  const input = (slot: string, name: string, args: Record<string, unknown>, id: string) =>
    interactive(slot, { action: 'input', requestId: id, commandId: id, command: { name, args }, waitMs: 5000 });
  const ok = async (slot: string, name: string, args: Record<string, unknown>, id: string) => {
    const value = await input(slot, name, args, id); assert.equal(value.status, 'completed', `${slot} ${name}: ${JSON.stringify(value).slice(0, 1500)}`); return value;
  };
  const w01 = sessions.get('w01')!; const w02 = sessions.get('w02')!;

  // w01: the expert loop inside a budget of three mutations.
  await ok('w01', 'atcs_dump_cells', { path: path.join(w01.root, 'before.dump') }, 'w01-before');
  await ok('w01', 'atcs_ref', {}, 'w01-ref');
  // Trial 1 (mutation 1): reg1 is off the target path; its gain shows no setup change at the target.
  const trial = await ok('w01', 'atcs_size_cell', { instance: 'u_a/reg1', toMaster: 'BUFFD2BWP', planSha256: w01.planHash }, 'w01-trial');
  const trialGain = await ok('w01', 'atcs_gain', { check: 'setup', topN: 5 }, 'w01-trial-gain');
  assert.match(JSON.stringify(trialGain), /D_TNS/, 'the gain reads against the session reference');
  // Mutation 2: undo it at once; the toolkit logs the undo against the trial's seq.
  await ok('w01', 'atcs_undo', { planSha256: w01.planHash }, 'w01-undo');
  // Mutation 3: the kept move.
  await ok('w01', 'atcs_size_cell', { instance: 'u_a/reg0', toMaster: 'BUFFD2BWP', planSha256: w01.planHash }, 'w01-size');
  // Mutation 4: refused by the Host before the tool sees it; nothing is logged for it.
  const fourth = await input('w01', 'atcs_size_cell', { instance: 'u_a/reg0', toMaster: 'BUFFD4BWP', planSha256: w01.planHash }, 'w01-fourth');
  assert.equal(fourth.status, 'refused', JSON.stringify(fourth).slice(0, 1500));
  assert.match(fourth.reason, /admits at most 3 mutations in this approved execution; 3 were already admitted/);
  // Outside the scope is free and refused by the Host too; a read still answers.
  const outside = await input('w01', 'atcs_remove_buffer', { instance: 'u_a/reg1', planSha256: w01.planHash }, 'w01-outside');
  assert.equal(outside.status, 'refused'); assert.match(outside.reason, /outside the immutable owner-adopted reviewed scope/);
  await ok('w01', 'atcs_gain', { check: 'setup', topN: 5 }, 'w01-gain');
  await ok('w01', 'atcs_dump_cells', { path: path.join(w01.root, 'after.dump') }, 'w01-after');
  await ok('w01', 'atcs_export_changes', {}, 'w01-export');
  await ok('w01', 'atcs_close', {}, 'w01-close');

  // w02: an object outside its edit domain (w01's instance) is refused by the toolkit and changes nothing.
  await ok('w02', 'atcs_dump_cells', { path: path.join(w02.root, 'before.dump') }, 'w02-before');
  await ok('w02', 'atcs_ref', {}, 'w02-ref');
  const foreign = await input('w02', 'atcs_size_cell', { instance: 'u_a/reg0', toMaster: 'BUFFD4BWP', planSha256: w02.planHash }, 'w02-foreign');
  assert.notEqual(foreign.status, 'completed', JSON.stringify(foreign).slice(0, 1500));
  assert.match(JSON.stringify(foreign), /out-of-scope instance: u_a\/reg0/, 'the toolkit names the out-of-domain object');
  await ok('w02', 'atcs_size_cell', { instance: 'u_b/reg0', toMaster: 'BUFFD2BWP', planSha256: w02.planHash }, 'w02-size');
  await ok('w02', 'atcs_dump_cells', { path: path.join(w02.root, 'after.dump') }, 'w02-after');
  await ok('w02', 'atcs_export_changes', {}, 'w02-export');
  await ok('w02', 'atcs_close', {}, 'w02-close');

  for (const slot of ACTIVE) {
    const session = sessions.get(slot)!;
    await waitUntil(`${slot}'s session is ready`, () => control().executions[session.executionId]?.phase === 'ready', 30_000, 25);
    await resultAndAdopt(session.delegationId, { schema: 'atcs-worker-session/1', planSha256: session.planHash,
      mutationReceipts: slot === 'w01' ? ['w01-trial', 'w01-undo', 'w01-size'] : ['w02-foreign', 'w02-size'],
      stopReason: slot === 'w01' ? 'budget' : 'no-candidate-gains', limitations: ['synthetic Tcl; no commercial qualification'] });
    assert.equal((await act('complete', { executionId: session.executionId })).kind, 'accepted');
  }

  // The session logs: w01 kept its trial, undid it (logged against the trial's seq) and kept reg0;
  // w02's refused out-of-domain call reached no XTop and left no line; nothing of mutation 4 exists.
  const lines = async (file: string) => (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const w01Ops = await lines(path.join(w01.root, 'ops.jsonl'));
  assert.deepEqual(w01Ops.map(line => [line.seq, line.cmd, line.status, line.undoes ?? null]),
    [[1, 'size_cell', 'kept', null], [2, 'undo', 'kept', 1], [3, 'size_cell', 'kept', null]], JSON.stringify(trial).slice(0, 300));
  assert.deepEqual((await lines(path.join(w02.root, 'ops.jsonl'))).map(line => [line.cmd, line.args.instance]), [['size_cell', 'u_b/reg0']]);
  const w01Gain = await lines(path.join(w01.root, 'gain.jsonl'));
  assert.deepEqual(w01Gain.map(line => line.kind), ['reference', 'mutation', 'probe', 'undo', 'mutation', 'probe'], 'every kept edit and the undo read their gain');
  const interactiveInputs = records().filter(r => r.type === 'interactive' && (r as any).event === 'input-intent' && (r as any).executionId === w01.executionId);
  assert.equal(interactiveInputs.filter(r => (r as any).payload?.scopeMutation === true).length, 3, 'the Host admitted exactly three w01 mutations');

  // The kept command log each capture seals, and the recipe replays: w01's undone trial is not in it.
  for (const slot of SLOTS) { await node(`capture-worker-${slot.slice(1)}`); await node(`read-worker-result-${slot.slice(1)}`); }
  await node('check-worker-results');
  await node('collect');
  const collected = JSON.parse(await readFile(path.join(workspace, 'state/contributions-collected.json'), 'utf8'));
  const sealed = (slot: string) => collected.contributions.find((item: any) => item.taskId === slot);
  assert.equal(sealed('w01').kind, 'xtop-session');
  assert.deepEqual(sealed('w01').commands.map((command: any) => [command.proc, command.args.instance, command.args.toMaster]),
    [['atcs_size_cell', 'u_a/reg0', 'BUFFD2BWP']], 'w01\'s kept command log holds the kept sizing only');
  assert.deepEqual(sealed('w01').delta.mastersChanged, { 'u_a/reg0': ['BUFFD1BWP', 'BUFFD2BWP'] });
  assert.deepEqual(sealed('w02').commands.map((command: any) => [command.proc, command.args.instance]), [['atcs_size_cell', 'u_b/reg0']]);
  assert.deepEqual(sealed('w02').delta.mastersChanged, { 'u_b/reg0': ['BUFFD1BWP', 'BUFFD2BWP'] }, 'w02 changed nothing of w01\'s');
});
