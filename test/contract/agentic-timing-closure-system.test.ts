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
test('ATCS bounded worker uses the frozen Team seam, typed Operator and real Contribution collector', async t => {
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
  tool.argv = [wrapper, '${WORKSPACE}/flow/atcs-repl.tcl', '${WORKSPACE}/workspaces/w01/r1'];
  tool.interactive.argv = tool.argv;
  tool.licences = {};
  for (const member of contract.agentTeams[0].members) member.budgetShare.maxElapsedMs = 10000;
  await writeFile(path.join(variant, 'contract.yml'), stringify(contract));
  const graph = parse(await readFile(path.join(variant, 'graph.yml'), 'utf8')) as any;
  graph.entry = 'operate-worker-01'; // Start at the changed seam; pre-EDA preparation is separately Python-tested.
  await writeFile(path.join(variant, 'graph.yml'), stringify(graph));
  await cp(path.join(repoRoot, 'test/fixtures/interactive-job/atcs-repl.tcl'), path.join(variant, 'flow/atcs-repl.tcl'));
  const site = await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper, 'python3', '/usr/bin/python3'], licences: { xtop: 1, innovus: 1, primetime: 1, starrc: 1 },
    bindings: { designStateManifest: path.join(h.workspace, 'manifest.json'),
      analysisContract: path.join(h.workspace, 'analysis'), siteCapabilities: path.join(h.workspace, 'caps.json'),
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
    goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0 }, ownerSessionId: actor, timeBoxMs: 60000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  const runId = started.run.id; cleanupRunId = runId;
  const workspace = started.workspace;
  assert.ok(workspace);
  // Real Pack producers seed the base, private slot and worker manifest. All files are synthetic.
  const seeded = spawnSync('python3', ['-c', [
    'import sys,json; from pathlib import Path',
    'sys.path.insert(0,sys.argv[1]); sys.path.insert(0,sys.argv[2])',
    'import test_cli_state as f; from atcs import core,state,workspaces',
    'w=Path(sys.argv[3]); manifest=f._make_baseline_manifest(w)',
    'base=state.design_state(manifest); core.write_artifact(w/"state/working-state.json",base)',
    'raw={"taskId":"w01","baseStateId":base["id"],"problem":"synthetic sizing","targets":[],"editDomain":{"instances":["U1"],"nets":[],"regions":[]},"protected":{"instances":[],"nets":[]},"mayAffect":[],"actions":["size_cell"],"budget":{"xtopMinutes":1,"queries":1,"attempts":1}}',
    'package=workspaces.validate_work_package(raw,base,{"pgVerification":False}); slot=workspaces.prepare(package,str(w),base)',
    'f._write_json(w/"state/workers.json",{"requiredSlots":["w01"],"workers":{"w01":{"root":slot["root"],"opsLog":str(w/slot["root"]/"ops.jsonl"),"workspaceManifest":slot,"workPackage":package}}})',
    'f._write_json(w/"research/requests/worker-request-w01.json",{"candidate":raw,"baseState":base,"siteCapabilities":{"pgVerification":False},"actions":[{"instance":"U1","toMaster":"BUF2"}]})',
  ].join('\n'), path.join(repoRoot, 'packs', packId, 'flow'),
    path.join(repoRoot, 'packs', packId, 'flow/tests'), workspace], { encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);
  const planPath = path.join(workspace, 'research/requests/worker-request-w01.json');
  const planBytes = await readFile(planPath); const planHash = createHash('sha256').update(planBytes).digest('hex');
  const readerOut = path.join(workspace, 'reader.json');
  const read = spawnSync('python3', [path.join(repoRoot, 'packs', packId, 'tools/read-atcs.py'),
    'worker-request', planPath, readerOut, workspace, 'w01'], { encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  const retained = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir }, runId, planBytes, planHash);
  assert.ok(retained);
  await host.ctx.hima.ledger.appendObservation(runId, { path: planPath, contentSha256: planHash,
    retainedPath: retained, bytes: planBytes.length, reader: { id: 'atcs-worker-request-01', version: '1',
      reportKind: 'atcs-worker-request', emits: ['tc_request_invalid_count'] }, values: [] });
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const begin = await host.ctx.hima.executionAction({ runId, actor, action: 'begin',
    nodeId: 'operate-worker-01', requestId: 'begin', expectedEpoch: control().epoch, expectedRevision: control().revision });
  assert.equal(begin.kind, 'accepted', JSON.stringify(begin));
  const executionId = begin.receipt!.executionId!;
  const create = (memberId: string) => host.ctx.hima.delegate({ runId, actor, action: 'create', requestId: 'create-' + memberId,
    expectedEpoch: control().epoch, expectedRevision: control().revision,
    recipe: { teamId: 'atcs-worker-01', version: '3', memberId, executionId } } as never) as Promise<any>;
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
  await resultAndAdopt(researcher, { schema: 'atcs-worker-research/1', hypotheses: ['synthetic sizing'],
    evidenceRefs: researcher.effectiveContract.inputRefs, limitations: ['no EDA'] });
  const reviewer = await create('reviewer'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
  await resultAndAdopt(reviewer, { schema: 'atcs-worker-review/1', planSha256: planHash, command: 'atcs_size_cell',
    arguments: { instance: 'U1', toMaster: 'BUF2' }, evidenceRefs: reviewer.effectiveContract.inputRefs, limitations: ['no EDA'] });
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
  await send('atcs_size_cell', { instance: 'U1', toMaster: 'BUF2', planSha256: planHash }, 'mutation');
  const duplicate = await interactive({ action: 'input', requestId: 'mutation', commandId: 'mutation', toolSessionId,
    command: { name: 'atcs_size_cell', args: { instance: 'U1', toMaster: 'BUF2', planSha256: planHash } }, waitMs: 0 });
  assert.equal(duplicate.status, 'duplicate');
  await send('atcs_dump_cells', { path: path.join(slotRoot, 'after.dump') }, 'after');
  await send('atcs_export_changes', {}, 'export');
  await send('atcs_close', {}, 'exit');
  await waitUntil('ATCS synthetic Operator is ready', () => control().executions[executionId]?.phase === 'ready', 5000, 25);
  await resultAndAdopt(operator, { schema: 'atcs-worker-receipts/1', planSha256: planHash, mutationReceipt: 'mutation',
    limitations: ['synthetic Tcl; no commercial qualification'] });
  const completed = await host.ctx.hima.executionAction({ runId, actor, action: 'complete', executionId,
    requestId: 'complete', expectedEpoch: control().epoch, expectedRevision: control().revision });
  assert.equal(completed.kind, 'accepted', JSON.stringify(completed));
  assert.equal(host.ctx.hima.ledger.run(runId)!.currentNode, 'capture-worker-01');
  for (const nodeId of ['capture-worker-01', 'read-worker-result-01', 'collect']) {
    assert.equal(host.ctx.hima.ledger.run(runId)!.currentNode, nodeId);
    const begun = await host.ctx.hima.executionAction({ runId, actor, action: 'begin', nodeId,
      requestId: 'begin-' + nodeId, expectedEpoch: control().epoch, expectedRevision: control().revision });
    assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
    const id = begun.receipt!.executionId!;
    const work = await host.ctx.hima.executionAction({ runId, actor, action: 'work', executionId: id,
      requestId: 'work-' + nodeId, expectedEpoch: control().epoch, expectedRevision: control().revision });
    assert.notEqual(work.kind, 'refused', JSON.stringify(work));
    await waitUntil('ATCS node ready: ' + nodeId, () => control().executions[id]?.phase === 'ready', 10000, 25);
    const done = await host.ctx.hima.executionAction({ runId, actor, action: 'complete', executionId: id,
      requestId: 'complete-' + nodeId, expectedEpoch: control().epoch, expectedRevision: control().revision });
    assert.equal(done.kind, 'accepted', JSON.stringify(done));
  }
  const joined = JSON.parse(await readFile(path.join(workspace, 'state/contributions-collected.json'), 'utf8'));
  assert.equal(joined.contributions.length, 1);
  assert.deepEqual(joined.pending, [], 'parked slots are not falsely reported as pending work');
  assert.equal(joined.contributions[0].operations.length, 1);
  assert.equal(joined.contributions[0].operations[0].toMaster, 'BUF2');
  assert.equal((await readFile(path.join(slotRoot, 'ops.jsonl'), 'utf8')).trim().split('\n').length, 1);
});
const atcsXtopOperatorWrapper = '/data/eda/project/hima_harness/operator-admin/atcs-v9/atcs-xtop-operator-v9.sh';

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
    licences: { innovus: 1, primetime: 1, starrc: 1, xtop: 1 },
  });

  const packDir = path.join(repoRoot, 'packs', packId);
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const team = pack.contract.agentTeams.find(item => item.id === 'atcs-worker-01')!;
  const researcher = team.members.find(item => item.id === 'researcher')!;
  assert.equal(team.version, '3');
  assert.equal(researcher.budgetShare.maxTokensPerTurn, 8000);
  assert.equal(researcher.budgetShare.maxFollowups, 1);
  assert.match(researcher.taskTemplate, /at most one hypothesis per declared action/);
  for (const [id, followups] of [['reviewer', 1], ['operator', 0]] as const) {
    const member = team.members.find(item => item.id === id)!;
    assert.equal(member.budgetShare.maxTokensPerTurn, 5000);
    assert.equal(member.budgetShare.maxFollowups, followups);
  }
  assert.equal(packStage(packDir).stage, 'compiled');
  assert.equal(pack.graph.nodes.length, 106);
  // Final review (Minor): +2 edges -- check-setup-goal/check-hold-goal each gain
  // an explicit UNDETERMINED edge to `residual` (an unknown final WNS is an
  // evidence gap, not a person-facing wait) instead of falling through to the
  // engine's own unlabelled-UNDETERMINED default (wait-for-person).
  assert.equal(pack.graph.edges.length, 143);

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
    assert.match(throughHost.text, /agentic-timing-closure-system@0\.1\.9.*fit/s);
  } finally { await host.dispose(); }

  const tests = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(packDir, 'flow/tests'), '-v'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});
