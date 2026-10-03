// @hima-seam llm-replay direct
import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest, loadPack, packDigestExcludes, retainRunMaterial, runDelegations } from '@hima/harness';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { appendReplaySession, writeMomentScenario } from './support/moments.ts';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';

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

  // A hybrid node's Team is stranded the same way: a Pack that runs the Team's Operator on its
  // interactive path (ATCS #64 Task 5: the batch path is a no-op for parked slots) cannot finish
  // that execution once a required member ended without a result, whatever the tool's mode.
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
  const hybridSettled = hybridControl().executions[hybridExecutionId]!;
  assert.equal(hybridSettled.phase, 'failed', 'a hybrid-tool Team execution whose required member ended settles failed');
  assert.ok(hybridSettled.reason?.includes(hybridReviewer.effectiveContract.delegationId), hybridSettled.reason);

  // Boundary: a batch execution whose Team lost no required member (a parked slot's no-op) is
  // untouched and launches its own batch Job.
  const batchBegin = await host.ctx.hima.executionAction({ runId: hybridRunId, actor, action: 'begin', nodeId: 'synthesize',
    requestId: 'hybrid-batch-begin', expectedEpoch: hybridControl().epoch, expectedRevision: hybridControl().revision });
  assert.equal(batchBegin.kind, 'accepted', JSON.stringify(batchBegin));
  const batchId = batchBegin.receipt!.executionId!;
  const scoutOnBatch = await hybridDelegate({ action: 'create', requestId: 'hybrid-scout',
    recipe: { teamId: 'advisory-team', version: '1', memberId: 'scout', executionId: batchId } });
  assert.equal(scoutOnBatch.status, 'created', JSON.stringify(scoutOnBatch));
  const scoutOnBatchCancel = await hybridDelegate({ action: 'cancel', delegationId: scoutOnBatch.effectiveContract.delegationId, requestId: 'hybrid-scout-cancel' });
  assert.equal(scoutOnBatchCancel.status, 'accepted', JSON.stringify(scoutOnBatchCancel));
  assert.equal(hybridControl().executions[batchId]!.phase, 'begun', 'no required Team member was lost, so nothing settles it');
  const worked = await host.ctx.hima.executionAction({ runId: hybridRunId, actor, action: 'work', executionId: batchId,
    requestId: 'hybrid-batch-work', expectedEpoch: hybridControl().epoch, expectedRevision: hybridControl().revision });
  assert.equal(worked.kind, 'accepted', JSON.stringify(worked));
  // The fixture REPL waits on stdin, so its batch Job runs on; that it launched is the boundary.
  assert.equal(hybridControl().executions[batchId]!.phase, 'working', JSON.stringify(hybridControl().executions[batchId]));
});

