// @hima-seam llm-replay direct
// ADR-0016 (user decision 2026-09-29): fork branches drive themselves. A Pack declares `autopilot`
// on a fork (or on a plain path segment) and inside it the Harness takes the node turns the owner
// would take: a branch Workshop is authored by the branch's own child Agent (revised from the
// Reader's itemized problems when the Reader refuses), a reader observes, a Team node materializes
// its required members and adopts each schema-valid result, and the owner is told once, when the Run
// leaves the region. No person inside the loop: a member whose result fails its schema gets one
// repair follow-up and then the branch settles refused. Pause, cancel and the time box still hold.
//
// The fixture is the two-branch interactive-Team fork of `fork-interactive-team.host.test.ts`, with
// the Team reduced to its Operator (scoped by the admitted plan itself) and an optional advisory
// Reviewer the autopilot never waits for. Children are played by this test through the Ledger's
// production handoff shape (`HIMA_TEST_AUTOPILOT_CHILD_RESULTS=ledger`), and the synthetic Tcl REPL
// stands in for XTop: admission, identity, concurrency and join mechanics, never model quality.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import {
  BUILTIN_TCL_ADAPTER_DIGEST, WORKSHOP_ENTRY_SCHEMA, executionAction, interactiveCommandsDigest, loadPack, packDigestExcludes, runDelegations,
  type ExecutionActionRequest, type ExecutionActionResult, type LedgerRecord,
} from '@hima/harness';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { killSessions, localHome, sessionsOf, waitUntil } from './support/fabric.ts';
import { appendReplaySession, writeMomentScenario } from './support/moments.ts';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { writeLocalSite } from './support/site.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS = 'ledger';

const packId = 'branch-autopilot';
const branches = [
  { id: 'a', workshop: 'plan-a', read: 'read-plan-a', operate: 'operate-a', capture: 'capture-a', output: 'planA', problems: 'planAProblems', team: 'team-a', toMaster: 'BUF2' },
  { id: 'b', workshop: 'plan-b', read: 'read-plan-b', operate: 'operate-b', capture: 'capture-b', output: 'planB', problems: 'planBProblems', team: 'team-b', toMaster: 'BUF4' },
] as const;
type Branch = (typeof branches)[number];
const branchNodes = branches.flatMap((branch) => [branch.workshop, branch.read, branch.operate, branch.capture]);

interface Fixture {
  /** The branch child's share when it authors a Workshop entry. */
  readonly authorMs: number;
  /** The Operator's follow-ups: one repair when the member allows it. */
  readonly operatorFollowups: number;
  /** An extra graph edit, for the load-refusal cases. */
  readonly graphEdit?: (graph: Record<string, any>) => void;
  /**
   * Native children (#66 H2b): the autopilot reads each child's own completed turn, and every live
   * model session replays this script. Absent, children are played through the Ledger.
   */
  readonly native?: readonly ReplayEntry[];
  /** The Operator member's declared share (60 s when absent). */
  readonly operatorMs?: number;
  /** The Site's job lanes (2 when absent); a Run's delegation time is its time box on each lane. */
  readonly lanes?: number;
}
const defaults: Fixture = { authorMs: 30_000, operatorFollowups: 1 };

