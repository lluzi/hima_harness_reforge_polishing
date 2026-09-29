import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';
import {
  claimSlot, createInteractiveTimerController, listInteractiveSessions, operateInteractive, parseInteractiveRecord,
  parseInteractiveRequest, reconcileInteractiveLaunchReservations, reconcileInteractiveState, interactiveCallerDigest, interactiveDelegationGrant,
  remoteCommands, type DerivedInteractiveOperation, type InteractiveBinding, type InteractiveRuntimeDeps,
} from '@hima/harness';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const digest = (letter: string): string => letter.repeat(64);
const shellQuote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;
const fixture = path.join(repoRoot, 'test/fixtures/interactive-job/repl.mjs');
const binding: InteractiveBinding = {
  id: 'fixture-binding', packId: 'fixture-pack', packDigest: digest('a'), nodeId: 'manual', toolId: 'fixture-repl',
  source: { kind: 'trusted-test-fixture', id: 'fixture-binding' },
  adapter: { id: 'fixture-repl', version: '1', digest: digest('b'), completionProtocol: 'versioned-marker', allowsMultiline: false },
  environment: { id: 'isolated-test-fixture', digest: digest('c') }, mutation: 'qualified',
  limits: { startupWaitMs: 1_000, callWaitMaxMs: 1_000, commandMaxMs: 5_000, sessionMaxMs: 30_000, idleMaxMs: 10_000 },
};

const execution = { id: 'execution-1', nodeId: 'manual', kind: 'act' as const, generation: 1, attempt: 1,
  methodDigest: digest('a'), inputDigest: digest('d'), phase: 'begun' as const };

test('interactive session projection recognizes a finished Job without inventing command completion', () => {
  const runId = 'normal-close-run', toolSessionId = 'normal-close-session';
  const address = { runId, toolSessionId, executionId: execution.id, nodeId: 'manual', actor: 'operator',
    ownerEpoch: 1, controlRevision: 0, requestId: 'close-request', operationDigest: digest('a'),
    callerDigest: digest('b'), at: '2026-09-27T13:20:35.000Z' };
  const protocol = (data: object) => ({ type: 'interactive', runId, payload: parseInteractiveRecord({ ...address, ...data }) });
  const opening = [
    protocol({ event: 'open-intent', jobSession: toolSessionId, transcriptPath: '/fixture/transcript.log',
      exitPath: '/fixture/session.exit', sessionDeadlineAt: '2026-09-27T14:20:35.000Z' }),
    protocol({ event: 'opened', jobSession: toolSessionId, readiness: 'ready', qualification: {
      bindingDigest: digest('c'), adapter: binding.adapter, environment: binding.environment,
      mutation: 'qualified', testOnly: true } }),
    protocol({ event: 'input-intent', commandId: 'close-1', inputDigest: digest('d'), requestDigest: digest('b'),
      protocolToken: 'T'.repeat(32), inputBytes: 1, submit: true, effect: 'close', cursorBefore: 0,
      commandDeadlineAt: '2026-09-27T13:30:35.000Z' }),
    protocol({ event: 'input-sent', commandId: 'close-1', inputDigest: digest('d') }),
  ];
  const completed = protocol({ event: 'command-completed', commandId: 'close-1', inputDigest: digest('d'), cursorAfter: 123 });
  const finished = { type: 'job', runId, event: 'finished', job: { session: toolSessionId }, exitCode: 0 };
  const project = (records: object[]) => listInteractiveSessions({
    records: (query: { type: string }) => records.filter((record) => (record as { type: string }).type === query.type),
  } as never, runId)[0]!;
  assert.equal(project([...opening, completed]).status, 'ready', 'a close command receipt alone does not prove process exit');
  assert.equal(project([...opening, completed, { ...finished, job: { session: 'other-session' } }]).status, 'ready');
  const rows = [...opening, completed, finished];
  const before = JSON.stringify(rows);
  const closed = project(rows);
  assert.equal(closed.status, 'closed', 'same-session finished Job proves process exit without an interactive closed event');
  assert.equal(closed.activeCommand, undefined);
  assert.equal(closed.lastCursor, 123);
  assert.equal(JSON.stringify(rows), before, 'projection does not modify historical records');
  const interrupted = project([...opening, { ...finished, exitCode: 1 }]);
  assert.equal(interrupted.status, 'closed', 'process exit is independent of business success');
  assert.equal(interrupted.activeCommand?.state, 'sent', 'process exit does not manufacture a command completion receipt');
});

