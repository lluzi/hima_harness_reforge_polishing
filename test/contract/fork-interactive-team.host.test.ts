// ATCS #64 Task 2: a fork whose branches each hold an interactive EDA Job driven by its own Agent
// Team (Researcher -> Reviewer -> Operator), run at once and joined at one judge.
//
// The fork-join suite (`fork-join.test.ts`) proves batch branches through the desktop driver; this
// file proves the interactive-Team shape the ATCS Pack forks into, through the real in-process Host
// with the owner-driven execution actions a conversational Run owner calls. Each branch is
// `workshop -> reader -> interactive tool (Team) -> capture tool`; the join is one judge node.
//
// Replayed children stand in for models and the synthetic Tcl REPL stands in for XTop: this proves
// admission, identity, concurrency and join mechanics, never model quality or EDA results.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import {
  BUILTIN_TCL_ADAPTER_DIGEST, delegationRuntimePolicy, interactiveCommandsDigest, loadPack, packDigestExcludes, runDelegations,
  type ExecutionActionRequest, type ExecutionActionResult, type JobRecord, type LedgerRecord, type RunView,
} from '@hima/harness';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { killSessions, localHome, sessionsOf, waitUntil } from './support/fabric.ts';
import { writeMomentScenario } from './support/moments.ts';
import { writeLocalSite } from './support/site.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const packId = 'fork-interactive-team';
const branches = [
  { id: 'a', workshop: 'plan-a', read: 'read-plan-a', operate: 'operate-a', capture: 'capture-a', output: 'planA', team: 'team-a', toMaster: 'BUF2' },
  { id: 'b', workshop: 'plan-b', read: 'read-plan-b', operate: 'operate-b', capture: 'capture-b', output: 'planB', team: 'team-b', toMaster: 'BUF4' },
] as const;
type Branch = (typeof branches)[number];

const member = (branch: Branch, id: 'researcher' | 'reviewer' | 'operator', extra: Record<string, unknown>) => ({
  id, role: id, node: branch.operate, taskTemplate: `Return the branch ${branch.id} ${id} result as one JSON object.`,
  inputs: [branch.output], allowedTools: ['hima_delegation_input'], scopePolicy: 'declared-inputs-only',
  budgetShare: { maxElapsedMs: 30_000, maxFollowups: 0 }, dependencyRoles: [],
  resultSchema: { id: `fixture-${id}/1`, required: ['schema'] }, recipient: 'run-owner',
  ownerAdoption: 'required', identity: 'one-child-per-role-per-execution', followup: 'forbidden',
  cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
  refusalConditions: ['missing-evidence'], ...extra,
});

/** Each member's time share; the Researcher and Reviewer may keep one follow-up, as the ATCS workers do. */
interface Shares { readonly shareMs: number; readonly advisorFollowups: number }
const defaultShares: Shares = { shareMs: 30_000, advisorFollowups: 0 };
const shareOf = (shares: Shares, followups: number) => ({
  budgetShare: { maxElapsedMs: shares.shareMs, maxFollowups: followups }, followup: followups === 0 ? 'forbidden' : 'reuse-same-child' });

/** One Team per branch, each triggered by that branch's own interactive node. */
const teamOf = (branch: Branch, shares: Shares) => ({ id: branch.team, version: '1', triggerNode: branch.operate, members: [
  member(branch, 'researcher', { resultSchema: { id: 'fixture-research/1', required: ['schema', 'hypotheses'] }, ...shareOf(shares, shares.advisorFollowups) }),
  member(branch, 'reviewer', { dependencyRoles: ['researcher'], ...shareOf(shares, shares.advisorFollowups),
    resultSchema: { id: 'fixture-review/1', required: ['schema', 'planSha256', 'command', 'arguments'] } }),
  member(branch, 'operator', { ...shareOf(shares, 0), allowedTools: ['hima_interactive'], scopePolicy: 'site-qualified-interactive-only',
    dependencyRoles: ['reviewer'], resultSchema: { id: 'fixture-operator/1', required: ['schema'] },
    reviewedAction: { fromRole: 'reviewer', planInput: branch.output, actionListField: 'actions', command: 'atcs_size_cell',
      hostPlanHashArgument: 'planSha256', planHashField: 'planSha256', commandField: 'command', argumentsField: 'arguments' } }),
] });