const teamOf = (branch: Branch, fixture: Fixture) => ({ id: branch.team, version: '1', triggerNode: branch.operate, members: [
  // Advisory only: optional, never materialized by the autopilot, and nothing depends on it.
  { id: 'reviewer', role: 'reviewer', optional: true, node: branch.operate, taskTemplate: `Advise branch ${branch.id}'s Operator.`,
    inputs: [branch.output], allowedTools: ['hima_delegation_input'], scopePolicy: 'declared-inputs-only',
    budgetShare: { maxElapsedMs: 30_000, maxFollowups: 0 }, dependencyRoles: [],
    resultSchema: { id: 'fixture-advice/1', required: ['schema'] }, recipient: 'run-owner', ownerAdoption: 'candidate-only',
    identity: 'one-child-per-role-per-execution', followup: 'forbidden', cancellation: 'request-stop-preserve-unknown',
    terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'], refusalConditions: ['missing-evidence'] },
  { id: 'operator', role: 'operator', node: branch.operate, taskTemplate: `Operate branch ${branch.id}'s session inside the plan's scope.`,
    inputs: [branch.output], allowedTools: ['hima_interactive'], scopePolicy: 'site-qualified-interactive-only',
    budgetShare: { maxElapsedMs: fixture.operatorMs ?? 60_000, maxFollowups: fixture.operatorFollowups }, dependencyRoles: [],
    resultSchema: { id: 'fixture-operator/1', required: ['schema', 'planSha256'] }, recipient: 'run-owner', ownerAdoption: 'required',
    identity: 'one-child-per-role-per-execution', followup: fixture.operatorFollowups === 0 ? 'forbidden' : 'reuse-same-child',
    cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
    refusalConditions: ['missing-evidence'], taskInputs: [{ input: branch.output }],
    reviewedAction: { mode: 'request-scope', planInput: branch.output, scopePath: ['scope'], commands: ['atcs_size_cell'],
      maxMutations: 5, hostPlanHashArgument: 'planSha256' } },
] });

async function writePack(packsDir: string, tclsh: string, fixture: Fixture): Promise<string> {
  const dir = path.join(packsDir, packId);
  for (const sub of ['flow', 'readers', 'rules', 'tools']) await mkdir(path.join(dir, sub), { recursive: true });
  const repl = ['${WORKSPACE}/flow/atcs-repl.tcl', '${WORKSPACE}/research/branch-${SLOT}'];
  const contract = {
    id: packId, version: '1', title: 'Two self-driving interactive Team branches joined at one judge',
    inputs: [
      { name: 'flowRoot', description: 'Unused legacy flow root' },
      { name: 'design', description: 'Unused legacy design' },
      { name: 'workspaceRoot', description: 'Campaign workspaces' },
    ],
    outputs: [
      { name: 'seed', path: 'flow/seed.txt', description: 'What the fork source reads' },
      ...branches.flatMap((branch) => [
        { name: branch.output, path: `research/branch-${branch.id}/plan.json`, reader: 'plan-file', description: `Branch ${branch.id} plan` },
        { name: branch.problems, path: `research/branch-${branch.id}/plan.problems.txt`, description: `Branch ${branch.id} plan problems` },
      ]),
    ],
    environment: { wrappers: ['sh', tclsh] },
    workspace: { source: 'pack', copy: ['seed.txt', 'atcs-repl.tcl', 'capture.sh'] },
    workshops: branches.map((branch) => ({
      id: branch.workshop, purpose: `Write branch ${branch.id}'s one-action plan with its scope.`,
      directory: `research/branch-${branch.id}`, entry: 'entry.sh', language: 'sh', produces: branch.output,
      reads: [branch.problems], revision: { refusedWhen: 'plan_problem_count', problems: branch.problems },
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
    agentTeams: branches.map((branch) => teamOf(branch, fixture)),
    rules: ['plan-has-action'],
    strategy: { width: { type: 'number', unit: 'count', min: 1, max: 4, default: 2 } },
    words: { width: { label: 'fork width', unit: 'count' } },
  };
  const graph: Record<string, any> = {
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
      { id: 'finish', kind: 'act', parameters: { observes: 'seed' } },
    ],
    edges: [
      ...branches.flatMap((branch) => [
        { from: 'start', to: branch.workshop },
        { from: branch.workshop, to: branch.read },
        { from: branch.read, to: branch.operate },
        { from: branch.operate, to: branch.capture },
        { from: branch.capture, to: 'judge' },
      ]),
      { from: 'judge', to: 'finish', outcome: 'PASS' }, { from: 'judge', to: 'finish', outcome: 'FAIL' },
      { from: 'judge', to: 'finish', outcome: 'UNDETERMINED' },
    ],
    autopilot: [{ fork: 'start', revisions: 1, author: { maxElapsedMs: fixture.authorMs, maxFollowups: 3 } }],
  };
  fixture.graphEdit?.(graph);
  const values = {
    plan_action_count: { unit: 'count', description: 'Actions in one branch plan' },
    plan_problem_count: { unit: 'count', description: 'Problems the Reader counted in one branch plan' },
  };
  await writeFile(path.join(dir, 'contract.yml'), stringify(contract));
  await writeFile(path.join(dir, 'graph.yml'), stringify(graph));
  await writeFile(path.join(dir, 'semantics.yml'), stringify({ values }));
  await writeFile(path.join(dir, 'PACK.md'), '# Self-driving fork of interactive Team branches (test fixture)\n');
  await writeFile(path.join(dir, 'readers/plan-file.yml'), stringify({ id: 'plan-file', version: '1', file: 'tools/read-plan.sh',
    argv: ['sh', '${READER}', '${REPORT}', '${OUT}'], reportKind: 'fix-plan', emits: ['plan_action_count', 'plan_problem_count'] }));
  await writeFile(path.join(dir, 'rules/plan-has-action.yml'), stringify({ id: 'plan-has-action', version: '1',
    title: 'The branch plan names at least one action', requires: [{ type: 'plan_action_count' }],
    subject: { type: 'plan_action_count' }, predicate: { op: 'gte', threshold: 1, unit: 'count' } }));
  // The Reader counts one problem for a plan with no action, and writes its itemized refusal beside it.
  await writeFile(path.join(dir, 'tools/read-plan.sh'), [
    '#!/bin/sh', 'set -eu', 'count=$(grep -o \'"instance"\' "$1" | wc -l | tr -d " ")',
    'problems=0; [ "$count" -gt 0 ] || problems=1',
    'if [ "$problems" -gt 0 ]; then printf \'1 problem\\n- actions: name at least one action with an instance\\n\' > "${1%.json}.problems.txt";',
    'else printf \'0 problems\\n\' > "${1%.json}.problems.txt"; fi',
    'printf \'{"values":[{"type":"plan_action_count","unit":"count","value":%s},{"type":"plan_problem_count","unit":"count","value":%s}]}\\n\' "$count" "$problems" > "$2"', '',
  ].join('\n'));
  await writeFile(path.join(dir, 'flow/seed.txt'), 'two branches\n');
  await writeFile(path.join(dir, 'flow/capture.sh'), '#!/bin/sh\nset -eu\ncp "$1/ops.jsonl" "$1/captured.jsonl"\n');
  await cp(path.join(repoRoot, 'test/fixtures/interactive-job/atcs-repl.tcl'), path.join(dir, 'flow/atcs-repl.tcl'));
  return dir;
}

/** The admin binding and environment evidence for the pack's one interactive tool, on this Site. */
async function writeBinding(home: string, packsDir: string, tclsh: string, workspaceRoot: string): Promise<string> {
  const pack = loadPack(packsDir, packId);
  const digest = pack.folder.digest(packDigestExcludes);
  const tool = pack.contract.tools.find((item) => item.id === 'operator')!;
  const admin = path.join(home, 'admin'); await mkdir(admin, { recursive: true });
  const environmentFile = path.join(admin, 'environment.json');
  const environment = JSON.stringify({
    schema: 'hima-interactive-environment/1', site: 'local', toolId: tool.id,
    pack: { id: packId, digest }, adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST },
    commandsDigest: interactiveCommandsDigest(tool),
    wrapper: { path: tclsh, sha256: createHash('sha256').update(await readFile(tclsh)).digest('hex') },
    image: { reference: 'local/branch-autopilot-test', digest: `sha256:${'0'.repeat(64)}` },
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
    id: 'branch-autopilot-local', site: 'local', packDigest: digest, toolId: tool.id,
    adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(tool),
    environment: { id: 'branch-autopilot-local', file: environmentFile, sha256: createHash('sha256').update(environment).digest('hex') },
    mutation: 'qualified',
  }] }));
  return bindingsFile;
}

interface Driven { readonly host: InProcessHost; readonly runId: string; readonly owner: string; readonly workspace: string }

