import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { checkPack, jobKill, jobStatus, launchJob, loadPack, loadSite, readRunAssets, readEngineeringAsset, channelFor, type JobRecord, type WorkspaceRecord } from '@hima/harness';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { packsDirOf, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { repoRoot } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';


// The production wrapper independently refuses the unsandboxed fixture unless this exact test-only
// switch is present. This test file runs in its own Node process, so keep it stable across concurrent
// top-level cases instead of racing per-test save/restore operations.
process.env.HIMA_RESIDENT_TESTING = '1';

const declaration = `    outsourcing:
      role: resident-engineering-agent
      reads: [qorReport]
      knowledge: [push-method.md]
      artifactPrefix: engineering
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
      role: 'resident-engineering-agent', reads: ['qorReport'], knowledge: ['push-method.md'],
      artifactPrefix: 'engineering', produces: 'qorReport',
    });
    const missing = checkPack(pack, loadSite(path.join(home.h.home, 'hima/sites'), 'local'));
    assert.equal(missing.fit, false);
    assert.ok(missing.errors.some((error) => /engineeringCapabilities/.test(error)), JSON.stringify(missing.errors));
    const historical = 'resident-engineering-historical-schema';
    await writePackVariant(packsDirOf(home.h), historical, [
      ['tools:\n', `knowledge:\n  - file: push-method.md\n    purpose: Engineering playbook.\n\ntools:\n`],
      ['    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n',
        `${declaration.replace('      artifactPrefix: engineering\n', '')}    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]\n`],
    ], [], undefined, { 'knowledge/push-method.md': '# Push method\n' });
    assert.equal(loadPack(packsDirOf(home.h), historical).contract.tools[0]?.outsourcing?.artifactPrefix, undefined,
      'preserved pre-artifactPrefix methods remain readable under the current schema');
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

test('public Host wakes the owner when a resident turn waits without a status poll or human prompt', async (t) => {
  const silent = process.env.HIMA_TEST_SILENT_AGENT;
  process.env.HIMA_TEST_SILENT_AGENT = '0';
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  let task: Awaited<ReturnType<typeof openResidentTask>> | undefined;
  let maintenance: Promise<void> | undefined;
  let owner: Awaited<ReturnType<typeof createRootAgent>> | undefined;
  let next: typeof owner;
  let nextMaintenance: Promise<void> | undefined;
  try {
    owner = await createRootAgent(host.ctx, fixture.h.workspace);
    maintenance = owner.runMaintenance(signal => new Promise<void>(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    task = await openResidentTask(host, fixture, owner, 'DELIVER_RESULT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    await waitUntil('resident native turn is actually waiting', async () => {
      try { return JSON.parse(await readFile(path.join(taskDir, 'state.json'), 'utf8')).phase === 'waiting'; }
      catch { return false; }
    }, 5_000, 20);
    await waitUntil('resident lifecycle queues an actionable owner turn without an owner status call',
      () => owner!.inbox.nextTurn.length > 0, 5_000, 20);
    const text = owner.inbox.nextTurn.flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n');
    assert.match(text, /resident.*waiting/i);
    assert.match(text, /engineering.*status/i);
    assert.equal(host.ctx.hima.executionContext(task.started.run.id).executions.find(e => e.id === task!.executionId)?.phase, 'working',
      'turn-end is neither Reader verification nor node completion');
    owner.inbox.clear();
    await new Promise(resolve => setTimeout(resolve, 2_100));
    assert.equal(owner.inbox.nextTurn.length, 0, 'unchanged waiting facts do not produce repeated turns');
    const sent = await task.execute('second-native-turn', 'engineering', { executionId: task.executionId,
      engineering: { operation: 'message', message: 'LONG_MESSAGE retain the same task and result' } });
    assert.equal(sent.data.status, 'accepted');
    next = await createRootAgent(host.ctx, fixture.h.workspace);
    nextMaintenance = next.runMaintenance(signal => new Promise<void>(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    const handoff = await task.execute('transfer-owner', 'handoff', { targetOwner: String(next.id) });
    assert.equal(handoff.kind, 'refused');
    assert.match(handoff.reason, /safe boundary/);
    const control = task.controlled();
    assert.equal((await host.ctx.hima.executionAction({ runId: task.started.run.id, actor: String(owner.id),
      expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: 'pause-after-transfer',
      action: 'pause', nodeId: task.started.run.currentNode })).kind, 'accepted');
    owner.inbox.clear(); next.inbox.clear();
    await new Promise(resolve => setTimeout(resolve, 1_100));
    assert.equal(owner.inbox.nextTurn.length, 0, 'running is not an actionable native boundary');
    await waitUntil('second turn wakes the current owner even while paused', () => owner!.inbox.nextTurn.length > 0, 8_000, 20);
    assert.equal(next.inbox.nextTurn.length, 0, 'a non-owner is not notified');
    assert.match(JSON.stringify(owner.inbox.nextTurn), /Resident engineering task.*waiting/);
    assert.ok(task.controlled().paused.includes(task.started.run.currentNode!));
    assert.equal(jobsOf(host, task.started.run.id).filter(row => row.event === 'launched').length, 1,
      'lifecycle observation launches no replacement task or Reader job');
  } finally {
    process.env.HIMA_TEST_SILENT_AGENT = '1';
    if (task) await host.ctx.hima.cancelRun(task.started.run.id).catch(() => undefined);
    owner?.cancel({ kind: 'hook', reason: 'resident notification test complete' });
    await maintenance;
    next?.cancel({ kind: 'hook', reason: 'resident notification test complete' });
    await nextMaintenance;
    await host.dispose(); await fixture.h.dispose();
    if (silent === undefined) delete process.env.HIMA_TEST_SILENT_AGENT; else process.env.HIMA_TEST_SILENT_AGENT = silent;
  }
});

test('Host recovery reattaches resident lifecycle observation without replaying the task', async (t) => {
  const silent = process.env.HIMA_TEST_SILENT_AGENT;
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  const fixture = await installResidentFixture(t);
  let host = await bootInProcess(fixture.h);
  let task: Awaited<ReturnType<typeof openResidentTask>> | undefined;
  let resumed: Awaited<ReturnType<typeof resumeTestAgent>> | undefined;
  let maintenance: Promise<void> | undefined;
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    task = await openResidentTask(host, fixture, owner, 'LONG_MESSAGE DELIVER_RESULT');
    const ownerId = String(owner.id);
    await host.dispose();
    host = await bootInProcess(fixture.h);
    await host.ctx.hima.reconciled;
    resumed = await resumeTestAgent(host.ctx, ownerId);
    maintenance = resumed.agent.runMaintenance(signal => new Promise<void>(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    process.env.HIMA_TEST_SILENT_AGENT = '0';
    await waitUntil('recovered waiting resident wakes its restored owner', () => resumed!.agent.inbox.nextTurn.length > 0, 10_000, 20);
    assert.match(JSON.stringify(resumed.agent.inbox.nextTurn), /Resident engineering task.*waiting/);
    assert.equal(jobsOf(host, task.started.run.id).filter(row => row.event === 'launched').length, 1);
    assert.equal(host.ctx.hima.executionContext(task.started.run.id).executions.find(e => e.id === task!.executionId)?.phase, 'working');
  } finally {
    process.env.HIMA_TEST_SILENT_AGENT = '1';
    if (task) await host.ctx.hima.cancelRun(task.started.run.id).catch(() => undefined);
    resumed?.agent.cancel({ kind: 'hook', reason: 'resident recovery test complete' });
    await maintenance; await resumed?.dispose();
    await host.dispose(); await fixture.h.dispose();
    if (silent === undefined) delete process.env.HIMA_TEST_SILENT_AGENT; else process.env.HIMA_TEST_SILENT_AGENT = silent;
  }
});

test('resident owner notification survives Reader-rejected native delivery and same-task repair', async (t) => {
  const silent = process.env.HIMA_TEST_SILENT_AGENT;
  process.env.HIMA_TEST_SILENT_AGENT = '0';
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  let task: Awaited<ReturnType<typeof openResidentTask>> | undefined;
  let owner: Awaited<ReturnType<typeof createRootAgent>> | undefined;
  let maintenance: Promise<void> | undefined;
  try {
    owner = await createRootAgent(host.ctx, fixture.h.workspace);
    maintenance = owner.runMaintenance(signal => new Promise<void>(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }));
    task = await openResidentTask(host, fixture, owner, 'DELIVER_BAD_RESULT');
    await waitUntil('initial bad result still finishes a native turn', () => owner!.inbox.nextTurn.length > 0, 5_000, 20);
    owner.inbox.clear();
    const rejected = await task.execute('reader-reject', 'engineering', {
      executionId: task.executionId, engineering: { operation: 'delivery' } });
    assert.equal(rejected.data.status, 'reader-rejected', JSON.stringify(rejected));
    await new Promise(resolve => setTimeout(resolve, 2_100));
    assert.equal(owner.inbox.nextTurn.length, 0, 'a delivery requested by the owner needs no duplicate wake-up');
    const repaired = await task.execute('repair-after-reader', 'engineering', {
      executionId: task.executionId, engineering: { operation: 'message', message: 'FIX_DELIVERY' } });
    assert.equal(repaired.data.status, 'accepted');
    await waitUntil('Reader repair completion still wakes the owner', () => owner!.inbox.nextTurn.length > 0, 5_000, 20);
    assert.match(JSON.stringify(owner.inbox.nextTurn), /Resident engineering task.*waiting/);
  } finally {
    process.env.HIMA_TEST_SILENT_AGENT = '1';
    if (task) await host.ctx.hima.cancelRun(task.started.run.id).catch(() => undefined);
    owner?.cancel({ kind: 'hook', reason: 'resident repair notification test complete' });
    await maintenance; await host.dispose(); await fixture.h.dispose();
    if (silent === undefined) delete process.env.HIMA_TEST_SILENT_AGENT; else process.env.HIMA_TEST_SILENT_AGENT = silent;
  }
});

test('ended resident Run assets expose verified files and checkpoint bytes without changing its archive or verdict', async (t) => {
  const legacy = process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0'; // Exercise production project authorization, not the old test-only global viewer.
  const fixture = await installResidentFixture(t);
  const binary = Buffer.from([0, 255, 10, 65]);
  const binaryHash = createHash('sha256').update(binary).digest('hex');
  const treeDigest = createHash('sha256').update(JSON.stringify([{ path: 'Ω/layout.oa', sha256: binaryHash, size: binary.length }])).digest('hex');
  const admin = path.join(fixture.h.workspace, 'resident-admin');
  const support = path.join(admin, 'retained-fixture');
  await mkdir(path.join(support, 'engineering/checkpoints/best/Ω'), { recursive: true });
  await writeFile(path.join(support, 'engineering/checkpoints/best/Ω/layout.oa'), binary);
  const resultSource = path.join(admin, 'referenced-result.json');
  await writeFile(resultSource, JSON.stringify({ schema: 'fixture-result/1', value: 'native',
    selected: { checkpoint: { path: '${NATIVE_ENGINEERING_PREFIX}/checkpoints/best', digest: treeDigest } },
    ignored: { path: '../private', sha256: binaryHash } }));
  const capability = path.join(admin, 'engineering-capabilities-v1.json');
  const config = JSON.parse(await readFile(capability, 'utf8'));
  config.environment.set.STANDIN_RESULT_SOURCE = resultSource;
  config.environment.set.STANDIN_ARTIFACT_SOURCE_ROOT = support;
  await writeFile(capability, JSON.stringify(config));
  const host = await bootInProcess(fixture.h);
  let closed = false;
  let web: Awaited<ReturnType<typeof bootHimaHost>> | undefined;
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_RESULT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    await waitUntil('native result ready for collection', async () => {
      try { return JSON.parse(await readFile(path.join(taskDir, 'state.json'), 'utf8')).phase === 'waiting'; }
      catch { return false; }
    }, 5_000, 20);
    const delivery = await task.execute('assets-delivery', 'engineering', { executionId: task.executionId, engineering: { operation: 'delivery' } });
    assert.equal(delivery.data.status, 'verified');
    assert.equal((await task.execute('assets-release', 'engineering', { executionId: task.executionId, engineering: { operation: 'release' } })).data.status, 'released');
    await host.ctx.hima.cancelRun(task.started.run.id);
    const before = JSON.stringify(host.ctx.hima.ledger.run(task.started.run.id));
    const deps = { ledger: host.ctx.hima.ledger, judge: host.ctx.hima.judge, sitesDir: path.join(fixture.h.home, 'hima/sites'), packsDir: packsDirOf(fixture.h) };
    const result = await readRunAssets(deps, task.started.run.id);
    assert.equal(result.kind, 'read', JSON.stringify(result)); if (result.kind !== 'read') return;
    const archiveBytes = await readFile(result.manifestPath);
    assert.ok(result.deliveries, 'normal archive surface must list the real retained delivery after Run end');
    assert.equal(result.deliveries.length, 1);
    const held = result.deliveries[0]!;
    assert.equal(held.executionId, task.executionId);
    const resultRef = held.artifacts.find(a => a.kind === 'result')!;
    const readAsset = (id: string, tree?: string) => readEngineeringAsset(deps, task.started.run.id, task.executionId, held.requestId, id, tree);
    const document = await readAsset(resultRef.id);
    assert.equal(document.kind, 'file'); if (document.kind !== 'file') return;
    assert.match(document.text!, /fixture-result/);
    assert.ok(!document.references.some(ref => ref.path.includes('../private')), 'an escaping model reference grants no access');
    const checkpointRef = document.references.find(ref => ref.kind === 'directory'); assert.ok(checkpointRef);
    const tree = await readAsset(checkpointRef.id);
    assert.equal(tree.kind, 'directory'); if (tree.kind !== 'directory') return;
    assert.equal(tree.entries.length, 1);
    const member = tree.entries[0]!;
    const bytes = await readAsset(member.id, member.treeId);
    assert.equal(bytes.kind, 'file'); if (bytes.kind !== 'file') return;
    assert.equal(bytes.text, undefined, 'binary data is not rendered as corrupt UTF-8');
    assert.deepEqual(Buffer.from(bytes.bytes), binary);
    await assert.rejects(readAsset('../private'), /not a retained result reference/);
    await assert.rejects(readEngineeringAsset(deps, task.started.run.id, 'other-execution', held.requestId, member.id), /no verified engineering delivery/);
    const nativeMember = path.join(taskDir, 'workspace/engineering/checkpoints/best/Ω/layout.oa');
    await writeFile(nativeMember, 'changed');
    await assert.rejects(readAsset(tree.ref.id), /tree differs/);
    await unlink(nativeMember);
    const outside = path.join(fixture.h.workspace, 'outside.oa'); await writeFile(outside, binary); await symlink(outside, nativeMember);
    await assert.rejects(readAsset(tree.ref.id), /link/);
    await unlink(nativeMember); await writeFile(nativeMember, binary);
    const checkpoints = path.join(taskDir, 'workspace/engineering/checkpoints');
    await rename(checkpoints, `${checkpoints}-real`); await symlink(`${checkpoints}-real`, checkpoints);
    let intermediateRejected = false;
    try { await readAsset(tree.ref.id); } catch (error) { intermediateRejected = /symlink|ancestor|link/.test(String(error)); }
    await unlink(checkpoints); await rename(`${checkpoints}-real`, checkpoints);
    await truncate(nativeMember, 256 * 1024 * 1024 + 1);
    let oversizeRejected = false;
    try { await readAsset(tree.ref.id); } catch (error) { oversizeRejected = /file\/byte limit/.test(String(error)); }
    await writeFile(nativeMember, binary);
    assert.deepEqual({ intermediateRejected, oversizeRejected }, { intermediateRejected: true, oversizeRejected: true },
      'intermediate aliases and excessive size are rejected before tree hashing/transfer');
    const inputRef = document.references.find(ref => ref.path.endsWith('qor.rpt')); assert.ok(inputRef, 'declared task input provenance remains readable after end');
    const input = await readAsset(inputRef.id); assert.equal(input.kind, 'file');
    if (input.kind === 'file') assert.match(input.text!, /fixture input retained/);
    const channel = channelFor(loadSite(deps.sitesDir, 'local'));
    await assert.rejects(channel.exec(['find', taskDir, '-delete']), /only find/);
    await assert.rejects(channel.exec(['find', taskDir, '-exec', 'echo', 'unsafe']), /only find/);
    assert.equal(JSON.stringify(host.ctx.hima.ledger.run(task.started.run.id)), before);
    assert.deepEqual(await readFile(result.manifestPath), archiveBytes, 'new read projections do not rewrite the original archive');
    await host.dispose(); closed = true;
    web = await bootHimaHost(fixture.h);
    const cookie = await openSession(web), viewer = await createLiveSession(web, cookie, fixture.h.workspace);
    const query = new URLSearchParams({ sessionId: viewer, execution: task.executionId, delivery: held.requestId, artifact: member.id, tree: member.treeId!, format: 'download' });
    const download = await api(web, cookie, `/hima/api/runs/${task.started.run.id}/assets?${query}`);
    assert.equal(download.status, 200, download.status === 200 ? '' : await download.text());
    assert.match(download.headers.get('content-type') ?? '', /application\/octet-stream/);
    assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), binary, 'public Host download preserves every binary byte');
    query.set('artifact', tree.ref.id); query.delete('tree');
    const folderDownload = await api(web, cookie, `/hima/api/runs/${task.started.run.id}/assets?${query}`);
    assert.equal(folderDownload.status, 200, folderDownload.status === 200 ? '' : await folderDownload.text());
    const tarFile = path.join(fixture.h.workspace, 'downloaded-checkpoint.tar');
    await writeFile(tarFile, Buffer.from(await folderDownload.arrayBuffer()));
    const extracted = spawnSync('tar', ['-xOf', tarFile, './Ω/layout.oa']);
    assert.equal(extracted.status, 0, extracted.stderr.toString());
    assert.deepEqual(extracted.stdout, binary, 'one checkpoint download retains paths and bytes');
    const foreignWorkspace = path.join(fixture.h.home, 'foreign-workspace'); await mkdir(foreignWorkspace);
    const foreign = await createLiveSession(web, cookie, foreignWorkspace); query.set('sessionId', foreign);
    const denied = await api(web, cookie, `/hima/api/runs/${task.started.run.id}/assets?${query}`);
    assert.equal(denied.status, 403, 'another project cannot read engineering artifacts');
    assert.deepEqual(await readFile(result.manifestPath), archiveBytes);
  } finally {
    if (web) await web.stop();
    if (!closed) await host.dispose();
    await fixture.h.dispose();
    if (legacy === undefined) delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE; else process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = legacy;
  }
});

test('checkpoint inventory caps transport output before retaining an unbounded listing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hima-inventory-output-'));
  const prior = process.env.PATH;
  try {
    const fakeFind = path.join(dir, 'find');
    await writeFile(fakeFind, '#!/usr/bin/env python3\nimport os\nos.write(1, b"x" * (4 * 1024 * 1024 + 4096))\n');
    await chmod(fakeFind, 0o755);
    process.env.PATH = `${dir}:${prior ?? ''}`;
    const { LocalChannel } = await import('@hima/harness');
    await assert.rejects(new LocalChannel('inventory-fixture').exec(['find', dir, '-maxdepth', '33', '-mindepth', '1', '-print0']), /byte output limit/);
  } finally {
    if (prior === undefined) delete process.env.PATH; else process.env.PATH = prior;
    await rm(dir, { recursive: true, force: true });
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
    const envelope = JSON.parse(await readFile(path.join(taskDir, 'task.json'), 'utf8'));
    assert.equal(envelope.delivery.artifactPrefix, 'engineering', 'the executor must receive the Host-enforced support destination prefix');
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
    assert.equal(await readFile(path.join(workspace.workspace, 'engineering/support.txt'), 'utf8'),
      'nested retained engineering support\n', 'all manifest files are materialized for Reader/checkpoint references');
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

test('delivery preflight cannot overwrite Campaign authority outside the Pack artifact prefix', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_RESULT OUTSIDE_PREFIX');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    const protectedPath = path.join(task.workspace.workspace, 'state/protected.json');
    await mkdir(path.dirname(protectedPath), { recursive: true });
    await writeFile(protectedPath, 'Campaign authority\n');
    await waitUntil('outside-prefix native candidate', async () => {
      try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; } catch { return false; }
    }, 10_000, 20);
    const answer = await task.call({ run: task.started.run.id, action: 'engineering', requestId: 'outside-prefix-delivery',
      executionId: task.executionId, expectedEpoch: task.controlled().epoch, expectedRevision: task.controlled().revision,
      engineering: { operation: 'delivery' } });
    assert.equal(answer.isError, false, JSON.stringify(answer));
    const rejected = readToolResult(answer);
    assert.equal((rejected.data ?? rejected.receipt?.data)?.status, 'rejected', 'a known pre-write validation failure is not an uncertain Campaign copy');
    assert.equal(task.controlled().requests['outside-prefix-delivery'].state, 'done');
    assert.match(answer.content.filter((item) => item.type === 'text').map((item) => item.text).join(''), /outside Pack prefix engineering/);
    assert.equal(await readFile(protectedPath, 'utf8'), 'Campaign authority\n');
    await assert.rejects(readFile(path.join(task.workspace.workspace, 'engineering/result.json')), { code: 'ENOENT' },
      'complete manifest preflight occurs before the result output is written');
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('resident status exposes the completed native public reply to its owner', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_RESULT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    await waitUntil('native public reply completed', async () => {
      try { return JSON.parse(await readFile(path.join(taskDir, 'state.json'), 'utf8')).phase === 'waiting'; } catch { return false; }
    }, 10_000, 20);
    const status = await task.execute('read-native-reply', 'engineering', { executionId: task.executionId, engineering: { operation: 'status' } });
    assert.equal(status.data.state.detail.reply?.text, 'done', 'phase/end_turn alone loses the reply that explains readiness or blockers');
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('repair must use a fresh revisioned support path instead of mutating a published tree member', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_RESULT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    const supportPath = path.join(task.workspace.workspace, 'engineering/support.txt');
    await mkdir(path.dirname(supportPath), { recursive: true });
    await writeFile(supportPath, 'earlier immutable revision\n');
    await waitUntil('mutable-support native candidate', async () => {
      try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; } catch { return false; }
    }, 10_000, 20);
    const answer = await task.call({ run: task.started.run.id, action: 'engineering', requestId: 'mutable-support-delivery',
      executionId: task.executionId, expectedEpoch: task.controlled().epoch, expectedRevision: task.controlled().revision,
      engineering: { operation: 'delivery' } });
    assert.equal(answer.isError, false, JSON.stringify(answer));
    assert.match(answer.content.filter((item) => item.type === 'text').map((item) => item.text).join(''), /fresh revisioned artifact path/);
    assert.equal(await readFile(supportPath, 'utf8'), 'earlier immutable revision\n');
    await assert.rejects(readFile(path.join(task.workspace.workspace, 'engineering/result.json')), { code: 'ENOENT' });
  } finally {
    await host.dispose(); await fixture.h.dispose();
  }
});

test('artifact prefix must be a plain directory and cannot resolve through a Campaign symlink', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_RESULT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    const stateDir = path.join(task.workspace.workspace, 'state');
    await mkdir(stateDir, { recursive: true });
    await symlink(stateDir, path.join(task.workspace.workspace, 'engineering'));
    await waitUntil('symlink-prefix native candidate', async () => {
      try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; } catch { return false; }
    }, 10_000, 20);
    const answer = await task.call({ run: task.started.run.id, action: 'engineering', requestId: 'symlink-prefix-delivery',
      executionId: task.executionId, expectedEpoch: task.controlled().epoch, expectedRevision: task.controlled().revision,
      engineering: { operation: 'delivery' } });
    assert.equal(answer.isError, false, JSON.stringify(answer));
    assert.match(answer.content.filter((item) => item.type === 'text').map((item) => item.text).join(''), /plain non-symlink directory/);
    await assert.rejects(readFile(path.join(stateDir, 'result.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(stateDir, 'support.txt')), { code: 'ENOENT' });
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
    assert.equal(released.data.nextAction, undefined, 'cancelled cleanup must not recommend successful node completion');
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
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)!.control!.executions[task.executionId]!.reason, undefined,
      'a repaired delivery must clear the earlier Reader rejection from the current execution');
    const latestManifest = JSON.parse(await readFile(path.join(taskDir, 'delivery/manifest.json'), 'utf8'));
    assert.notEqual(latestManifest.sha256, firstManifest.sha256);
    assert.deepEqual(JSON.parse(await readFile(firstManifestPath, 'utf8')), firstManifest, 'the first rejected manifest remains immutable');
    assert.equal(createHash('sha256').update(firstArtifact).digest('hex'), firstManifest.artifacts[0].sha256,
      'the first Reader-rejected artifact bytes remain verifiable after repair');
    assert.equal(firstManifest.sessionId, latestManifest.sessionId, 'repair stayed in the original native session');
    const release = await task.execute('repair-release', 'engineering', { executionId: task.executionId, engineering: { operation: 'release' } });
    assert.equal(release.data.status, 'released', JSON.stringify(release));
    assert.equal(release.data.nextAction, 'complete');
    assert.equal(release.data.executionId, task.executionId);
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

test('paused verified delivery and release retain facts without recommending completion', async (t) => {
  const fixture = await installResidentFixture(t);
  const host = await bootInProcess(fixture.h);
  try {
    const owner = await createRootAgent(host.ctx, fixture.h.workspace);
    const task = await openResidentTask(host, fixture, owner, 'DELIVER_RESULT');
    const taskDir = path.join(task.workspace.workspace, '.hima-engineering', task.engineering.data.taskId);
    await waitUntil('paused task candidate', async () => {
      try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; } catch { return false; }
    }, 10_000, 20);
    await task.execute('hold-before-delivery', 'pause', {});
    const delivery = await task.execute('held-delivery', 'engineering', { executionId: task.executionId, engineering: { operation: 'delivery' } });
    assert.equal(delivery.data.status, 'verified');
    assert.doesNotMatch(delivery.reason, /then call action complete/, 'paused delivery does not recommend completing the held execution');
    assert.match(delivery.reason, /hold|paused|control/);
    const release = await task.execute('held-release', 'engineering', { executionId: task.executionId, engineering: { operation: 'release' } });
    assert.equal(release.data.status, 'released');
    assert.equal(release.data.nextAction, undefined);
    assert.equal((await task.execute('held-complete', 'complete', { executionId: task.executionId })).kind, 'refused');
    assert.equal(host.ctx.hima.ledger.run(task.started.run.id)!.control!.executions[task.executionId]!.phase, 'ready');
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
    assert.equal(release.data.nextAction, 'complete');
    assert.equal(release.data.executionId, task.executionId);
    assert.match(release.reason, /does not complete/);
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