async function writeForkPack(packsDir: string, tclsh: string, shares: Shares): Promise<string> {
  const dir = path.join(packsDir, packId);
  await mkdir(path.join(dir, 'flow'), { recursive: true });
  await mkdir(path.join(dir, 'readers'), { recursive: true });
  await mkdir(path.join(dir, 'rules'), { recursive: true });
  await mkdir(path.join(dir, 'tools'), { recursive: true });
  const repl = ['${WORKSPACE}/flow/atcs-repl.tcl', '${WORKSPACE}/research/branch-${SLOT}'];
  const contract = {
    id: packId, version: '1', title: 'Two interactive Team branches joined at one judge',
    inputs: [
      { name: 'flowRoot', description: 'Unused legacy flow root' },
      { name: 'design', description: 'Unused legacy design' },
      { name: 'workspaceRoot', description: 'Campaign workspaces' },
    ],
    outputs: [
      { name: 'seed', path: 'flow/seed.txt', description: 'What the fork source reads' },
      ...branches.map((branch) => ({ name: branch.output, path: `research/branch-${branch.id}/plan.json`,
        reader: 'plan-file', description: `Branch ${branch.id} fix plan` })),
    ],
    environment: { wrappers: ['sh', tclsh] },
    workspace: { source: 'pack', copy: ['seed.txt', 'atcs-repl.tcl', 'capture.sh'] },
    workshops: branches.map((branch) => ({
      id: branch.workshop, purpose: `Write branch ${branch.id}'s one-action fix plan.`,
      directory: `research/branch-${branch.id}`, entry: 'entry.sh', language: 'sh', produces: branch.output,
      argv: ['sh', '${ENTRY}', '${WORKSHOP}', '${WORKSPACE}'],
    })),
    tools: [
      { id: 'operator', file: 'flow/atcs-repl.tcl', description: 'One branch slot of the synthetic interactive REPL.',
        inputs: ['WORKSPACE', 'SLOT'], licences: { xtop: 1 }, argv: [tclsh, ...repl],
        interactive: { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', argv: [tclsh, ...repl],
          commands: { read: ['atcs_query_paths'], mutate: ['atcs_size_cell'], save: ['atcs_dump_cells', 'atcs_export_changes'], close: ['atcs_close'] },
          arguments: {
            atcs_query_paths: [],
            atcs_size_cell: [{ name: 'instance', type: 'string' }, { name: 'toMaster', type: 'string' }, { name: 'planSha256', type: 'string' }],
            atcs_dump_cells: [{ name: 'path', type: 'string' }], atcs_export_changes: [], atcs_close: [],
          } } },
      { id: 'capture', file: 'flow/capture.sh', description: 'Seal one branch slot\'s operation log.',
        inputs: ['WORKSPACE', 'SLOT'], argv: ['sh', '${WORKSPACE}/flow/capture.sh', '${WORKSPACE}/research/branch-${SLOT}'] },
    ],
    agentTeams: branches.map((branch) => teamOf(branch, shares)),
    rules: ['plan-has-action'],
    strategy: { width: { type: 'number', unit: 'count', min: 1, max: 4, default: 2 } },
    words: { width: { label: 'fork width', unit: 'count' } },
  };
  const graph = {
    id: packId, version: '1', entry: 'start',
    nodes: [
      { id: 'start', kind: 'act', parameters: { observes: 'seed' } },
      ...branches.flatMap((branch) => [
        { id: branch.workshop, kind: 'act', parameters: { workshop: branch.workshop } },
        { id: branch.read, kind: 'act', parameters: { observes: branch.output } },
        { id: branch.operate, kind: 'act', parameters: { tool: 'operator', arguments: { SLOT: branch.id } } },
        { id: branch.capture, kind: 'act', parameters: { tool: 'capture', arguments: { SLOT: branch.id } } },
      ]),
      { id: 'judge', kind: 'judge', parameters: { rules: ['plan-has-action'] } },
      // Outside every fork: the same interactive tool at the Run's own cursor, after the join.
      { id: 'operate-main', kind: 'act', parameters: { tool: 'operator', arguments: { SLOT: 'main' } } },
      { id: 'blocked', kind: 'wait', parameters: { blocker: 'hard-blocker' } },
    ],
    edges: branches.flatMap((branch) => [
      { from: 'start', to: branch.workshop },
      { from: branch.workshop, to: branch.read },
      { from: branch.read, to: branch.operate },
      { from: branch.operate, to: branch.capture },
      { from: branch.capture, to: 'judge' },
    ]).concat([{ from: 'judge', to: 'operate-main', outcome: 'PASS' }, { from: 'judge', to: 'blocked', outcome: 'FAIL' }] as never[]),
  };
  const values = { plan_action_count: { unit: 'count', description: 'Actions in one branch fix plan' } };
  await writeFile(path.join(dir, 'contract.yml'), stringify(contract));
  await writeFile(path.join(dir, 'graph.yml'), stringify(graph));
  await writeFile(path.join(dir, 'semantics.yml'), stringify({ values }));
  await writeFile(path.join(dir, 'PACK.md'), '# Fork of interactive Team branches (test fixture)\n');
  await writeFile(path.join(dir, 'readers/plan-file.yml'), stringify({ id: 'plan-file', version: '1', file: 'tools/read-plan.sh',
    argv: ['sh', '${READER}', '${REPORT}', '${OUT}'], reportKind: 'fix-plan', emits: ['plan_action_count'] }));
  await writeFile(path.join(dir, 'rules/plan-has-action.yml'), stringify({ id: 'plan-has-action', version: '1',
    title: 'The branch plan names at least one action', requires: [{ type: 'plan_action_count' }],
    subject: { type: 'plan_action_count' }, predicate: { op: 'gte', threshold: 1, unit: 'count' } }));
  await writeFile(path.join(dir, 'tools/read-plan.sh'), [
    '#!/bin/sh', 'set -eu', 'count=$(grep -o \'"instance"\' "$1" | wc -l | tr -d " ")',
    'printf \'{"values":[{"type":"plan_action_count","unit":"count","value":%s}]}\\n\' "$count" > "$2"', '',
  ].join('\n'));
  await writeFile(path.join(dir, 'flow/seed.txt'), 'two branches\n');
  await writeFile(path.join(dir, 'flow/capture.sh'), '#!/bin/sh\nset -eu\ncp "$1/ops.jsonl" "$1/captured.jsonl"\n');
  await cp(path.join(repoRoot, 'test/fixtures/interactive-job/atcs-repl.tcl'), path.join(dir, 'flow/atcs-repl.tcl'));
  return dir;
}