/** A booted Host with one Run of the fixture Pack on a local Site with two Job slots and two XTop seats. */
async function campaign(t: TestContext, fixture: Fixture, timeBoxMs: number, check: (driven: Driven) => Promise<void>): Promise<void> {
  const prior = process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'branch-autopilot-local';
  t.after(() => { if (prior === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID; else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = prior; });
  if (fixture.native !== undefined) {
    process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS = 'native';
    t.after(() => { process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS = 'ledger'; });
  }
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local, 'the local stand-in home must be available');
  const { h, flow } = local;
  const workspaceRoot = await realpath(h.workspace);
  const tclsh = await realpath('/usr/bin/tclsh');
  const packsDir = path.join(h.home, 'hima/packs');
  await writePack(packsDir, tclsh, fixture);
  const bindingsFile = await writeBinding(h.home, packsDir, tclsh, workspaceRoot);
  const site = await writeLocalSite(h, { allowedReadRoots: [workspaceRoot, flow.root, path.dirname(tclsh)], allowedWriteRoots: [workspaceRoot],
    allowedWrappers: ['sh', tclsh], bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot }, licences: { xtop: 2 }, parallelJobs: fixture.lanes ?? 2 });
  let scenario = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  if (fixture.native !== undefined) {
    // Replay binds live sessions to scripts by first-call order; every one gets the same script.
    await writeFile(scenario.file, `${JSON.stringify({ version: 0, type: 'session', id: 'native-first', createdAt: 0, cwd: '{{cwd}}' })}\n`);
    await writeFile(scenario.override, `${JSON.stringify(fixture.native)}\n`);
    scenario = { ...scenario, children: [] };
    for (let n = 1; n <= 8; n++) scenario = await appendReplaySession(scenario, `native-${n}`, fixture.native);
  }
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`);
  const host = await bootInProcess(h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, h.workspace);
    const started = await host.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id), timeBoxMs });
    assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('unreachable');
    runId = started.run.id;
    await check({ host, runId, owner: String(owner.id), workspace: started.workspace! });
  } finally {
    if (runId !== undefined) { try { await host.ctx.hima.cancelRun(runId); } catch { /* ended */ } finally { killSessions(sessionsOf(host, runId)); } }
    try { await host.dispose(); } finally { await h.dispose(); }
  }
}

/** The owner's calls and this test's stand-ins for the branch children. */
function players({ host, runId, owner, workspace }: Driven) {
  let serial = 0;
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const run = () => host.ctx.hima.ledger.run(runId)!;
  const records = () => host.ctx.hima.ledger.records({ runId });
  const deps = () => (host.ctx.hima as any).deps();
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}): Promise<ExecutionActionResult> =>
    host.ctx.hima.executionAction({ runId, actor: owner, origin: 'agent', expectedEpoch: control().epoch, expectedRevision: control().revision,
      requestId: `owner-${++serial}`, action, ...fields });
  /** A person's control, re-read and sent again when the autopilot moved the revision under it, as a
   *  person refreshing the page does. */
  const human = async (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}): Promise<ExecutionActionResult> => {
    for (let attempt = 0; ; attempt++) {
      const sent = await host.ctx.hima.executionAction({ runId, actor: owner, origin: 'human', expectedEpoch: control().epoch,
        expectedRevision: control().revision, requestId: `human-${++serial}`, action, ...fields });
      if (sent.kind !== 'refused' || !/revision is stale/.test(sent.reason ?? '') || attempt >= 20) return sent;
    }
  };
  /** One owner-driven node: begin, work, settle, complete. */
  const ownerNode = async (nodeId: string) => {
    const begun = await act('begin', { nodeId }); assert.equal(begun.kind, 'accepted', `begin ${nodeId}: ${begun.reason}`);
    const executionId = begun.receipt!.executionId!;
    assert.notEqual((await act('work', { executionId })).kind, 'refused');
    await waitUntil(`${nodeId} settles`, () => ['ready', 'failed'].includes(control().executions[executionId]?.phase ?? ''), 30_000, 25);
    const done = await act('complete', { executionId }); assert.equal(done.kind, 'accepted', `complete ${nodeId}: ${done.reason}`);
  };
  /** A child's result, in the production handoff shape, appended after anything it already answered. */
  const answer = async (delegationId: string, text: string) => {
    const row = runDelegations(deps(), runId).find((item) => item.delegationId === delegationId)!;
    await host.ctx.hima.ledger.appendDelegation(runId, { delegationId, parentSessionId: owner, childSessionId: row.childSessionId,
      requestId: `result-${delegationId}-${++serial}`.slice(0, 160), requestDigest: 'a'.repeat(64), event: 'result-observed', payload: {
        candidate: true, source: 'native-live-session', handoff: {
          outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
          contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
          output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
          unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['synthetic child result'] },
        } } });
  };
  const delegationRecords = (delegationId: string) => records().filter((record) => record.type === 'delegation' && record.delegationId === delegationId);
  /** The branch Workshop's author child, once the autopilot asked it for an entry it has not yet answered. */
  const authorAsked = async (branch: Branch): Promise<string> => {
    let id = '';
    await waitUntil(`${branch.workshop}'s author is asked`, () => {
      const row = runDelegations(deps(), runId).find((item) => item.delegationId.startsWith(`autopilot-author-${branch.workshop}-`));
      if (row === undefined || row.state !== 'accepted') return false;
      const own = delegationRecords(row.delegationId);
      const asked = own.filter((record) => record.type === 'delegation' && (record.event === 'created' || record.event === 'followup-sent')).at(-1)?.seq ?? 0;
      const answered = own.filter((record) => record.type === 'delegation' && record.event === 'result-observed').at(-1)?.seq ?? 0;
      id = row.delegationId;
      return asked > answered;
    }, 60_000, 25);
    return id;
  };
  /** The branch's plan-writing entry: one action and its scope, or (`empty`) a plan the Reader refuses. */
  const entry = (branch: Branch, empty = false) => {
    const plan = JSON.stringify(empty ? { actions: [], scope: { commands: ['atcs_size_cell'], maxMutations: 3 } }
      : { actions: [{ instance: 'U1', toMaster: branch.toMaster }], scope: { commands: ['atcs_size_cell'], maxMutations: 3 } });
    return JSON.stringify({ schema: WORKSHOP_ENTRY_SCHEMA,
      entry: `mkdir -p "$2/research/branch-${branch.id}"\nprintf '%s\\n' '${plan}' > "$2/research/branch-${branch.id}/plan.json"\n` });
  };
  /** The branch's Operator child, once the autopilot materialized it. */
  const operatorOf = async (branch: Branch) => {
    let found: ReturnType<typeof runDelegations>[number] | undefined;
    await waitUntil(`${branch.operate}'s Operator is materialized`, () => {
      found = runDelegations(deps(), runId).find((row) => row.effective.recipe?.teamId === branch.team && row.effective.recipe.memberId === 'operator'
        && row.state === 'accepted');
      return found !== undefined;
    }, 60_000, 25);
    return found!;
  };
  const interactive = (operator: ReturnType<typeof runDelegations>[number], body: Record<string, unknown>) =>
    host.ctx.hima.interactive(operator.childSessionId, { runId, executionId: operator.effective.recipe!.executionId,
      nodeId: operator.effective.recipe && operator.contract.nodeRef, ownerEpoch: control().epoch, controlRevision: control().revision, ...body }) as Promise<Record<string, any>>;
  /** The Operator's whole session: open, dump, the one scoped mutation, dump, export, close — by the
   *  toolkit's own close, or (`harnessClose`) by asking the Harness to close the session. */
  const operate = async (branch: Branch, operator: ReturnType<typeof runDelegations>[number], harnessClose = false) => {
    const opened = await interactive(operator, { action: 'open', requestId: `open-${branch.id}-${++serial}` });
    assert.equal(opened.status, 'opened', JSON.stringify(opened));
    const toolSessionId = opened.session.toolSessionId as string;
    const planSha256 = operator.effective.recipe!.inlinePayload!.planSha256;
    const slot = path.join(workspace, `research/branch-${branch.id}`);
    for (const [name, args] of [['atcs_dump_cells', { path: path.join(slot, 'before.dump') }],
      ['atcs_size_cell', { instance: 'U1', toMaster: branch.toMaster, planSha256 }],
      ['atcs_dump_cells', { path: path.join(slot, 'after.dump') }], ['atcs_export_changes', {}], ...(harnessClose ? [] : [['atcs_close', {}] as const])] as const) {
      const id = `${name}-${branch.id}-${++serial}`;
      const sent = await interactive(operator, { action: 'input', requestId: id, commandId: id, toolSessionId, command: { name, args }, waitMs: 5_000 });
      assert.equal(sent.status, 'completed', `${name} in branch ${branch.id}: ${JSON.stringify(sent)}`);
    }
    if (harnessClose) {
      const closed = await interactive(operator, { action: 'close', requestId: `close-${branch.id}-${++serial}`, toolSessionId });
      assert.equal(closed.status, 'closed', JSON.stringify(closed));
    }
    await waitUntil(`${branch.operate} is ready`, () => control().executions[operator.effective.recipe!.executionId]?.phase === 'ready', 30_000, 25);
    return planSha256;
  };
  /** Owner-origin node turns on these nodes, as the control requests record them. */
  const ownerTurns = (nodes: readonly string[]) => Object.values(control().requests).filter((request) =>
    request.origin !== 'autopilot' && request.origin !== 'human' && ['begin', 'work', 'write', 'complete'].includes(request.receipt.action)
    && nodes.includes(control().executions[request.receipt.executionId ?? '']?.nodeId ?? ''));
  const autopilotTurns = (nodes: readonly string[]) => Object.values(control().requests).filter((request) =>
    request.origin === 'autopilot' && nodes.includes(control().executions[request.receipt.executionId ?? '']?.nodeId ?? ''));
  return { control, run, records, act, human, ownerNode, answer, authorAsked, entry, operatorOf, operate, ownerTurns, autopilotTurns, delegationRecords };
}

