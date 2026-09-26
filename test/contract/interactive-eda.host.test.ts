import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import {
  BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest, loadPack, packDigestExcludes,
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
    read: ['get_value'], mutate: ['set_value', 'fail_command'], save: ['save_state', 'close_session'],
  } };
  await writeFile(contractFile, stringify(contract));
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
  const scenario = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(path.join(h.home, 'hima/packs'))}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`);

  const host = await bootInProcess(h); t.after(() => host.dispose());
  const owner = await createRootAgent(host.ctx, h.workspace);
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
    const control = host.ctx.hima.ledger.run(runId)!.control!;
    const delegated = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'create',
      requestId: 'delegate-operator', expectedEpoch: control.epoch, expectedRevision: control.revision,
      contract: { delegationId: 'operator', role: 'operator', task: 'Use only the qualified interactive fixture and report typed receipts.',
        inputRefs: [], nodeRef: nodeId, allowedTools: ['hima_interactive', 'terminal_open', 'bash'],
        budgetShare: { maxElapsedMs: 30_000, maxFollowups: 1, maxTokensPerTurn: 512 }, dependencyIds: [],
        recipient: { kind: 'run-owner', sessionId: String(owner.id) } } } as never) as Record<string, any>;
    assert.equal(delegated.status, 'created', delegated.reason); const operatorId = delegated.receipt?.childSessionId as string; assert.ok(operatorId);
    assert.deepEqual(delegated.effectiveContract.tools, ['hima_interactive']);
    assert.equal(delegated.effectiveContract.operator.executionId, executionId);
    assert.equal(host.ctx.hima.ledger.run(runId)!.control!.owner, String(owner.id), 'Operator delegation never changes the Run owner');
    process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'local-tcl-fixture';
    const opened = await request({ action: 'open', requestId: 'interactive-open' });
    assert.equal(opened.status, 'opened', opened.reason); assert.equal(opened.readiness, 'ready');
    assert.equal(opened.session?.qualification?.testOnly, true, 'trusted continuation of the same fixture remains owner-drivable for typed protocol coverage');
    const toolSessionId = opened.session?.toolSessionId as string; assert.ok(toolSessionId); sessions.push(toolSessionId);
    const launched = host.ctx.hima.ledger.records({ runId, type: 'job' })
      .filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
    assert.equal(launched.length, 1); const originalPid = launched[0]!.job.pid;

    const batch = await action('work', 'batch-bypass', { executionId });
    assert.equal(batch.kind, 'refused'); assert.match(batch.reason!, /interactive/i);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, 1);

    const set = await request({ action: 'input', requestId: 'interactive-set', toolSessionId, commandId: 'set-1',
      command: { name: 'set_value', args: { arguments: ['answer', 42] } }, waitMs: 1_000 });
    assert.equal(set.status, 'completed');
    const duplicate = await request({ action: 'input', requestId: 'interactive-set', toolSessionId, commandId: 'set-1',
      command: { name: 'set_value', args: { arguments: ['answer', 42] } }, waitMs: 0 });
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' })
      .find((record): record is JobRecord => record.type === 'job' && record.event === 'launched')?.job.pid, originalPid);

    const get = await request({ action: 'input', requestId: 'interactive-get', toolSessionId, commandId: 'get-1',
      command: { name: 'get_value', args: { arguments: ['answer'] } }, waitMs: 1_000 });
    assert.equal(get.status, 'completed'); assert.match(get.transcript.text, /VALUE answer=42/);
    const failed = await request({ action: 'input', requestId: 'interactive-fail', toolSessionId, commandId: 'fail-1',
      command: { name: 'fail_command', args: { arguments: [] } }, waitMs: 1_000 });
    assert.equal(failed.status, 'failed'); assert.match(failed.transcript.text, /intentional fixture failure/);

    assert.equal((await action('pause', 'interactive-pause', { nodeId })).kind, 'accepted');
    const heldMutation = await request({ action: 'input', requestId: 'interactive-held-set', toolSessionId, commandId: 'held-set',
      command: { name: 'set_value', args: { arguments: ['held', true] } }, waitMs: 0 });
    assert.equal(heldMutation.status, 'refused'); assert.match(heldMutation.reason, /held/);
    const heldRead = await request({ action: 'input', requestId: 'interactive-held-get', toolSessionId, commandId: 'held-get',
      command: { name: 'get_value', args: { arguments: ['answer'] } }, waitMs: 1_000 });
    assert.equal(heldRead.status, 'completed'); assert.match(heldRead.transcript.text, /VALUE answer=42/);
    assert.equal((await action('continue', 'interactive-continue', { nodeId })).kind, 'accepted');

    const workspace = launched[0]!.job.workspace; const savedFile = path.join(workspace, 'interactive-state.txt');
    const saved = await request({ action: 'input', requestId: 'interactive-save', toolSessionId, commandId: 'save-1',
      command: { name: 'save_state', args: { arguments: [savedFile] } }, waitMs: 1_000 });
    assert.equal(saved.status, 'completed'); assert.match(await readFile(savedFile, 'utf8'), /answer 42/);
    const exited = await request({ action: 'input', requestId: 'interactive-exit', toolSessionId, commandId: 'exit-1',
      command: { name: 'close_session', args: { arguments: [] } }, waitMs: 1_000 });
    assert.equal(exited.status, 'completed', exited.reason);
    await waitUntil('interactive Job exits and original execution becomes ready', () => {
      const context = host.ctx.hima.executionContext(runId);
      return context.executions.find((entry) => entry.id === executionId)?.phase === 'ready'
        && host.ctx.hima.ledger.records({ runId, type: 'job' }).some((record) => record.type === 'job' && record.event === 'finished' && record.exitCode === 0);
    }, 5_000, 50);
    const closed = await request({ action: 'close', requestId: 'interactive-close', toolSessionId });
    assert.equal(closed.status, 'closed');
    const cancelControl = host.ctx.hima.ledger.run(runId)!.control!;
    const cancelOperator = await host.ctx.hima.delegate({ runId, actor: String(owner.id), action: 'cancel', delegationId: 'operator',
      requestId: 'cancel-operator', expectedEpoch: cancelControl.epoch, expectedRevision: cancelControl.revision } as never) as Record<string, any>;
    assert.equal(cancelOperator.status, 'accepted');
    const completed = await action('complete', 'interactive-complete', { executionId });
    assert.equal(completed.kind, 'accepted');
  } finally {
    for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 15_000 });
  }
});
