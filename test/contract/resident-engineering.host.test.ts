import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { checkPack, jobKill, launchJob, loadPack, loadSite, type JobRecord, type WorkspaceRecord } from '@hima/harness';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { packsDirOf, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { repoRoot } from './support/dsh-home.ts';

// The production wrapper independently refuses the unsandboxed fixture unless this exact test-only
// switch is present. This test file runs in its own Node process, so keep it stable across concurrent
// top-level cases instead of racing per-test save/restore operations.
process.env.HIMA_RESIDENT_TESTING = '1';

const declaration = `    outsourcing:
      role: resident-engineering-agent
      reads: [qorReport]
      knowledge: [push-method.md]
      produces: qorReport
`;

const resultReader = `#!/usr/bin/env python3
import json, pathlib, sys
report, output = map(pathlib.Path, sys.argv[1:3])
value = json.loads(report.read_text())
if value.get("schema") != "fixture-result/1" or value.get("value") not in ["native", "repaired"]:
    raise SystemExit("unexpected resident result")
output.write_text('{"values":[{"type":"fixture_value","unit":"count","value":1}]}\\n')
`;

const readToolResult = (result: Awaited<ReturnType<ReturnType<typeof publicCaller>>>) => {
  assert.equal(result.isError, false, JSON.stringify(result));
  return JSON.parse(result.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
};

function publicCaller(host: Awaited<ReturnType<typeof bootInProcess>>, agent: Awaited<ReturnType<typeof createRootAgent>>) {
  let serial = 0;
  return (args: Record<string, unknown>) => host.ctx.tools.execute({
    callId: `resident-${++serial}` as never, name: 'hima_execute', arguments: args, agent,
    signal: AbortSignal.timeout(30_000),
  });
}

async function installResidentFixture(t: Parameters<typeof localHome>[0], options: { parallelJobs?: number } = {}) {
  const parallelJobs = options.parallelJobs ?? 2;
  const home = await localHome(t, { sleepSeconds: 0, parallelJobs });
  assert.ok(home);
  const id = 'resident-engineering-loop';
  await writePackVariant(packsDirOf(home.h), id, [
    ['  - name: synthesisLog\n', '  - name: engineeringResult\n    path: engineering/result.json\n    reader: fixture-result\n    description: Reader-verified resident engineering result.\n  - name: synthesisLog\n'],
    ['    - make\n', '    - make\n    - /usr/bin/python3\n'],
    ['tools:\n', 'knowledge:\n  - file: push-method.md\n    purpose: Engineering playbook.\n\ntools:\n'],
    ['    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n',
      `${declaration.replace('produces: qorReport', 'produces: engineeringResult')}    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n`],
  ], [], undefined, {
    'knowledge/push-method.md': '# Push method\n',
    'readers/fixture-result.yml': "id: fixture-result\nversion: '1'\nfile: tools/read-fixture-result.py\nargv: [/usr/bin/python3, '${READER}', '${REPORT}', '${OUT}']\nreportKind: fixture-result/1\nemits: [fixture_value]\n",
    'tools/read-fixture-result.py': resultReader,
    'semantics.yml': 'values:\n  fixture_value: { unit: count, description: Verified fixture value }\n',
  });
  const wrapper = path.join(repoRoot, 'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
  const native = path.join(repoRoot, 'sites/linglong-atcs28/tests/fixtures/acp-standin.py');
  const admin = path.join(home.h.workspace, 'resident-admin');
  await mkdir(admin, { recursive: true });
  const capability = path.join(admin, 'engineering-capabilities-v1.json');
  const descendantPid = path.join(admin, 'descendant.pid');
  const permissionResponse = path.join(admin, 'permission-response.json');
  await writeFile(capability, `${JSON.stringify({
    schema: 'hima-resident-engineering-capability/1', protocol: 'hima-resident-engineering/1',
    wrapper: { argv: [wrapper, '--capability', capability] },
    native: { executable: native, version: '1.18.34', argv: [], model: 'deepseek/deepseek-flash', protocolVersion: 1 },
    sandbox: { kind: 'none', testOnly: true, privateWorkspace: 'workspace', privateHome: 'home' },
    environment: { inherit: [], set: { STANDIN_DESCENDANT_PID: descendantPid, STANDIN_PERMISSION_RESPONSE: permissionResponse }, toolPaths: [], credentialReadPaths: [] },
    permissions: { autoApprove: ['read', 'edit', 'write', 'bash'], denyUnknown: true },
    delivery: { candidate: 'resident-delivery.json' }, stopGraceSeconds: 1,
  }, null, 2)}\n`);
  await writeLocalSite(home.h, {
    allowedReadRoots: [home.h.workspace, home.flow.root, path.dirname(wrapper), path.dirname(native)],
    allowedWriteRoots: [home.h.workspace], allowedWrappers: ['make', '/usr/bin/python3', '/bin/sleep', wrapper],
    bindings: { flowRoot: home.flow.root, design: home.flow.design, workspaceRoot: home.h.workspace, engineeringCapabilities: capability },
    parallelJobs,
  });
  return { ...home, id, wrapper, native, descendantPid };
}

async function openResidentTask(
  host: Awaited<ReturnType<typeof bootInProcess>>,
  fixture: Awaited<ReturnType<typeof installResidentFixture>>,
  owner: Awaited<ReturnType<typeof createRootAgent>>,
  goal: string,
) {
  const started = await host.ctx.hima.startRun({ pack: fixture.id, site: 'local', goal: { target_period_ns: 2 },
    ownerSessionId: String(owner.id), timeBoxMs: 60_000 });
  assert.equal(started.kind, 'ran');
  if (started.kind !== 'ran') throw new Error('resident fixture Run did not start');
  const workspace = host.ctx.hima.ledger.records({ runId: started.run.id, type: 'workspace' })
    .findLast((record): record is WorkspaceRecord => record.type === 'workspace')!;
  const input = path.join(workspace.workspace, `flow/results/${fixture.flow.design}/syn/report/qor.rpt`);
  await mkdir(path.dirname(input), { recursive: true });
  await writeFile(input, 'fixture input retained for the engineering task\n');
  const call = publicCaller(host, owner);
  const controlled = () => host.ctx.hima.ledger.run(started.run.id)!.control!;
  const execute = async (requestId: string, action: string, extra: Record<string, unknown>) => readToolResult(await call({
    run: started.run.id, action, requestId, expectedEpoch: controlled().epoch, expectedRevision: controlled().revision, ...extra,
  }));
  const begun = await execute(`${goal}-begin`, 'begin', { nodeId: started.run.currentNode });
  assert.equal(begun.kind, 'accepted');
  const executionId = begun.receipt.executionId as string;
  const engineering = await execute(`${goal}-start`, 'engineering', { executionId, engineering: { operation: 'start', goal } });
  assert.equal(engineering.data?.status, 'started', JSON.stringify(engineering));
  return { started, workspace, call, controlled, execute, executionId, engineering };
}

const processIsAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};

const jobsOf = (host: Awaited<ReturnType<typeof bootInProcess>>, runId: string): JobRecord[] =>
  host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record): record is JobRecord => record.type === 'job');