const atJoin = (driven: Driven) => () => { const run = driven.host.ctx.hima.ledger.run(driven.runId)!; return run.fork === undefined && run.currentNode === 'judge'; };

test('a self-driving fork runs both branches to the join with zero owner turns inside them, every record present, and tells the owner once', async (t) => {
  await campaign(t, defaults, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    assert.ok(p.run().fork, 'the fork opened at start');
    // Each branch's own child Agent authors its Workshop; branch b's first plan is refused by its
    // Reader, and the branch is revised from the Reader's itemized problems, in the same generation.
    const played = await Promise.all(branches.map(async (branch) => {
      await p.answer(await p.authorAsked(branch), p.entry(branch, branch.id === 'b'));
      if (branch.id === 'b') await p.answer(await p.authorAsked(branch), p.entry(branch));
      const operator = await p.operatorOf(branch);
      const planSha256 = await p.operate(branch, operator);
      await p.answer(operator.delegationId, JSON.stringify({ schema: 'fixture-operator/1', planSha256 }));
      return operator;
    }));
    await waitUntil('both branches reach the join', atJoin(driven), 60_000, 25);

    // Zero owner turns inside the branches; the only owner turns are the fork's own node.
    assert.deepEqual(p.ownerTurns(branchNodes), [], 'the owner took no turn inside a self-driving branch');
    assert.deepEqual(p.ownerTurns(['start']).map((request) => request.receipt.action), ['begin', 'work', 'complete']);
    for (const node of branchNodes) assert.ok(p.autopilotTurns([node]).some((request) => request.receipt.action === 'complete'), `the autopilot completed ${node}`);

    // Every record owner-driven execution writes is there.
    const records = p.records();
    const branchOf = (record: LedgerRecord) => ('branchId' in record ? record.branchId : undefined);
    for (const branch of branches) {
      assert.ok(records.some((r) => r.type === 'node' && r.nodeId === branch.capture && r.state === 'done' && branchOf(r) === branch.workshop), `${branch.capture} done in its branch`);
      assert.ok(records.some((r) => r.type === 'observation' && r.reader.id === 'plan-file' && branchOf(r) === branch.workshop), `branch ${branch.id} reading`);
      assert.ok(records.some((r) => r.type === 'code' && r.nodeId === branch.workshop), `branch ${branch.id} code record`);
      assert.ok(records.some((r) => r.type === 'job' && r.event === 'launched' && r.nodeId === branch.operate && r.licences?.xtop === 1), `branch ${branch.id} interactive Job`);
    }
    const [, b] = played;
    const restart = records.filter((r) => r.type === 'resumed' && r.kind === 'restart');
    assert.equal(restart.length, 1, 'branch b was revised once');
    assert.equal(restart[0]!.writer, 'executor', 'the autopilot, not a person, restarted it');
    assert.equal(restart[0]!.type === 'resumed' ? restart[0]!.nodeId : '', 'plan-b');
    const codeB = records.filter((r) => r.type === 'code' && r.nodeId === 'plan-b');
    assert.equal(codeB.length, 2, 'the refused entry and its revision are both retained');
    for (const [index, operator] of played.entries()) {
      const own = p.delegationRecords(operator.delegationId).map((r) => r.type === 'delegation' ? r.event : '');
      assert.ok(own.includes('result-adopted'), `${operator.delegationId}'s schema-valid result was adopted`);
      // #64 M-T03-1: the Operator's task carries its request's exact bytes, not only a record id.
      const branch = branches[index]!;
      const plan = JSON.parse(await readFile(path.join(driven.workspace, `research/branch-${branch.id}/plan.json`), 'utf8'));
      const task = operator.contract.task;
      const at = task.indexOf(`Exact input ${branch.output} `);
      assert.ok(at >= 0, `the Operator's task embeds ${branch.output}: ${task}`);
      assert.deepEqual(JSON.parse(task.slice(task.indexOf('\n', at) + 1).split('\n')[0]!), plan, 'every field of the request is in the task');
      assert.match(task, new RegExp(operator.effective.recipe!.inlinePayload!.planSha256), 'and its plan hash');
    }
    assert.equal(runDelegations((driven.host.ctx.hima as any).deps(), driven.runId).filter((row) => row.effective.recipe?.memberId === 'reviewer').length, 0,
      'the optional advisory Reviewer is never waited for');
    assert.ok(b, 'branch b ran');
    assert.equal(records.filter((r) => r.type === 'blocker').length, 0, 'no blocker asked for a person');

    // The owner is told once, when the Run leaves the region, with both branches in one summary.
    await waitUntil('the owner is told', () => driven.host.ctx.hima.autopilotNotices(driven.runId).length > 0, 10_000, 25);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const notices = driven.host.ctx.hima.autopilotNotices(driven.runId);
    assert.equal(notices.length, 1, JSON.stringify(notices));
    assert.match(notices[0]!, /stands at judge/);
    assert.match(notices[0]!, /plan-a: capture-a done; adopted Team result run-[^;]+; final reading run-/);
    assert.match(notices[0]!, /plan-b: capture-b done; adopted Team result run-/);

    // The owner acts at the join; a fenced owner turn inside a branch is refused with the reason.
    const fenced = await p.act('begin', { nodeId: 'read-plan-a' });
    assert.equal(fenced.kind, 'refused');
    assert.match(fenced.reason!, /driven by this Pack's autopilot/);
    await p.ownerNode('judge');
    assert.equal(p.run().currentNode, 'finish');
  });
});

