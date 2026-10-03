import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import {
  BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest, loadPack, packDigestExcludes,
  retainRunMaterial, runDelegations,
  type ExecutionActionResult, type JobRecord,
} from '@hima/harness';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeMomentScenario } from './support/moments.ts';
import { timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('real Host owns one qualified interactive Job from begin through typed Tcl save and exit', async (t) => {
  const priorTestBinding = process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'local-tcl-fixture';
  t.after(() => { if (priorTestBinding === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = priorTestBinding; });
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h, flow } = local; t.after(() => h.dispose());
  const packId = 'interactive-tcl-host';
  await writePackVariant(path.join(h.home, 'hima/packs'), packId, [], [], timingProbePackId);
  const contractFile = path.join(h.home, 'hima/packs', packId, 'contract.yml');
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  const wrapper = await realpath('/usr/bin/tclsh');
  contract.environment.wrappers = [wrapper];
  contract.workspace.copy.push('interactive-repl.tcl');
  const tool = contract.tools.find((candidate: { id: string }) => candidate.id === 'synth');
  tool.licences = {};
  tool.argv = [wrapper, '${WORKSPACE}/flow/interactive-repl.tcl'];
  tool.interactive = { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', argv: [wrapper, '${WORKSPACE}/flow/interactive-repl.tcl'], commands: {
    read: ['get_value'], mutate: ['set_value', 'fail_command', 'slow_fail'], save: ['save_state', 'close_session'],
  }, arguments: {
    get_value: [{ name: 'key', type: 'string' }],
    set_value: [{ name: 'key', type: 'string' }, { name: 'value', type: 'number' }],
    fail_command: [], slow_fail: [], save_state: [{ name: 'file', type: 'string' }], close_session: [],
  } };
  contract.agentTeams = [{ id: 'fixture-team', version: '1', triggerNode: 'synthesize', members: [{
    id: 'researcher', role: 'researcher', node: 'synthesize',
    taskTemplate: 'Read the exact declared QoR observation and return a bounded candidate.',
    inputs: ['qorReport'], allowedTools: ['hima_delegation_input'], scopePolicy: 'declared-inputs-only',
    budgetShare: { maxElapsedMs: 5_000, maxFollowups: 0, maxTokensPerTurn: 1_000 }, dependencyRoles: [],
    resultSchema: { id: 'fixture-research/1', required: ['schema', 'hypotheses'] }, recipient: 'run-owner',
    ownerAdoption: 'candidate-only', identity: 'one-child-per-role-per-execution', followup: 'forbidden',
    cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
    refusalConditions: ['missing-current-evidence'],
  }] }];
  await writeFile(contractFile, stringify(contract));
  const gatedPackId = 'interactive-tcl-team-required';
  await writePackVariant(path.join(h.home, 'hima/packs'), gatedPackId, [], [], packId);
  const gatedContractFile = path.join(h.home, 'hima/packs', gatedPackId, 'contract.yml');
  const gatedContract = parse(await readFile(gatedContractFile, 'utf8')) as Record<string, any>;
  gatedContract.tools.find((candidate: { id: string }) => candidate.id === 'synth').interactive.arguments.set_value
    .push({ name: 'planSha256', type: 'string' });
  gatedContract.agentTeams = [{ id: 'required-team', version: '1', triggerNode: 'synthesize', members: [
    { id: 'researcher', role: 'researcher', node: 'synthesize', taskTemplate: 'Return bounded hypotheses.',
      inputs: ['qorReport'], allowedTools: ['hima_delegation_input'], scopePolicy: 'declared-inputs-only',
      budgetShare: { maxElapsedMs: 10_000, maxFollowups: 0 }, dependencyRoles: [],
      resultSchema: { id: 'fixture-research/1', required: ['schema', 'hypotheses'] }, recipient: 'run-owner',
      ownerAdoption: 'required', identity: 'one-child-per-role-per-execution', followup: 'forbidden',
      cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
      refusalConditions: ['missing-evidence'] },
    { id: 'reviewer', role: 'reviewer', node: 'synthesize', taskTemplate: 'Return one reviewed action.',
      inputs: ['qorReport'], allowedTools: ['hima_delegation_input'], scopePolicy: 'declared-inputs-only',
      budgetShare: { maxElapsedMs: 10_000, maxFollowups: 0 }, dependencyRoles: ['researcher'],
      resultSchema: { id: 'fixture-review/1', required: ['schema', 'planSha256', 'command', 'arguments'] },
      recipient: 'run-owner', ownerAdoption: 'required', identity: 'one-child-per-role-per-execution', followup: 'forbidden',
      cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
      refusalConditions: ['missing-evidence'] },
    { id: 'operator', role: 'operator', node: 'synthesize', taskTemplate: 'Operate the exact adopted action.',
      inputs: ['qorReport'], allowedTools: ['hima_interactive'], scopePolicy: 'site-qualified-interactive-only',
      budgetShare: { maxElapsedMs: 10_000, maxFollowups: 0 }, dependencyRoles: ['reviewer'],
      resultSchema: { id: 'fixture-operator/1', required: ['schema'] }, recipient: 'run-owner', ownerAdoption: 'required',
      identity: 'one-child-per-role-per-execution', followup: 'forbidden', cancellation: 'request-stop-preserve-unknown',
      terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'], refusalConditions: ['reviewer-not-adopted'],
      reviewedAction: { fromRole: 'reviewer', planInput: 'qorReport', actionListField: 'actions', command: 'set_value',
        hostPlanHashArgument: 'planSha256', planHashField: 'planSha256', commandField: 'command', argumentsField: 'arguments' } },
  ] }];
  await writeFile(gatedContractFile, stringify(gatedContract));
  const sourceTemplate = path.join(h.home, 'hima/packs', packId, 'interactive-repl.tcl');
  await copyFile(path.join(repoRoot, 'test/fixtures/interactive-job/repl.tcl'), sourceTemplate);
  await copyFile(sourceTemplate, path.join(flow.root, 'interactive-repl.tcl'));
  const installedPack = loadPack(path.join(h.home, 'hima/packs'), packId);
  const packDigest = installedPack.folder.digest(packDigestExcludes);
  const declaredTool = installedPack.contract.tools.find((candidate) => candidate.id === 'synth')!;

  const site = await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow.root, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper], bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
    licences: {}, parallelJobs: 1 });
  const adminDir = path.join(h.home, 'admin'); await mkdir(adminDir);
  const environmentFile = path.join(adminDir, 'tcl-environment.json');
  const sourceBytes = await readFile(sourceTemplate);
  const wrapperBytes = await readFile(wrapper);
  const environmentBytes = `${JSON.stringify({
    schema: 'hima-interactive-environment/1', site: 'local', toolId: 'synth',
    pack: { id: packId, digest: packDigest },
    adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST },
    commandsDigest: interactiveCommandsDigest(declaredTool),
    wrapper: { path: wrapper, sha256: createHash('sha256').update(wrapperBytes).digest('hex') },
    image: { reference: 'local/interactive-test', digest: `sha256:${'0'.repeat(64)}` },
    sourceTemplate: { path: 'interactive-repl.tcl', sha256: createHash('sha256').update(sourceBytes).digest('hex') },
    confinement: { rootFilesystem: 'read-only', dataRoot: '/', dataMount: 'read-only',
      privateWriteRoot: h.workspace, network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
    qualification: { status: 'passed', transcriptSha256: '1'.repeat(64), logicalEcoSha256: '2'.repeat(64),
      physicalEcoSha256: '3'.repeat(64), xtopReady: true, identityQuery: true, mutation: true, save: true,
      sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
  }, null, 2)}\n`;
  await writeFile(environmentFile, environmentBytes);
  const environmentDigest = createHash('sha256').update(environmentBytes).digest('hex');
  const bindingsFile = path.join(adminDir, 'interactive-bindings.json');
  const binding = { id: 'local-tcl-fixture', site: 'local', packDigest, toolId: 'synth', adapter: 'hima-tcl-line-v1',
    adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(declaredTool),
    environment: { id: 'local-tcl-fixture-env', file: environmentFile, sha256: '0'.repeat(64) }, mutation: 'qualified' };
  const writeBindings = (environmentSha256: string) => writeFile(bindingsFile,
    `${JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [{ ...binding,
      environment: { ...binding.environment, sha256: environmentSha256 } }] }, null, 2)}\n`);
  await writeBindings('0'.repeat(64));
  const gatedPlanText = `${JSON.stringify({ actions: [{ key: 'answer', value: 42 }] })}\n`;
  const gatedPlanSha256 = createHash('sha256').update(gatedPlanText).digest('hex');
  const scenario = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(path.join(h.home, 'hima/packs'))}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`);

  const host = await bootInProcess(h); t.after(() => host.dispose());
  const owner = await createRootAgent(host.ctx, h.workspace);
  const gated = await host.ctx.hima.startRun({ pack: gatedPackId, site: site.name, goal: { target_period_ns: 2 },
    ownerSessionId: String(owner.id), timeBoxMs: 60_000 });
  assert.equal(gated.kind, 'ran'); if (gated.kind !== 'ran') return;
  let gatedControl = host.ctx.hima.ledger.run(gated.run.id)!.control!;
  const gatedBegin = await host.ctx.hima.executionAction({ runId: gated.run.id, actor: String(owner.id), action: 'begin',
    nodeId: gated.run.currentNode!, requestId: 'gated-begin', expectedEpoch: gatedControl.epoch, expectedRevision: gatedControl.revision });
  assert.equal(gatedBegin.kind, 'accepted');
  gatedControl = host.ctx.hima.ledger.run(gated.run.id)!.control!;
  const manualBypass = await host.ctx.hima.delegate({ runId: gated.run.id, actor: String(owner.id), action: 'create',
    requestId: 'gated-manual-operator', expectedEpoch: gatedControl.epoch, expectedRevision: gatedControl.revision,
    contract: { role: 'operator', nodeId: gated.run.currentNode, executionId: gatedBegin.receipt?.executionId },
    text: 'Skip the declared Reviewer.' } as never) as Record<string, any>;
  assert.equal(manualBypass.status, 'refused'); assert.match(manualBypass.reason, /declares an Operator Agent Team recipe/);
  assert.equal(host.ctx.hima.ledger.records({ runId: gated.run.id, type: 'delegation' }).length, 0);
  const gatedExecutionId = gatedBegin.receipt?.executionId; assert.ok(gatedExecutionId);
  const gatedPlanBytes = Buffer.from(gatedPlanText);
  const gatedRetained = await retainRunMaterial({ ledger: host.ctx.hima.ledger,
    packsDir: path.join(h.home, 'hima/packs') }, gated.run.id, gatedPlanBytes, gatedPlanSha256);
  assert.ok(gatedRetained);
  await host.ctx.hima.ledger.appendObservation(gated.run.id, { path: `flow/results/${flow.design}/syn/report/qor.rpt`,
    contentSha256: gatedPlanSha256, retainedPath: gatedRetained, bytes: gatedPlanBytes.byteLength,
    reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
  const recipeCreate = async (memberId: string, requestId: string) => {
    const current = host.ctx.hima.ledger.run(gated.run.id)!.control!;
    return host.ctx.hima.delegate({ runId: gated.run.id, actor: String(owner.id), action: 'create', requestId,
      expectedEpoch: current.epoch, expectedRevision: current.revision,
      recipe: { teamId: 'required-team', version: '1', memberId, executionId: gatedExecutionId } } as never) as Promise<Record<string, any>>;
  };
  const appendCandidate = async (delegationId: string, text: string, requestId: string) => {
    const row = runDelegations((host.ctx.hima as any).deps(), gated.run.id).find(item => item.delegationId === delegationId)!;
    const outputIdentity = createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex');
    return host.ctx.hima.ledger.appendDelegation(gated.run.id, { delegationId, parentSessionId: row.parentSessionId,
      childSessionId: row.childSessionId, requestId, requestDigest: createHash('sha256').update(requestId).digest('hex'),
      event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
        outputIdentity, contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
        output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
        unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: [] },
      } } });
  };
  const researcher = await recipeCreate('researcher', 'gated-researcher'); assert.equal(researcher.status, 'created', JSON.stringify(researcher));
  assert.deepEqual(researcher.effectiveContract.tools, ['hima_delegation_input']);
  assert.equal(researcher.effectiveContract.recipient.sessionId, String(owner.id));
  assert.equal(researcher.effectiveContract.budgetShare.maxElapsedMs, 10_000);
  const reviewerBeforeResearch = await recipeCreate('reviewer', 'gated-reviewer-too-early');
  assert.equal(reviewerBeforeResearch.status, 'refused'); assert.match(reviewerBeforeResearch.reason, /dependency researcher/);
  await appendCandidate(researcher.effectiveContract.delegationId,
    JSON.stringify({ schema: 'fixture-research/1', hypotheses: ['hold endpoint group'] }), 'gated-research-result');
  const researchRecord = host.ctx.hima.ledger.records({ runId: gated.run.id, type: 'delegation' })
    .findLast(record => record.type === 'delegation' && record.delegationId === researcher.effectiveContract.delegationId && record.event === 'result-observed');
  assert.ok(researchRecord);
  const reviewerBeforeAdoption = await recipeCreate('reviewer', 'gated-reviewer-before-research-adoption');
  assert.equal(reviewerBeforeAdoption.status, 'refused');
  gatedControl = host.ctx.hima.ledger.run(gated.run.id)!.control!;
  const adoptedResearch = await host.ctx.hima.delegate({ runId: gated.run.id, actor: String(owner.id), action: 'adopt',
    delegationId: researcher.effectiveContract.delegationId, resultRecordId: researchRecord.id,
    requestId: 'gated-adopt-research', expectedEpoch: gatedControl.epoch, expectedRevision: gatedControl.revision } as never) as Record<string, any>;
  assert.equal(adoptedResearch.status, 'accepted', JSON.stringify(adoptedResearch));
  const operatorTooEarly = await recipeCreate('operator', 'gated-operator-too-early');
  assert.equal(operatorTooEarly.status, 'refused'); assert.match(operatorTooEarly.reason, /dependency reviewer/);
  const reviewer = await recipeCreate('reviewer', 'gated-reviewer'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer));
  const retainedResearch = await host.ctx.hima.delegationInput(reviewer.receipt.childSessionId,
    { runId: gated.run.id, recordId: researchRecord.id }) as Record<string, any>;
  assert.equal(retainedResearch.kind, 'record-fact');
  assert.deepEqual(JSON.parse(retainedResearch.payload.text),
    { schema: 'fixture-research/1', hypotheses: ['hold endpoint group'] },
    'ATCS-02: an adopted Researcher result reaches the Reviewer intact without a Pack-output projection');
  assert.deepEqual(reviewer.effectiveContract.tools, ['hima_delegation_input']);
  assert.equal(reviewer.effectiveContract.recipient.sessionId, String(owner.id));
  await appendCandidate(reviewer.effectiveContract.delegationId,
    JSON.stringify({ schema: 'fixture-review/1', planSha256: gatedPlanSha256, command: 'set_value', arguments: { key: 'answer', value: 42 } }),
    'gated-review-result');
  const reviewRecord = host.ctx.hima.ledger.records({ runId: gated.run.id, type: 'delegation' })
    .findLast(record => record.type === 'delegation' && record.delegationId === reviewer.effectiveContract.delegationId && record.event === 'result-observed');
  assert.ok(reviewRecord);
  const unadoptedOperator = await recipeCreate('operator', 'gated-operator-unadopted');
  assert.equal(unadoptedOperator.status, 'refused'); assert.match(unadoptedOperator.reason, /requires explicit owner adoption/);
  gatedControl = host.ctx.hima.ledger.run(gated.run.id)!.control!;
  const missingExactResult = await host.ctx.hima.delegate({ runId: gated.run.id, actor: String(owner.id), action: 'adopt',
    delegationId: reviewer.effectiveContract.delegationId, requestId: 'gated-adopt-missing-result',
    expectedEpoch: gatedControl.epoch, expectedRevision: gatedControl.revision } as never) as Record<string, any>;
  assert.equal(missingExactResult.status, 'refused'); assert.match(missingExactResult.reason, /must name the exact observed result/);
  const wrongExactResult = await host.ctx.hima.delegate({ runId: gated.run.id, actor: String(owner.id), action: 'adopt',
    delegationId: reviewer.effectiveContract.delegationId, resultRecordId: 'wrong-result', requestId: 'gated-adopt-wrong-result',
    expectedEpoch: gatedControl.epoch, expectedRevision: gatedControl.revision } as never) as Record<string, any>;
  assert.equal(wrongExactResult.status, 'refused'); assert.match(wrongExactResult.reason, /not this delegation latest exact candidate/);
  gatedControl = host.ctx.hima.ledger.run(gated.run.id)!.control!;
  const adoptedReview = await host.ctx.hima.delegate({ runId: gated.run.id, actor: String(owner.id), action: 'adopt',
    delegationId: reviewer.effectiveContract.delegationId, resultRecordId: reviewRecord.id, requestId: 'gated-adopt-review',
    expectedEpoch: gatedControl.epoch, expectedRevision: gatedControl.revision } as never) as Record<string, any>;
  assert.equal(adoptedReview.status, 'accepted', JSON.stringify(adoptedReview));
  const operator = await recipeCreate('operator', 'gated-operator');
  assert.equal(operator.status, 'refused'); assert.match(operator.reason, /no interactive operation/,
    'after dependency and exact adoption gates, an unavailable binding still refuses before child creation');
  await host.ctx.hima.cancelRun(gated.run.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 },
    ownerSessionId: String(owner.id), timeBoxMs: 60_000 });
  assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return;
  const runId = started.run.id; const nodeId = started.run.currentNode!;
  const action = async (name: 'begin' | 'work' | 'complete' | 'pause' | 'continue', requestId: string,
    options: { executionId?: string; nodeId?: string; origin?: 'human' } = {}): Promise<ExecutionActionResult> => {
    const control = host.ctx.hima.ledger.run(runId)!.control!;
    return host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: control.epoch,
      expectedRevision: control.revision, requestId, action: name, ...options });
  };
  const begun = await action('begin', 'interactive-begin', { nodeId });
  assert.equal(begun.kind, 'accepted'); const executionId = begun.receipt?.executionId; assert.ok(executionId);
  if (!executionId) return;
  // C10: a batch `work` request on this interactive-only node is refused to the owner naming the
  // interactive-only contract, and it neither blocks the node nor spends an attempt — the node stays
  // begun and the owner opens the interactive Job next, with no person's clearance in between.
  const attemptsBeforeBatch = host.ctx.hima.ledger.run(runId)!.meters?.attempts ?? 0;
  const batchWork = await action('work', 'c10-batch-work', { executionId, nodeId });
  assert.equal(batchWork.kind, 'refused', JSON.stringify(batchWork));
  assert.match(batchWork.reason ?? '', /interactive-only/);
  assert.equal(host.ctx.hima.ledger.records({ runId, type: 'node' })
    .some((record) => record.type === 'node' && record.nodeId === nodeId && record.state === 'blocked'), false,
    'the refused batch work does not block the interactive-only node');
  assert.deepEqual(host.ctx.hima.ledger.run(runId)!.control?.paused, [], 'the node is not paused for human clearance');
  assert.equal(host.ctx.hima.executionContext(runId).executions.find((item) => item.id === executionId)?.phase, 'begun',
    'the node stays runnable after the refused batch work');
  assert.equal(host.ctx.hima.ledger.run(runId)!.meters?.attempts ?? 0, attemptsBeforeBatch, 'the refused batch work spends no attempt');
  assert.equal(host.ctx.hima.ledger.records({ runId, type: 'resumed' }).length, 0, 'no person clearance was needed');
  assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0, 'the refused batch work launched no Job');
  const requestAs = async (sessionId: string, body: Record<string, unknown>) => host.ctx.hima.interactive(sessionId, {
    runId, executionId, nodeId, requestId: body.requestId,
    ownerEpoch: host.ctx.hima.ledger.run(runId)!.control!.epoch,
    controlRevision: host.ctx.hima.ledger.run(runId)!.control!.revision,
    ...body,
  }) as Promise<Record<string, any>>;
  let interactiveSessionId = String(owner.id);
  const request = (body: Record<string, unknown>) => requestAs(interactiveSessionId, body);
  const sessions: string[] = [];
  try {
    const wrongNode = await host.ctx.hima.interactive(String(owner.id), { action: 'open', runId, executionId,
      nodeId: 'read-qor', requestId: 'interactive-wrong-node', ownerEpoch: 1, controlRevision: 1 }) as Record<string, any>;
    assert.equal(wrongNode.status, 'refused'); assert.match(wrongNode.reason, /execution|current/i);

    const beforeTamper = host.ctx.hima.ledger.run(runId)!; const originalExecution = beforeTamper.control!.executions[executionId]!;
    await host.ctx.hima.ledger.advanceRun(runId, { control: { ...beforeTamper.control!, executions: {
      ...beforeTamper.control!.executions, [executionId]: { ...originalExecution, inputDigest: 'f'.repeat(64) } } } });
    const changedInput = await request({ action: 'open', requestId: 'interactive-changed-input' });
    assert.equal(changedInput.status, 'refused'); assert.match(changedInput.reason, /input evidence changed/i);
    const restore = host.ctx.hima.ledger.run(runId)!;
    await host.ctx.hima.ledger.advanceRun(runId, { control: { ...restore.control!, executions: {
      ...restore.control!.executions, [executionId]: originalExecution } } });

    const bad = await request({ action: 'open', requestId: 'interactive-open-bad-binding' });
    assert.equal(bad.status, 'refused'); assert.match(bad.reason, /environment evidence changed|digest verification failed/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0, 'bad admin evidence starts no Job');

    await writeBindings(environmentDigest);
    delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    const directOwner = await request({ action: 'open', requestId: 'interactive-owner-open' });
    if (directOwner.status === 'opened' && typeof directOwner.session?.toolSessionId === 'string') {
      sessions.push(directOwner.session.toolSessionId);
    }
    assert.equal(directOwner.status, 'refused', JSON.stringify(directOwner));
    assert.match(directOwner.reason, /production-qualified.*Operator child|Operator child.*production-qualified/i);
    let control = host.ctx.hima.ledger.run(runId)!.control!;
    const conflicting = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'delegate-operator-conflict', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { role: 'operator', nodeRef: nodeId, nodeId: 'another-node', executionId },
      text: 'Operate only the exact qualified interactive fixture and report typed receipts.' } as never) as Record<string, any>;
    assert.equal(conflicting.status, 'refused'); assert.match(conflicting.reason, /nodeId.*nodeRef|different node/i);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'delegation' }).length, 0,
      'a conflicting owner alias is refused before any child intent is recorded');
    control = host.ctx.hima.ledger.run(runId)!.control!;
    for (const [requestId, execution] of [['delegate-operator-missing-execution', undefined],
      ['delegate-operator-malformed-execution', 42]] as const) {
      const missingExecution = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
        requestId, expectedEpoch: control.epoch, expectedRevision: control.revision,
        contract: { role: 'operator', nodeId, ...(execution === undefined ? {} : { executionId: execution }) },
        text: 'Operate only the exact qualified interactive fixture and report typed receipts.' } as never) as Record<string, any>;
      assert.equal(missingExecution.status, 'refused'); assert.match(missingExecution.reason, /requires the exact executionId/);
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'delegation' }).length, 0);
    }
    const wrongExecution = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'delegate-operator-wrong-execution', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { role: 'operator', nodeId, executionId: 'another-execution' },
      text: 'Operate only the exact qualified interactive fixture and report typed receipts.' } as never) as Record<string, any>;
    assert.equal(wrongExecution.status, 'refused'); assert.match(wrongExecution.reason, /executionId differs/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'delegation' }).length, 0,
      'a mismatched execution alias is refused before any child intent is recorded');
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const operatorTask = 'Operate only the exact qualified interactive fixture and report typed receipts.';
    for (const [requestId, budgetShare] of [['delegate-operator-total-tokens', { maxTotalTokens: 1_000 }],
      ['delegate-operator-total-cost', { maxCost: 1 }]] as const) {
      const unsupportedBudget = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
        requestId, expectedEpoch: control.epoch, expectedRevision: control.revision,
        contract: { role: 'operator', nodeId, executionId, budgetShare },
        text: 'Operate only the exact qualified interactive fixture and report typed receipts.' } as never) as Record<string, any>;
      assert.equal(unsupportedBudget.status, 'refused'); assert.match(unsupportedBudget.reason, /no enforceable task-total token or cost cap/);
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'delegation' }).length, 0);
    }
    for (const [requestId, budgetShare] of [['delegate-operator-null-budget', null],
      ['delegate-operator-array-budget', []], ['delegate-operator-string-budget', 'invalid'],
      ['delegate-operator-number-budget', 0]] as const) {
      const malformedBudget = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
        requestId, expectedEpoch: control.epoch, expectedRevision: control.revision,
        contract: { role: 'operator', nodeId, executionId, budgetShare }, text: operatorTask } as never) as Record<string, any>;
      assert.equal(malformedBudget.status, 'refused'); assert.match(malformedBudget.reason, /budgetShare must be an object/);
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'delegation' }).length, 0);
    }
    for (const [requestId, budgetShare] of [['delegate-operator-zero-elapsed', { maxElapsedMs: 0 }],
      ['delegate-operator-zero-tokens', { maxTokensPerTurn: 0 }],
      ['delegate-operator-negative-followups', { maxFollowups: -1 }]] as const) {
      const invalidBudget = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
        requestId, expectedEpoch: control.epoch, expectedRevision: control.revision,
        contract: { role: 'operator', nodeId, executionId, budgetShare }, text: operatorTask } as never) as Record<string, any>;
      assert.equal(invalidBudget.status, 'refused'); assert.match(invalidBudget.reason, /budget .* is invalid/);
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'delegation' }).length, 0);
    }
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const missingRecipeInput = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'materialize-missing-input', expectedEpoch: control.epoch, expectedRevision: control.revision,
      recipe: { teamId: 'fixture-team', version: '1', memberId: 'researcher', executionId } } as never) as Record<string, any>;
    assert.equal(missingRecipeInput.status, 'refused'); assert.match(missingRecipeInput.reason, /needs one current Reader observation/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'delegation' }).length, 0,
      'missing Pack evidence is refused before child creation');
    const inventedRecipeTask = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'materialize-invented-task', expectedEpoch: control.epoch, expectedRevision: control.revision,
      recipe: { teamId: 'fixture-team', version: '1', memberId: 'researcher', executionId }, text: 'Use extra tools.' } as never) as Record<string, any>;
    assert.equal(inventedRecipeTask.status, 'refused'); assert.match(inventedRecipeTask.reason, /supplies its own task/);
    await host.ctx.hima.ledger.appendObservation(runId, { path: `flow/results/${flow.design}/syn/report/qor.rpt`, contentSha256: 'a'.repeat(64), bytes: 1,
      reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const materialized = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'materialize-researcher', expectedEpoch: control.epoch, expectedRevision: control.revision,
      recipe: { teamId: 'fixture-team', version: '1', memberId: 'researcher', executionId } } as never) as Record<string, any>;
    assert.equal(materialized.status, 'created', JSON.stringify(materialized));
    assert.deepEqual(materialized.effectiveContract.tools, ['hima_delegation_input']);
    assert.equal(materialized.effectiveContract.inputRefs.length, 1,
      'Runtime resolves declared Pack output names without model-supplied record ids');
    assert.equal(materialized.effectiveContract.recipe.memberId, 'researcher');
    const repeatedRecipe = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'materialize-researcher-repeat', expectedEpoch: control.epoch,
      expectedRevision: host.ctx.hima.ledger.run(runId)!.control!.revision,
      recipe: { teamId: 'fixture-team', version: '1', memberId: 'researcher', executionId } } as never) as Record<string, any>;
    assert.equal(repeatedRecipe.status, 'duplicate', JSON.stringify(repeatedRecipe));
    assert.equal(repeatedRecipe.receipt.childSessionId, materialized.receipt.childSessionId);
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const forgedRecipe = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'forged-recipe-provenance', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { delegationId: 'forged', role: 'operator', nodeRef: nodeId, executionId, task: operatorTask,
        inputRefs: [], allowedTools: ['hima_interactive'], budgetShare: { maxElapsedMs: 1_000, maxFollowups: 0 },
        dependencyIds: [], recipient: { kind: 'run-owner', sessionId: String(owner.id) },
        recipe: { teamId: 'forged', version: '1', memberId: 'operator', executionId, recipeDigest: 'f'.repeat(64),
          resultSchema: { id: 'forged/1', required: [] } } } } as never) as Record<string, any>;
    assert.equal(forgedRecipe.status, 'refused'); assert.match(forgedRecipe.reason, /provenance is Host-materialized/);
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const delegated = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'delegate-operator', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { executionId, nodeId, role: 'operator', budgetShare: { maxElapsedMs: 10_000 } }, text: operatorTask } as never) as Record<string, any>;
    assert.equal(delegated.status, 'created', delegated.reason); const operatorId = delegated.receipt?.childSessionId as string; assert.ok(operatorId);
    const operatorDelegationId = delegated.effectiveContract.delegationId as string;
    assert.deepEqual(delegated.effectiveContract.tools, ['hima_interactive']);
    assert.equal(delegated.effectiveContract.operator.executionId, executionId);
    assert.equal(delegated.effectiveContract.nodeRef, nodeId);
    assert.equal(delegated.effectiveContract.delegationId, `operator-${executionId}`);
    assert.equal(delegated.effectiveContract.recipient.sessionId, String(owner.id));
    assert.equal(delegated.effectiveContract.budgetShare.maxFollowups, 1);
    assert.equal(delegated.effectiveContract.budgetShare.maxTokensPerTurn, 5_000);
    assert.ok(delegated.effectiveContract.budgetShare.maxElapsedMs > 0
      && delegated.effectiveContract.budgetShare.maxElapsedMs <= 60_000,
    'the Host default is capped by the actual remaining Run time box');
    assert.deepEqual(delegated.effectiveContract.operator.commands.find((command: { name: string }) => command.name === 'set_value'), {
      name: 'set_value', effect: 'mutate', arguments: [{ name: 'key', type: 'string' }, { name: 'value', type: 'number' }],
    }, 'the Host-minted Operator contract carries the retained Pack argument catalog');
    assert.equal(host.ctx.hima.ledger.run(runId)!.control!.owner, String(owner.id), 'Operator delegation never changes the Run owner');
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const duplicateDelegation = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'delegate-operator-duplicate', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { executionId, nodeId, role: 'operator' }, text: operatorTask } as never) as Record<string, any>;
    assert.equal(duplicateDelegation.status, 'duplicate', duplicateDelegation.reason);
    assert.equal(duplicateDelegation.receipt.childSessionId, operatorId,
      'the clock-derived default is frozen by the prior contract for a durable retry');
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const secondIdentity = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'delegate-operator-second-identity', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { delegationId: 'another-operator', executionId, nodeRef: nodeId, role: 'operator', task: operatorTask,
        inputRefs: [], allowedTools: ['hima_interactive'], budgetShare: delegated.effectiveContract.budgetShare,
        dependencyIds: [], recipient: { kind: 'run-owner', sessionId: String(owner.id) } } } as never) as Record<string, any>;
    assert.equal(secondIdentity.status, 'refused');
    assert.match(secondIdentity.reason, /already belongs to delegation/,
      'one interactive execution can never mint a second Operator child under another delegation id');
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const legacyDuplicate = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'delegate-operator-legacy-full', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { delegationId: operatorDelegationId, role: 'operator', task: operatorTask, inputRefs: [], nodeRef: nodeId,
        allowedTools: ['hima_interactive', 'terminal_open', 'bash'], budgetShare: delegated.effectiveContract.budgetShare,
        dependencyIds: [], recipient: { kind: 'run-owner', sessionId: String(owner.id) } } } as never) as Record<string, any>;
    assert.equal(legacyDuplicate.status, 'duplicate', legacyDuplicate.reason);
    assert.equal(legacyDuplicate.receipt.childSessionId, operatorId,
      'the complete legacy nodeRef contract without executionId remains compatible and bound to the retained grant');
    control = host.ctx.hima.ledger.run(runId)!.control!;
    const rebindPrior = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'delegate-operator-rebind', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { delegationId: operatorDelegationId, executionId: 'later-execution', nodeId, role: 'operator' }, text: operatorTask } as never) as Record<string, any>;
    assert.equal(rebindPrior.status, 'refused'); assert.match(rebindPrior.reason, /different Run, node or execution/);
    process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'local-tcl-fixture';
    const opened = await request({ action: 'open', requestId: 'interactive-open' });
    assert.equal(opened.status, 'opened', opened.reason); assert.equal(opened.readiness, 'ready');
    assert.deepEqual(Object.keys(opened.context).sort(), ['asOf', 'budget', 'execution', 'operator', 'run'],
      'an Operator sees the local turn state, never the whole Pack graph and Run method');
    assert.equal(opened.context.run.id, runId);
    assert.equal(opened.context.execution.id, executionId);
    assert.equal(opened.context.method, undefined);
    assert.equal(opened.context.nodes, undefined);
    assert.equal(opened.session?.qualification?.testOnly, true, 'trusted continuation of the same fixture remains owner-drivable for typed protocol coverage');
    const toolSessionId = opened.session?.toolSessionId as string; assert.ok(toolSessionId); sessions.push(toolSessionId);
    const launched = host.ctx.hima.ledger.records({ runId, type: 'job' })
      .filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
    assert.equal(launched.length, 1); const originalPid = launched[0]!.job.pid;

    const batch = await action('work', 'batch-bypass', { executionId });
    assert.equal(batch.kind, 'refused'); assert.match(batch.reason!, /interactive/i);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, 1);

    const set = await request({ action: 'input', requestId: 'interactive-set', toolSessionId, commandId: 'set-1',
      command: { name: 'set_value', args: { key: 'answer', value: 42 } }, waitMs: 1_000 });
    assert.equal(set.status, 'completed');
    assert.ok(JSON.stringify(set.context).length < 2_000, 'one command receipt does not scale with the complete Run graph');
    const duplicate = await request({ action: 'input', requestId: 'interactive-set', toolSessionId, commandId: 'set-1',
      command: { name: 'set_value', args: { key: 'answer', value: 42 } }, waitMs: 0 });
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' })
      .find((record): record is JobRecord => record.type === 'job' && record.event === 'launched')?.job.pid, originalPid);

    const get = await request({ action: 'input', requestId: 'interactive-get', toolSessionId, commandId: 'get-1',
      command: { name: 'get_value', args: { key: 'answer' } }, waitMs: 1_000 });
    assert.equal(get.status, 'completed'); assert.match(get.transcript.text, /VALUE answer=42/);
    const failed = await request({ action: 'input', requestId: 'interactive-fail', toolSessionId, commandId: 'fail-1',
      command: { name: 'fail_command', args: {} }, waitMs: 1_000 });
    assert.equal(failed.status, 'failed'); assert.match(failed.transcript.text, /intentional fixture failure/);
    // C33: the command-failed Ledger record carries a bounded errorTail with the adapter's error line,
    // so the failure's cause is reproducible from the Ledger alone, not only from a live transcript.
    const failedRecord = host.ctx.hima.ledger.records({ runId, type: 'interactive' })
      .findLast((record) => record.type === 'interactive' && (record.payload as { event?: string }).event === 'command-failed'
        && (record.payload as { commandId?: string }).commandId === 'fail-1');
    assert.ok(failedRecord?.type === 'interactive', 'a command-failed record was written');
    const errorTail = (failedRecord.payload as { errorTail?: string }).errorTail;
    assert.ok(errorTail, `the command-failed record carries an errorTail: ${JSON.stringify(failedRecord.payload)}`);
    assert.match(errorTail!, /intentional fixture failure/, 'the errorTail carries the adapter error line');
    assert.equal(/HIMA:[^:]+:(ACK|DONE|FAIL)/.test(errorTail!), false, 'the errorTail strips the HIMA protocol markers');

    // C33 (observe path): a command that has not finished when its send returns is settled later
    // through `observe`, and that writer must record the same errorTail. slow_fail returns `sent` at
    // waitMs:0, then FAILs; the observe step catches the FAIL and records it with its error line.
    const sent = await request({ action: 'input', requestId: 'interactive-slowfail', toolSessionId, commandId: 'slow-1',
      command: { name: 'slow_fail', args: {} }, waitMs: 0 });
    assert.equal(sent.status, 'sent', `the slow command has not settled at its send: ${JSON.stringify(sent)}`);
    const observed = await request({ action: 'observe', requestId: 'interactive-slowfail-observe', toolSessionId, commandId: 'slow-1', waitMs: 2_000 });
    assert.equal(observed.status, 'failed', `the observe path settles the failed command: ${JSON.stringify(observed)}`);
    const observedRecord = host.ctx.hima.ledger.records({ runId, type: 'interactive' })
      .findLast((record) => record.type === 'interactive' && (record.payload as { event?: string }).event === 'command-failed'
        && (record.payload as { commandId?: string }).commandId === 'slow-1');
    assert.ok(observedRecord?.type === 'interactive', 'the observe path wrote a command-failed record');
    const observedTail = (observedRecord.payload as { errorTail?: string }).errorTail;
    assert.ok(observedTail, `the observe-path command-failed record carries an errorTail: ${JSON.stringify(observedRecord.payload)}`);
    assert.match(observedTail!, /intentional fixture failure/, 'the observe-path errorTail carries the adapter error line');

    assert.equal((await action('pause', 'interactive-pause', { nodeId })).kind, 'accepted');
    const heldMutation = await request({ action: 'input', requestId: 'interactive-held-set', toolSessionId, commandId: 'held-set',
      command: { name: 'set_value', args: { key: 'held', value: 1 } }, waitMs: 0 });
    assert.equal(heldMutation.status, 'refused'); assert.match(heldMutation.reason, /held/);
    const heldRead = await request({ action: 'input', requestId: 'interactive-held-get', toolSessionId, commandId: 'held-get',
      command: { name: 'get_value', args: { key: 'answer' } }, waitMs: 1_000 });
    assert.equal(heldRead.status, 'completed'); assert.match(heldRead.transcript.text, /VALUE answer=42/);
    assert.equal((await action('continue', 'interactive-continue', { nodeId })).kind, 'accepted');

    const workspace = launched[0]!.job.workspace; const savedFile = path.join(workspace, 'interactive-state.txt');
    const saved = await request({ action: 'input', requestId: 'interactive-save', toolSessionId, commandId: 'save-1',
      command: { name: 'save_state', args: { file: savedFile } }, waitMs: 1_000 });
    assert.equal(saved.status, 'completed'); assert.match(await readFile(savedFile, 'utf8'), /answer 42/);
    const exited = await request({ action: 'input', requestId: 'interactive-exit', toolSessionId, commandId: 'exit-1',
      command: { name: 'close_session', args: {} }, waitMs: 1_000 });
    assert.equal(exited.status, 'completed', exited.reason);
    await waitUntil('interactive Job exits and original execution becomes ready', () => {
      const context = host.ctx.hima.executionContext(runId);
      return context.executions.find((entry) => entry.id === executionId)?.phase === 'ready'
        && host.ctx.hima.ledger.records({ runId, type: 'job' }).some((record) => record.type === 'job' && record.event === 'finished' && record.exitCode === 0);
    }, 5_000, 50);
    const closed = await request({ action: 'close', requestId: 'interactive-close', toolSessionId });
    assert.equal(closed.status, 'closed');
    const cancelControl = host.ctx.hima.ledger.run(runId)!.control!;
    const cancelOperator = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'cancel', delegationId: operatorDelegationId,
      requestId: 'cancel-operator', expectedEpoch: cancelControl.epoch, expectedRevision: cancelControl.revision } as never) as Record<string, any>;
    assert.equal(cancelOperator.status, 'accepted');
    const completed = await action('complete', 'interactive-complete', { executionId });
    assert.equal(completed.kind, 'accepted');
  } finally {
    for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
  }
});