test('a normal tool may declare one generic resident engineering delivery contract', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  try {
    const id = 'resident-engineering-schema';
    await writePackVariant(packsDirOf(home.h), id, [
      ['tools:\n', `knowledge:\n  - file: push-method.md\n    purpose: Engineering playbook.\n\ntools:\n`],
      ['    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n',
        `${declaration}    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n`],
    ], [], undefined, { 'knowledge/push-method.md': '# Push method\n' });
    const pack = loadPack(packsDirOf(home.h), id);
    assert.deepEqual(pack.contract.tools[0]?.outsourcing, {
      role: 'resident-engineering-agent', reads: ['qorReport'], knowledge: ['push-method.md'], produces: 'qorReport',
    });
    const missing = checkPack(pack, loadSite(path.join(home.h.home, 'hima/sites'), 'local'));
    assert.equal(missing.fit, false);
    assert.ok(missing.errors.some((error) => /engineeringCapabilities/.test(error)), JSON.stringify(missing.errors));
  } finally {
    await home.h.dispose();
  }
});

test('outsourcing rejects unknown materials, unreadable delivery, and a second interactive protocol', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  try {
    const variants = [
      ['resident-unknown-read', declaration.replace('reads: [qorReport]', 'reads: [missingReport]'), /unknown output.*missingReport/i],
      ['resident-unknown-knowledge', declaration.replace('knowledge: [push-method.md]', 'knowledge: [missing.md]'), /knowledge.*missing\.md/i],
      ['resident-unreadable-delivery', declaration.replace('produces: qorReport', 'produces: synthesisLog'), /produces.*reader/i],
      ['resident-interactive-conflict', `${declaration}    interactive:\n      mode: hybrid\n      adapter: hima-tcl-line-v1\n      commands: { read: [report], mutate: [], save: [], close: [] }\n`, /outsourcing.*interactive|interactive.*outsourcing/i],
    ] as const;
    for (const [id, outsourcing, expected] of variants) {
      await writePackVariant(packsDirOf(home.h), id, [
        ['tools:\n', `knowledge:\n  - file: push-method.md\n    purpose: Engineering playbook.\n\ntools:\n`],
        ['    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n',
          `${outsourcing}    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n`],
      ], [], undefined, { 'knowledge/push-method.md': '# Push method\n' });
      assert.throws(() => loadPack(packsDirOf(home.h), id), expected, id);
    }
  } finally {
    await home.h.dispose();
  }
});