test('a Team member result failing its schema gets one repair follow-up, then the branch settles refused without a person', async (t) => {
  await campaign(t, defaults, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    await Promise.all(branches.map(async (branch) => {
      await p.answer(await p.authorAsked(branch), p.entry(branch));
      const operator = await p.operatorOf(branch);
      const planSha256 = await p.operate(branch, operator);
      if (branch.id === 'b') { await p.answer(operator.delegationId, JSON.stringify({ schema: 'fixture-operator/1', planSha256 })); return; }
      // Branch a's Operator answers the wrong schema; the autopilot sends exactly one repair.
      await p.answer(operator.delegationId, JSON.stringify({ schema: 'something-else/1', planSha256 }));
      await waitUntil('the one repair follow-up is sent', () => p.delegationRecords(operator.delegationId).some((r) => r.type === 'delegation' && r.event === 'followup-sent'), 30_000, 25);
      await p.answer(operator.delegationId, JSON.stringify({ schema: 'fixture-operator/1' }));
    }));
    await waitUntil('the fork reaches its join', atJoin(driven), 60_000, 25);
    const records = p.records();
    const a = runDelegations((driven.host.ctx.hima as any).deps(), driven.runId).find((row) => row.effective.recipe?.teamId === 'team-a' && row.effective.recipe.memberId === 'operator')!;
    const events = p.delegationRecords(a.delegationId).map((r) => r.type === 'delegation' ? r.event : '');
    assert.equal(events.filter((event) => event === 'followup-intent').length, 1, 'exactly one repair follow-up');
    assert.ok(!events.includes('result-adopted'), 'a schema-failing result is never adopted');
    const settled = records.findLast((r) => r.type === 'node' && r.branchId === 'plan-a');
    assert.ok(settled?.type === 'node' && settled.state === 'cancelled', JSON.stringify(settled));
    assert.match(settled.reason ?? '', /settled refused/);
    assert.match(settled.reason ?? '', /fixture-operator\/1|lacks planSha256/);
    assert.ok(records.some((r) => r.type === 'node' && r.nodeId === 'capture-b' && r.state === 'done'), 'the other branch finished');
    assert.equal(Object.values(p.control().requests).filter((request) => request.origin === 'human').length, 0, 'no person was asked');
    assert.deepEqual(p.ownerTurns(branchNodes), []);
    assert.deepEqual(p.control().paused, [], 'no hold is left behind by the refused branch');
    // The join judges the refused branch with no reading: UNDETERMINED, routed by the Pack.
    await p.ownerNode('judge');
    const judged = p.records().findLast((r) => r.type === 'node' && r.nodeId === 'judge' && r.state === 'done');
    assert.ok(judged?.type === 'node' && judged.outcome === 'UNDETERMINED', JSON.stringify(judged));
  });
});

test('an Operator that asks the Harness to close its session settles its node done, never a failed attempt (#64 D-T03-1)', async (t) => {
  await campaign(t, defaults, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    await Promise.all(branches.map(async (branch) => {
      await p.answer(await p.authorAsked(branch), p.entry(branch));
      const operator = await p.operatorOf(branch);
      const planSha256 = await p.operate(branch, operator, branch.id === 'a');
      await p.answer(operator.delegationId, JSON.stringify({ schema: 'fixture-operator/1', planSha256 }));
    }));
    await waitUntil('both branches reach the join', atJoin(driven), 60_000, 25);
    const records = p.records();
    assert.equal(records.filter((r) => r.type === 'node' && r.nodeId === 'operate-a' && (r.state === 'retrying' || r.state === 'blocked')).length, 0,
      'the requested close is no failed attempt');
    const done = records.findLast((r) => r.type === 'node' && r.nodeId === 'operate-a' && r.state === 'done');
    assert.ok(done?.type === 'node', 'operate-a settled done');
    assert.match(done.reason ?? '', /its Operator closed tmux session/);
    assert.equal(Object.values(p.control().executions).filter((e) => e.nodeId === 'operate-a').length, 1, 'one attempt, no second Team');
    assert.ok(records.some((r) => r.type === 'node' && r.nodeId === 'capture-a' && r.state === 'done'), 'its capture sealed the dumps');
  });
});

test('a person pausing one branch holds only that branch; continuing it lets the autopilot carry it to the join', async (t) => {
  await campaign(t, defaults, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    const paused = await p.human('pause', { nodeId: 'read-plan-a' });
    assert.equal(paused.kind, 'accepted', paused.reason);
    const bDone = (async () => {
      await p.answer(await p.authorAsked(branches[1]), p.entry(branches[1]));
      const operator = await p.operatorOf(branches[1]);
      const planSha256 = await p.operate(branches[1], operator);
      await p.answer(operator.delegationId, JSON.stringify({ schema: 'fixture-operator/1', planSha256 }));
    })();
    await p.answer(await p.authorAsked(branches[0]), p.entry(branches[0]));
    await bDone;
    await waitUntil('branch b reaches the join while a is held', () => p.run().fork?.branches['plan-b']?.state === 'done', 60_000, 25);
    await waitUntil('branch a stands at its paused reader', () => p.run().fork?.branches['plan-a']?.currentNode === 'read-plan-a', 30_000, 25);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(p.run().fork?.branches['plan-a']?.currentNode, 'read-plan-a', 'branch a is held at the paused node');
    assert.ok(!Object.values(p.control().executions).some((execution) => execution.nodeId === 'read-plan-a'), 'no paused node began');
    assert.ok(p.run().fork, 'the fork stays open for the held branch');
    const continued = await p.human('continue', { nodeId: 'read-plan-a' });
    assert.equal(continued.kind, 'accepted', continued.reason);
    const operator = await p.operatorOf(branches[0]);
    const planSha256 = await p.operate(branches[0], operator);
    await p.answer(operator.delegationId, JSON.stringify({ schema: 'fixture-operator/1', planSha256 }));
    await waitUntil('the continued branch reaches the join', atJoin(driven), 60_000, 25);
    assert.deepEqual(p.ownerTurns(branchNodes), []);
  });
});

