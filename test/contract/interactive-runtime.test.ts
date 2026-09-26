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
  type DerivedInteractiveOperation, type InteractiveBinding, type InteractiveRuntimeDeps,
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
    argv: ['sh', '-c', `exec ${shellQuote(process.execPath)} ${shellQuote(fixture)} fixture-repl 1`], name: 'runtime-repl', licences: { fixture: 1 } };
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
