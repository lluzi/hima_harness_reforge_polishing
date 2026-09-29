import assert from 'node:assert/strict';
import { appendFile, copyFile, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { retainRunMaterial, runDelegations } from '@hima/harness';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeMomentScenario } from './support/moments.ts';
import { timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const member = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  id, role, node: 'synthesize', taskTemplate: `Return the ${id} result as one JSON object.`,
  inputs: ['qorReport'], allowedTools: ['hima_delegation_input'], scopePolicy: 'declared-inputs-only',
  budgetShare: { maxElapsedMs: 10_000, maxFollowups: 0 }, dependencyRoles: [],
  resultSchema: { id: `fixture-${id}/1`, required: ['schema'] }, recipient: 'run-owner',
  ownerAdoption: 'candidate-only', identity: 'one-child-per-role-per-execution', followup: 'forbidden',
  cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
  refusalConditions: ['missing-evidence'], ...extra,
});

test('a Team execution whose required member ended without a result settles failed and a fresh attempt begins', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h, flow } = local;
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined; let cleanupRunId: string | undefined;
  t.after(async () => { if (host && cleanupRunId) await host.ctx.hima.cancelRun(cleanupRunId); await host?.dispose(); await h.dispose(); });
  const packsDir = path.join(h.home, 'hima/packs');
  const packId = 'team-settlement';
  await writePackVariant(packsDir, packId, [], [], timingProbePackId);
  const contractFile = path.join(packsDir, packId, 'contract.yml');
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  const wrapper = await realpath('/usr/bin/tclsh');
  contract.environment.wrappers = [wrapper];
  contract.workspace.copy.push('interactive-repl.tcl');
  const tool = contract.tools.find((candidate: { id: string }) => candidate.id === 'synth');
  tool.licences = {};
  tool.argv = [wrapper, '${WORKSPACE}/flow/interactive-repl.tcl'];
  tool.interactive = { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', argv: tool.argv, commands: {
    read: ['get_value'], mutate: ['set_value'], save: ['save_state', 'close_session'],
  }, arguments: {
    get_value: [{ name: 'key', type: 'string' }],
    set_value: [{ name: 'key', type: 'string' }, { name: 'value', type: 'number' }, { name: 'planSha256', type: 'string' }],
    save_state: [{ name: 'file', type: 'string' }], close_session: [],
  } };
  contract.agentTeams = [
    // The Operator and every role it transitively depends on are what this execution needs to finish.
    { id: 'required-team', version: '1', triggerNode: 'synthesize', members: [
      // A short allocation lets the fresh attempt also prove the unattended deadline path.
      member('reviewer', 'reviewer', { ownerAdoption: 'required', budgetShare: { maxElapsedMs: 8_000, maxFollowups: 0 },
        resultSchema: { id: 'fixture-review/1', required: ['schema', 'planSha256', 'command', 'arguments'] } }),
      member('operator', 'operator', { inputs: ['qorReport'], allowedTools: ['hima_interactive'],
        scopePolicy: 'site-qualified-interactive-only', dependencyRoles: ['reviewer'], ownerAdoption: 'required',
        reviewedAction: { fromRole: 'reviewer', planInput: 'qorReport', actionListField: 'actions', command: 'set_value',
          hostPlanHashArgument: 'planSha256', planHashField: 'planSha256', commandField: 'command', argumentsField: 'arguments' } }),
    ] },
    // No Operator: this Team only advises, so losing its member does not strand the execution.
    { id: 'advisory-team', version: '1', triggerNode: 'synthesize', members: [member('scout', 'researcher')] },
  ];
  await writeFile(contractFile, stringify(contract));
  const hybridPackId = 'team-settlement-hybrid';
  await writePackVariant(packsDir, hybridPackId, [], [], timingProbePackId);
  await writeFile(path.join(packsDir, hybridPackId, 'contract.yml'),
    stringify({ ...contract, id: hybridPackId, tools: contract.tools.map((item: any) => item.id === 'synth' ? { ...item, interactive: { ...item.interactive, mode: 'hybrid' } } : item) }));
  await copyFile(path.join(repoRoot, 'test/fixtures/interactive-job/repl.tcl'), path.join(packsDir, hybridPackId, 'interactive-repl.tcl'));
  const sourceTemplate = path.join(packsDir, packId, 'interactive-repl.tcl');
  await copyFile(path.join(repoRoot, 'test/fixtures/interactive-job/repl.tcl'), sourceTemplate);
  await copyFile(sourceTemplate, path.join(flow.root, 'interactive-repl.tcl'));
  const site = await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow.root, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper], bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
    licences: {}, parallelJobs: 1 });
  // Every replayed child answers with prose, never the JSON object the recipe demands.
  const scenario = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n`);

  host = await bootInProcess(h);
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 },
    ownerSessionId: actor, timeBoxMs: 120_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  const runId = started.run.id; cleanupRunId = runId;
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  // Team members read one exact current Reader observation; its content is irrelevant here.
  const report = Buffer.from('synthetic qor\n'); const reportSha256 = createHash('sha256').update(report).digest('hex');
  const retained = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir }, runId, report, reportSha256); assert.ok(retained);
  await host.ctx.hima.ledger.appendObservation(runId, { path: `flow/results/${flow.design}/syn/report/qor.rpt`,
    contentSha256: reportSha256, retainedPath: retained, bytes: report.byteLength,
    reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
  const begin = async (requestId: string) => host.ctx.hima.executionAction({ runId, actor, action: 'begin', nodeId: 'synthesize',
    requestId, expectedEpoch: control().epoch, expectedRevision: control().revision });
  const delegate = (body: Record<string, unknown>) => host.ctx.hima.delegate({ runId, actor,
    expectedEpoch: control().epoch, expectedRevision: control().revision, ...body } as never) as Promise<Record<string, any>>;
  const create = (teamId: string, memberId: string, executionId: string, requestId: string) =>
    delegate({ action: 'create', requestId, recipe: { teamId, version: '1', memberId, executionId } });

  const first = await begin('begin-1'); assert.equal(first.kind, 'accepted', JSON.stringify(first));
  const firstId = first.receipt!.executionId!;
  const reviewer = await create('required-team', 'reviewer', firstId, 'reviewer-1');
  assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
  const reviewerId = reviewer.effectiveContract.delegationId as string;
  let refused: Record<string, any> = {}; let reads = 0;
  await waitUntil('the reviewer child returned a completed turn', async () => {
    refused = await delegate({ action: 'result', delegationId: reviewerId, requestId: `reviewer-1-result-${reads++}` });
    return refused.status !== 'unavailable';
  }, 20_000, 100);
  assert.equal(refused.status, 'refused', JSON.stringify(refused));
  const text = 'I acknowledge the retained facts. I will not start another task.';
  let parseError = '';
  try { JSON.parse(text); } catch (error) { parseError = (error as Error).message; }
  assert.ok(refused.reason.includes(parseError),
    `the refusal carries the exact JSON parse error so the owner can relay it: ${refused.reason}`);
  assert.equal(control().executions[firstId]!.phase, 'begun',
    'a refused result alone does not end the execution while the child is still accepted');

  const cancelled = await delegate({ action: 'cancel', delegationId: reviewerId, requestId: 'reviewer-1-cancel' });
  assert.equal(cancelled.status, 'accepted', JSON.stringify(cancelled));
  const settled = control().executions[firstId]!;
  assert.equal(settled.phase, 'failed', 'a required member that ended without a result settles its execution failed');
  assert.match(settled.reason ?? '', /reviewer/); assert.ok(settled.reason!.includes(reviewerId), settled.reason);
  const retrying = host.ctx.hima.ledger.records({ runId, type: 'node' })
    .findLast((record) => record.type === 'node' && record.nodeId === 'synthesize');
  assert.equal(retrying?.type === 'node' && retrying.state, 'retrying', 'the failure spends the ordinary Retry allowance');
  assert.ok(retrying?.type === 'node' && retrying.reason?.includes(reviewerId), JSON.stringify(retrying));

  const second = await begin('begin-2'); assert.equal(second.kind, 'accepted', JSON.stringify(second));
  const secondId = second.receipt!.executionId!;
  assert.notEqual(secondId, firstId);
  assert.equal(control().executions[secondId]!.attempt, control().executions[firstId]!.attempt + 1);
  const freshReviewer = await create('required-team', 'reviewer', secondId, 'reviewer-2');
  assert.equal(freshReviewer.status, 'created', JSON.stringify(freshReviewer));
  assert.notEqual(freshReviewer.effectiveContract.delegationId, reviewerId, 'the fresh attempt owns fresh Team identities');

  // Boundary: an advisory Team without an Operator never strands the execution, so it is not settled.
  const scout = await create('advisory-team', 'scout', secondId, 'scout-2');
  assert.equal(scout.status, 'created', JSON.stringify(scout));
  const scoutCancelled = await delegate({ action: 'cancel', delegationId: scout.effectiveContract.delegationId, requestId: 'scout-2-cancel' });
  assert.equal(scoutCancelled.status, 'accepted', JSON.stringify(scoutCancelled));
  assert.equal(control().executions[secondId]!.phase, 'begun');
  const freshReviewerId = freshReviewer.effectiveContract.delegationId as string;
  assert.equal(runDelegations((host.ctx.hima as any).deps(), runId).find((row) => row.delegationId === freshReviewerId)?.state, 'accepted');

  // Unattended: the required member's recorded deadline alone settles the execution.
  await waitUntil('the fresh attempt settles once its reviewer deadline expires', () => control().executions[secondId]!.phase === 'failed', 15_000, 50);
  assert.equal(runDelegations((host.ctx.hima as any).deps(), runId).find((row) => row.delegationId === freshReviewerId)?.state, 'expired');
  assert.ok(control().executions[secondId]!.reason?.includes(freshReviewerId), control().executions[secondId]!.reason);
  const third = await begin('begin-3'); assert.equal(third.kind, 'accepted', JSON.stringify(third));

  // A Host that stopped after writing the attempt record, but before the phase and any settlement
  // trigger, leaves a begun execution; the owner's next begin finishes it without a second retry.
  const thirdId = third.receipt!.executionId!; const thirdAttempt = control().executions[thirdId]!.attempt;
  const lastReviewer = await create('required-team', 'reviewer', thirdId, 'reviewer-3');
  assert.equal(lastReviewer.status, 'created', JSON.stringify(lastReviewer));
  const lastRow = runDelegations((host.ctx.hima as any).deps(), runId).find((row) => row.delegationId === lastReviewer.effectiveContract.delegationId)!;
  await host.ctx.hima.ledger.appendDelegation(runId, { delegationId: lastRow.delegationId, parentSessionId: lastRow.parentSessionId,
    childSessionId: lastRow.childSessionId, requestId: `deadline:${lastRow.delegationId}`, requestDigest: 'd'.repeat(64),
    event: 'deadline', payload: { reason: 'Original child time allocation expired; new work is fenced.', stopObserved: false } });
  // The third failure spends the default allowance of three, so its attempt record is the blocker.
  await host.ctx.hima.ledger.appendBlocker(runId, { nodeId: 'synthesize', attempts: thirdAttempt, reason: 'interrupted settlement' });
  await host.ctx.hima.ledger.appendNode(runId, { nodeId: 'synthesize', kind: 'act', state: 'blocked', attempt: thirdAttempt,
    reason: 'interrupted settlement' } as never);
  assert.equal(control().executions[thirdId]!.phase, 'begun');
  const fourth = await begin('begin-4');
  assert.equal(control().executions[thirdId]!.phase, 'failed', 'begin settles the stranded execution first');
  const thirdAttempts = host.ctx.hima.ledger.records({ runId, type: 'node' })
    .filter((record) => record.type === 'node' && record.nodeId === 'synthesize' && record.attempt === thirdAttempt);
  assert.deepEqual(thirdAttempts.map((record) => record.type === 'node' && record.state), ['blocked'], 'one failed attempt is settled once');
  assert.equal(host.ctx.hima.ledger.records({ runId, type: 'blocker' }).length, 1);
  assert.ok(control().paused.includes('synthesize'), 'the Hard blocker holds the node for a person');
  assert.equal(fourth.kind, 'refused', JSON.stringify(fourth));

  // Boundary: at a hybrid node the owner can still finish through batch work, so the Team is advisory.
  await host.ctx.hima.cancelRun(runId); cleanupRunId = undefined;
  const hybrid = await host.ctx.hima.startRun({ pack: hybridPackId, site: site.name, goal: { target_period_ns: 2 },
    ownerSessionId: actor, timeBoxMs: 120_000 });
  assert.equal(hybrid.kind, 'ran', JSON.stringify(hybrid)); if (hybrid.kind !== 'ran') return;
  const hybridRunId = hybrid.run.id; cleanupRunId = hybridRunId;
  const hybridControl = () => host!.ctx.hima.ledger.run(hybridRunId)!.control!;
  const hybridRetained = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir }, hybridRunId, report, reportSha256); assert.ok(hybridRetained);
  await host.ctx.hima.ledger.appendObservation(hybridRunId, { path: `flow/results/${flow.design}/syn/report/qor.rpt`,
    contentSha256: reportSha256, retainedPath: hybridRetained, bytes: report.byteLength,
    reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
  const hybridBegin = await host.ctx.hima.executionAction({ runId: hybridRunId, actor, action: 'begin', nodeId: 'synthesize',
    requestId: 'hybrid-begin', expectedEpoch: hybridControl().epoch, expectedRevision: hybridControl().revision });
  assert.equal(hybridBegin.kind, 'accepted', JSON.stringify(hybridBegin));
  const hybridExecutionId = hybridBegin.receipt!.executionId!;
  const hybridDelegate = (body: Record<string, unknown>) => host!.ctx.hima.delegate({ runId: hybridRunId, actor,
    expectedEpoch: hybridControl().epoch, expectedRevision: hybridControl().revision, ...body } as never) as Promise<Record<string, any>>;
  const hybridReviewer = await hybridDelegate({ action: 'create', requestId: 'hybrid-reviewer',
    recipe: { teamId: 'required-team', version: '1', memberId: 'reviewer', executionId: hybridExecutionId } });
  assert.equal(hybridReviewer.status, 'created', JSON.stringify(hybridReviewer));
  const hybridCancel = await hybridDelegate({ action: 'cancel', delegationId: hybridReviewer.effectiveContract.delegationId, requestId: 'hybrid-cancel' });
  assert.equal(hybridCancel.status, 'accepted', JSON.stringify(hybridCancel));
  assert.equal(hybridControl().executions[hybridExecutionId]!.phase, 'begun');
});

// Gap 4 (Harness): a Team member result refused for its schema names the schema and the exact
// missing required fields, so the owner can relay what must change instead of guessing. The child
// replays one JSON object that carries `schema` but omits `planSha256` and `arguments`.
test('an Agent Team result missing required fields is refused naming the schema and the missing fields', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h, flow } = local;
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined; let cleanupRunId: string | undefined;
  t.after(async () => { if (host && cleanupRunId) await host.ctx.hima.cancelRun(cleanupRunId); await host?.dispose(); await h.dispose(); });
  const packsDir = path.join(h.home, 'hima/packs');
  const packId = 'team-schema-refusal';
  await writePackVariant(packsDir, packId, [], [], timingProbePackId);
  const contractFile = path.join(packsDir, packId, 'contract.yml');
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  // No licence declaration is needed for this team-schema check; the site declares none.
  const synth = contract.tools.find((candidate: { id: string }) => candidate.id === 'synth');
  if (synth) synth.licences = {};
  contract.agentTeams = [
    { id: 'schema-team', version: '1', triggerNode: 'synthesize', members: [
      member('reviewer', 'reviewer', { ownerAdoption: 'candidate-only',
        resultSchema: { id: 'fixture-review/1', required: ['schema', 'planSha256', 'command', 'arguments'] } }),
    ] },
  ];
  await writeFile(contractFile, stringify(contract));
  const site = await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow.root], allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace }, licences: {}, parallelJobs: 1 });
  // The one replayed child returns a JSON object that omits two required fields.
  const scenario = await writeMomentScenario(h, 'bad-schema', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n`);

  host = await bootInProcess(h);
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 }, ownerSessionId: actor, timeBoxMs: 120_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  const runId = started.run.id; cleanupRunId = runId;
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const report = Buffer.from('synthetic qor\n'); const reportSha256 = createHash('sha256').update(report).digest('hex');
  const retained = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir }, runId, report, reportSha256); assert.ok(retained);
  await host.ctx.hima.ledger.appendObservation(runId, { path: `flow/results/${flow.design}/syn/report/qor.rpt`,
    contentSha256: reportSha256, retainedPath: retained, bytes: report.byteLength,
    reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
  const delegate = (body: Record<string, unknown>) => host.ctx.hima.delegate({ runId, actor,
    expectedEpoch: control().epoch, expectedRevision: control().revision, ...body } as never) as Promise<Record<string, any>>;
  const begun = await host.ctx.hima.executionAction({ runId, actor, action: 'begin', nodeId: 'synthesize',
    requestId: 'begin-schema', expectedEpoch: control().epoch, expectedRevision: control().revision });
  assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
  const executionId = begun.receipt!.executionId!;
  const reviewer = await delegate({ action: 'create', requestId: 'reviewer-schema',
    recipe: { teamId: 'schema-team', version: '1', memberId: 'reviewer', executionId } });
  assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
  const reviewerId = reviewer.effectiveContract.delegationId as string;
  let refused: Record<string, any> = {}; let reads = 0;
  await waitUntil('the reviewer child returned a completed turn', async () => {
    refused = await delegate({ action: 'result', delegationId: reviewerId, requestId: `reviewer-schema-result-${reads++}` });
    return refused.status !== 'unavailable';
  }, 20_000, 100);
  assert.equal(refused.status, 'refused', JSON.stringify(refused));
  assert.ok(refused.reason.includes('fixture-review/1'), `the refusal names the schema: ${refused.reason}`);
  assert.ok(refused.reason.includes('planSha256'), `the refusal names the missing field planSha256: ${refused.reason}`);
  assert.ok(refused.reason.includes('arguments'), `the refusal names the missing field arguments: ${refused.reason}`);
});