test('a native child whose turn ends at max-tokens with no output gets one repair follow-up at once, not a wait to expiry (#66 H2b)', async (t) => {
  // D-T04-2: the author's only turn ended `max-tokens` inside its reasoning, with no text. Its answer
  // to the one repair follow-up is a branch-agnostic entry that writes the plan into its Workshop.
  const plan = JSON.stringify({ actions: [{ instance: 'U1', toMaster: 'BUF2' }], scope: { commands: ['atcs_size_cell'], maxMutations: 3 } });
  const entry = JSON.stringify({ schema: WORKSHOP_ENTRY_SCHEMA, entry: `printf '%s\\n' '${plan}' > "$1/plan.json"\n` });
  const outOfTokens: ReplayEntry = { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'I should first decide which of the recorded inputs to read, and' } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ] };
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  const authorMs = 90_000;
  await campaign(t, { ...defaults, authorMs, native: [outOfTokens, say(entry), say(entry), say(entry)] }, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    const deps = () => (driven.host.ctx.hima as any).deps();
    const author = () => runDelegations(deps(), driven.runId).find((row) => row.delegationId.startsWith('autopilot-author-plan-a-'));
    await waitUntil('branch a\'s author is created', () => author() !== undefined, 30_000, 25);
    const created = Date.now();
    // The precondition, read from the child's own native Session: its first turn ended max-tokens with no text.
    const query = (driven.host.ctx as any).get('sessionQuery') as { readSession(id: string): Promise<{ events: { type: string; data?: any }[] }> };
    let firstEnd: { type: string; data?: any } | undefined; let texts: string[] = [];
    await waitUntil('the author\'s first turn ends', async () => {
      const log = await query.readSession(author()!.childSessionId).catch(() => undefined);
      if (log === undefined) return false;
      firstEnd = log.events.find((event) => event.type === 'turn/end');
      texts = log.events.filter((event) => event.type === 'assistant/message' && event.data?.turn === firstEnd?.data?.turn)
        .flatMap((event) => (event.data?.message?.content ?? []).filter((block: any) => block.type === 'text').map((block: any) => block.text));
      return firstEnd !== undefined;
    }, 20_000, 25);
    assert.equal(firstEnd!.data?.reason?.kind, 'max-tokens', JSON.stringify(firstEnd));
    assert.deepEqual(texts, [], 'the turn produced no text');
    const events = () => p.delegationRecords(author()!.delegationId).map((r) => r.type === 'delegation' ? r.event : '');
    // Well inside the author's 90 s share: the output-less turn is followed up, never waited out.
    await waitUntil('the output-less author turn gets its repair follow-up', () => events().includes('followup-intent'), 20_000, 25);
    const waited = Date.now() - created;
    assert.equal(author()!.state === 'expired', false, 'the author did not expire first');
    assert.ok(waited < authorMs, `followed up after ${waited} ms`);
    // The follow-up reached the child's own Session and says why.
    await waitUntil('the child reads the repair', async () => JSON.stringify((await query.readSession(author()!.childSessionId)).events
      .filter((event) => event.type !== 'assistant/message')).includes('your turn ended without output'), 10_000, 25);
    assert.equal(events().filter((event) => event === 'followup-intent').length, 1, 'exactly one repair follow-up');
    // The repaired turn is the author's result: the seat is not lost.
    await waitUntil('the repaired author answer is observed', () => events().includes('result-observed'), 30_000, 25);
    t.diagnostic(`H2b: follow-up ${waited} ms after the author was created (share ${authorMs} ms)`);
  });
});

test('an Operator whose branch is done frees its share: a later branch\'s recipe Operator still gets its member share (#66 H2a, ATCS-09 dry w04)', async (t) => {
  // One lane and a 300 s time box: 300 s of delegation time. The two authors hold 30 s each (a
  // completed author keeps its reservation while a follow-up is still allowed), which leaves 240 s,
  // and each Operator member declares exactly that. Branch b's Operator takes it all, finishes, and
  // its result is adopted; its execution is settled, so it can never work again. Branch a, held until
  // then, must still get an Operator: the dry path's generation 2 starved exactly here.
  const operatorMs = 240_000;
  await campaign(t, { ...defaults, operatorMs, lanes: 1 }, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    const paused = await p.human('pause', { nodeId: 'read-plan-a' });
    assert.equal(paused.kind, 'accepted', paused.reason);
    await Promise.all(branches.map(async (branch) => p.answer(await p.authorAsked(branch), p.entry(branch))));
    const b = await p.operatorOf(branches[1]);
    assert.equal(b.effective.budgetShare.maxElapsedMs, operatorMs, 'branch b\'s Operator gets its member share');
    await p.answer(b.delegationId, JSON.stringify({ schema: 'fixture-operator/1', planSha256: await p.operate(branches[1], b) }));
    await waitUntil('branch b reaches the join', () => p.run().fork?.branches['plan-b']?.state === 'done', 60_000, 25);
    const continued = await p.human('continue', { nodeId: 'read-plan-a' });
    assert.equal(continued.kind, 'accepted', continued.reason);
    // Branch a's Operator, or the refusal that settles its branch instead.
    const refusedA = () => p.records().find((r) => r.type === 'node' && r.branchId === 'plan-a' && r.state === 'cancelled');
    await waitUntil('branch a\'s Operator is materialized or its branch settles', () => refusedA() !== undefined
      || runDelegations((driven.host.ctx.hima as any).deps(), driven.runId).some((row) => row.effective.recipe?.teamId === 'team-a'), 60_000, 25);
    const settled = refusedA();
    assert.equal(settled, undefined, `branch a was starved: ${settled?.type === 'node' ? settled.reason : ''}`);
    const a = await p.operatorOf(branches[0]);
    t.diagnostic(`Operator shares: b ${b.effective.budgetShare.maxElapsedMs} ms, a ${a.effective.budgetShare.maxElapsedMs} ms`);
    assert.ok(a.effective.budgetShare.maxElapsedMs > 200_000, `branch a's Operator gets (nearly) its member share: ${a.effective.budgetShare.maxElapsedMs}`);
    await p.answer(a.delegationId, JSON.stringify({ schema: 'fixture-operator/1', planSha256: await p.operate(branches[0], a) }));
    await waitUntil('both branches reach the join', atJoin(driven), 60_000, 25);
  });
});