test('public Host keeps one resident task through start, message, Reader-verified delivery and release', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: fixture.id, site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id), timeBoxMs: 60_000 });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return;
    const workspace = host.ctx.hima.ledger.records({ runId: started.run.id, type: 'workspace' })
      .findLast((record): record is WorkspaceRecord => record.type === 'workspace')!;
    const input = path.join(workspace.workspace, `flow/results/${fixture.flow.design}/syn/report/qor.rpt`);
    await mkdir(path.dirname(input), { recursive: true });
    await writeFile(input, 'fixture input retained for the engineering task\n');
    const call = publicCaller(host, owner);
    const controlled = () => host.ctx.hima.ledger.run(started.run.id)!.control!;
    const execute = async (requestId: string, action: string, extra: Record<string, unknown>) => readToolResult(await call({
      run: started.run.id, action, requestId, expectedEpoch: controlled().epoch, expectedRevision: controlled().revision, ...extra,
    }));
    const begun = await execute('01-begin', 'begin', { nodeId: started.run.currentNode });
    assert.equal(begun.kind, 'accepted');
    const executionId = begun.receipt.executionId as string;
    const engineering = await execute('02-start', 'engineering', {
      executionId, engineering: { operation: 'start', goal: 'DELIVER_RESULT', context: 'Use the supplied method and return measured fixture output.' },
    });
    assert.equal(engineering.kind, 'accepted', JSON.stringify(engineering));
    assert.ok(engineering.data, JSON.stringify(engineering));
    assert.equal(engineering.data.status, 'started');
    assert.equal(jobsOf(host, started.run.id).filter((record) => record.event === 'launched').length, 1);
    const taskId = engineering.data.taskId as string;
    const taskDir = path.join(workspace.workspace, '.hima-engineering', taskId);
    const other = await createRootAgent(host.ctx, fixture.h.workspace);
    const staleOwner = readToolResult(await publicCaller(host, other)({ run: started.run.id, action: 'engineering', requestId: 'wrong-owner-status',
      executionId, expectedEpoch: controlled().epoch, expectedRevision: controlled().revision, engineering: { operation: 'status' } }));
    assert.equal(staleOwner.kind, 'refused');
    assert.match(staleOwner.reason, /owner.*stale/i);
    await waitUntil('the native stand-in produced its delivery candidate', async () => {
      try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; }
      catch { return false; }
    }, 10_000, 20);

    const message = await execute('03-message', 'engineering', { executionId,
      engineering: { operation: 'message', message: 'Confirm this stays in the same native session.' } });
    assert.equal(message.data.status, 'completed', JSON.stringify(message));
    const statusArgs = { run: started.run.id, action: 'engineering', requestId: '04-status', executionId,
      expectedEpoch: controlled().epoch, expectedRevision: controlled().revision, engineering: { operation: 'status' } };
    const status = readToolResult(await call(statusArgs));
    assert.equal(status.data.state.sessionId, message.data.state?.sessionId ?? status.data.state.sessionId);
    const duplicate = readToolResult(await call(statusArgs));
    assert.equal(duplicate.kind, 'duplicate');
    assert.equal(duplicate.receipt.data.taskId, taskId);

    const delivery = await execute('05-delivery', 'engineering', { executionId, engineering: { operation: 'delivery' } });
    assert.equal(delivery.data.status, 'verified', JSON.stringify(delivery));
    assert.equal(delivery.data.outcome, 'completed');
    const observations = host.ctx.hima.ledger.records({ runId: started.run.id, type: 'observation' });
    assert.ok(observations.some((record) => record.type === 'observation' && record.reader.id === 'fixture-result'));
    const deliveredBytes = await readFile(path.join(workspace.workspace, 'engineering/result.json'));
    assert.equal(createHash('sha256').update(deliveredBytes).digest('hex'), delivery.data.output.sha256);

    const release = await execute('06-release', 'engineering', { executionId, engineering: { operation: 'release' } });
    assert.ok(release.data, JSON.stringify(release));
    assert.equal(release.data.status, 'released', JSON.stringify(release));
    const completed = await execute('07-complete', 'complete', { executionId });
    assert.equal(completed.kind, 'accepted', JSON.stringify(completed));
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('paused execution still reports and actually cancels the same resident native process tree', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'SPAWN_DESCENDANT');
    await waitUntil('resident native descendant pid', async () => {
      try { return Number.isInteger(Number((await readFile(fixture.descendantPid, 'utf8')).trim())); } catch { return false; }
    }, 10_000, 20);
    const descendant = Number((await readFile(fixture.descendantPid, 'utf8')).trim());
    assert.equal(processIsAlive(descendant), true);
    const paused = await task.execute('pause-resident', 'pause', { nodeId: task.started.run.currentNode });
    assert.equal(paused.kind, 'accepted');
    const refusedMessage = await task.execute('paused-message', 'engineering', { executionId: task.executionId,
      engineering: { operation: 'message', message: 'new work while paused' } });
    assert.equal(refusedMessage.kind, 'refused');
    assert.match(refusedMessage.reason, /paused/i);
    const status = await task.execute('paused-status', 'engineering', { executionId: task.executionId, engineering: { operation: 'status' } });
    assert.equal(status.kind, 'accepted');
    const cancelled = await task.execute('paused-engineering-cancel', 'engineering', { executionId: task.executionId,
      engineering: { operation: 'cancel' } });
    assert.equal(cancelled.data.status, 'stopped', JSON.stringify(cancelled));
    await waitUntil('resident native descendant stopped', () => !processIsAlive(descendant), 5_000, 20);
    const released = await task.execute('paused-release', 'engineering', { executionId: task.executionId, engineering: { operation: 'release' } });
    assert.equal(released.data.status, 'released', JSON.stringify(released));
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('Run cancel kills its resident Job descendants and an unknown follow-up is never replayed', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'RUN_CANCEL_UNKNOWN');
    await task.execute('run-pause-before-cancel', 'pause', { nodeId: task.started.run.currentNode });
    const cancel = await task.execute('run-cancel-resident', 'cancel', {});
    assert.equal(cancel.kind, 'accepted');
    await waitUntil('Run cancel settles', () => host.ctx.hima.ledger.run(task.started.run.id)?.status === 'cancelled', 10_000, 20);
    const jobFacts = jobsOf(host, task.started.run.id);
    const launchedSession = jobFacts.find((record) => record.event === 'launched')?.job.session;
    assert.ok(launchedSession);
    assert.ok(jobFacts.some((record) => record.event === 'killed' && record.job.session === launchedSession),
      'Run cancel records the actual resident Job process-group stop');
    const args = { run: task.started.run.id, action: 'engineering', requestId: 'status-after-dead-wrapper', executionId: task.executionId,
      expectedEpoch: task.controlled().epoch, expectedRevision: task.controlled().revision, engineering: { operation: 'status' } };
    const unknown = readToolResult(await task.call(args));
    assert.equal(unknown.data.status, 'unknown', JSON.stringify(unknown));
    const duplicate = readToolResult(await task.call(args));
    assert.equal(duplicate.kind, 'duplicate');
    assert.equal(jobsOf(host, task.started.run.id).filter((record) => record.event === 'launched').length, 1,
      'unknown status did not restart or replay the resident task');
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('best-effort resident delivery is saved and Reader-verified without claiming the Pack Goal', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_BEST_EFFORT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    await waitUntil('best-effort native candidate', async () => {
      try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; } catch { return false; }
    }, 10_000, 20);
    const delivery = await task.execute('best-effort-delivery', 'engineering', { executionId: task.executionId, engineering: { operation: 'delivery' } });
    assert.equal(delivery.data.status, 'verified', JSON.stringify(delivery));
    assert.equal(delivery.data.outcome, 'best-effort');
    assert.equal(delivery.data.summary, 'deterministic native result with residual');
    await task.execute('best-effort-release', 'engineering', { executionId: task.executionId, engineering: { operation: 'release' } });
    const completed = await task.execute('best-effort-complete', 'complete', { executionId: task.executionId });
    assert.equal(completed.kind, 'accepted');
    const run = host.ctx.hima.ledger.run(task.started.run.id)!;
    assert.equal(run.status, 'running');
    assert.equal(run.currentNode, 'read-qor');
    assert.equal(host.ctx.hima.ledger.records({ runId: run.id, type: 'decision' }).length, 0,
      'engineering best-effort is not a Pack goal decision');
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('an at-cap start writes no task, then a fresh request launches once with the tool licence after the slot frees', async (t) => {
  const fixture = await installResidentFixture(t, { parallelJobs: 1 });
  const host = await bootInProcess(fixture.h);
  const deps = { ledger: host.ctx.hima.ledger, sitesDir: path.join(fixture.h.home, 'hima/sites') };
  let holding: Awaited<ReturnType<typeof launchJob>> | undefined;
  try {
    holding = await launchJob(deps, { site: 'local', workspace: fixture.h.workspace, argv: ['/bin/sleep', '60'], name: 'resident-cap-holder' });
    assert.equal(holding.kind, 'launched');
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: fixture.id, site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id), timeBoxMs: 60_000 });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return;
    const workspace = host.ctx.hima.ledger.records({ runId: started.run.id, type: 'workspace' })
      .findLast((record): record is WorkspaceRecord => record.type === 'workspace')!;
    const input = path.join(workspace.workspace, `flow/results/${fixture.flow.design}/syn/report/qor.rpt`);
    await mkdir(path.dirname(input), { recursive: true }); await writeFile(input, 'capacity fixture input\n');
    const call = publicCaller(host, owner); const controlled = () => host.ctx.hima.ledger.run(started.run.id)!.control!;
    const execute = async (requestId: string, extra: Record<string, unknown>) => readToolResult(await call({
      run: started.run.id, action: 'engineering', requestId, expectedEpoch: controlled().epoch, expectedRevision: controlled().revision, ...extra,
    }));
    const begun = readToolResult(await call({ run: started.run.id, action: 'begin', requestId: 'cap-begin', nodeId: started.run.currentNode,
      expectedEpoch: controlled().epoch, expectedRevision: controlled().revision }));
    const executionId = begun.receipt.executionId as string;
    const first = await execute('cap-start-one', { executionId, engineering: { operation: 'start', goal: 'RUN_CANCEL_UNKNOWN' } });
    assert.equal(first.data.status, 'at-cap', JSON.stringify(first));
    const taskDir = path.join(workspace.workspace, '.hima-engineering', first.data.taskId);
    assert.equal(await access(taskDir).then(() => true, () => false), false, 'capacity refusal leaves no task files');
    if (holding.kind === 'launched') await jobKill(deps, { run: holding.run.id, session: holding.record.job.session });
    const second = await execute('cap-start-two', { executionId, engineering: { operation: 'start', goal: 'RUN_CANCEL_UNKNOWN' } });
    assert.equal(second.data.status, 'started', JSON.stringify(second));
    const residentLaunch = jobsOf(host, started.run.id).find((record) => record.event === 'launched');
    assert.deepEqual(residentLaunch?.licences, { 'Design-Compiler': 1 });
    assert.equal(jobsOf(host, started.run.id).filter((record) => record.event === 'launched').length, 1);
    const cancelled = await execute('cap-cancel', { executionId, engineering: { operation: 'cancel' } });
    assert.equal(cancelled.data.status, 'stopped');
    const released = await execute('cap-release', { executionId, engineering: { operation: 'release' } });
    assert.equal(released.data.status, 'released');
  } finally {
    if (holding?.kind === 'launched') await jobKill(deps, { run: holding.run.id, session: holding.record.job.session }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await host.dispose(); await fixture.h.dispose();
  }
});