/** The admin binding and environment evidence for the pack's one interactive tool, on this Site. */
async function writeBinding(home: string, packsDir: string, tclsh: string, workspaceRoot: string): Promise<string> {
  let pack: ReturnType<typeof loadPack>;
  try { pack = loadPack(packsDir, packId); } catch (error) { throw new Error(`fixture pack refused: ${JSON.stringify((error as { issues?: unknown }).issues ?? String(error))}`); }
  const digest = pack.folder.digest(packDigestExcludes);
  const tool = pack.contract.tools.find((item) => item.id === 'operator')!;
  const admin = path.join(home, 'admin'); await mkdir(admin, { recursive: true });
  const environmentFile = path.join(admin, 'environment.json');
  const environment = JSON.stringify({
    schema: 'hima-interactive-environment/1', site: 'local', toolId: tool.id,
    pack: { id: packId, digest }, adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST },
    commandsDigest: interactiveCommandsDigest(tool),
    wrapper: { path: tclsh, sha256: createHash('sha256').update(await readFile(tclsh)).digest('hex') },
    image: { reference: 'local/fork-team-test', digest: `sha256:${'0'.repeat(64)}` },
    sourceTemplate: { path: tool.file, sha256: createHash('sha256').update(await readFile(path.join(pack.dir, tool.file))).digest('hex') },
    confinement: { rootFilesystem: 'read-only', dataRoot: '/', dataMount: 'read-only', privateWriteRoot: workspaceRoot,
      network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
    qualification: { status: 'passed', transcriptSha256: '1'.repeat(64), logicalEcoSha256: '2'.repeat(64),
      physicalEcoSha256: '3'.repeat(64), xtopReady: true, identityQuery: true, mutation: true, save: true,
      sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
  });
  await writeFile(environmentFile, environment);
  const bindingsFile = path.join(admin, 'bindings.json');
  await writeFile(bindingsFile, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [{
    id: 'fork-team-local', site: 'local', packDigest: digest, toolId: tool.id,
    adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(tool),
    environment: { id: 'fork-team-local', file: environmentFile, sha256: createHash('sha256').update(environment).digest('hex') },
    mutation: 'qualified',
  }] }));
  return bindingsFile;
}

/** The most Jobs of this Run the ledger ever held open at one instant: launched minus settled, in seq order. */
function mostOpenAtOnce(records: readonly LedgerRecord[]): number {
  let open = 0; let most = 0; const live = new Set<string>();
  for (const record of records) {
    if (record.type !== 'job') continue;
    if (record.event === 'launched') { live.add(record.job.session); open = live.size; }
    else live.delete(record.job.session);
    most = Math.max(most, open);
  }
  return most;
}

interface Driven {
  readonly host: InProcessHost; readonly runId: string; readonly actor: string; readonly workspace: string;
  /** A second Run of the same Pack on the same Site, owned by a second conversation. */
  readonly another: () => Promise<Driven>;
}