test('an identical rewrite after an identical failure is never re-run: the author gets one repair follow-up carrying the failure, then the branch settles refused (#64 D-T06-2)', async (t) => {
  // T06: the w02 author's program exited 4; the autopilot re-wrote and re-ran the same retained code
  // (same sha, same exit) about 200 times until the Run-wide research-write budget was gone. Here the
  // author always answers the same failing program.
  const failing = JSON.stringify({ schema: WORKSHOP_ENTRY_SCHEMA, entry: 'echo "operatorBrief not written: exit 1" >&2\nexit 4\n' });
  await campaign(t, defaults, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    const author = await p.authorAsked(branches[0]);
    await p.answer(author, failing);
    const codes = () => p.records().filter((r) => r.type === 'code' && r.nodeId === 'plan-a');
    const followups = () => p.delegationRecords(author).filter((r) => r.type === 'delegation' && r.event === 'followup-intent');
    await waitUntil('a repair follow-up, or a re-run of the failed program', () => followups().length > 0 || codes().length > 1, 30_000, 25);
    assert.equal(codes().length, 1, `the failed program is not re-run as it stands: ${codes().length} code records of ${new Set(codes().map((r) => r.type === 'code' ? r.sha256 : '')).size} distinct sha`);
    assert.equal(followups().length, 1, 'the author is asked to repair once');
    const asked = await p.authorAsked(branches[0]);
    assert.equal(asked, author, 'the same author, followed up');
    const sent = p.delegationRecords(author).findLast((r) => r.type === 'delegation' && r.event === 'followup-sent');
    assert.match(JSON.stringify(sent), /exited 4/, 'the follow-up carries the failure');
    assert.match(JSON.stringify(sent), /operatorBrief not written/, 'and the tail of the program\'s own log');
    // The author answers the identical program: it is not run again, and the branch settles refused.
    await p.answer(author, failing);
    const settled = () => p.records().findLast((r) => r.type === 'node' && r.branchId === 'plan-a' && r.state === 'cancelled');
    await waitUntil('branch a settles refused', () => settled() !== undefined || codes().length > 1, 30_000, 25);
    assert.equal(codes().length, 1, 'the identical rewrite is never run');
    const refusal = settled();
    assert.ok(refusal?.type === 'node', 'branch a settled');
    assert.match(refusal.reason ?? '', /settled refused/);
    assert.match(refusal.reason ?? '', /exited 4|identical/);
    assert.equal(p.records().filter((r) => r.type === 'research-write' && r.nodeId === 'plan-a').length, 1, 'one research write for one authored program');
    assert.equal(followups().length, 1, 'one repair follow-up in all');
    assert.equal(Object.values(p.control().requests).filter((request) => request.origin === 'human').length, 0, 'no person was asked');
  });
});

test('each revised failing program runs once, and the author\'s follow-up allowance bounds the branch before it settles refused (#64 D-T06-2)', async (t) => {
  await campaign(t, defaults, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    const codes = () => p.records().filter((r) => r.type === 'code' && r.nodeId === 'plan-a');
    const settled = () => p.records().findLast((r) => r.type === 'node' && r.branchId === 'plan-a' && r.state === 'cancelled');
    let answers = 0;
    while (settled() === undefined && answers < 8) {
      const author = await Promise.race([p.authorAsked(branches[0]),
        waitUntil('branch a settles', () => settled() !== undefined, 60_000, 25).then(() => '')]);
      if (author === '') break;
      answers += 1;
      await p.answer(author, JSON.stringify({ schema: WORKSHOP_ENTRY_SCHEMA, entry: `# revision ${String(answers)}\nexit 4\n` }));
      await waitUntil(`revision ${String(answers)} runs or the branch settles`, () => codes().length >= answers || settled() !== undefined, 30_000, 25);
    }
    const refusal = settled();
    assert.ok(refusal?.type === 'node', 'branch a settled refused');
    assert.match(refusal.reason ?? '', /follow-up allowance is exhausted/);
    const author = runDelegations((driven.host.ctx.hima as any).deps(), driven.runId).find((row) => row.delegationId.startsWith('autopilot-author-plan-a-'))!;
    assert.equal(author.followups, 3, 'the author\'s declared allowance, and no more');
    assert.equal(answers, 4, 'the first entry and one revision per follow-up');
    assert.equal(codes().length, answers, 'each authored program ran exactly once');
    assert.equal(new Set(codes().map((r) => r.type === 'code' ? r.sha256 : '')).size, answers);
  });
});

test('a schema repair after a failed-program repair has its own follow-up id, never "Follow-up id changed contents" (#64 D-Q1-4)', async (t) => {
  // Q1 #362/#459 (w04, w05): the author's reply failed its schema (repair `ap-repair-<id>`), its program then
  // failed by its own exit (repair `ap-repair-<id>-<attempt>`), and its next reply failed the schema again.
  // That second schema repair reused `ap-repair-<id>` with other text; the Host refused it ("Follow-up id
  // changed contents") and the branch settled refused with follow-ups still allowed.
  await campaign(t, { ...defaults, authorMs: 120_000 }, 300_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    const author = await p.authorAsked(branches[0]);
    const followups = () => p.delegationRecords(author).filter((r) => r.type === 'delegation' && r.event === 'followup-intent');
    const settled = () => p.records().findLast((r) => r.type === 'node' && r.branchId === 'plan-a' && r.state === 'cancelled');
    const codes = () => p.records().filter((r) => r.type === 'code' && r.nodeId === 'plan-a');
    await p.answer(author, 'The first reply is prose, not the entry object.');
    await waitUntil('the first schema repair', () => followups().length === 1 || settled() !== undefined, 30_000, 25);
    await p.answer(author, JSON.stringify({ schema: WORKSHOP_ENTRY_SCHEMA, entry: 'echo "failing on purpose" >&2\nexit 4\n' }));
    await waitUntil('the failed-program repair', () => followups().length === 2 || settled() !== undefined, 30_000, 25);
    await p.answer(author, 'The failure was the missing input; the entry follows.');
    await waitUntil('the second schema repair, or the branch settles', () => followups().length === 3 || settled() !== undefined, 30_000, 25);
    const refusal = settled();
    assert.equal(refusal, undefined, `branch a settled refused: ${refusal?.type === 'node' ? refusal.reason : ''}`);
    const ids = followups().map((r) => r.type === 'delegation' ? r.requestId : '');
    assert.equal(new Set(ids).size, 3, `three distinct follow-up ids: ${JSON.stringify(ids)}`);
    await p.answer(author, p.entry(branches[0]));
    await waitUntil('the repaired entry runs', () => codes().length === 2, 30_000, 25);
    await waitUntil('branch a reads its plan', () => p.records().some((r) => r.type === 'observation' && r.reader.id === 'plan-file'
      && 'branchId' in r && r.branchId === 'plan-a'), 30_000, 25);
  });
});

