import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest, loadPack, packDigestExcludes, retainRunMaterial, runDelegations } from '@hima/harness';
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
    member('reviewer', 'reviewer', { ownerAdoption: 'required',
      resultSchema: { id: 'fixture-scope-review/1', required: ['schema', 'planSha256', 'scope'] } }),
    member('operator', 'operator', { allowedTools: ['hima_interactive'], scopePolicy: 'site-qualified-interactive-only',
      dependencyRoles: ['reviewer'], ownerAdoption: 'required', reviewedAction }),
  ] }];

  // The Pack declaration itself is held to the tool: each scope command is a mutation carrying the hash, within 1..200.
  for (const [label, bad, pattern] of [
    ['a read command', { ...scopeRecipe, commands: ['size_cell', 'get_value'] }, /not a mutation/],
    ['a mutation without the hash argument', { ...scopeRecipe, hostPlanHashArgument: 'master' }, /hostPlanHashArgument/],
    ['a cap above 200', { ...scopeRecipe, maxMutations: 201 }, /./],
    ['a cap of zero', { ...scopeRecipe, maxMutations: 0 }, /./],
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
  const scenario = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`);

  host = await bootInProcess(h);
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 },
    ownerSessionId: actor, timeBoxMs: 120_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  const runId = started.run.id; cleanupRunId = runId;
  const control = () => host!.ctx.hima.ledger.run(runId)!.control!;
  const plan = Buffer.from(`${JSON.stringify({ problem: 'synthetic setup path', editDomain: ['U1', 'n1'] })}\n`);
  const planSha256 = createHash('sha256').update(plan).digest('hex');
  const retained = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir }, runId, plan, planSha256); assert.ok(retained);
  await host.ctx.hima.ledger.appendObservation(runId, { path: `flow/results/${flow.design}/syn/report/qor.rpt`,
    contentSha256: planSha256, retainedPath: retained, bytes: plan.byteLength,
    reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
  const begun = await host.ctx.hima.executionAction({ runId, actor, action: 'begin', nodeId: 'synthesize',
    requestId: 'begin', expectedEpoch: control().epoch, expectedRevision: control().revision });
  assert.equal(begun.kind, 'accepted', JSON.stringify(begun)); const executionId = begun.receipt!.executionId!;
  const delegate = (body: Record<string, unknown>) => host!.ctx.hima.delegate({ runId, actor,
    expectedEpoch: control().epoch, expectedRevision: control().revision, ...body } as never) as Promise<Record<string, any>>;
  const create = (memberId: string, requestId: string) =>
    delegate({ action: 'create', requestId, recipe: { teamId: 'scope-team', version: '1', memberId, executionId } });
  // Deterministic stand-in for the Reviewer's model turn, in the production Ledger handoff shape.
  const reviewAndAdopt = async (delegationId: string, value: unknown, requestId: string) => {
    const row = runDelegations((host!.ctx.hima as any).deps(), runId).find((item) => item.delegationId === delegationId)!;
    const text = JSON.stringify(value);
    const record = await host!.ctx.hima.ledger.appendDelegation(runId, { delegationId, parentSessionId: actor,
      childSessionId: row.childSessionId, requestId, requestDigest: createHash('sha256').update(requestId).digest('hex'),
      event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
        outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
        contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
        output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
        unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['synthetic review'] } } } });
    const adopted = await delegate({ action: 'adopt', delegationId, resultRecordId: record.id, requestId: `adopt-${requestId}` });
    assert.equal(adopted.status, 'accepted', JSON.stringify(adopted));
  };

  const reviewer = await create('reviewer', 'reviewer'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
  assert.deepEqual(reviewer.effectiveContract.recipe.reviewOutput,
    { scopeField: 'scope', commands: ['size_cell', 'insert_buffer'], maxMutations: 5 },
    'the Reviewer learns the recipe commands and cap it may approve');
  const reviewerId = reviewer.effectiveContract.delegationId as string;
  const review = (scope: unknown, hashValue = planSha256) => ({ schema: 'fixture-scope-review/1', planSha256: hashValue, scope });
  // A Reviewer maxMutations above the Pack recipe cap is not adopted into an Operator.
  await reviewAndAdopt(reviewerId, review({ commands: ['size_cell', 'insert_buffer'], maxMutations: 6 }), 'review-over-cap');
  const overCap = await create('operator', 'operator-over-cap');
  assert.equal(overCap.status, 'refused', JSON.stringify(overCap)); assert.match(overCap.reason, /maxMutations/);
  // A scope naming a mutation outside the Pack recipe is not adopted either.
  await reviewAndAdopt(reviewerId, review({ commands: ['size_cell', 'set_value'], maxMutations: 3 }), 'review-outside-recipe');
  const outsideRecipe = await create('operator', 'operator-outside-recipe');
  assert.equal(outsideRecipe.status, 'refused', JSON.stringify(outsideRecipe)); assert.match(outsideRecipe.reason, /set_value/);
  assert.equal(runDelegations((host.ctx.hima as any).deps(), runId).filter((row) => row.effective.role === 'operator').length, 0,
    'a refused scope creates no Operator child');

  await reviewAndAdopt(reviewerId, review({ commands: ['size_cell', 'insert_buffer'], maxMutations: 3 }), 'review');
  const operator = await create('operator', 'operator'); assert.equal(operator.status, 'created', JSON.stringify(operator));
  const payload = operator.effectiveContract.recipe.inlinePayload;
  assert.deepEqual(payload.scope, { commands: ['size_cell', 'insert_buffer'], maxMutations: 3 });
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
  await accepted('read-before', 'get_value', { key: 'U1' });
  await accepted('m1', 'size_cell', { instance: 'U1', master: 'BUF4', planSha256 });
  await accepted('m2', 'insert_buffer', { net: 'n1', cell: 'BUF2', planSha256 });
  await accepted('m3', 'size_cell', { instance: 'U1', master: 'BUF2', planSha256 });
  const retry = await input('m3', 'size_cell', { instance: 'U1', master: 'BUF2', planSha256 });
  assert.equal(retry.status, 'duplicate', 'retrying an accepted mutation is its receipt, not a fourth mutation');
  const fourth = await input('m4', 'insert_buffer', { net: 'n1', cell: 'BUF4', planSha256 });
  assert.equal(fourth.status, 'refused', JSON.stringify(fourth)); assert.match(fourth.reason, /at most 3 mutations/);
  const read = await accepted('read-after', 'get_value', { key: 'U1' });
  assert.match(JSON.stringify(read), /VALUE U1=BUF2/, 'read commands stay available after the mutation budget is spent');
  await accepted('save', 'save_state', { file: path.join(h.workspace, 'scope-state.txt') });
});