test('Reader rejection is repaired in the same native session and release binds the latest verified manifest', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_BAD_RESULT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    await waitUntil('bad native candidate', async () => {
      try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; } catch { return false; }
    }, 10_000, 20);
    const rejected = await task.execute('repair-delivery-bad', 'engineering', { executionId: task.executionId, engineering: { operation: 'delivery' } });
    assert.equal(rejected.data.status, 'reader-rejected', JSON.stringify(rejected));
    const firstManifestPath = path.join(taskDir, 'delivery/manifests/repair-delivery-bad.json');
    const firstManifest = JSON.parse(await readFile(firstManifestPath, 'utf8'));
    const firstArtifact = await readFile(path.join(taskDir, firstManifest.artifactRoot, firstManifest.artifacts[0].path));
    const repaired = await task.execute('repair-message', 'engineering', { executionId: task.executionId,
      engineering: { operation: 'message', message: 'FIX_DELIVERY' } });
    assert.equal(repaired.data.status, 'completed', JSON.stringify(repaired));
    const accepted = await task.execute('repair-delivery-good', 'engineering', { executionId: task.executionId, engineering: { operation: 'delivery' } });
    assert.ok(accepted.data, JSON.stringify(accepted));
    assert.equal(accepted.data.status, 'verified', JSON.stringify(accepted));
    assert.equal(accepted.data.summary, 'deterministic repaired result');
    const latestManifest = JSON.parse(await readFile(path.join(taskDir, 'delivery/manifest.json'), 'utf8'));
    assert.notEqual(latestManifest.sha256, firstManifest.sha256);
    assert.deepEqual(JSON.parse(await readFile(firstManifestPath, 'utf8')), firstManifest, 'the first rejected manifest remains immutable');
    assert.equal(createHash('sha256').update(firstArtifact).digest('hex'), firstManifest.artifacts[0].sha256,
      'the first Reader-rejected artifact bytes remain verifiable after repair');
    assert.equal(firstManifest.sessionId, latestManifest.sessionId, 'repair stayed in the original native session');
    const release = await task.execute('repair-release', 'engineering', { executionId: task.executionId, engineering: { operation: 'release' } });
    assert.equal(release.data.status, 'released', JSON.stringify(release));
    const completed = await task.execute('repair-complete', 'complete', { executionId: task.executionId });
    assert.equal(completed.kind, 'accepted');
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});