// Gap 5 (Harness): when a person adopts a reviewed action whose argument values are not one action in
// the exact reader-backed fix plan, Operator creation is refused naming the offending argument=value
// pairs (not just "not one action in the plan"). The reviewer result is injected directly as an
// observed candidate; the refusal fires before any interactive binding is resolved.
test('an adopted reviewed action whose argument value is not in the plan is refused naming the value', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h, flow } = local;
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined; let cleanupRunId: string | undefined;
  t.after(async () => { if (host && cleanupRunId) await host.ctx.hima.cancelRun(cleanupRunId); await host?.dispose(); await h.dispose(); });
  const packsDir = path.join(h.home, 'hima/packs');
  const packId = 'team-plan-refusal';
  await writePackVariant(packsDir, packId, [], [], timingProbePackId);
  const contractFile = path.join(packsDir, packId, 'contract.yml');
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  const wrapper = await realpath('/usr/bin/tclsh');
  contract.environment.wrappers = [wrapper];
  contract.workspace.copy.push('interactive-repl.tcl');
  const tool = contract.tools.find((candidate: { id: string }) => candidate.id === 'synth');
  tool.licences = {};
  tool.argv = [wrapper, '${WORKSPACE}/flow/interactive-repl.tcl'];
  tool.interactive = { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', argv: tool.argv, commands: {
    read: ['get_value'], mutate: ['set_value'], save: ['save_state', 'close_session'],
  }, arguments: {
    get_value: [{ name: 'key', type: 'string' }],
    set_value: [{ name: 'key', type: 'string' }, { name: 'value', type: 'number' }, { name: 'planSha256', type: 'string' }],
    save_state: [{ name: 'file', type: 'string' }], close_session: [],
  } };
  contract.agentTeams = [
    { id: 'required-team', version: '1', triggerNode: 'synthesize', members: [
      member('reviewer', 'reviewer', { ownerAdoption: 'required', budgetShare: { maxElapsedMs: 8_000, maxFollowups: 0 },
        resultSchema: { id: 'fixture-review/1', required: ['schema', 'planSha256', 'command', 'arguments'] } }),
      member('operator', 'operator', { inputs: ['qorReport'], allowedTools: ['hima_interactive'],
        scopePolicy: 'site-qualified-interactive-only', dependencyRoles: ['reviewer'], ownerAdoption: 'required',
        reviewedAction: { fromRole: 'reviewer', planInput: 'qorReport', actionListField: 'actions', command: 'set_value',
          hostPlanHashArgument: 'planSha256', planHashField: 'planSha256', commandField: 'command', argumentsField: 'arguments' } }),
    ] },
  ];
  await writeFile(contractFile, stringify(contract));
  const sourceTemplate = path.join(packsDir, packId, 'interactive-repl.tcl');
  await copyFile(path.join(repoRoot, 'test/fixtures/interactive-job/repl.tcl'), sourceTemplate);
  await copyFile(sourceTemplate, path.join(flow.root, 'interactive-repl.tcl'));
  const site = await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow.root, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper], bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace }, licences: {}, parallelJobs: 1 });
  const scenario = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n`);

  host = await bootInProcess(h);
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 }, ownerSessionId: actor, timeBoxMs: 120_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  const runId = started.run.id; cleanupRunId = runId;
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  // The reader-backed fix plan declares exactly one action: value 42.
  const planText = `${JSON.stringify({ actions: [{ key: 'answer', value: 42 }] })}\n`;
  const planBytes = Buffer.from(planText); const planSha256 = createHash('sha256').update(planBytes).digest('hex');
  const retained = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir }, runId, planBytes, planSha256); assert.ok(retained);
  await host.ctx.hima.ledger.appendObservation(runId, { path: `flow/results/${flow.design}/syn/report/qor.rpt`,
    contentSha256: planSha256, retainedPath: retained, bytes: planBytes.byteLength,
    reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
  const delegate = (body: Record<string, unknown>) => host.ctx.hima.delegate({ runId, actor,
    expectedEpoch: control().epoch, expectedRevision: control().revision, ...body } as never) as Promise<Record<string, any>>;
  const appendCandidate = async (delegationId: string, text: string, requestId: string) => {
    const row = runDelegations((host!.ctx.hima as any).deps(), runId).find((item: any) => item.delegationId === delegationId)!;
    const outputIdentity = createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex');
    return host!.ctx.hima.ledger.appendDelegation(runId, { delegationId, parentSessionId: row.parentSessionId,
      childSessionId: row.childSessionId, requestId, requestDigest: createHash('sha256').update(requestId).digest('hex'),
      event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
        outputIdentity, contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
        output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
        unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: [] },
      } } });
  };
  const begun = await host.ctx.hima.executionAction({ runId, actor, action: 'begin', nodeId: 'synthesize',
    requestId: 'begin-plan', expectedEpoch: control().epoch, expectedRevision: control().revision });
  assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
  const executionId = begun.receipt!.executionId!;
  const create = (memberId: string, requestId: string) => delegate({ action: 'create', requestId,
    recipe: { teamId: 'required-team', version: '1', memberId, executionId } });
  const reviewer = await create('reviewer', 'plan-reviewer'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
  const reviewerId = reviewer.effectiveContract.delegationId as string;
  // The reviewer's adopted action mutates value 99 — no action in the plan.
  await appendCandidate(reviewerId, JSON.stringify({ schema: 'fixture-review/1', planSha256, command: 'set_value', arguments: { key: 'answer', value: 99 } }), 'plan-review-result');
  const reviewRecord = host.ctx.hima.ledger.records({ runId, type: 'delegation' })
    .findLast((record) => record.type === 'delegation' && record.delegationId === reviewerId && record.event === 'result-observed');
  assert.ok(reviewRecord);
  const adopted = await delegate({ action: 'adopt', delegationId: reviewerId, resultRecordId: reviewRecord!.id, requestId: 'plan-adopt-review' });
  assert.equal(adopted.status, 'accepted', JSON.stringify(adopted));
  const operator = await create('operator', 'plan-operator');
  assert.equal(operator.status, 'refused', JSON.stringify(operator));
  assert.match(operator.reason, /not one action in the exact reader-backed fix plan/);
  assert.ok(operator.reason.includes('value=99'), `the refusal names the offending value: ${operator.reason}`);
});