/** A booted Host with one Run of the fixture Pack started on a local Site declaring `parallelJobs` slots. */
async function forkedCampaign(t: TestContext, parallelJobs: number, check: (driven: Driven) => Promise<void>, shares: Shares = defaultShares): Promise<void> {
  const prior = process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'fork-team-local';
  t.after(() => { if (prior === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = prior; });
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local, 'the local stand-in home must be available');
  const { h, flow } = local;
  const workspaceRoot = await realpath(h.workspace);
  const tclsh = await realpath('/usr/bin/tclsh');
  const packsDir = path.join(h.home, 'hima/packs');
  await writeForkPack(packsDir, tclsh, shares);
  const bindingsFile = await writeBinding(h.home, packsDir, tclsh, workspaceRoot);
  // Two XTop seats, so only the Job cap under test decides how many interactive Jobs fit at once.
  const site = await writeLocalSite(h, { allowedReadRoots: [workspaceRoot, flow.root, path.dirname(tclsh)], allowedWriteRoots: [workspaceRoot],
    allowedWrappers: ['sh', tclsh], bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot },
    licences: { xtop: 2 }, parallelJobs });
  const scenario = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`);
  const host = await bootInProcess(h);
  const runIds: string[] = [];
  const start = async (): Promise<Driven> => {
    const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
    const started = await host.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 }, ownerSessionId: actor, timeBoxMs: 180_000 });
    assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('unreachable');
    runIds.push(started.run.id);
    assert.ok(started.workspace);
    return { host, runId: started.run.id, actor, workspace: started.workspace, another: start };
  };
  try {
    await check(await start());
  } finally {
    for (const runId of runIds) {
      try { await host.ctx.hima.cancelRun(runId); } catch { /* already ended */ } finally { killSessions(sessionsOf(host, runId)); }
    }
    try { await host.dispose(); } finally { await h.dispose(); }
  }
}

/** The owner's explicit calls. Nothing here picks or starts a successor on its own. */
function ownerCalls({ host, runId, actor, workspace }: Driven) {
  let serial = 0;
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const context = () => host.ctx.hima.executionContext(runId);
  const records = () => host.ctx.hima.ledger.records({ runId });
  const jobs = () => records().filter((record): record is JobRecord => record.type === 'job');
  const interactiveJobs = (event?: JobRecord['event']) =>
    jobs().filter((record) => record.nodeId?.startsWith('operate-') && (event === undefined || record.event === event));
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}): Promise<ExecutionActionResult> =>
    host.ctx.hima.executionAction({ runId, actor, expectedEpoch: control().epoch, expectedRevision: control().revision,
      requestId: `fork-team-${++serial}`, action, ...fields });
  const phase = (executionId: string) => control().executions[executionId]?.phase;
  const begin = async (nodeId: string): Promise<string> => {
    const begun = await act('begin', { nodeId });
    assert.equal(begun.kind, 'accepted', `begin ${nodeId}: ${JSON.stringify(begun.reason ?? begun)}`);
    return begun.receipt!.executionId!;
  };
  const workAndComplete = async (nodeId: string, executionId: string) => {
    const worked = await act('work', { executionId });
    assert.equal(worked.kind, 'accepted', `work ${nodeId}: ${JSON.stringify(worked.reason ?? worked)}`);
    await waitUntil(`${nodeId} settles its own work`, () => ['ready', 'failed'].includes(phase(executionId) ?? ''), 30_000, 25);
    assert.equal(phase(executionId), 'ready', `${nodeId}: ${JSON.stringify(control().executions[executionId])}`);
    const done = await act('complete', { executionId });
    assert.equal(done.kind, 'accepted', `complete ${nodeId}: ${JSON.stringify(done.reason ?? done)}`);
  };
  const node = async (nodeId: string) => { const id = await begin(nodeId); await workAndComplete(nodeId, id); return id; };
  const create = (branch: Branch, memberId: string, executionId: string) => host.ctx.hima.delegate({ runId, actor, action: 'create',
    requestId: `create-${branch.id}-${memberId}-${++serial}`, expectedEpoch: control().epoch, expectedRevision: control().revision,
    recipe: { teamId: branch.team, version: '1', memberId, executionId } } as never) as Promise<Record<string, any>>;
  // Deterministic model stand-ins use the production Ledger handoff shape; no model-quality claim.
  const resultAndAdopt = async (delegationId: string, value: unknown) => {
    const row = runDelegations((host.ctx.hima as any).deps(), runId).find((item) => item.delegationId === delegationId)!;
    const text = JSON.stringify(value);
    const record = await host.ctx.hima.ledger.appendDelegation(runId, { delegationId, parentSessionId: actor,
      childSessionId: row.childSessionId, requestId: `result-${delegationId}`, requestDigest: 'a'.repeat(64),
      event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
        outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
        contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
        output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
        unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['synthetic model result'] },
      } } });
    const adoption = await host.ctx.hima.delegate({ runId, actor, action: 'adopt', delegationId, resultRecordId: record.id,
      requestId: `adopt-${delegationId}`, expectedEpoch: control().epoch, expectedRevision: control().revision } as never) as Record<string, any>;
    assert.equal(adoption.status, 'accepted', JSON.stringify(adoption));
  };
  const slot = (branch: Branch) => path.join(workspace, `research/branch-${branch.id}`);
  return { control, context, records, jobs, interactiveJobs, act, phase, begin, workAndComplete, node, create, resultAndAdopt, slot };
}

/**
 * Drive the fork to the moment both Operators are created: `start` opens the fork, each branch's
 * Workshop writes its own plan and its Reader reads it, both interactive executions are begun, and
 * each branch's Team (Researcher -> Reviewer -> Operator) is materialized for its own execution.
 * Everything a branch holds is asserted to be that branch's own on the way.
 */
async function teamsReady(driven: Driven, owner: ReturnType<typeof ownerCalls>) {
  const { control, context, records, act, begin, workAndComplete, node, create, resultAndAdopt } = owner;
  await node('start');
  assert.deepEqual([...context().available].sort(), ['plan-a', 'plan-b'], 'the fork opens at start and launches nothing');
  assert.ok(context().run.fork, 'the Run stands inside the fork');
  for (const branch of branches) {
    const executionId = await begin(branch.workshop);
    assert.equal((await act('recommend', { executionId })).kind, 'accepted');
    const plan = JSON.stringify({ actions: [{ instance: 'U1', toMaster: branch.toMaster }] });
    const script = `mkdir -p "$2/research/branch-${branch.id}"\nprintf '%s\\n' '${plan}' > "$2/research/branch-${branch.id}/plan.json"\n`;
    const written = await act('write', { executionId, path: 'entry.sh', content: script });
    assert.equal(written.kind, 'accepted', JSON.stringify(written.reason ?? written));
    await workAndComplete(branch.workshop, executionId);
    await node(branch.read);
  }
  assert.deepEqual([...context().available].sort(), ['operate-a', 'operate-b']);

  const operate = new Map<string, string>();
  for (const branch of branches) operate.set(branch.id, await begin(branch.operate));
  for (const branch of branches) {
    assert.equal(control().executions[operate.get(branch.id)!]!.branchId, branch.workshop, `${branch.operate} is admitted in its own branch`);
  }
  const crossed = await create(branches[0], 'researcher', operate.get('b')!);
  assert.equal(crossed.status, 'refused', 'team-a materialized on operate-b\'s execution is refused');
  assert.match(crossed.reason, /exact freshly begun target execution/, 'a Team member binds only to its own node\'s execution');

  const operatorOf = new Map<string, string>(); const planHashOf = new Map<string, string>();
  for (const branch of branches) {
    const executionId = operate.get(branch.id)!;
    const plan = records().findLast((record) => record.type === 'observation' && record.branchId === branch.workshop && record.reader.id === 'plan-file');
    assert.ok(plan?.type === 'observation', `branch ${branch.id} holds its own plan reading`);
    planHashOf.set(branch.id, plan.contentSha256);
    const researcher = await create(branch, 'researcher', executionId);
    assert.equal(researcher.status, 'created', JSON.stringify(researcher));
    assert.deepEqual(researcher.effectiveContract.inputRefs, [plan.id], `branch ${branch.id}'s Researcher reads its own plan only`);
    await resultAndAdopt(researcher.effectiveContract.delegationId, { schema: 'fixture-research/1', hypotheses: [`size U1 to ${branch.toMaster}`] });
    const reviewer = await create(branch, 'reviewer', executionId);
    assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
    await resultAndAdopt(reviewer.effectiveContract.delegationId, { schema: 'fixture-review/1', planSha256: plan.contentSha256,
      command: 'atcs_size_cell', arguments: { instance: 'U1', toMaster: branch.toMaster } });
    const operator = await create(branch, 'operator', executionId);
    assert.equal(operator.status, 'created', JSON.stringify(operator));
    operatorOf.set(branch.id, operator.receipt.childSessionId as string);
  }
  for (const branch of branches) {
    const own = runDelegations((driven.host.ctx.hima as any).deps(), driven.runId).filter((row) => row.effective.recipe?.teamId === branch.team);
    assert.deepEqual(own.map((row) => row.effective.recipe?.memberId).sort(), ['operator', 'researcher', 'reviewer']);
    for (const row of own) {
      assert.equal(row.effective.recipe?.executionId, operate.get(branch.id), `${branch.team}/${row.effective.recipe?.memberId} belongs to ${branch.operate}'s execution`);
      assert.equal(row.contract.nodeRef, branch.operate);
    }
  }
  const interactive = (branch: Branch, body: Record<string, unknown>, as = operatorOf.get(branch.id)!) =>
    driven.host.ctx.hima.interactive(as, { runId: driven.runId, executionId: operate.get(branch.id)!, nodeId: branch.operate,
      ownerEpoch: control().epoch, controlRevision: control().revision, ...body }) as Promise<Record<string, any>>;
  const send = (branch: Branch, toolSessionId: string, name: string, args: Record<string, unknown>, id: string) => interactive(branch, {
    action: 'input', requestId: `${id}-${branch.id}`, commandId: `${id}-${branch.id}`, toolSessionId, command: { name, args }, waitMs: 5_000 });
  /** One Operator's whole reviewed session after its open: dump, the one mutation, dump, export, close. */
  const operateOnce = async (branch: Branch, toolSessionId: string) => {
    for (const [step, [name, args]] of reviewedSteps(owner, planHashOf).entries()) {
      const sent = await send(branch, toolSessionId, name, args(branch), `step-${step}`);
      assert.equal(sent.status, 'completed', `${name} in branch ${branch.id}: ${JSON.stringify(sent)}`);
    }
  };
  /** Settle one branch's interactive execution: its Job exited, the Operator's result adopted, the node completed. */
  const settleOperate = async (branch: Branch) => {
    await waitUntil(`branch ${branch.id} interactive execution is ready`, () => owner.phase(operate.get(branch.id)!) === 'ready', 10_000, 25);
    const row = runDelegations((driven.host.ctx.hima as any).deps(), driven.runId).find((item) => item.childSessionId === operatorOf.get(branch.id))!;
    await resultAndAdopt(row.delegationId, { schema: 'fixture-operator/1', planSha256: planHashOf.get(branch.id), mutationReceipt: `step-1-${branch.id}` });
    const done = await act('complete', { executionId: operate.get(branch.id)! });
    assert.equal(done.kind, 'accepted', JSON.stringify(done.reason ?? done));
  };
  return { operate, operatorOf, planHashOf, interactive, send, operateOnce, settleOperate };
}

