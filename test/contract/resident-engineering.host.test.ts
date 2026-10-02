import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { checkPack, jobKill, jobStatus, launchJob, loadPack, loadSite, type JobRecord, type WorkspaceRecord } from '@hima/harness';
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
  const requestPrefix = goal.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
  const controlled = () => host.ctx.hima.ledger.run(started.run.id)!.control!;
  const execute = async (requestId: string, action: string, extra: Record<string, unknown>) => readToolResult(await call({
    run: started.run.id, action, requestId, expectedEpoch: controlled().epoch, expectedRevision: controlled().revision, ...extra,
  }));
  const begun = await execute(`${requestPrefix}-begin`, 'begin', { nodeId: started.run.currentNode });
  assert.equal(begun.kind, 'accepted');
  const executionId = begun.receipt.executionId as string;
  const engineering = await execute(`${requestPrefix}-start`, 'engineering', { executionId, engineering: { operation: 'start', goal } });
  assert.equal(engineering.data?.status, 'started', JSON.stringify(engineering));
  return { started, workspace, call, controlled, execute, executionId, engineering };
}

const processIsAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};

const jobsOf = (host: Awaited<ReturnType<typeof bootInProcess>>, runId: string): JobRecord[] =>
  host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record): record is JobRecord => record.type === 'job');

async function crashResidentWrapper(host: Awaited<ReturnType<typeof bootInProcess>>, runId: string, sitesDir: string): Promise<JobRecord> {
  const launch = jobsOf(host, runId).find((record) => record.event === 'launched' && record.job.name.startsWith('engineering-'));
  assert.ok(launch);
  const jobPid = launch.job.pid;
  assert.ok(jobPid);
  const rows = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }];
  });
  const descendants = new Set<number>([jobPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (descendants.has(row.ppid) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; }
  }
  const wrapper = rows.filter((row) => row.pid !== jobPid && descendants.has(row.pid)
    && row.command.includes('resident-engineering-wrapper.py') && !row.command.includes('--reconcile')
    && !/\b(?:ba|z|c|k)?sh\s+-c\b/.test(row.command)).at(-1);
  assert.ok(wrapper, `wrapper process not found below Job pid ${jobPid}`);
  process.kill(wrapper.pid, 'SIGKILL');
  await waitUntil('crashed resident wrapper Job exits', async () =>
    (await jobStatus({ ledger: host.ctx.hima.ledger, sitesDir }, { run: runId, session: launch.job.session })).state.state !== 'running', 5_000, 20);
  return launch;
}

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

    const messageStartedAt = Date.now();
    const message = await execute('03-message', 'engineering', { executionId,
      engineering: { operation: 'message', message: 'LONG_MESSAGE' } });
    assert.equal(message.data.status, 'accepted', JSON.stringify(message));
    assert.ok(Date.now() - messageStartedAt < 4_000, 'Host returns the durable queue ack before the 5.5s native prompt completes');
    const queued = JSON.parse(await readFile(path.join(taskDir, 'native/messages/03-message.queued.json'), 'utf8'));
    assert.equal(queued.status, 'queued');
    await waitUntil('slow same-session message actual completion fact', async () => {
      try {
        const state = JSON.parse(await readFile(path.join(taskDir, 'state.json'), 'utf8'));
        return state.phase === 'waiting' && state.detail?.completedRequestId === '03-message';
      } catch { return false; }
    }, 10_000, 20);
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
    const task = await openResidentTask(host, fixture, owner, 'SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH');
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
    assert.ok(released.data, JSON.stringify(released));
    assert.equal(released.data.status, 'released', JSON.stringify(released));
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('Run cancel confirms cleanup or keeps resources fenced without replay when ownership retention races', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'RUN_CANCEL_UNKNOWN');
    await task.execute('run-pause-before-cancel', 'pause', { nodeId: task.started.run.currentNode });
    const cancel = await task.execute('run-cancel-resident', 'cancel', {});
    assert.equal(cancel.kind, 'accepted');
    await waitUntil('Run cancel resolves retained ownership', () =>
      ['confirmed', 'uncertain'].includes(host.ctx.hima.ledger.run(task.started.run.id)?.control?.stop?.status ?? ''), 15_000, 20);
    const stopStatus = host.ctx.hima.ledger.run(task.started.run.id)?.control?.stop?.status;
    const jobFacts = jobsOf(host, task.started.run.id);
    const launchedSession = jobFacts.find((record) => record.event === 'launched')?.job.session;
    assert.ok(launchedSession);
    assert.ok(jobFacts.some((record) => record.event === 'killed' && record.job.session === launchedSession),
      'Run cancel records the actual resident Job process-group stop');
    const args = { run: task.started.run.id, action: 'engineering', requestId: 'status-after-dead-wrapper', executionId: task.executionId,
      expectedEpoch: task.controlled().epoch, expectedRevision: task.controlled().revision, engineering: { operation: 'status' } };
    const unknown = readToolResult(await task.call(args));
    assert.equal(unknown.data.status, stopStatus === 'confirmed' ? 'stopped' : 'unknown', JSON.stringify(unknown));
    const duplicate = readToolResult(await task.call(args));
    assert.equal(duplicate.kind, 'duplicate');
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)?.status, stopStatus === 'confirmed' ? 'cancelled' : 'waiting');
    assert.ok(jobsOf(host, task.started.run.id).filter((record) => record.event === 'launched')
      .slice(1).every((record) => record.job.name.startsWith('engineering-reconcile-')),
    'unknown reconciliation launches only bounded cleanup Jobs and never replays resident business work');
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
    assert.equal(repaired.data.status, 'accepted', JSON.stringify(repaired));
    await waitUntil('repair message actual completion fact', async () => {
      try {
        const state = JSON.parse(await readFile(path.join(taskDir, 'state.json'), 'utf8'));
        return state.phase === 'waiting' && state.detail?.completedRequestId === 'repair-message';
      } catch { return false; }
    }, 10_000, 20);
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