test('interactive runtime derives authority from Run/Ledger, preserves single-writer and refuses spoofed completion', async (t) => {
  assert.deepEqual(parseInteractiveRequest({ action: 'open', runId: 'run-1', executionId: 'execution-1', nodeId: 'manual',
    requestId: 'open-1', ownerEpoch: 1, controlRevision: 0 }, 'actual-host-agent').actor, 'actual-host-agent');
  for (const injected of [{ actor: 'model' }, { argv: ['sh'] }, { qualification: true }]) assert.throws(() => parseInteractiveRequest({
    action: 'open', runId: 'run-1', executionId: 'execution-1', nodeId: 'manual', requestId: 'open-1',
    ownerEpoch: 1, controlRevision: 0, ...injected,
  }, 'actual-host-agent'), /unrecognized|Unrecognized|invalid/i);
  const home = await createHimaHome(); t.after(() => home.dispose());
  const site = await writeLocalSite(home, { allowedReadRoots: [home.workspace], allowedWriteRoots: [home.workspace],
    allowedWrappers: ['sh'], parallelJobs: 1, licences: { fixture: 1 } });
  const host = await bootInProcess(home); t.after(() => host.dispose());
  const parent = await createRootAgent(host.ctx, home.workspace);
  const makeRun = async (campaignId: string, executionId: string) => host.ctx.hima.ledger.createRun({
    campaignId, siteId: 'local', packId: 'fixture-pack', packDigest: digest('a'), status: 'running', currentNode: 'manual', generation: 1,
    budget: { timeBoxMs: 60_000, closingReserveMs: 1_000, retryAllowance: 1, jobCap: 1, licences: { fixture: 1 }, generationLimit: 1 },
    control: { mode: 'agent', owner: String(parent.id), epoch: 1, revision: 0, paused: [], requests: {},
      executions: { [executionId]: { ...execution, id: executionId } } },
  });
  const run = await makeRun('interactive-runtime', 'execution-1');
  const sessions: string[] = [];
  let derived: DerivedInteractiveOperation = { binding, site: 'local', workspace: home.workspace,
    argv: ['sh', '-c', `exec ${shellQuote(process.execPath)} ${shellQuote(fixture)} fixture-repl 1`], name: 'runtime-repl', licences: { fixture: 1 },
    commands: [
      { name: 'get', effect: 'read' }, { name: 'set', effect: 'mutate' },
      { name: 'fake-prompt', effect: 'mutate' }, { name: 'exit', effect: 'close' },
    ] };
  const deadlines: string[] = [];
  const deps: InteractiveRuntimeDeps = {
    fabric: { ledger: host.ctx.hima.ledger, sitesDir: site.sitesDir } as never,
    resolveOperation: async () => derived,
    verifyAdminBinding: async (effective) => ({ bindingFileRealpath: '/trusted/test/binding',
      bindingFileSha256: digest('0'), environmentDigest: effective.environment.digest,
      confinement: 'unqualified' }),
    encodeCommand: async (_binding, request) => ({
      text: JSON.stringify({ id: request.commandId, _himaToken: request.protocolToken, op: request.name, ...(request.args as object) }),
      submit: true, effect: request.name === 'get' ? 'read' : request.name === 'exit' ? 'close' : 'mutation',
    }),
    claimJobSlot: async (request) => {
      const claimed = await claimSlot({ ledger: host.ctx.hima.ledger as never, sitesDir: site.sitesDir }, {
        site: { name: request.site, jobs: request.run.budget!.jobCap, licences: request.run.budget!.licences },
        holds: request.licences, launch: request.launch,
      });
      if (claimed.kind === 'claimed') return { kind: 'claimed', launched: claimed.launched };
      return { kind: claimed.kind === 'at-cap' ? 'at-cap' : claimed.kind === 'unreadable' ? 'unreadable' : 'stopped',
        reason: claimed.kind === 'at-cap' ? 'site Job/licence cap is full' : claimed.kind === 'unreadable' ? claimed.error.message : 'slot claim stopped' };
    },
    trustedTestQualification: { bindingId: 'fixture-binding' },
    onDeadline: async (deadline) => { deadlines.push(`${deadline.kind}:${deadline.toolSessionId}`); },
  };
  const ownerBase = { runId: run.id, executionId: 'execution-1', nodeId: 'manual', actor: String(parent.id), ownerEpoch: 1, controlRevision: 0 };
  const ungranted = await operateInteractive(deps, { ...ownerBase, actor: 'operator-child', action: 'open', requestId: 'operator-ungranted' });
  assert.equal(ungranted.status, 'refused'); assert.match(ungranted.reason!, /owner|delegated authority/);
  const grant = await interactiveDelegationGrant(deps, ownerBase); assert.equal('reason' in grant, false);
  if ('reason' in grant) return;
  const base = { ...ownerBase, actor: 'operator-child', authorityOwner: String(parent.id), expectedBindingDigest: grant.bindingDigest };
  try {
    const changedQualification = await operateInteractive(deps, { ...base, expectedBindingDigest: digest('f'),
      action: 'open', requestId: 'operator-changed-qualification' });
    assert.equal(changedQualification.status, 'refused'); assert.match(changedQualification.reason!, /differs from the Operator delegation receipt/);
    const opened = await operateInteractive(deps, { ...base, action: 'open', requestId: 'open-1' });
    assert.equal(opened.status, 'opened', 'reason' in opened ? opened.reason : undefined);
    if (opened.status !== 'opened') return;
    const toolSessionId = opened.session.toolSessionId; sessions.push(toolSessionId);
    assert.equal(opened.readiness, 'ready');
    const jobs = host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }).filter((record) => record.type === 'job');
    assert.equal(jobs.length, 1); assert.equal(jobs[0]!.job.session, toolSessionId); assert.deepEqual(jobs[0]!.licences, { fixture: 1 });
    assert.equal(host.ctx.hima.ledger.run(run.id)!.meters?.jobsLaunched, 1, 'interactive open charges one Job while begin already owns the attempt');

    const set = await operateInteractive(deps, { ...base, action: 'input', requestId: 'input-set', toolSessionId,
      commandId: 'set-1', command: { name: 'set', args: { key: 'answer', value: 42 } }, waitMs: 1_000 });
    assert.equal(set.status, 'completed');

    const fake = await operateInteractive(deps, { ...base, action: 'input', requestId: 'input-fake', toolSessionId,
      commandId: 'model-chosen-id', command: { name: 'fake-prompt', args: { ms: 250 } }, waitMs: 20 });
    assert.equal(fake.status, 'sent', 'an exact marker built only from model-chosen commandId cannot release the lease');
    const overlap = await operateInteractive(deps, { ...base, action: 'input', requestId: 'input-overlap', toolSessionId,
      commandId: 'set-overlap', command: { name: 'set', args: { key: 'x', value: 1 } } });
    assert.equal(overlap.status, 'refused'); assert.match(overlap.reason!, /single-writer/);
    const observed = await operateInteractive(deps, { ...base, action: 'observe', requestId: 'observe-fake',
      toolSessionId, commandId: 'model-chosen-id', waitMs: 1_000 });
    assert.equal(observed.status, 'completed', 'only the adapter emission carrying the persisted Host token completes');

    const duplicate = await operateInteractive(deps, { ...base, action: 'input', requestId: 'input-set', toolSessionId,
      commandId: 'set-1', command: { name: 'set', args: { key: 'answer', value: 42 } } });
    assert.equal(duplicate.status, 'duplicate');
    const crossAction = await operateInteractive(deps, { ...base, action: 'input', requestId: 'open-1', toolSessionId,
      commandId: 'cross-action', command: { name: 'set', args: { key: 'x', value: 1 } } });
    assert.equal(crossAction.status, 'refused'); assert.match(crossAction.reason!, /different action|different.*intent/);
    const crossSession = await operateInteractive(deps, { ...base, action: 'input', requestId: 'input-set',
      toolSessionId: 'another-session', commandId: 'set-1', command: { name: 'set', args: { key: 'answer', value: 42 } } });
    assert.equal(crossSession.status, 'refused'); assert.match(crossSession.reason!, /different action|different.*intent/);
    const crossActor = await operateInteractive(deps, { ...base, actor: 'foreign-actor', authorityOwner: undefined, action: 'input', requestId: 'input-set',
      toolSessionId, commandId: 'set-1', command: { name: 'set', args: { key: 'answer', value: 42 } } });
    assert.equal(crossActor.status, 'refused'); assert.match(crossActor.reason!, /actor|intent/);
    const changed = await operateInteractive(deps, { ...base, action: 'input', requestId: 'input-set', toolSessionId,
      commandId: 'set-1', command: { name: 'set', args: { key: 'answer', value: 43 } } });
    assert.equal(changed.status, 'refused'); assert.match(changed.reason!, /different.*typed command|typed command intent/);

    const current = host.ctx.hima.ledger.run(run.id)!;
    await host.ctx.hima.ledger.advanceRun(run.id, { control: { ...current.control!, paused: ['manual'] } });
    const heldMutation = await operateInteractive(deps, { ...base, action: 'input', requestId: 'held-set', toolSessionId,
      commandId: 'held-set', command: { name: 'set', args: { key: 'held', value: true } } });
    assert.equal(heldMutation.status, 'refused'); assert.match(heldMutation.reason!, /held/);
    const revisionDriftDuplicate = await operateInteractive(deps, { ...base, action: 'input', requestId: 'input-set', toolSessionId,
      commandId: 'set-1', command: { name: 'set', args: { key: 'answer', value: 42 } }, controlRevision: 999 });
    assert.equal(revisionDriftDuplicate.status, 'duplicate', 'retained exact receipt survives later control revision and hold');
    const heldRead = await operateInteractive(deps, { ...base, action: 'read', requestId: 'held-read', toolSessionId });
    assert.equal(heldRead.status, 'read');
    const heldTypedRead = await operateInteractive(deps, { ...base, action: 'input', requestId: 'held-typed-read',
      toolSessionId, commandId: 'held-get', command: { name: 'get', args: { key: 'answer' } }, waitMs: 1_000 });
    assert.equal(heldTypedRead.status, 'completed', 'trusted adapter read commands remain available while mutation is held');
    await host.ctx.hima.ledger.advanceRun(run.id, { control: { ...host.ctx.hima.ledger.run(run.id)!.control!, paused: [] } });
    // Authority is the execution's: a later Run-wide revision keeps it (#64 D-T01-2); a revision
    // from the future or another owner epoch never does.
    const bumped = host.ctx.hima.ledger.run(run.id)!.control!;
    await host.ctx.hima.ledger.advanceRun(run.id, { control: { ...bumped, revision: bumped.revision + 3 } });
    const laterRevision = await operateInteractive(deps, { ...base, action: 'input', requestId: 'later-revision-get', toolSessionId,
      commandId: 'later-revision-get', command: { name: 'get', args: { key: 'answer' } }, waitMs: 1_000 });
    assert.equal(laterRevision.status, 'completed', `an unrelated control revision keeps this execution's authority: ${JSON.stringify(laterRevision)}`);
    const future = await operateInteractive(deps, { ...base, action: 'input', requestId: 'future-revision-set', toolSessionId,
      commandId: 'future-revision-set', command: { name: 'set', args: { key: 'x', value: 3 } }, controlRevision: bumped.revision + 4 });
    assert.equal(future.status, 'refused'); assert.match(future.reason!, /control revision is stale/);
    const otherEpoch = await operateInteractive(deps, { ...base, action: 'input', requestId: 'other-epoch-set', toolSessionId,
      commandId: 'other-epoch-set', command: { name: 'set', args: { key: 'x', value: 4 } }, ownerEpoch: 2 });
    assert.equal(otherEpoch.status, 'refused'); assert.match(otherEpoch.reason!, /epoch/);

    const second = await makeRun('interactive-cap', 'execution-2');
    const atCap = await operateInteractive(deps, { runId: second.id, executionId: 'execution-2', nodeId: 'manual',
      actor: String(parent.id), ownerEpoch: 1, controlRevision: 0, action: 'open', requestId: 'open-cap' });
    assert.equal(atCap.status, 'refused'); assert.match(atCap.reason!, /cap/);

    const batchRun = await makeRun('interactive-batch-working', 'execution-batch');
    const batchCurrent = host.ctx.hima.ledger.run(batchRun.id)!;
    await host.ctx.hima.ledger.advanceRun(batchRun.id, { control: { ...batchCurrent.control!, executions: {
      ...batchCurrent.control!.executions, 'execution-batch': { ...batchCurrent.control!.executions['execution-batch']!,
        phase: 'working', jobSession: 'existing-batch-session' } } } });
    const besideBatch = await operateInteractive(deps, { runId: batchRun.id, executionId: 'execution-batch', nodeId: 'manual',
      actor: String(parent.id), ownerEpoch: 1, controlRevision: 0, action: 'open', requestId: 'open-beside-batch' });
    assert.equal(besideBatch.status, 'refused'); assert.match(besideBatch.reason!, /freshly begun execution/);

    const inside = await makeRun('interactive-inside-binding', 'execution-inside');
    const adminBinding: InteractiveBinding = { ...binding, id: 'admin-inside', source: { kind: 'admin-file',
      path: path.join(home.workspace, 'qualification.json'), sha256: digest('e') } };
    const insideDeps: InteractiveRuntimeDeps = { ...deps,
      resolveOperation: async () => ({ ...derived, binding: adminBinding }),
      verifyAdminBinding: async () => ({ bindingFileRealpath: path.join(home.workspace, 'qualification.json'),
        bindingFileSha256: digest('e'), environmentDigest: binding.environment.digest, confinement: 'unqualified' }) };
    const insideRefused = await operateInteractive(insideDeps, { runId: inside.id, executionId: 'execution-inside', nodeId: 'manual',
      actor: String(parent.id), ownerEpoch: 1, controlRevision: 0, action: 'open', requestId: 'open-inside' });
    assert.equal(insideRefused.status, 'refused'); assert.match(insideRefused.reason!, /task-writable workspace/);

    const unconfined = await makeRun('interactive-unconfined-admin', 'execution-unconfined');
    const unconfinedBinding: InteractiveBinding = { ...binding, id: 'admin-unconfined',
      source: { kind: 'admin-file', path: '/trusted/admin/interactive.json', sha256: digest('e') } };
    const unconfinedDeps: InteractiveRuntimeDeps = { ...deps,
      resolveOperation: async () => ({ ...derived, binding: unconfinedBinding }),
      verifyAdminBinding: async () => ({ bindingFileRealpath: '/trusted/admin/interactive.json',
        bindingFileSha256: digest('e'), environmentDigest: binding.environment.digest, confinement: 'unqualified' }) };
    const unconfinedRefused = await operateInteractive(unconfinedDeps, { runId: unconfined.id, executionId: 'execution-unconfined',
      nodeId: 'manual', actor: String(parent.id), ownerEpoch: 1, controlRevision: 0, action: 'open', requestId: 'open-unconfined' });
    assert.equal(unconfinedRefused.status, 'refused'); assert.match(unconfinedRefused.reason!, /confinement is not enforced/);

    const rootWorkspace = await makeRun('interactive-root-workspace', 'execution-root-workspace');
    const rootBinding: InteractiveBinding = { ...binding, id: 'admin-root-workspace', source: { kind: 'admin-file',
      path: '/trusted/admin/interactive-root.json', sha256: digest('e') } };
    const rootDeps: InteractiveRuntimeDeps = { ...deps,
      resolveOperation: async () => ({ ...derived, binding: rootBinding, workspace: home.workspace }),
      verifyAdminBinding: async () => ({ bindingFileRealpath: '/trusted/admin/interactive-root.json',
        bindingFileSha256: digest('e'), environmentDigest: binding.environment.digest,
        confinement: 'enforced', writableRoot: home.workspace }) };
    const rootRefused = await operateInteractive(rootDeps, { runId: rootWorkspace.id, executionId: 'execution-root-workspace',
      nodeId: 'manual', actor: String(parent.id), ownerEpoch: 1, controlRevision: 0, action: 'open', requestId: 'open-root-workspace' });
    assert.equal(rootRefused.status, 'refused'); assert.match(rootRefused.reason!, /derived Campaign workspace/);

    const lostRequest = { ...base, action: 'input' as const, requestId: 'lost-request', toolSessionId,
      commandId: 'lost-1', command: { name: 'set', args: { key: 'lost', value: 1 } } };
    const intentRequestDigest = interactiveCallerDigest(lostRequest);
    const view = listInteractiveSessions(host.ctx.hima.ledger as never, run.id).find((item) => item.toolSessionId === toolSessionId)!;
    const lostIntent = parseInteractiveRecord({ runId: run.id, executionId: 'execution-1', nodeId: 'manual', toolSessionId,
      requestId: 'lost-request', actor: base.actor, ownerEpoch: 1, controlRevision: 0, operationDigest: digest('e'),
      callerDigest: intentRequestDigest,
      at: new Date().toISOString(), event: 'input-intent', commandId: 'lost-1', inputDigest: digest('f'),
      requestDigest: intentRequestDigest, protocolToken: 'T'.repeat(32), inputBytes: 1, submit: true, effect: 'mutation',
      cursorBefore: view.lastCursor ?? 0, commandDeadlineAt: new Date(Date.now() + 5_000).toISOString() });
    await host.ctx.hima.ledger.appendInteractive(run.id, { executionId: 'execution-1', toolSessionId,
      requestId: 'lost-request', event: 'input-intent', payload: lostIntent as never });
    await reconcileInteractiveState(deps);
    const uncertain = host.ctx.hima.ledger.records({ runId: run.id, type: 'interactive' })
      .filter((record) => record.type === 'interactive').findLast((record) => record.requestId === 'lost-request');
    assert.equal(uncertain?.event, 'input-uncertain');
    const noResend = await operateInteractive(deps, lostRequest);
    assert.equal(noResend.status, 'outcome-unknown');

    const timer = createInteractiveTimerController(deps); t.after(() => timer.dispose());
    const scheduled = await timer.reconcile();
    assert.ok(scheduled.some((deadline) => deadline.kind === 'session' && deadline.toolSessionId === toolSessionId));

    const fenced = host.ctx.hima.ledger.run(run.id)!;
    await host.ctx.hima.ledger.advanceRun(run.id, { control: { ...fenced.control!, requests: { ...fenced.control!.requests,
      'exit:test': { actor: 'desktop-user', origin: 'human', epoch: 1, revision: 0, at: new Date().toISOString(),
        digest: digest('9'), state: 'done', receipt: { requestId: 'exit-test', action: 'host-exit', data: { mode: 'drain' } } } } } });
    const exitMutation = await operateInteractive(deps, { ...base, action: 'input', requestId: 'exit-fenced-input',
      toolSessionId, commandId: 'exit-fenced-input', command: { name: 'set', args: { key: 'blocked', value: true } } });
    assert.equal(exitMutation.status, 'refused'); assert.match(exitMutation.reason!, /App is closing/);
    const exitRead = await operateInteractive(deps, { ...base, action: 'read', requestId: 'exit-fenced-read', toolSessionId });
    assert.equal(exitRead.status, 'read', 'exit fence preserves transcript reads');
    const exitSignal = await operateInteractive(deps, { ...base, action: 'signal', requestId: 'exit-fenced-signal',
      toolSessionId, signal: 'interrupt' });
    assert.equal(exitSignal.status, 'delivered', 'exit fence preserves explicit interrupt/cleanup');

    const closed = await operateInteractive(deps, { ...base, action: 'close', requestId: 'close-1', toolSessionId });
    assert.equal(closed.status, 'closed');
    const exitedOpenDuplicate = await operateInteractive(deps, { ...base, action: 'open', requestId: 'open-1', controlRevision: 999 });
    assert.equal(exitedOpenDuplicate.status, 'duplicate', 'natural/explicit exit does not erase the original open receipt');
    if (exitedOpenDuplicate.status === 'duplicate' && 'readiness' in exitedOpenDuplicate) assert.equal(exitedOpenDuplicate.readiness, 'ready', 'duplicate preserves the original open readiness after close');
    else assert.fail(`open duplicate lost its original receipt: ${JSON.stringify(exitedOpenDuplicate)}`);

    const productionRun = await makeRun('interactive-production-operator', 'execution-production');
    const productionBinding: InteractiveBinding = { ...binding, id: 'production-binding',
      source: { kind: 'admin-file', path: '/trusted/admin/production-binding.json', sha256: digest('e') } };
    const productionDeps: InteractiveRuntimeDeps = { ...deps, trustedTestQualification: undefined,
      resolveOperation: async () => ({ ...derived, binding: productionBinding }),
      verifyAdminBinding: async () => ({ bindingFileRealpath: '/trusted/admin/production-binding.json',
        bindingFileSha256: digest('e'), environmentDigest: productionBinding.environment.digest,
        confinement: 'enforced', writableRoot: path.dirname(home.workspace) }) };
    const productionOwner = { runId: productionRun.id, executionId: 'execution-production', nodeId: 'manual',
      actor: String(parent.id), ownerEpoch: 1, controlRevision: 0 };
    const productionGrant = await interactiveDelegationGrant(productionDeps, productionOwner);
    assert.equal('reason' in productionGrant, false, 'production binding grants only an exact Operator delegation');
    if ('reason' in productionGrant) return;
    const productionOperator = { ...productionOwner, actor: 'production-operator-child', authorityOwner: String(parent.id),
      expectedBindingDigest: productionGrant.bindingDigest };
    const productionOpen = await operateInteractive(productionDeps, { ...productionOperator, action: 'open', requestId: 'production-open' });
    assert.equal(productionOpen.status, 'opened', 'reason' in productionOpen ? productionOpen.reason : undefined);
    if (productionOpen.status !== 'opened') return;
    const productionSession = productionOpen.session.toolSessionId; sessions.push(productionSession);
    const ownerTakeover = await operateInteractive(productionDeps, { ...productionOwner, action: 'input', requestId: 'production-owner-takeover',
      toolSessionId: productionSession, commandId: 'owner-set', command: { name: 'set', args: { key: 'owner', value: true } } });
    assert.equal(ownerTakeover.status, 'refused');
    assert.match(ownerTakeover.reason!, /recorded Operator child|cannot take over/i);
    const operatorSet = await operateInteractive(productionDeps, { ...productionOperator, action: 'input', requestId: 'production-operator-set',
      toolSessionId: productionSession, commandId: 'operator-set', command: { name: 'set', args: { key: 'operator', value: true } }, waitMs: 1_000 });
    assert.equal(operatorSet.status, 'completed');
    const productionClose = await operateInteractive(productionDeps, { ...productionOperator, action: 'close',
      requestId: 'production-close', toolSessionId: productionSession });
    assert.equal(productionClose.status, 'closed');

    const uncertainRun = await makeRun('interactive-open-uncertain', 'execution-open-uncertain');
    const uncertainRequest = { runId: uncertainRun.id, executionId: 'execution-open-uncertain', nodeId: 'manual',
      actor: String(parent.id), ownerEpoch: 1, controlRevision: 0, action: 'open' as const, requestId: 'open-uncertain' };
    const uncertainDigest = interactiveCallerDigest(uncertainRequest); const uncertainSession = 'hima-retained-uncertain';
    const { action: _uncertainAction, ...uncertainCommon } = uncertainRequest;
    const uncertainIntent = parseInteractiveRecord({ ...uncertainCommon, toolSessionId: uncertainSession,
      callerDigest: uncertainDigest, operationDigest: digest('3'), at: new Date().toISOString(), event: 'open-intent',
      jobSession: uncertainSession, transcriptPath: path.join(home.workspace, `${uncertainSession}.log`),
      exitPath: path.join(home.workspace, `${uncertainSession}.exit`), sessionDeadlineAt: new Date(Date.now() + 30_000).toISOString() });
    await host.ctx.hima.ledger.appendInteractive(uncertainRun.id, { executionId: uncertainRequest.executionId,
      toolSessionId: uncertainSession, requestId: uncertainRequest.requestId, event: 'open-intent', payload: uncertainIntent as never });
    const uncertainJob = { ...opened.session.job, session: uncertainSession, name: 'retained-uncertain',
      startedAt: new Date().toISOString(), wire: 'retained uncertain fixture' };
    await host.ctx.hima.ledger.appendJob(uncertainRun.id, { event: 'launched', nodeId: 'manual', job: uncertainJob });
    const uncertainOutcome = parseInteractiveRecord({ ...uncertainCommon, toolSessionId: uncertainSession,
      callerDigest: uncertainDigest, operationDigest: digest('3'), at: new Date().toISOString(), event: 'open-uncertain',
      jobSession: uncertainSession, qualification: opened.session.qualification, reason: 'launch receipt was lost after native publication' });
    await host.ctx.hima.ledger.appendInteractive(uncertainRun.id, { executionId: uncertainRequest.executionId,
      toolSessionId: uncertainSession, requestId: uncertainRequest.requestId, event: 'open-uncertain', payload: uncertainOutcome as never });
    const retainedUncertain = await operateInteractive(deps, { ...uncertainRequest, controlRevision: 999 });
    assert.equal(retainedUncertain.status, 'uncertain');
    if (retainedUncertain.status === 'uncertain') assert.match(retainedUncertain.reason, /lost after native publication/);
    await host.ctx.hima.ledger.appendJob(uncertainRun.id, { event: 'killed', nodeId: 'manual', job: uncertainJob });

    const releasedRun = await makeRun('interactive-open-released', 'execution-open-released');
    const releasedRequest = { runId: releasedRun.id, executionId: 'execution-open-released', nodeId: 'manual',
      actor: String(parent.id), ownerEpoch: 1, controlRevision: 0, action: 'open' as const, requestId: 'open-released' };
    const releasedDigest = interactiveCallerDigest(releasedRequest); const releasedSession = 'hima-retained-released';
    const { action: _releasedAction, ...releasedCommon } = releasedRequest;
    const releasedIntent = parseInteractiveRecord({ ...releasedCommon, toolSessionId: releasedSession,
      callerDigest: releasedDigest, operationDigest: digest('4'), at: new Date().toISOString(), event: 'open-intent',
      jobSession: releasedSession, transcriptPath: path.join(home.workspace, `${releasedSession}.log`),
      exitPath: path.join(home.workspace, `${releasedSession}.exit`), sessionDeadlineAt: new Date(Date.now() + 30_000).toISOString() });
    await host.ctx.hima.ledger.appendInteractive(releasedRun.id, { executionId: releasedRequest.executionId,
      toolSessionId: releasedSession, requestId: releasedRequest.requestId, event: 'open-intent', payload: releasedIntent as never });
    const releasedOutcome = parseInteractiveRecord({ ...releasedCommon, toolSessionId: releasedSession,
      callerDigest: releasedDigest, operationDigest: digest('4'), at: new Date().toISOString(), event: 'open-released',
      jobSession: releasedSession, reason: 'verified absent and released without a Job' });
    await host.ctx.hima.ledger.appendInteractive(releasedRun.id, { executionId: releasedRequest.executionId,
      toolSessionId: releasedSession, requestId: releasedRequest.requestId, event: 'open-released', payload: releasedOutcome as never });
    const retainedReleased = await operateInteractive(deps, { ...releasedRequest, controlRevision: 999 });
    assert.equal(retainedReleased.status, 'uncertain');
    if (retainedReleased.status === 'uncertain') assert.match(retainedReleased.reason, /verified absent and released/);
    await host.ctx.hima.ledger.advanceRun(run.id, { status: 'cancelled' });
    const stoppedRead = await operateInteractive(deps, { ...base, action: 'read', requestId: 'read-after-stop', toolSessionId });
    assert.equal(stoppedRead.status, 'read', 'durable transcript read remains available after the Run stops');

    const unavailableRun = await makeRun('interactive-unqualified', 'execution-unqualified');
    derived = { ...derived, binding: { ...binding, id: 'fixture-unqualified',
      source: { kind: 'trusted-test-fixture', id: 'fixture-unqualified' }, mutation: 'unavailable' } };
    const unavailableDeps: InteractiveRuntimeDeps = { ...deps, trustedTestQualification: { bindingId: 'fixture-unqualified' } };
    const unavailableBase = { runId: unavailableRun.id, executionId: 'execution-unqualified', nodeId: 'manual',
      actor: String(parent.id), ownerEpoch: 1, controlRevision: 0 };
    const unavailableOpen = await operateInteractive(unavailableDeps, { ...unavailableBase, action: 'open', requestId: 'open-unqualified' });
    assert.equal(unavailableOpen.status, 'opened', 'reason' in unavailableOpen ? unavailableOpen.reason : undefined);
    if (unavailableOpen.status === 'opened') {
      sessions.push(unavailableOpen.session.toolSessionId);
      const refusedMutation = await operateInteractive(unavailableDeps, { ...unavailableBase, action: 'input',
        requestId: 'mutation-unqualified', toolSessionId: unavailableOpen.session.toolSessionId,
        commandId: 'set-unqualified', command: { name: 'set', args: { key: 'x', value: 1 } } });
      assert.equal(refusedMutation.status, 'refused'); assert.match(refusedMutation.reason!, /mutation is unavailable/);
      await operateInteractive(unavailableDeps, { ...unavailableBase, action: 'close', requestId: 'close-unqualified',
        toolSessionId: unavailableOpen.session.toolSessionId });
    }

    const reservationRun = await makeRun('interactive-crash-reservation', 'execution-reservation');
    const reservedSession = `hima-crash-reservation-${Date.now().toString(16)}`;
    const reservationIntent = parseInteractiveRecord({ runId: reservationRun.id, executionId: 'execution-reservation',
      nodeId: 'manual', toolSessionId: reservedSession, requestId: 'crash-open', actor: String(parent.id), ownerEpoch: 1,
      controlRevision: 0, callerDigest: digest('1'), operationDigest: digest('2'), at: new Date().toISOString(),
      event: 'open-intent', jobSession: reservedSession, transcriptPath: path.join(home.workspace, `${reservedSession}.log`),
      exitPath: path.join(home.workspace, `${reservedSession}.exit`), sessionDeadlineAt: new Date(Date.now() + 30_000).toISOString() });
    await host.ctx.hima.ledger.appendInteractive(reservationRun.id, { executionId: 'execution-reservation',
      toolSessionId: reservedSession, requestId: 'crash-open', event: 'open-intent', payload: reservationIntent as never });
    sessions.push(reservedSession);
    assert.equal(spawnSync('tmux', ['new-session', '-d', '-s', reservedSession, 'sleep', '60']).status, 0);
    const reservationFabric = { ledger: host.ctx.hima.ledger as never, sitesDir: site.sitesDir } as never;
    let launchedAfterCrash = false;
    await assert.rejects(() => claimSlot({ ledger: host.ctx.hima.ledger as never, sitesDir: site.sitesDir }, {
      site: { name: 'local', jobs: 1, licences: {} }, holds: {}, launch: async () => { launchedAfterCrash = true; return 'launched'; },
    }), /no Job record/);
    assert.equal(launchedAfterCrash, false, 'live unrecorded tmux reservation blocks the next batch or interactive launch');
    spawnSync('tmux', ['kill-session', '-t', `=${reservedSession}`]);
    const released = await reconcileInteractiveLaunchReservations(reservationFabric, 'local');
    assert.ok(released.some((entry) => entry.toolSessionId === reservedSession && entry.state === 'released'));
  } finally {
    for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
  }
});