/** The Operator's reviewed session, as the ATCS Operator runs it; `close` ends the REPL and its Job. */
const reviewedSteps = (owner: ReturnType<typeof ownerCalls>, planHashOf: ReadonlyMap<string, string>):
  readonly (readonly [string, (branch: Branch) => Record<string, unknown>])[] => [
  ['atcs_dump_cells', (branch) => ({ path: path.join(owner.slot(branch), 'before.dump') })],
  ['atcs_size_cell', (branch) => ({ instance: 'U1', toMaster: branch.toMaster, planSha256: planHashOf.get(branch.id) })],
  ['atcs_dump_cells', (branch) => ({ path: path.join(owner.slot(branch), 'after.dump') })],
  ['atcs_export_changes', () => ({})],
  ['atcs_close', () => ({})],
];

test('two fork branches each hold an interactive Job driven by their own Team at once, and the join waits for both captures', async (t) => {
  await forkedCampaign(t, 2, async (driven) => {
    const owner = ownerCalls(driven);
    const { context, records, interactiveJobs, act, node, slot, control } = owner;
    const team = await teamsReady(driven, owner);
    const { interactive, send, settleOperate, planHashOf, operatorOf } = team;

    // One branch's Operator holds no grant on the other branch's execution.
    await assert.rejects(interactive(branches[1], { action: 'open', requestId: 'foreign-open' }, operatorOf.get('a')!),
      (error: { code?: string }) => error.code === 'hima/not-authorized', 'operator a holds no grant on branch b\'s execution');
    assert.equal(interactiveJobs().length, 0, 'a refused foreign open launches nothing');

    // Both branches open their interactive Job in the same instant; neither's admission refuses the other's.
    const opened = await Promise.all(branches.map((branch) => interactive(branch, { action: 'open', requestId: `open-${branch.id}` })));
    for (const [index, result] of opened.entries()) assert.equal(result.status, 'opened', `branch ${branches[index]!.id}: ${JSON.stringify(result)}`);
    const sessionOf = new Map(branches.map((branch, index) => [branch.id, opened[index]!.session.toolSessionId as string]));
    assert.deepEqual(interactiveJobs('launched').map((record) => [record.nodeId, record.branchId]).sort(),
      [['operate-a', 'plan-a'], ['operate-b', 'plan-b']], 'each interactive launch names its node and the branch it belongs to');
    assert.equal(interactiveJobs().filter((record) => record.event !== 'launched').length, 0, 'both interactive Jobs are open at once: neither has settled');

    // One open Job per execution still holds inside a branch.
    const again = await interactive(branches[0], { action: 'open', requestId: 'open-a-again' });
    assert.equal(again.status, 'refused', JSON.stringify(again));
    assert.equal(interactiveJobs('launched').length, 2, 'the refused second open of one execution launched nothing');

    // The cap is pressed: with both slots held by the branches' interactive Jobs, a third Job on the
    // same Site (a second Run's Workshop) is refused and launches nothing.
    const rival = ownerCalls(await driven.another());
    await rival.node('start');
    const rivalPlan = await rival.begin('plan-a');
    assert.equal((await rival.act('recommend', { executionId: rivalPlan })).kind, 'accepted');
    assert.equal((await rival.act('write', { executionId: rivalPlan, path: 'entry.sh', content: 'exit 0\n' })).kind, 'accepted');
    assert.equal((await rival.act('work', { executionId: rivalPlan })).kind, 'accepted');
    const pressed = rival.control().executions[rivalPlan]!;
    assert.deepEqual([pressed.phase, pressed.result], ['begun', { kind: 'at-cap',
      reason: 'site local is running 2 jobs against a cap of 2; nothing was launched' }], 'a third Job at a Site cap of two is held back');
    assert.equal(rival.jobs().filter((record) => record.event === 'launched').length, 0, 'the rival Run launched nothing');

    // Each Operator applies only its own reviewed action, with both sessions live and their commands interleaved.
    const crossed = await send(branches[1], sessionOf.get('b')!, 'atcs_size_cell',
      { instance: 'U1', toMaster: branches[0].toMaster, planSha256: planHashOf.get('b') }, 'crossed');
    assert.equal(crossed.status, 'refused', `branch b cannot apply branch a's reviewed action: ${JSON.stringify(crossed)}`);
    for (const [step, [name, args]] of reviewedSteps(owner, planHashOf).entries()) {
      const sent = await Promise.all(branches.map((branch) => send(branch, sessionOf.get(branch.id)!, name, args(branch), `step-${step}`)));
      for (const [index, result] of sent.entries()) assert.equal(result.status, 'completed', `${name} in branch ${branches[index]!.id}: ${JSON.stringify(result)}`);
    }
    for (const branch of branches) await settleOperate(branch);
    for (const branch of branches) {
      const ops = (await readFile(path.join(slot(branch), 'ops.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(ops.map((op) => op.args.toMaster), [branch.toMaster], `branch ${branch.id}'s REPL applied only its own reviewed action`);
    }

    // The join waits for both captures: one captured branch leaves the judge unavailable.
    assert.deepEqual([...context().available].sort(), ['capture-a', 'capture-b']);
    await node('capture-a');
    assert.deepEqual(context().available, ['capture-b'], 'the join is not available while branch b has not captured');
    assert.equal((await act('begin', { nodeId: 'judge' })).kind, 'refused');
    assert.equal(context().run.fork?.branches['plan-a']?.state, 'done');
    assert.notEqual(context().run.fork?.branches['plan-b']?.state, 'done');
    await node('capture-b');
    assert.deepEqual(context().available, ['judge']);
    for (const branch of branches) {
      const captured = (await readFile(path.join(slot(branch), 'captured.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(captured.map((op) => op.args.toMaster), [branch.toMaster]);
    }
    await node('judge');
    assert.equal(context().run.fork, undefined, 'the join closed the fork');
    assert.deepEqual(records().filter((record) => record.type === 'verdict').map((record) => [record.branchId, record.ruleId, record.outcome]),
      [['plan-a', 'plan-has-action', 'PASS'], ['plan-b', 'plan-has-action', 'PASS']], 'the join judged each branch\'s own reading');

    // The Run view a person reads shows each branch's own Jobs, its interactive session among them.
    const remote = await import(new URL('../../packages/harness/lib/remote.js', import.meta.url).href);
    const view = remote.runView(driven.host.ctx.hima.ledger, driven.host.ctx.hima.ledger.run(driven.runId)!) as RunView;
    assert.deepEqual(view.generations[0]?.branches?.map((branch) => [branch.id, branch.jobs.filter((job) => job.event === 'launched').map((job) => job.nodeId)]),
      branches.map((branch) => [branch.workshop, [branch.workshop, branch.read, branch.operate, branch.capture]]),
      'each branch row carries every Job of its own, its interactive session included');

    // The two interactive Jobs filled the Site's two slots and nothing ever exceeded them.
    assert.equal(mostOpenAtOnce(records()), 2, `the Run's Jobs peaked at the Site cap of two: ${mostOpenAtOnce(records())}`);
    for (const execution of Object.values(control().executions)) {
      const branch = branches.find((item) => [item.workshop, item.read, item.operate, item.capture].includes(execution.nodeId as never));
      assert.equal(execution.branchId, branch?.workshop, `execution of ${execution.nodeId} names its branch`);
    }

    // At the Run's own cursor, outside every fork, a force-closed interactive Job's stop names no branch.
    assert.deepEqual(context().available, ['operate-main']);
    const main = await owner.begin('operate-main');
    await mkdir(path.join(driven.workspace, 'research/branch-main'), { recursive: true });
    const atMain = (body: Record<string, unknown>) => driven.host.ctx.hima.interactive(driven.actor, { runId: driven.runId, executionId: main,
      nodeId: 'operate-main', ownerEpoch: control().epoch, controlRevision: control().revision, ...body }) as Promise<Record<string, any>>;
    const mainOpen = await atMain({ action: 'open', requestId: 'open-main' });
    assert.equal(mainOpen.status, 'opened', JSON.stringify(mainOpen));
    const mainStop = await atMain({ action: 'close', requestId: 'close-main', toolSessionId: mainOpen.session.toolSessionId });
    assert.equal(mainStop.status, 'closed', JSON.stringify(mainStop));
    const mainJobs = interactiveJobs().filter((record) => record.nodeId === 'operate-main');
    assert.deepEqual(mainJobs.map((record) => [record.event, 'branchId' in record]), [['launched', false], ['killed', false]],
      'a main-cursor interactive Job and its stop carry no branchId key');
  });
});

test('under a Site cap of one, the second branch\'s interactive open is refused while the first holds the slot, opens once it is free, and its stop names its branch', async (t) => {
  await forkedCampaign(t, 1, async (driven) => {
    const owner = ownerCalls(driven);
    const { interactiveJobs, records } = owner;
    const { interactive, operateOnce, settleOperate } = await teamsReady(driven, owner);
    const opened = await Promise.all(branches.map((branch) => interactive(branch, { action: 'open', requestId: `open-${branch.id}` })));
    assert.deepEqual(opened.map((result) => result.status).sort(), ['opened', 'refused'], JSON.stringify(opened));
    const first = branches[opened.findIndex((result) => result.status === 'opened')]!;
    const second = branches.find((branch) => branch !== first)!;
    const refused = opened.find((result) => result.status === 'refused')!;
    assert.match(refused.reason, /cap is full/, 'an interactive open at the cap is refused, never queued');
    assert.deepEqual(interactiveJobs('launched').map((record) => record.nodeId), [first.operate], 'the refused open launched nothing');

    await operateOnce(first, opened.find((result) => result.status === 'opened')!.session.toolSessionId);
    await settleOperate(first);
    const retried = await interactive(second, { action: 'open', requestId: `open-${second.id}-retry` });
    assert.equal(retried.status, 'opened', `the freed slot admits the waiting branch: ${JSON.stringify(retried)}`);
    assert.equal(mostOpenAtOnce(records()), 1, 'never more than the one declared slot');

    // A branch's open interactive Job force-closed by its Operator: the stop names the branch it was launched in.
    const stopped = await interactive(second, { action: 'close', requestId: `close-${second.id}`, toolSessionId: retried.session.toolSessionId });
    assert.equal(stopped.status, 'closed', JSON.stringify(stopped));
    assert.deepEqual(interactiveJobs('killed').map((record) => [record.nodeId, record.branchId]), [[second.operate, second.workshop]],
      'the killed record of a branch\'s interactive Job carries that branch');
  });
});

test('two parallel Teams whose shares together exceed the time box are admitted on the Site\'s two lanes, each Operator keeping its declared share', async (t) => {
  // #64 Task 2b. Six 50 s shares in a 180 s box: 300 s in series, but the Run was started on two job lanes (360 s).
  // The Researchers and Reviewers keep a follow-up, so their whole share stays reserved after their results.
  const shares: Shares = { shareMs: 50_000, advisorFollowups: 1 };
  await forkedCampaign(t, 2, async (driven) => {
    const owner = ownerCalls(driven);
    const { operatorOf } = await teamsReady(driven, owner);
    const all = runDelegations((driven.host.ctx.hima as any).deps(), driven.runId);
    assert.equal(all.length, 6, 'both branches\' Teams are admitted in full');
    for (const branch of branches) {
      const operator = all.find((row) => row.childSessionId === operatorOf.get(branch.id))!;
      assert.equal(operator.effective.budgetShare.maxElapsedMs, shares.shareMs,
        `the Host-materialized Operator of branch ${branch.id} keeps its declared share rather than a remainder of shares summed in series`);
    }
    // A share longer than what is left of the box is still refused, even with lane time unreserved.
    const control = owner.control();
    const plan = owner.records().find((record) => record.type === 'observation' && record.reader.id === 'plan-file')!;
    const tooLong = await driven.host.ctx.hima.delegate({ runId: driven.runId, actor: driven.actor, action: 'create', requestId: 'too-long',
      expectedEpoch: control.epoch, expectedRevision: control.revision, contract: { delegationId: 'too-long', role: 'researcher', task: 'Too long.',
        inputRefs: [plan.id], allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 181_000, maxFollowups: 0 }, dependencyIds: [],
        recipient: { kind: 'run-owner', sessionId: driven.actor } } } as never) as Record<string, any>;
    assert.equal(tooLong.status, 'refused', JSON.stringify(tooLong));
    assert.match(tooLong.reason, /Child shares exceed/);
  }, shares);
});

test('the owner advancing one branch leaves the other branch\'s Operator session authority valid (#64 D-T01-2)', async (t) => {
  // Live Record #243: while the owner advanced other branches, worker 02's Operator input was
  // refused before dispatch with "owner, delegated authority, epoch or control revision is stale".
  // An Operator's authority belongs to its own execution; progress in another branch bumps only the
  // Run-wide control revision and must not revoke it.
  await forkedCampaign(t, 2, async (driven) => {
    const owner = ownerCalls(driven);
    const { control, records, act, phase } = owner;
    const { operate, operatorOf, send, operateOnce, planHashOf, interactive } = await teamsReady(driven, owner);
    const [a, b] = branches;
    const opened = await Promise.all(branches.map((branch) => interactive(branch, { action: 'open', requestId: `open-${branch.id}` })));
    for (const [index, result] of opened.entries()) assert.equal(result.status, 'opened', `branch ${branches[index]!.id}: ${JSON.stringify(result)}`);
    const sessionOf = new Map(branches.map((branch, index) => [branch.id, opened[index]!.session.toolSessionId as string]));

    // Branch a runs its whole reviewed session and its Operator result is adopted; branch b's session stays open.
    await operateOnce(a, sessionOf.get(a.id)!);
    await waitUntil('branch a interactive execution is ready', () => phase(operate.get(a.id)!) === 'ready', 10_000, 25);
    const row = runDelegations((driven.host.ctx.hima as any).deps(), driven.runId).find((item) => item.childSessionId === operatorOf.get(a.id))!;
    await owner.resultAndAdopt(row.delegationId, { schema: 'fixture-operator/1', planSha256: planHashOf.get(a.id), mutationReceipt: `step-1-${a.id}` });

    // The owner completes branch a exactly between branch b's admitted input intent and its dispatch.
    const ledger = driven.host.ctx.hima.ledger;
    const original = ledger.appendInteractive.bind(ledger);
    let advance: Promise<ExecutionActionResult> | undefined;
    let revisionAtIntent: number | undefined;
    ledger.appendInteractive = (async (runId: string, data: Parameters<typeof original>[1]) => {
      const appended = await original(runId, data);
      if (advance === undefined && data.event === 'input-intent' && data.executionId === operate.get(b.id)) {
        revisionAtIntent = control().revision;
        advance = act('complete', { executionId: operate.get(a.id)! });
      }
      return appended;
    }) as typeof ledger.appendInteractive;
    t.after(() => { ledger.appendInteractive = original; });

    const first = await send(b, sessionOf.get(b.id)!, 'atcs_dump_cells', { path: path.join(owner.slot(b), 'before.dump') }, 'race');
    ledger.appendInteractive = original;
    assert.ok(advance, 'branch b admitted an input intent while the owner advanced branch a');
    const advanced = await advance;
    assert.equal(advanced.kind, 'accepted', `the owner completes branch a: ${JSON.stringify(advanced.reason ?? advanced)}`);
    assert.ok(control().revision > revisionAtIntent!, 'branch a\'s completion moved the Run-wide control revision');
    assert.equal(phase(operate.get(a.id)!), 'completed');
    assert.equal(first.status, 'completed', `branch b's in-flight input keeps its own execution's authority: ${JSON.stringify(first)}`);
    const lost = records().filter((record) => record.type === 'interactive' && /lost authority|control revision is stale/.test(JSON.stringify(record.payload)));
    assert.deepEqual(lost, [], 'no interactive record carries the stale-authority rejection');

    // Branch b goes on with its reviewed session under the later revision and ends normally.
    for (const [step, [name, args]] of reviewedSteps(owner, planHashOf).entries()) {
      if (step === 0) continue;
      const sent = await send(b, sessionOf.get(b.id)!, name, args(b), `after-${step}`);
      assert.equal(sent.status, 'completed', `${name} in branch b after branch a advanced: ${JSON.stringify(sent)}`);
    }
    await waitUntil('branch b interactive execution is ready', () => phase(operate.get(b.id)!) === 'ready', 10_000, 25);
  });
});

test('a pause on one branch\'s node holds only that branch: the other branch\'s Team result is adopted and the join is reached (#64 review I4)', async (t) => {
  // Live: pause [operate-worker-02] refused every child-result adoption Run-wide, so no other
  // branch could finish and the six-branch join stalled. A node pause holds that node's own
  // execution and branch; the rest of the fork goes on.
  await forkedCampaign(t, 2, async (driven) => {
    const owner = ownerCalls(driven);
    const { act, context, node } = owner;
    const { operate, operatorOf, interactive, operateOnce, settleOperate, planHashOf } = await teamsReady(driven, owner);
    const [a, b] = branches;
    const opened = await Promise.all(branches.map((branch) => interactive(branch, { action: 'open', requestId: `open-${branch.id}` })));
    for (const [index, result] of opened.entries()) assert.equal(result.status, 'opened', `branch ${branches[index]!.id}: ${JSON.stringify(result)}`);
    // Branch a's Operator finishes its session; then the owner holds branch a's node.
    await operateOnce(a, opened[0]!.session.toolSessionId);
    await waitUntil('branch a interactive execution is ready', () => owner.phase(operate.get(a.id)!) === 'ready', 10_000, 25);
    const paused = await act('pause', { nodeId: a.operate });
    assert.equal(paused.kind, 'accepted', JSON.stringify(paused.reason ?? paused));
    const deps = (driven.host.ctx.hima as any).deps();
    assert.equal(delegationRuntimePolicy(deps, operatorOf.get(b.id)!)?.writesAllowed, true, 'branch b\'s Operator keeps its write grant');
    assert.equal(delegationRuntimePolicy(deps, operatorOf.get(a.id)!)?.writesAllowed, false, 'branch a\'s Operator is held');

    // Branch b runs its whole session, its Operator result is adopted and its capture runs.
    await operateOnce(b, opened[1]!.session.toolSessionId);
    await settleOperate(b);
    await node(b.capture);

    // Branch a stays held: its Operator's result cannot be adopted while the pause stands.
    const row = runDelegations(deps, driven.runId).find((item) => item.childSessionId === operatorOf.get(a.id))!;
    const text = JSON.stringify({ schema: 'fixture-operator/1', planSha256: planHashOf.get(a.id) });
    const observed = await driven.host.ctx.hima.ledger.appendDelegation(driven.runId, { delegationId: row.delegationId, parentSessionId: driven.actor,
      childSessionId: row.childSessionId, requestId: `result-${row.delegationId}-held`, requestDigest: 'b'.repeat(64),
      event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
        outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
        contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
        output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
        unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['synthetic model result'] } } } });
    const control = owner.control();
    const heldAdoption = await driven.host.ctx.hima.delegate({ runId: driven.runId, actor: driven.actor, action: 'adopt', delegationId: row.delegationId,
      resultRecordId: observed.id, requestId: `adopt-${row.delegationId}-held`, expectedEpoch: control.epoch, expectedRevision: control.revision } as never) as Record<string, any>;
    assert.equal(heldAdoption.status, 'refused', JSON.stringify(heldAdoption));
    assert.match(heldAdoption.reason, /unheld/);

    // Lifting the pause lets branch a finish, and the join is reached.
    const lifted = await act('continue', { nodeId: a.operate });
    assert.equal(lifted.kind, 'accepted', JSON.stringify(lifted.reason ?? lifted));
    await settleOperate(a);
    await node(a.capture);
    assert.deepEqual(context().available, ['judge'], 'the join is reached once both branches captured');
    await node('judge');
    assert.equal(context().run.fork, undefined, 'the join closed the fork');
    void operate;
  });
});