test('public status reconciles a crashed wrapper orphan without replay and release keeps the stopped task fenced', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  const sitesDir = path.join(fixture.h.home, 'hima/sites');
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH');
    await waitUntil('detached native descendant exists', async () => {
      try { return processIsAlive(Number((await readFile(fixture.descendantPid, 'utf8')).trim())); } catch { return false; }
    }, 10_000, 20);
    const descendant = Number((await readFile(fixture.descendantPid, 'utf8')).trim());
    await crashResidentWrapper(host, task.started.run.id, sitesDir);
    assert.equal(processIsAlive(descendant), true, 'wrapper crash leaves the separately-owned native descendant alive for reconciliation');
    const status = await task.execute('crash-status', 'engineering', { executionId: task.executionId, engineering: { operation: 'status' } });
    assert.equal(status.data.status, 'stopped', JSON.stringify(status));
    assert.equal(status.data.nativeQuiescence, 'confirmed');
    await waitUntil('reconciliation stops detached descendant', () => !processIsAlive(descendant), 5_000, 20);
    assert.equal(jobsOf(host, task.started.run.id).filter((record) => record.event === 'launched').length, 2,
      'one original wrapper Job plus one bounded reconciliation Job; no business retry');
    const lostMessage = await task.execute('crash-message', 'engineering', { executionId: task.executionId,
      engineering: { operation: 'message', message: 'continue lost RPC' } });
    assert.equal(lostMessage.kind, 'refused');
    assert.match(lostMessage.reason, /cannot be continued|wrapper is gone/i);
    const release = await task.execute('crash-release', 'engineering', { executionId: task.executionId, engineering: { operation: 'release' } });
    assert.equal(release.data.status, 'released', JSON.stringify(release));
    const releasedStatus = await task.execute('crash-released-status', 'engineering', { executionId: task.executionId, engineering: { operation: 'status' } });
    assert.equal(releasedStatus.data.status, 'released', JSON.stringify(releasedStatus));
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)!.control!.executions[task.executionId]!.phase, 'failed');
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('crash cleanup preserves Reader-verified ready delivery through status, release and completion', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  const sitesDir = path.join(fixture.h.home, 'hima/sites');
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_RESULT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    await waitUntil('native delivery candidate', async () => {
      try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; } catch { return false; }
    }, 10_000, 20);
    const settledPrompt = await task.execute('verified-before-crash-message', 'engineering', { executionId: task.executionId,
      engineering: { operation: 'message', message: 'Confirm delivery remains in this same session.' } });
    assert.equal(settledPrompt.data.status, 'accepted', JSON.stringify(settledPrompt));
    await waitUntil('message completion state', async () => {
      try {
        const state = JSON.parse(await readFile(path.join(taskDir, 'state.json'), 'utf8'));
        return state.phase === 'waiting' && state.detail?.completedRequestId === 'verified-before-crash-message';
      } catch { return false; }
    }, 10_000, 20);
    const delivery = await task.execute('verified-before-crash-delivery', 'engineering', { executionId: task.executionId,
      engineering: { operation: 'delivery' } });
    assert.equal(delivery.data.status, 'verified', JSON.stringify(delivery));
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)!.control!.executions[task.executionId]!.phase, 'ready');
    const outputPath = path.join(task.workspace.workspace, 'engineering/result.json');
    const outputSha256 = createHash('sha256').update(await readFile(outputPath)).digest('hex');
    const observations = host.ctx.hima.ledger.records({ runId: task.started.run.id, type: 'observation' })
      .filter((record) => record.type === 'observation').map((record) => [record.id, record.contentSha256]);
    await crashResidentWrapper(host, task.started.run.id, sitesDir);
    const status = await task.execute('verified-crash-status', 'engineering', { executionId: task.executionId, engineering: { operation: 'status' } });
    assert.equal(status.data.status, 'stopped', JSON.stringify(status));
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)!.control!.executions[task.executionId]!.phase, 'ready');
    const release = await task.execute('verified-crash-release', 'engineering', { executionId: task.executionId, engineering: { operation: 'release' } });
    assert.equal(release.data.status, 'released', JSON.stringify(release));
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)!.control!.executions[task.executionId]!.phase, 'ready');
    assert.equal(createHash('sha256').update(await readFile(outputPath)).digest('hex'), outputSha256);
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: task.started.run.id, type: 'observation' })
      .filter((record) => record.type === 'observation').map((record) => [record.id, record.contentSha256]), observations);
    const completed = await task.execute('verified-crash-complete', 'complete', { executionId: task.executionId });
    assert.equal(completed.kind, 'accepted', JSON.stringify(completed));
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)?.currentNode, 'read-qor');
    assert.equal(host.ctx.hima.ledger.records({ runId: task.started.run.id, type: 'node' })
      .filter((record) => record.type === 'node' && record.state === 'retrying').length, 0);
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('Run cancel after wrapper crash reconciles the retained native tree before ending and launches no retry', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  const sitesDir = path.join(fixture.h.home, 'hima/sites');
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH');
    await waitUntil('detached native descendant exists', async () => {
      try { return processIsAlive(Number((await readFile(fixture.descendantPid, 'utf8')).trim())); } catch { return false; }
    }, 10_000, 20);
    const descendant = Number((await readFile(fixture.descendantPid, 'utf8')).trim());
    await crashResidentWrapper(host, task.started.run.id, sitesDir);
    const cancelled = await task.execute('crash-run-cancel', 'cancel', {});
    assert.equal(cancelled.kind, 'accepted');
    await waitUntil('crashed-wrapper Run cancel finishes', () => host.ctx.hima.ledger.run(task.started.run.id)?.status === 'cancelled', 15_000, 20);
    await waitUntil('Run cancel stops detached descendant', () => !processIsAlive(descendant), 5_000, 20);
    const launches = jobsOf(host, task.started.run.id).filter((record) => record.event === 'launched');
    assert.equal(launches.length, 2, JSON.stringify(launches.map((record) => ({ name: record.job.name, session: record.job.session }))));
    assert.ok(launches.some((record) => record.job.name.startsWith('engineering-reconcile-')));
    assert.equal(host.ctx.hima.ledger.records({ runId: task.started.run.id, type: 'node' })
      .filter((record) => record.type === 'node' && record.state === 'retrying').length, 0,
      'crash cleanup never retries the engineering business action');
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('Host restart fences a finished resident wrapper instead of settling it as ordinary tool work', async (t) => {
  const fixture = await installResidentFixture(t);
  const sitesDir = path.join(fixture.h.home, 'hima/sites');
  let host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH');
    await waitUntil('detached native descendant exists', async () => {
      try { return processIsAlive(Number((await readFile(fixture.descendantPid, 'utf8')).trim())); } catch { return false; }
    }, 10_000, 20);
    const descendant = Number((await readFile(fixture.descendantPid, 'utf8')).trim());
    await crashResidentWrapper(host, task.started.run.id, sitesDir);
    await host.dispose();
    host = await bootInProcess(fixture.h);
    await host.ctx.hima.reconciled;
    const recovered = host.ctx.hima.executionContext(task.started.run.id);
    assert.equal(recovered.executions.find((execution) => execution.id === task.executionId)?.phase, 'uncertain');
    assert.match(recovered.executions.find((execution) => execution.id === task.executionId)?.reason ?? '', /same-task reconciliation|ordinary node settlement is refused/i);
    assert.equal(jobsOf(host, task.started.run.id).filter((record) => record.event === 'launched').length, 1,
      'Host restart launches neither a replacement wrapper nor business retry');
    assert.equal(host.ctx.hima.ledger.records({ runId: task.started.run.id, type: 'node' })
      .filter((record) => record.type === 'node' && ['done', 'retrying'].includes(record.state)).length, 0);
    // Desktop/Host exit is allowed to request mechanical cleanup. Whichever side won that race,
    // recovery above must be based on retained facts and must not settle/retry ordinary node work.
    const cleanup = await host.ctx.hima.cancelRun(task.started.run.id);
    assert.equal(cleanup.kind, 'cancelled', JSON.stringify(cleanup));
    await waitUntil('post-restart cancel stops detached descendant', () => !processIsAlive(descendant), 5_000, 20);
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('missing retained owner identity returns unknown, keeps the orphan fenced, and never replays business work', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  const sitesDir = path.join(fixture.h.home, 'hima/sites');
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH');
    await waitUntil('detached native descendant exists', async () => {
      try { return processIsAlive(Number((await readFile(fixture.descendantPid, 'utf8')).trim())); } catch { return false; }
    }, 10_000, 20);
    const descendant = Number((await readFile(fixture.descendantPid, 'utf8')).trim());
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    const ownedPath = path.join(taskDir, 'native/owned.json');
    const retainedOwned = await readFile(ownedPath);
    await crashResidentWrapper(host, task.started.run.id, sitesDir);
    await unlink(ownedPath);
    const unknown = await task.execute('missing-owner-status', 'engineering', { executionId: task.executionId, engineering: { operation: 'status' } });
    assert.equal(unknown.data.status, 'unknown', JSON.stringify(unknown));
    assert.match(unknown.data.reason, /ownership|identity|confirm/i);
    assert.equal(processIsAlive(descendant), true, 'missing identity cannot authorize killing an arbitrary retained PID');
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)?.status, 'running');
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)!.control!.executions[task.executionId]!.phase, 'uncertain');
    assert.ok(jobsOf(host, task.started.run.id).filter((record) => record.event === 'launched')
      .slice(1).every((record) => record.job.name.startsWith('engineering-reconcile-')));
    // Restore the exact signed authority only to clean this isolated fixture; the first request's
    // unknown receipt remains immutable and is not replayed.
    await writeFile(ownedPath, retainedOwned);
    const stopped = await task.execute('restored-owner-status', 'engineering', { executionId: task.executionId, engineering: { operation: 'status' } });
    assert.equal(stopped.data.status, 'stopped', JSON.stringify(stopped));
    await waitUntil('restored identity cleanup stops orphan', () => !processIsAlive(descendant), 5_000, 20);
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('pre-receipt Host crash retains task identity so restart can clean the same native task without replay', async (t) => {
  const fixture = await installResidentFixture(t);
  let host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: fixture.id, site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id), timeBoxMs: 60_000 });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return;
    const workspace = host.ctx.hima.ledger.records({ runId: started.run.id, type: 'workspace' })
      .findLast((record): record is WorkspaceRecord => record.type === 'workspace')!;
    const input = path.join(workspace.workspace, `flow/results/${fixture.flow.design}/syn/report/qor.rpt`);
    await mkdir(path.dirname(input), { recursive: true }); await writeFile(input, 'pre-receipt fixture input\n');
    const call = publicCaller(host, owner); const controlled = () => host.ctx.hima.ledger.run(started.run.id)!.control!;
    const begun = readToolResult(await call({ run: started.run.id, action: 'begin', requestId: 'pre-receipt-begin', nodeId: started.run.currentNode,
      expectedEpoch: controlled().epoch, expectedRevision: controlled().revision }));
    const executionId = begun.receipt.executionId as string;
    const advanceRun = host.ctx.hima.ledger.advanceRun.bind(host.ctx.hima.ledger);
    host.ctx.hima.ledger.advanceRun = async (...args) => {
      const request = args[1].control?.requests?.['pre-receipt-start'];
      const status = (request?.receipt.data as { status?: unknown } | undefined)?.status;
      if (status === 'started' || status === 'unknown') throw new Error('fixture Host crashed after launch before final start receipt');
      return advanceRun(...args);
    };
    const interrupted = await call({ run: started.run.id, action: 'engineering', requestId: 'pre-receipt-start', executionId,
      expectedEpoch: controlled().epoch, expectedRevision: controlled().revision,
      engineering: { operation: 'start', goal: 'SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH' } });
    host.ctx.hima.ledger.advanceRun = advanceRun;
    assert.equal(interrupted.isError, true, JSON.stringify(interrupted));
    const admitted = host.ctx.hima.ledger.run(started.run.id)!.control!.requests['pre-receipt-start']!;
    assert.equal(admitted.state, 'admitted');
    assert.equal((admitted.receipt.data as { status?: unknown }).status, 'admitted');
    assert.match(String((admitted.receipt.data as { capabilitySha256?: unknown }).capabilitySha256), /^[0-9a-f]{64}$/);
    assert.match(String((admitted.receipt.data as { taskEnvelopeSha256?: unknown }).taskEnvelopeSha256), /^[0-9a-f]{64}$/);
    await waitUntil('pre-receipt native descendant exists', async () => {
      try { return processIsAlive(Number((await readFile(fixture.descendantPid, 'utf8')).trim())); } catch { return false; }
    }, 10_000, 20);
    const descendant = Number((await readFile(fixture.descendantPid, 'utf8')).trim());
    assert.equal(jobsOf(host, started.run.id).filter((record) => record.event === 'launched').length, 1);
    await host.dispose();
    host = await bootInProcess(fixture.h);
    await host.ctx.hima.reconciled;
    const recovered = host.ctx.hima.executionContext(started.run.id);
    const recoveredExecution = recovered.executions.find((execution) => execution.id === executionId)!;
    assert.ok(['working', 'uncertain'].includes(recoveredExecution.phase), JSON.stringify(recoveredExecution));
    if (recoveredExecution.phase === 'uncertain') assert.match(recoveredExecution.reason ?? '', /same-task reconciliation|resident wrapper Job/i);
    assert.equal(recovered.run.control?.requests['pre-receipt-start']?.state, 'admitted');
    const cleanup = await host.ctx.hima.cancelRun(started.run.id);
    assert.equal(cleanup.kind, 'cancelled', JSON.stringify(cleanup));
    await waitUntil('pre-receipt retained identity cleanup stops orphan', () => !processIsAlive(descendant), 5_000, 20);
    const launches = jobsOf(host, started.run.id).filter((record) => record.event === 'launched');
    assert.equal(launches.filter((record) => record.job.name === 'engineering-synthesize').length, 1);
    assert.ok(launches.slice(1).every((record) => record.job.name.startsWith('engineering-reconcile-')),
      'restart cleanup may add one bounded reconcile Job but never another engineering business Job');
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});