// #64 D-T01-3: the Harness "closed" worker 02's interactive session, but the tool it had launched
// kept running and kept its locks in the slot, so every retry in that slot was refused by the
// wrapper's startup lock check. A close must end with the Job's process group observed gone, or
// with a recorded `process-survived` naming the process group, which the next open of the same
// node then refuses on instead of launching into the stale lock.
test('interactive close waits for the wrapper\'s own shutdown, and a surviving tool is recorded and refused by the retry', async (t) => {
  const { existsSync } = await import('node:fs');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const home = await createHimaHome(); t.after(() => home.dispose());
  const site = await writeLocalSite(home, { allowedReadRoots: [home.workspace], allowedWriteRoots: [home.workspace],
    allowedWrappers: ['sh'], parallelJobs: 2, licences: { fixture: 2 } });
  const host = await bootInProcess(home); t.after(() => host.dispose());
  const parent = await createRootAgent(host.ctx, home.workspace);
  // The stand-in wrapper owns one slot lock for its tool's lifetime, as XTop's `.cdslck` files are:
  // a start refuses while the lock exists, and only the wrapper's own shutdown path releases it.
  // `slow` takes two seconds to shut down after the hangup; `stubborn` ignores hangup and TERM
  // entirely and ends only on an interrupt from a person.
  const wrapper = path.join(home.workspace, 'slot-wrapper.sh');
  await writeFile(wrapper, [
    'slot=$1; mode=$2; node=$3; repl=$4',
    'if [ -e "$slot/tool.lock" ]; then echo "writable slot holds a live tool lock" >&2; exit 3; fi',
    'echo $$ > "$slot/tool.lock"',
    'release() { rm -f "$slot/tool.lock"; }',
    'if [ "$mode" = slow ]; then trap \'sleep 2; release; exit 0\' HUP TERM; fi',
    'if [ "$mode" = stubborn ]; then trap \'\' HUP TERM; trap \'release; exit 0\' INT; fi',
    '"$node" "$repl" fixture-repl 1',
    'if [ "$mode" = stubborn ]; then while :; do sleep 1; done; fi',
    'release', '',
  ].join('\n'));
  const executions = ['slow-1', 'slow-2', 'stubborn-1', 'stubborn-2'];
  const run = await host.ctx.hima.ledger.createRun({
    campaignId: 'interactive-close', siteId: 'local', packId: 'fixture-pack', packDigest: digest('a'), status: 'running', currentNode: 'manual', generation: 1,
    budget: { timeBoxMs: 120_000, closingReserveMs: 1_000, retryAllowance: 3, jobCap: 2, licences: { fixture: 2 }, generationLimit: 1 },
    control: { mode: 'agent', owner: String(parent.id), epoch: 1, revision: 0, paused: [], requests: {},
      executions: Object.fromEntries(executions.map((id, index) => [id, { ...execution, id, attempt: index % 2 + 1 }])) },
  });
  let mode = 'slow';
  const slot = () => path.join(home.workspace, `slot-${mode}`);
  const notices: { owner: string; runId: string; key: string; detail?: string }[] = [];
  const deps = {
    fabric: { ledger: host.ctx.hima.ledger, sitesDir: site.sitesDir,
      notify: (owner: string, runId: string, key: string, detail?: string) => { notices.push({ owner, runId, key, detail }); return { status: 'queued' }; } } as never,
    resolveOperation: async () => ({ binding, site: 'local', workspace: home.workspace,
      argv: ['sh', wrapper, slot(), mode, process.execPath, fixture], name: `close-${mode}`, licences: { fixture: 1 },
      commands: [{ name: 'get', effect: 'read' as const }, { name: 'exit', effect: 'close' as const }] }),
    verifyAdminBinding: async (effective: InteractiveBinding) => ({ bindingFileRealpath: '/trusted/test/binding',
      bindingFileSha256: digest('0'), environmentDigest: effective.environment.digest, confinement: 'unqualified' as const }),
    encodeCommand: async (_binding: InteractiveBinding, request: { commandId: string; protocolToken: string; name: string; args: unknown }) => ({
      text: JSON.stringify({ id: request.commandId, _himaToken: request.protocolToken, op: request.name, ...(request.args as object) }),
      submit: true, effect: request.name === 'get' ? 'read' as const : 'close' as const }),
    claimJobSlot: async (request: Parameters<NonNullable<InteractiveRuntimeDeps['claimJobSlot']>>[0]) => {
      const claimed = await claimSlot({ ledger: host.ctx.hima.ledger as never, sitesDir: site.sitesDir }, {
        site: { name: request.site, jobs: request.run.budget!.jobCap, licences: request.run.budget!.licences },
        holds: request.licences, launch: request.launch });
      return claimed.kind === 'claimed' ? { kind: 'claimed' as const, launched: claimed.launched }
        : { kind: 'at-cap' as const, reason: claimed.kind === 'at-cap' ? 'site Job/licence cap is full' : String((claimed as { error?: Error }).error?.message ?? claimed.kind) };
    },
    trustedTestQualification: { bindingId: 'fixture-binding' },
    closeGrace: { hangupMs: 4_000, terminateMs: 1_000 },
    onDeadline: async () => {},
  } as InteractiveRuntimeDeps;
  const owner = { runId: run.id, nodeId: 'manual', actor: String(parent.id), ownerEpoch: 1, controlRevision: 0 };
  const sessions: string[] = []; const groups: number[] = [];
  const tmuxThere = (session: string) => spawnSync('tmux', ['has-session', '-t', `=${session}`]).status === 0;
  const open = async (executionId: string, requestId: string) => {
    const opened = await operateInteractive(deps, { ...owner, executionId, action: 'open', requestId });
    if (opened.status === 'opened') { sessions.push(opened.session.toolSessionId); groups.push(opened.session.job.pid!); }
    return opened;
  };
  try {
    // A wrapper that takes a while to shut down: close waits for it, so the retry finds the slot free.
    await mkdir(slot(), { recursive: true });
    const first = await open('slow-1', 'open-slow-1');
    assert.equal(first.status, 'opened', JSON.stringify(first)); if (first.status !== 'opened') return;
    assert.equal(first.readiness, 'ready');
    assert.ok(existsSync(path.join(slot(), 'tool.lock')), 'the running tool holds its slot lock');
    const closed = await operateInteractive(deps, { ...owner, executionId: 'slow-1', action: 'close', requestId: 'close-slow-1',
      toolSessionId: first.session.toolSessionId });
    assert.equal(closed.status, 'closed', JSON.stringify(closed));
    assert.equal(existsSync(path.join(slot(), 'tool.lock')), false, 'a close returns only after the wrapper\'s own shutdown released its lock');
    assert.equal(tmuxThere(first.session.toolSessionId), false);
    const retry = await open('slow-2', 'open-slow-2');
    assert.equal(retry.status, 'opened', JSON.stringify(retry)); if (retry.status !== 'opened') return;
    assert.equal(retry.readiness, 'ready', 'the retry in the same slot is not refused by a lock the previous session left');
    const retryClosed = await operateInteractive(deps, { ...owner, executionId: 'slow-2', action: 'close', requestId: 'close-slow-2',
      toolSessionId: retry.session.toolSessionId });
    assert.equal(retryClosed.status, 'closed', JSON.stringify(retryClosed));

    // A tool that ignores hangup and TERM: close records process-survived with the Job's process group.
    mode = 'stubborn'; await mkdir(slot(), { recursive: true });
    const stubborn = await open('stubborn-1', 'open-stubborn-1');
    assert.equal(stubborn.status, 'opened', JSON.stringify(stubborn)); if (stubborn.status !== 'opened') return;
    const pid = stubborn.session.job.pid!;
    assert.ok(Number.isInteger(pid) && pid > 0);
    const survived = await operateInteractive(deps, { ...owner, executionId: 'stubborn-1', action: 'close', requestId: 'close-stubborn-1',
      toolSessionId: stubborn.session.toolSessionId }) as Record<string, any>;
    assert.equal(survived.status, 'process-survived', JSON.stringify(survived));
    assert.equal(survived.pid, pid, 'the survivor is named by the Job\'s recorded process group');
    const records = host.ctx.hima.ledger.records({ runId: run.id });
    const receipt = records.findLast((record) => record.type === 'interactive' && record.requestId === 'close-stubborn-1');
    assert.equal(receipt?.type === 'interactive' ? receipt.event : undefined, 'process-survived');
    assert.equal(receipt?.type === 'interactive' ? (receipt.payload as { pid?: number }).pid : undefined, pid);
    assert.deepEqual(records.filter((record) => record.type === 'job' && record.job.session === stubborn.session.toolSessionId).map((record) => record.type === 'job' ? record.event : ''),
      ['launched'], 'a surviving tool is not recorded as a killed Job');
    assert.equal(listInteractiveSessions(host.ctx.hima.ledger as never, run.id, 'stubborn-1')[0]?.status, 'uncertain');
    // #64 review I1: a survivor is a visible blocker on its node and the owner is told, never a
    // silent `working` node until the time box ends.
    const blockers = host.ctx.hima.ledger.records({ runId: run.id, type: 'blocker' });
    assert.equal(blockers.length, 1, JSON.stringify(blockers));
    const blocker = blockers[0]!;
    assert.ok(blocker.type === 'blocker' && blocker.nodeId === 'manual' && new RegExp(`process group ${pid}`).test(blocker.reason), JSON.stringify(blocker));
    const held = host.ctx.hima.ledger.run(run.id)!.control!.executions['stubborn-1']!;
    assert.equal(held.phase, 'uncertain', JSON.stringify(held));
    assert.match(held.reason ?? '', new RegExp(`process group ${pid}`));
    assert.equal(notices.length, 1, JSON.stringify(notices));
    assert.equal(notices[0]!.owner, String(parent.id)); assert.equal(notices[0]!.runId, run.id); assert.equal(notices[0]!.key, 'stubborn-1');
    assert.match(notices[0]!.detail ?? '', new RegExp(`process group ${pid}`));
    assert.ok(existsSync(path.join(slot(), 'tool.lock')), 'the survivor still holds its slot lock');
    const refused = await open('stubborn-2', 'open-stubborn-2');
    assert.equal(refused.status, 'refused', JSON.stringify(refused));
    assert.match((refused as { reason: string }).reason, new RegExp(`process group ${pid}`), 'the retry names the surviving process group');
    assert.doesNotMatch(JSON.stringify(refused), /live tool lock/);

    // #64 review I2: every other stop (cancel, time box, node stop, App quit) goes through the same
    // process-group stop, so none of them records `killed` while the tool is alive.
    const { jobKill } = await import('@hima/harness');
    const stopped = await jobKill({ ledger: host.ctx.hima.ledger as never, sitesDir: site.sitesDir },
      { run: run.id, session: stubborn.session.toolSessionId, grace: { hangupMs: 1_000, terminateMs: 1_000 } });
    assert.deepEqual(stopped.outcome, { wasRunning: true, gone: false, survivedPid: pid }, JSON.stringify(stopped.outcome));
    assert.equal(stopped.record, undefined);
    assert.equal(host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }).filter((record) => record.type === 'job'
      && record.job.session === stubborn.session.toolSessionId && record.event === 'killed').length, 0, 'a stop that left the tool alive records no kill');
    // The retry guard asks about the process group itself, not the tmux session: with the Job's
    // session gone (a bare kill by an older Host or by hand), the survivor still refuses the slot.
    spawnSync('tmux', ['kill-session', '-t', `=${stubborn.session.toolSessionId}`]);
    assert.equal(tmuxThere(stubborn.session.toolSessionId), false);
    const stillRefused = await open('stubborn-2', 'open-stubborn-2-sessionless');
    assert.equal(stillRefused.status, 'refused', JSON.stringify(stillRefused));
    assert.match((stillRefused as { reason: string }).reason, new RegExp(`process group ${pid}`));

    // A person ends the survivor; the same retry then opens in the freed slot.
    process.kill(-pid, 'SIGINT');
    await waitFor(() => !existsSync(path.join(slot(), 'tool.lock')), 'the survivor releases its slot lock once a person ends it');
    const reopened = await open('stubborn-2', 'open-stubborn-2-after');
    assert.equal(reopened.status, 'opened', JSON.stringify(reopened)); if (reopened.status !== 'opened') return;
    assert.equal(reopened.readiness, 'ready');
    const exited = await operateInteractive(deps, { ...owner, executionId: 'stubborn-2', action: 'input', requestId: 'exit-stubborn-2',
      toolSessionId: reopened.session.toolSessionId, commandId: 'exit-stubborn-2', command: { name: 'exit', args: {} }, waitMs: 2_000 });
    assert.equal(exited.status, 'completed', JSON.stringify(exited));
  } finally {
    for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
    for (const group of groups) { try { process.kill(-group, 'SIGKILL'); } catch { /* already gone */ } }
  }
});