test('a Run the owner\'s own tool left on a self-driving segment node is picked up by the autopilot\'s periodic kick (#64 D-T04-1)', async (t) => {
  // D-T04-1 (every live Run): after the owner's accepted complete, the segment's first node never
  // began until a person pressed Continue. The owner's hima_execution tool calls the fabric
  // operation directly (tools.ts), which kicks nothing; the Host's own executionAction kicks.
  const graphEdit = (graph: Record<string, any>) => {
    graph.entry = 'pre';
    graph.nodes.unshift({ id: 'pre', kind: 'act', parameters: { observes: 'seed' } }, { id: 'mid', kind: 'act', parameters: { observes: 'seed' } });
    graph.edges.unshift({ from: 'pre', to: 'mid' }, { from: 'mid', to: 'start' });
    graph.autopilot.push({ from: ['mid'], until: ['start'] });
  };
  await campaign(t, { ...defaults, graphEdit }, 300_000, async (driven) => {
    const p = players(driven);
    const deps = () => (driven.host.ctx.hima as any).deps();
    let serial = 0;
    const tool = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => executionAction(deps(), {
      runId: driven.runId, actor: driven.owner, origin: 'agent', expectedEpoch: p.control().epoch, expectedRevision: p.control().revision,
      requestId: `tool-${++serial}`, action, ...fields });
    assert.equal(p.run().currentNode, 'pre');
    const begun = await tool('begin', { nodeId: 'pre' }); assert.equal(begun.kind, 'accepted', begun.reason);
    const executionId = begun.receipt!.executionId!;
    assert.notEqual((await tool('work', { executionId })).kind, 'refused');
    await waitUntil('pre settles', () => p.control().executions[executionId]?.phase === 'ready', 30_000, 25);
    const done = await tool('complete', { executionId }); assert.equal(done.kind, 'accepted', done.reason);
    const at = Date.now();
    await waitUntil('the Run stands on the segment node', () => p.run().currentNode === 'mid', 10_000, 25);
    await waitUntil('the autopilot begins the segment node', () => p.autopilotTurns(['mid']).some((request) => request.receipt.action === 'begin'), 25_000, 50);
    t.diagnostic(`D-T04-1: the autopilot began mid ${String(Date.now() - at)} ms after the owner's tool complete`);
    await waitUntil('the segment drives to where it stops', () => p.run().currentNode === 'start', 30_000, 25);
    assert.equal(Object.values(p.control().requests).filter((request) => request.origin === 'human').length, 0, 'no person pressed Continue');
  });
});

test('the time box still ends a Run whose self-driving branches are waiting for their children', async (t) => {
  await campaign(t, { ...defaults, authorMs: 4_000 }, 12_000, async (driven) => {
    const p = players(driven);
    await p.ownerNode('start');
    await p.authorAsked(branches[0]);
    // Nobody answers: the autopilot waits on its children and never on a person; the time box ends it.
    await waitUntil('the time box ends the Run', () => /^ended-|^cancelled$/.test(String(p.run().status)), 60_000, 100);
    assert.equal(p.run().status, 'ended-budget-exhausted', JSON.stringify({ status: p.run().status, meters: p.run().meters }));
    assert.deepEqual(p.ownerTurns(branchNodes), []);
    assert.equal(Object.values(p.control().requests).filter((request) => request.origin === 'human').length, 0, 'no person was asked');
  });
});

test('an autopilot declaration is held at load: a wait inside a segment, an unlabelled UNDETERMINED and a non-fork are refused', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const tclsh = await realpath('/usr/bin/tclsh');
  const cases: readonly [string, (graph: Record<string, any>) => void, RegExp][] = [
    ['a segment through a wait node', (graph) => {
      graph.nodes.push({ id: 'hold', kind: 'wait', parameters: { blocker: 'person' } });
      graph.edges = graph.edges.filter((edge: any) => !(edge.from === 'judge' && edge.outcome === 'FAIL'));
      graph.edges.push({ from: 'judge', to: 'hold', outcome: 'FAIL' });
      graph.autopilot.push({ from: ['judge'], until: ['finish'] });
    }, /reaches wait node "hold" without stopping there/],
    ['a segment judge with no UNDETERMINED edge', (graph) => {
      graph.edges = graph.edges.filter((edge: any) => !(edge.from === 'judge' && edge.outcome === 'UNDETERMINED'));
      graph.autopilot.push({ from: ['judge'], until: ['finish'] });
    }, /judge "judge" with no UNDETERMINED edge/],
    ['a fork declaration on a node that draws no fork', (graph) => { graph.autopilot = [{ fork: 'judge' }]; }, /draws no fork/],
    ['a segment reaching into a fork branch', (graph) => { graph.autopilot.push({ from: ['read-plan-a'], until: ['judge'] }); }, /branch node of the fork/],
  ];
  for (const [what, graphEdit, refusal] of cases) {
    const packsDir = path.join(local.h.home, `refusal-${cases.findIndex((item) => item[0] === what)}`);
    await writePack(packsDir, tclsh, { ...defaults, graphEdit });
    assert.throws(() => loadPack(packsDir, packId), refusal, what);
  }
  // And the declaration itself is data a person reads in graph.yml.
  const packsDir = path.join(local.h.home, 'accepted');
  const dir = await writePack(packsDir, tclsh, defaults);
  assert.deepEqual(parse(await readFile(path.join(dir, 'graph.yml'), 'utf8')).autopilot, [{ fork: 'start', revisions: 1, author: { maxElapsedMs: 30_000, maxFollowups: 3 } }]);
  assert.equal(loadPack(packsDir, packId).graph.autopilot.length, 1);
});