test('a Team Reviewer may approve an Operator scope: typed mutations within its commands, plan hash and budget', async (t) => {
  const priorBinding = process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'scope-tcl-fixture';
  t.after(() => { if (priorBinding === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = priorBinding; });
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h, flow } = local;
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined; let cleanupRunId: string | undefined;
  t.after(async () => { if (host && cleanupRunId) await host.ctx.hima.cancelRun(cleanupRunId); await host?.dispose(); await h.dispose(); });
  const packsDir = path.join(h.home, 'hima/packs');
  const packId = 'team-scope';
  await writePackVariant(packsDir, packId, [], [], timingProbePackId);
  const contractFile = path.join(packsDir, packId, 'contract.yml');
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  const wrapper = await realpath('/usr/bin/tclsh');
  contract.environment.wrappers = [wrapper];
  contract.workspace.copy.push('interactive-repl.tcl');
  const tool = contract.tools.find((candidate: { id: string }) => candidate.id === 'synth');
  tool.licences = {};
  tool.argv = [wrapper, '${WORKSPACE}/flow/interactive-repl.tcl'];
  const hash = { name: 'planSha256', type: 'string' };
  tool.interactive = { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', argv: tool.argv, commands: {
    read: ['get_value'], mutate: ['size_cell', 'insert_buffer', 'set_value'], save: ['save_state', 'close_session'],
  }, arguments: {
    get_value: [{ name: 'key', type: 'string' }],
    size_cell: [{ name: 'instance', type: 'string' }, { name: 'master', type: 'string' }, hash],
    insert_buffer: [{ name: 'net', type: 'string' }, { name: 'cell', type: 'string' }, hash],
    set_value: [{ name: 'key', type: 'string' }, { name: 'value', type: 'number' }, hash],
    save_state: [{ name: 'file', type: 'string' }], close_session: [],
  } };
  // The recipe allows two commands with a cap of five; set_value is a mutation of the tool but outside the recipe.
  const scopeRecipe = { mode: 'scope', fromRole: 'reviewer', planInput: 'qorReport', hostPlanHashArgument: 'planSha256',
    planHashField: 'planSha256', scopeField: 'scope', commands: ['size_cell', 'insert_buffer'], maxMutations: 5 };
  const team = (reviewedAction: Record<string, unknown>) => [{ id: 'scope-team', version: '1', triggerNode: 'synthesize', members: [
    member('reviewer', 'reviewer', { ownerAdoption: 'required', followup: 'reuse-same-child',
      budgetShare: { maxElapsedMs: 30_000, maxFollowups: 1 },
      resultSchema: { id: 'fixture-scope-review/1', required: ['schema', 'planSha256', 'scope'] } }),
    member('operator', 'operator', { allowedTools: ['hima_interactive'], scopePolicy: 'site-qualified-interactive-only',
      dependencyRoles: ['reviewer'], ownerAdoption: 'required', reviewedAction }),
  ] }];

  // The Pack declaration itself is held to the tool: each scope command is a mutation carrying the hash, within 1..600 (#66 H1).
  for (const [label, bad, pattern] of [
    ['a read command', { ...scopeRecipe, commands: ['size_cell', 'get_value'] }, /not a mutation/],
    ['a mutation without the hash argument', { ...scopeRecipe, hostPlanHashArgument: 'master' }, /hostPlanHashArgument/],
    ['a cap above 600', { ...scopeRecipe, maxMutations: 601 }, /maxMutations[\s\S]*(<=600|too big)/i],
    ['a cap of zero', { ...scopeRecipe, maxMutations: 0 }, /maxMutations[\s\S]*(>=1|too small)/i],
    ['a scope field the Reviewer schema does not require', { ...scopeRecipe, scopeField: 'portfolio' }, /portfolio/],
  ] as const) {
    await writeFile(contractFile, stringify({ ...contract, agentTeams: team(bad) }));
    assert.throws(() => loadPack(packsDir, packId), pattern, `a scope recipe with ${label} does not load`);
  }
  contract.agentTeams = team(scopeRecipe);
  await writeFile(contractFile, stringify(contract));
  const sourceTemplate = path.join(packsDir, packId, 'interactive-repl.tcl');
  await copyFile(path.join(repoRoot, 'test/fixtures/interactive-job/scope-repl.tcl'), sourceTemplate);
  await copyFile(sourceTemplate, path.join(flow.root, 'interactive-repl.tcl'));
  const installed = loadPack(packsDir, packId);
  const packDigest = installed.folder.digest(packDigestExcludes);
  const declaredTool = installed.contract.tools.find((candidate) => candidate.id === 'synth')!;
  const site = await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow.root, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper], bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
    licences: {}, parallelJobs: 1 });
  const adminDir = path.join(h.home, 'admin'); await mkdir(adminDir);
  const environmentFile = path.join(adminDir, 'environment.json');
  const environmentText = JSON.stringify({
    schema: 'hima-interactive-environment/1', site: 'local', toolId: 'synth', pack: { id: packId, digest: packDigest },
    adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST }, commandsDigest: interactiveCommandsDigest(declaredTool),
    wrapper: { path: wrapper, sha256: createHash('sha256').update(await readFile(wrapper)).digest('hex') },
    image: { reference: 'local/scope-test', digest: `sha256:${'0'.repeat(64)}` },
    sourceTemplate: { path: 'interactive-repl.tcl', sha256: createHash('sha256').update(await readFile(sourceTemplate)).digest('hex') },
    confinement: { rootFilesystem: 'read-only', dataRoot: '/', dataMount: 'read-only', privateWriteRoot: await realpath(h.workspace),
      network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
    qualification: { status: 'passed', transcriptSha256: '1'.repeat(64), logicalEcoSha256: '2'.repeat(64),
      physicalEcoSha256: '3'.repeat(64), xtopReady: true, identityQuery: true, mutation: true, save: true,
      sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
  });
  await writeFile(environmentFile, environmentText);
  const bindingsFile = path.join(adminDir, 'bindings.json');
  await writeFile(bindingsFile, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [{
    id: 'scope-tcl-fixture', site: 'local', packDigest, toolId: 'synth', adapter: 'hima-tcl-line-v1',
    adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(declaredTool),
    environment: { id: 'scope-tcl-env', file: environmentFile, sha256: createHash('sha256').update(environmentText).digest('hex') },
    mutation: 'qualified' }] }));
  // The plan and the scripted model turns are fixed before boot: replay binds sessions by first-call order.
  const plan = Buffer.from(`${JSON.stringify({ problem: 'synthetic setup path', editDomain: ['U1', 'n1'] })}\n`);
  const planSha256 = createHash('sha256').update(plan).digest('hex');
  const review = (scope: unknown) => JSON.stringify({ schema: 'fixture-scope-review/1', planSha256, scope });
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  const replayDir = path.join(h.home, 'scope-replay'); await mkdir(replayDir, { recursive: true });
  const replayFile = path.join(replayDir, 'session.jsonl'); const replayOverride = path.join(replayDir, 'replay.override.json');
  await writeFile(replayFile, `${JSON.stringify({ version: 0, type: 'session', id: 'scope-reviewer-1', createdAt: 0, cwd: '{{cwd}}' })}\n`);
  // Attempt 1's Reviewer: its first scope is over the recipe cap, its one follow-up names a mutation outside the recipe.
  await writeFile(replayOverride, `${JSON.stringify([say(review({ commands: ['size_cell', 'insert_buffer'], maxMutations: 6 })),
    say(review({ commands: ['size_cell', 'set_value'], maxMutations: 3 }))])}\n`);
  // The owner's first model call comes when DSH tells it that Reviewer 1 finished, so it binds the first child script.
  let scenario = await appendReplaySession({ file: replayFile, override: replayOverride, readyFile: path.join(replayDir, 'unused'), children: [] },
    'scope-owner', Array.from({ length: 8 }, () => say('I acknowledge the retained facts. I will not start another task.')));
  scenario = await appendReplaySession(scenario, 'scope-reviewer-2', [say(review({ commands: ['size_cell', 'insert_buffer'], maxMutations: 4 }))]);
  scenario = await appendReplaySession(scenario, 'scope-operator', [say(JSON.stringify({ schema: 'fixture-operator/1' }))]);
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), QUIET_TITLE_ROW);
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`);

  host = await bootInProcess(h);
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 },
    ownerSessionId: actor, timeBoxMs: 120_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  const runId = started.run.id; cleanupRunId = runId;
  const control = () => host!.ctx.hima.ledger.run(runId)!.control!;
  const retained = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir }, runId, plan, planSha256); assert.ok(retained);
  await host.ctx.hima.ledger.appendObservation(runId, { path: `flow/results/${flow.design}/syn/report/qor.rpt`,
    contentSha256: planSha256, retainedPath: retained, bytes: plan.byteLength,
    reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
  const begin = async (requestId: string) => {
    const begun = await host!.ctx.hima.executionAction({ runId, actor, action: 'begin', nodeId: 'synthesize',
      requestId, expectedEpoch: control().epoch, expectedRevision: control().revision });
    assert.equal(begun.kind, 'accepted', JSON.stringify(begun)); return begun.receipt!.executionId!;
  };
  const delegate = (body: Record<string, unknown>) => host!.ctx.hima.delegate({ runId, actor,
    expectedEpoch: control().epoch, expectedRevision: control().revision, ...body } as never) as Promise<Record<string, any>>;
  const create = (memberId: string, executionId: string, requestId: string) =>
    delegate({ action: 'create', requestId, recipe: { teamId: 'scope-team', version: '1', memberId, executionId } });
  let reads = 0;
  const readResult = async (delegationId: string) => {
    let value: Record<string, any> = {};
    await waitUntil('the Reviewer child returned a completed turn', async () => {
      value = await delegate({ action: 'result', delegationId, requestId: `result-${reads++}` });
      return value.status !== 'unavailable';
    }, 20_000, 100);
    return value;
  };

  // Attempt 1: an invalid scope is refused at the Reviewer result, before anything can be adopted.
  const firstId = await begin('begin-1');
  const reviewer = await create('reviewer', firstId, 'reviewer-1'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
  assert.deepEqual(reviewer.effectiveContract.recipe.reviewOutput,
    { mode: 'scope', scopeField: 'scope', commands: ['size_cell', 'insert_buffer'], maxMutations: 5 },
    'the Reviewer learns the recipe commands and cap it may approve');
  const reviewerId = reviewer.effectiveContract.delegationId as string;
  const overCap = await readResult(reviewerId);
  assert.equal(overCap.status, 'refused', JSON.stringify(overCap));
  assert.match(overCap.reason, /maxMutations must be an integer from 1 to the Pack recipe cap 5/);
  assert.match(overCap.reason, /1 follow-up\(s\) to the same child remain/);
  const followed = await delegate({ action: 'followup', delegationId: reviewerId, requestId: 'reviewer-1-repair',
    text: 'Your scope was refused; return the corrected JSON object only.' });
  assert.equal(followed.status, 'accepted', JSON.stringify(followed));
  const outsideRecipe = await readResult(reviewerId);
  assert.equal(outsideRecipe.status, 'refused', JSON.stringify(outsideRecipe));
  assert.match(outsideRecipe.reason, /outside the Pack recipe scope \(size_cell, insert_buffer\): set_value/);
  assert.match(outsideRecipe.reason, /No follow-up remains/);
  assert.equal(host.ctx.hima.ledger.records({ runId, type: 'delegation' }).some((record) => record.type === 'delegation'
    && record.delegationId === reviewerId && ['result-observed', 'result-adopted'].includes(record.event)), false,
    'a refused scope is never observed, so it cannot be adopted');
  // Follow-ups exhausted: cancelling the Reviewer settles the attempt instead of stranding it at begun.
  const cancelled = await delegate({ action: 'cancel', delegationId: reviewerId, requestId: 'reviewer-1-cancel' });
  assert.equal(cancelled.status, 'accepted', JSON.stringify(cancelled));
  assert.equal(control().executions[firstId]!.phase, 'failed', 'the execution settles failed');
  assert.ok(control().executions[firstId]!.reason?.includes(reviewerId), control().executions[firstId]!.reason);

  // Attempt 2: a valid scope is observed and adopted into the Operator.
  const executionId = await begin('begin-2');
  const reviewer2 = await create('reviewer', executionId, 'reviewer-2'); assert.equal(reviewer2.status, 'created', JSON.stringify(reviewer2));
  const reviewer2Id = reviewer2.effectiveContract.delegationId as string;
  const observed = await readResult(reviewer2Id);
  assert.equal(observed.status, 'candidate', JSON.stringify(observed));
  const reviewRecord = host.ctx.hima.ledger.records({ runId, type: 'delegation' }).findLast((record) => record.type === 'delegation'
    && record.delegationId === reviewer2Id && record.event === 'result-observed')!;
  assert.ok(reviewRecord);
  const adopt = async (resultRecordId: string, requestId: string) => {
    const adopted = await delegate({ action: 'adopt', delegationId: reviewer2Id, resultRecordId, requestId });
    assert.equal(adopted.status, 'accepted', JSON.stringify(adopted));
  };
  // Second guard: a Ledger result that bypassed the result gate (for example written by an older Host)
  // is still refused when the Operator is created from it.
  const reviewRow = runDelegations((host.ctx.hima as any).deps(), runId).find((row) => row.delegationId === reviewer2Id)!;
  const forgedText = review({ commands: ['size_cell'], maxMutations: 9 });
  const forged = await host.ctx.hima.ledger.appendDelegation(runId, { delegationId: reviewer2Id, parentSessionId: actor,
    childSessionId: reviewRow.childSessionId, requestId: 'forged-over-cap', requestDigest: 'e'.repeat(64),
    event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
      outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text: forgedText }])).digest('hex'),
      contract: { recordId: reviewRow.contractRecordId, requestDigest: reviewRow.requestDigest },
      output: { text: forgedText, content: [{ type: 'text', text: forgedText }], truncated: false }, completedTurn: { turn: 9, endSeq: 9 },
      unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: [] } } } });
  await adopt(forged.id, 'adopt-forged');
  const guarded = await create('operator', executionId, 'operator-forged');
  assert.equal(guarded.status, 'refused', JSON.stringify(guarded)); assert.match(guarded.reason, /Pack recipe cap 5/);
  assert.equal(runDelegations((host.ctx.hima as any).deps(), runId).filter((row) => row.effective.role === 'operator').length, 0,
    'a refused scope creates no Operator child');
  await host.ctx.hima.ledger.appendDelegation(runId, { delegationId: reviewer2Id, parentSessionId: actor,
    childSessionId: reviewRow.childSessionId, requestId: 're-observe-review', requestDigest: 'f'.repeat(64),
    event: 'result-observed', payload: (reviewRecord as { payload: unknown }).payload as never });
  const reobserved = host.ctx.hima.ledger.records({ runId, type: 'delegation' }).findLast((record) => record.type === 'delegation'
    && record.delegationId === reviewer2Id && record.event === 'result-observed')!;
  await adopt(reobserved.id, 'adopt-review');

  const operator = await create('operator', executionId, 'operator'); assert.equal(operator.status, 'created', JSON.stringify(operator));
  const payload = operator.effectiveContract.recipe.inlinePayload;
  assert.equal(payload.mode, 'scope');
  assert.deepEqual(payload.scope, { commands: ['size_cell', 'insert_buffer'], maxMutations: 4 });
  assert.equal(payload.planSha256, planSha256);
  assert.equal(payload.command, undefined, 'a scope is not one pinned action');
  const operatorId = operator.receipt.childSessionId as string;
  const interactive = (body: Record<string, unknown>) => host!.ctx.hima.interactive(operatorId, { runId, executionId,
    nodeId: 'synthesize', ownerEpoch: control().epoch, controlRevision: control().revision, ...body }) as Promise<Record<string, any>>;
  const opened = await interactive({ action: 'open', requestId: 'open' }); assert.equal(opened.status, 'opened', JSON.stringify(opened));
  const toolSessionId = opened.session.toolSessionId as string;
  await waitUntil('the scope REPL is ready', async () => (await host!.ctx.hima.interactiveSessions(actor, runId) as any)
    .sessions.some((session: any) => session.toolSessionId === toolSessionId && session.status === 'ready'), 10_000, 25);
  const input = (id: string, name: string, args: Record<string, unknown>) =>
    interactive({ action: 'input', requestId: id, commandId: id, toolSessionId, command: { name, args }, waitMs: 1_000 });
  const accepted = async (id: string, name: string, args: Record<string, unknown>) => {
    const value = await input(id, name, args); assert.equal(value.status, 'completed', JSON.stringify(value)); return value;
  };

  const wrongHash = await input('wrong-hash', 'size_cell', { instance: 'U1', master: 'BUF4', planSha256: 'f'.repeat(64) });
  assert.equal(wrongHash.status, 'refused', JSON.stringify(wrongHash)); assert.match(wrongHash.reason, /plan SHA-256/);
  const outside = await input('outside', 'set_value', { key: 'k', value: 1, planSha256 });
  assert.equal(outside.status, 'refused', JSON.stringify(outside)); assert.match(outside.reason, /scope/);
  const readBefore = await accepted('read-before', 'get_value', { key: 'U1' });
  // The budget caps the approval, not one tool session. No product path opens a second session in one
  // execution today (open needs a fresh begun execution), so one scope mutation an earlier session of this
  // approved execution admitted is written as the Ledger would hold it.
  const readIntent = host.ctx.hima.ledger.records({ runId, type: 'interactive' }).find((record) => record.type === 'interactive'
    && record.requestId === 'read-before' && (record.payload as { event?: string }).event === 'input-intent')!;
  assert.ok(readIntent, JSON.stringify(readBefore));
  await host.ctx.hima.ledger.appendInteractive(runId, { executionId, toolSessionId: 'earlier-session', requestId: 'earlier-m0',
    event: 'input-intent', payload: { ...(readIntent as { payload: object }).payload, toolSessionId: 'earlier-session',
      requestId: 'earlier-m0', commandId: 'earlier-m0', effect: 'mutation', scopeMutation: true } as never });
  await accepted('m1', 'size_cell', { instance: 'U1', master: 'BUF4', planSha256 });
  await accepted('m2', 'insert_buffer', { net: 'n1', cell: 'BUF2', planSha256 });
  await accepted('m3', 'size_cell', { instance: 'U1', master: 'BUF2', planSha256 });
  const retry = await input('m3', 'size_cell', { instance: 'U1', master: 'BUF2', planSha256 });
  assert.equal(retry.status, 'duplicate', 'retrying an accepted mutation is its receipt, not a fourth mutation');
  // The budget is counted from the Ledger, so a Host restart does not refill it.
  await host.dispose(); host = await bootInProcess(h); await host.ctx.hima.reconciled; await resumeTestAgent(host.ctx, actor);
  // The Run's retained Pack classifies the command, not a later edit of the installed Pack.
  const installedText = await readFile(contractFile, 'utf8');
  const edited = parse(installedText) as Record<string, any>;
  const editedTool = edited.tools.find((candidate: { id: string }) => candidate.id === 'synth');
  editedTool.interactive.commands = { ...editedTool.interactive.commands, read: ['get_value', 'insert_buffer', 'set_value'], mutate: ['size_cell'] };
  edited.agentTeams[0].members[1].reviewedAction.commands = ['size_cell']; // the edited installed Pack still loads
  await writeFile(contractFile, stringify(edited));
  const outsideAfterEdit = await input('outside-after-edit', 'set_value', { key: 'k', value: 2, planSha256 });
  assert.equal(outsideAfterEdit.status, 'refused', JSON.stringify(outsideAfterEdit)); assert.match(outsideAfterEdit.reason, /outside the immutable owner-adopted reviewed scope/);
  const fourth = await input('m4', 'insert_buffer', { net: 'n1', cell: 'BUF4', planSha256 });
  assert.equal(fourth.status, 'refused', JSON.stringify(fourth)); assert.match(fourth.reason, /at most 4 mutations in this approved execution; 4 were already admitted/);
  await writeFile(contractFile, installedText);
  const read = await accepted('read-after', 'get_value', { key: 'U1' });
  assert.match(JSON.stringify(read), /VALUE U1=BUF2/, 'read commands stay available after the mutation budget is spent');
  await accepted('save', 'save_state', { file: path.join(h.workspace, 'scope-state.txt') });
  // Closing the session does not open a new budget: the product refuses a second open in this execution.
  const closed = await interactive({ action: 'close', requestId: 'close-1', toolSessionId });
  assert.equal(closed.status, 'closed', JSON.stringify(closed));
  // The stopped Job settles its execution through the asynchronous Job observer; wait for that fact
  // rather than racing it, so the refusal below is always the settled one.
  await waitUntil('the closed interactive Job settles its execution', () =>
    ['ready', 'failed', 'completed'].includes(control().executions[executionId]!.phase), 10_000, 25);
  const reopened = await interactive({ action: 'open', requestId: 'open-2' });
  assert.equal(reopened.status, 'refused', JSON.stringify(reopened));
  // #64 D-T03-1: the session this Operator closed settles its execution ready (the close is its end,
  // never a failed attempt), and a ready execution admits no second open either.
  assert.match(reopened.reason, /the interactive execution is absent, settled, failed or superseded|requires the freshly begun execution/);
  assert.equal(control().executions[executionId]!.phase, 'ready', 'the requested close settled the execution ready');
});

// Gap 4 (Harness): a Team member result refused for its schema names the schema and the exact
// missing required fields, so the owner can relay what must change instead of guessing. The child
// replays one JSON object that carries `schema` but omits `planSha256` and `arguments`.
for (const [label, resultText] of [
  ['missing required fields', '{"schema":"fixture-review/1","command":"set_value"}'],
  ['a JSON number', '1'], ['a JSON boolean', 'true'], ['a JSON string', '"x"'],
  ['JSON null', 'null'], ['a JSON array', '[]'],
] as const) {
  test(`an Agent Team result with ${label} is refused naming the schema and the missing fields`, async (t) => {
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
  // The child returns this parseable JSON through its actual replayed model turn.
  const scenario = await writeMomentScenario(h, 'bad-schema', path.join(repoRoot, 'test/fixtures/delegation'));
  const entries = JSON.parse(await readFile(scenario.override, 'utf8'));
  const resultBlock = entries[0].chunks.find((chunk: any) => chunk.type === 'block-end' && chunk.block?.type === 'text');
  assert.ok(resultBlock, 'the replay fixture contains its model text result');
  resultBlock.block.text = resultText;
  await writeFile(scenario.override, JSON.stringify(entries));
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
}

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