// #64 D-T02-4: on the Site's tmux 3.4, `tmux run-shell` prints nothing, so a liveness probe read
// through it answered "" and every later open in a slot whose survivor had already ended was
// refused for the rest of the Run. The probe asks the process group itself through the Site
// channel; tmux's own output plays no part in the answer. The stand-in `tmux` below behaves as the
// Site's did: every `run-shell` succeeds and prints nothing, every other tmux verb is the real one.
test('a survivor\'s process group is asked through the Site channel, so a silent tmux run-shell neither refuses a freed slot nor admits a live one', async (t) => {
  const { chmod, mkdir, writeFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const home = await createHimaHome(); t.after(() => home.dispose());
  const site = await writeLocalSite(home, { allowedReadRoots: [home.workspace], allowedWriteRoots: [home.workspace],
    allowedWrappers: ['sh'], parallelJobs: 2, licences: { fixture: 2 } });
  const realTmux = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(realTmux, 'tmux is on PATH');
  const standins = path.join(home.workspace, 'silent-run-shell'); await mkdir(standins, { recursive: true });
  await writeFile(path.join(standins, 'tmux'), ['#!/bin/sh', 'for word in "$@"; do [ "$word" = run-shell ] && exit 0; done',
    `exec ${shellQuote(realTmux)} "$@"`, ''].join('\n'));
  await chmod(path.join(standins, 'tmux'), 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${standins}${path.delimiter}${priorPath ?? ''}`;
  t.after(() => { process.env.PATH = priorPath; });
  assert.equal(spawnSync('tmux', ['start-server', ';', 'run-shell', 'echo alive'], { encoding: 'utf8' }).stdout, '',
    'the stand-in tmux answers run-shell with nothing, as tmux 3.4 did on the Site');
  const host = await bootInProcess(home); t.after(() => host.dispose());
  const parent = await createRootAgent(host.ctx, home.workspace);
  const slot = path.join(home.workspace, 'slot'); await mkdir(slot, { recursive: true });
  const wrapper = path.join(home.workspace, 'stubborn-wrapper.sh');
  await writeFile(wrapper, [
    'slot=$1; node=$2; repl=$3',
    'if [ -e "$slot/tool.lock" ]; then echo "writable slot holds a live tool lock" >&2; exit 3; fi',
    'echo $$ > "$slot/tool.lock"',
    'trap \'\' HUP TERM; trap \'rm -f "$slot/tool.lock"; exit 0\' INT',
    '"$node" "$repl" fixture-repl 1',
    'while :; do sleep 1; done', '',
  ].join('\n'));
  const run = await host.ctx.hima.ledger.createRun({
    campaignId: 'silent-run-shell', siteId: 'local', packId: 'fixture-pack', packDigest: digest('a'), status: 'running', currentNode: 'manual', generation: 1,
    budget: { timeBoxMs: 120_000, closingReserveMs: 1_000, retryAllowance: 3, jobCap: 2, licences: { fixture: 2 }, generationLimit: 1 },
    control: { mode: 'agent', owner: String(parent.id), epoch: 1, revision: 0, paused: [], requests: {},
      executions: Object.fromEntries(['first', 'retry'].map((id, index) => [id, { ...execution, id, attempt: index + 1 }])) },
  });
  const deps = {
    fabric: { ledger: host.ctx.hima.ledger, sitesDir: site.sitesDir, notify: () => ({ status: 'queued' }) } as never,
    resolveOperation: async () => ({ binding, site: 'local', workspace: home.workspace,
      argv: ['sh', wrapper, slot, process.execPath, fixture], name: 'silent-probe', licences: { fixture: 1 },
      commands: [{ name: 'get', effect: 'read' as const }, { name: 'exit', effect: 'close' as const }] }),
    verifyAdminBinding: async (effective: InteractiveBinding) => ({ bindingFileRealpath: '/trusted/test/binding',
      bindingFileSha256: digest('0'), environmentDigest: effective.environment.digest, confinement: 'unqualified' as const }),
    encodeCommand: async (_binding: InteractiveBinding, request: { commandId: string; protocolToken: string; name: string; args: unknown }) => ({
      text: JSON.stringify({ id: request.commandId, _himaToken: request.protocolToken, op: request.name, ...(request.args as object) }),
      submit: true, effect: request.name === 'get' ? 'read' as const : 'close' as const }),
    claimJobSlot: async (request: Parameters<NonNullable<InteractiveRuntimeDeps['claimJobSlot']>>[0]) => {
      const claimed = await claimSlot({ ledger: host.ctx.hima.ledger as never, sitesDir: site.sitesDir }, {
        site: { name: request.site, jobs: request.run.budget!.jobCap, licences: request.run.budget!.licences },
        holds: request.licences, launch: request.launch });
      return claimed.kind === 'claimed' ? { kind: 'claimed' as const, launched: claimed.launched }
        : { kind: 'at-cap' as const, reason: claimed.kind === 'at-cap' ? 'site Job/licence cap is full' : String((claimed as { error?: Error }).error?.message ?? claimed.kind) };
    },
    trustedTestQualification: { bindingId: 'fixture-binding' },
    closeGrace: { hangupMs: 1_000, terminateMs: 1_000 },
    onDeadline: async () => {},
  } as InteractiveRuntimeDeps;
  const owner = { runId: run.id, nodeId: 'manual', actor: String(parent.id), ownerEpoch: 1, controlRevision: 0 };
  const sessions: string[] = []; const groups: number[] = [];
  const open = async (executionId: string, requestId: string) => {
    const opened = await operateInteractive(deps, { ...owner, executionId, action: 'open', requestId });
    if (opened.status === 'opened') { sessions.push(opened.session.toolSessionId); groups.push(opened.session.job.pid!); }
    return opened;
  };
  try {
    const first = await open('first', 'open-first');
    assert.equal(first.status, 'opened', JSON.stringify(first)); if (first.status !== 'opened') return;
    const pid = first.session.job.pid!;
    const survived = await operateInteractive(deps, { ...owner, executionId: 'first', action: 'close', requestId: 'close-first',
      toolSessionId: first.session.toolSessionId });
    assert.equal(survived.status, 'process-survived', JSON.stringify(survived));
    // While the survivor runs, the retry is refused naming its group: the silent run-shell did not decide it.
    const whileAlive = await open('retry', 'open-retry-alive').catch((error: Error) => ({ status: 'threw', reason: error.message }));
    assert.equal(whileAlive.status, 'refused', JSON.stringify(whileAlive));
    assert.match((whileAlive as { reason: string }).reason, new RegExp(`process group ${pid} still runs`), JSON.stringify(whileAlive));
    // A person ends the survivor; the probe reads the group gone and the same slot opens again.
    process.kill(-pid, 'SIGINT');
    await waitFor(() => !existsSync(path.join(slot, 'tool.lock')), 'the survivor releases its slot lock once a person ends it');
    await waitFor(() => { try { process.kill(-pid, 0); return false; } catch { return true; } }, 'the survivor\'s process group is gone');
    const reopened = await open('retry', 'open-retry-after').catch((error: Error) => ({ status: 'threw', reason: error.message }));
    assert.equal(reopened.status, 'opened', JSON.stringify(reopened));
    assert.ok(!remoteCommandsOf(/run-shell/).length, 'no liveness question went through tmux run-shell');
  } finally {
    for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
    for (const group of groups) { try { process.kill(-group, 'SIGKILL'); } catch { /* already gone */ } }
  }
});

/** Every command the channel audit holds whose wire matches `pattern`. */
const remoteCommandsOf = (pattern: RegExp) => remoteCommands().filter((command) => pattern.test(command.wire));

async function waitFor(check: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
