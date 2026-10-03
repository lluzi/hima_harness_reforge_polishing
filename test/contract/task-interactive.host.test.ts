// @hima-seam tools wrapped
// Real private PostgreSQL + tmux + Tcl. Native child grants are Host-authored fixture facts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { repoRoot } from './support/dsh-home.ts';
const lib = process.env.HIMA_DBOS_TEST_LIB ?? path.join(repoRoot, 'packages/harness/lib');
const at = (name: string) => import(pathToFileURL(path.join(lib, `${name}.js`)).href);
const { startLocalDatabase } = await at('local-database');
const { startDurableRuntime } = await at('durable-runtime');
const { jsonDigest } = await at('run-store');
const { loadPack } = await at('packs');
const { packDigestExcludes } = await at('pack-folder');
const { loadSite } = await at('sites');
const { LocalChannel } = await at('channel');
const { createInteractiveBindingBridge, interactiveCommandsDigest, BUILTIN_TCL_ADAPTER_DIGEST } = await at('interactive-binding');
const { operateTaskInteractive, taskInteractiveDelegationGrant, readTaskInteractiveOperation, listTaskInteractiveSessions, closeTaskInteractiveSessions } = await at('task-interactive');

// This process owns one temporary database and all retained native session names in its facts.
test('PG Operator retains Tcl identity, mutation scope and physical licence through commands, recovery and control races', { timeout: 90000 }, async (t) => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'hima-u4-interactive-')));
  const workspace = path.join(home, 'work'), sitesDir = path.join(home, 'sites'), packsDir = path.join(home, 'packs');
  const packDir = path.join(packsDir, 'operator-fixture'), admin = path.join(home, 'admin');
  await Promise.all([mkdir(workspace), mkdir(sitesDir), mkdir(path.join(packDir, 'tools'), { recursive: true }), mkdir(admin)]);
  const script = path.join(packDir, 'tools/repl.tcl');
  await writeFile(script, `set workspace [lindex $argv 0]\nset value 0\nproc get_value {} {global value; return $value}\nproc set_value {plan number} {global value workspace; set value $number; set f [open [file join $workspace calls] a]; puts $f $number; close $f; return $value}\nproc save_state {} {global value workspace; set f [open [file join $workspace saved] w]; puts $f $value; close $f; return saved}\nputs "HIMA:hima-tcl-line-v1:1:READY"\nflush stdout\nwhile {[gets stdin line] >= 0} {if {[catch {uplevel #0 $line} answer]} {puts stderr $answer}; flush stdout; flush stderr}\n`);
  await writeFile(path.join(packDir, 'contract.yml'), stringify({ id: 'operator-fixture', version: '1', title: 'Bounded Tcl Operator', strategy: {}, inputs: [{ name: 'workspaceRoot' }], outputs: [], environment: { wrappers: ['/usr/bin/tclsh'] }, workspace: { copy: [] }, tools: [{ id: 'operate', file: 'tools/repl.tcl', inputs: ['WORKSPACE'], argv: ['/usr/bin/tclsh', script, '${WORKSPACE}'], licences: { fixture: 1 }, interactive: { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', closeGraceMs: 2000, commands: { read: ['get_value'], mutate: ['set_value'], save: ['save_state'] }, arguments: { get_value: [], set_value: [{ name: 'planSha256', type: 'string' }, { name: 'value', type: 'number' }], save_state: [] } } }] }));
  await writeFile(path.join(packDir, 'graph.yml'), stringify({ schema: 'hima-flow/1', id: 'operator-fixture', version: '1', flow: { kind: 'task', id: 'operate', tool: 'operate', inputs: {}, contract: { input: { version: '1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } }, output: { version: '1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } } } } }));
  await writeFile(path.join(sitesDir, 'local.permit.yml'), stringify({ allowedReadRoots: [workspace, packDir, admin], allowedWriteRoots: [workspace], allowedWrappers: ['/usr/bin/tclsh'], forbidden: ['services', 'licences', 'network', 'deletions', 'downloads'] }));
  await writeFile(path.join(sitesDir, 'local.yml'), stringify({ name: 'local', kind: 'local', workspaceRoot: workspace, permit: './local.permit.yml', bindings: { workspaceRoot: workspace }, capacity: { cores: 1, memoryGiB: 1, parallelJobs: 1, licences: { fixture: 1 } } }));
  const pack = loadPack(packsDir, 'operator-fixture'), site = loadSite(sitesDir, 'local'), packSha256 = pack.folder.digest(packDigestExcludes);
  const environmentFile = path.join(admin, 'environment.json'), bindingsFile = path.join(admin, 'bindings.json');
  await writeFile(environmentFile, 'explicit local Tcl test environment\n');
  const { createHash } = await import('node:crypto');
  const actualEnvironmentDigest = createHash('sha256').update(await readFile(environmentFile)).digest('hex');
  const row = { id: 'operator-fixture-binding', site: 'local', packDigest: packSha256, toolId: 'operate', adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(pack.contract.tools[0]), environment: { id: 'tcl-test', file: environmentFile, sha256: actualEnvironmentDigest }, mutation: 'qualified' };
  await writeFile(bindingsFile, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [row] }));
  const database = await startLocalDatabase({ home, runtimeDirectory: process.env.HIMA_POSTGRES_RUNTIME });
  const manifest = { files: { 'interactive-fixture': '4'.repeat(64) }, adapters: { interactive: '1' } };
  let runtime = await startDurableRuntime({ database, manifest });
  let bridge = createInteractiveBindingBridge({ packsDir, sitesDir, interactiveBindingsFile: bindingsFile });
  let deps: any;
  const resolve = async (identity: any, grant: any) => bridge.resolve({ pack, run: { id: identity.runId, packId: pack.id, packDigest: packSha256, campaignId: 'fixture', siteId: 'local', strategy: {}, generation: 1 }, execution: { id: grant.executionId, nodeId: grant.nodeId, kind: 'act', methodDigest: packSha256, attempt: 1 }, site: loadSite(sitesDir, 'local'), workspace, node: { id: 'operate', kind: 'act', parameters: { tool: 'operate', arguments: {} } } });
  const resetDeps = () => { deps = { store: runtime.store, sitesDir, bridge, resolveOperation: resolve, trustedTestQualification: { bindingId: row.id } }; };
  resetDeps();
  const originalExec = LocalChannel.prototype.exec;
  let actor = 'operator-one', identity: any, admission: any;
  const identities: any[] = [];
  const target = { executionId: 'execution', nodeId: 'operate' }, planSha256 = 'a'.repeat(64);
  const installGrant = async (name: string, child: string, maxMutations = 3) => {
    const run = await runtime.store.createRun({ runId: name, owner: 'owner', inputSha256: jsonDigest({ name }), applicationVersion: runtime.applicationVersion, deadlineAt: new Date(Date.now() + 120000).toISOString(), data: {} });
    const id = { runId: name, taskId: 'operate', effectId: `effect-${name}`, inputSha256: run.inputSha256, packSha256, irSha256: 'b'.repeat(64), applicationVersion: runtime.applicationVersion, adapterVersion: '1' };
    const adm = { runId: name, effectId: id.effectId, owner: run.owner, epoch: run.epoch, revision: run.revision };
    await runtime.store.prepareExternalEffect(id, { kind: 'team' });
    const operator = await taskInteractiveDelegationGrant(deps, id, adm, target);
    await runtime.store.recordExternalEffectFact(id, `child:${child}:intent`, { effective: { role: 'operator', childSessionId: child, parentSessionId: 'owner', workspace, operator, recipe: { inlinePayload: { mode: 'scope', sourceResultRecordId: 'reviewed-plan', adoptionRecordId: 'adoption', planSha256, planHashArgument: 'planSha256', scope: { commands: ['set_value'], maxMutations } } } }, deadlineAt: new Date(Date.now() + 120000).toISOString(), guard: { sitesDir, siteId: 'local', siteDigest: jsonDigest(site), admission: adm } });
    identities.push(id); return { id, adm, operator };
  };
  const call = (action: string, requestId: string, extra = {}) => operateTaskInteractive(deps, actor, { action, requestId, runId: identity.runId, ...target, ownerEpoch: admission.epoch, controlRevision: admission.revision, ...extra });
  try {
    // Identified evidence without enforcing confinement must refuse before any native launch.
    const run = await runtime.store.createRun({ runId: 'qualification', owner: 'owner', inputSha256: jsonDigest({}), applicationVersion: runtime.applicationVersion, deadlineAt: '2099-01-01T00:00:00.000Z', data: {} });
    const id = { runId: run.runId, taskId: 'operate', effectId: 'effect-qualification', inputSha256: run.inputSha256, packSha256, irSha256: 'b'.repeat(64), applicationVersion: runtime.applicationVersion, adapterVersion: '1' };
    await runtime.store.prepareExternalEffect(id, { kind: 'team' });
    await assert.rejects(taskInteractiveDelegationGrant(deps, id, { runId: run.runId, effectId: id.effectId, owner: 'owner', epoch: 0, revision: 0 }, target), /confinement|production/);
    process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = row.id;
    ({ id: identity, adm: admission } = await installGrant('many-commands', actor));
    await runtime.stop(); runtime = await startDurableRuntime({ database, manifest }); resetDeps();
    delete deps.resolveOperation;
    const opened = await call('open', 'open-one'); assert.equal(opened.status, 'opened', JSON.stringify(opened)); assert.equal(opened.readiness, 'ready');
    const session = opened.session.toolSessionId;
    assert.equal((await call('status', 'status-running', { toolSessionId: session })).process, 'running');
    deps.resolveOperation = resolve;
    const competitor = await installGrant('capacity-competitor', 'operator-capacity');
    const capacityRequest = { action: 'open', requestId: 'capacity-open', runId: competitor.id.runId, ...target, ownerEpoch: 0, controlRevision: 0 };
    assert.match((await operateTaskInteractive(deps, 'operator-capacity', capacityRequest)).reason, /capacity/);
    for (let n = 0; n < 5; n++) { const result = await call('input', `read-${n}`, { toolSessionId: session, commandId: `read-${n}`, command: { name: 'get_value', args: {} }, waitMs: 1000 }); assert.equal(result.status, 'completed', JSON.stringify(result)); }
    for (let n = 1; n <= 2; n++) assert.equal((await call('input', `mutate-${n}`, { toolSessionId: session, commandId: `mutate-${n}`, command: { name: 'set_value', args: { planSha256, value: n } }, waitMs: 1000 })).status, 'completed');
    assert.equal((await call('input', 'wrong-plan', { toolSessionId: session, commandId: 'wrong-plan', command: { name: 'set_value', args: { planSha256: 'c'.repeat(64), value: 99 } } })).status, 'refused');
    assert.equal((await call('input', 'changed-id', { toolSessionId: session, commandId: 'mutate-1', command: { name: 'set_value', args: { planSha256, value: 99 } } })).status, 'refused');
    // PG reopen does not reset the allocation or replace native session or original deadline.
    const before = (await listTaskInteractiveSessions(runtime.store, identity))[0];
    await runtime.stop(); runtime = await startDurableRuntime({ database, manifest }); resetDeps();
    const after = (await listTaskInteractiveSessions(runtime.store, identity))[0]; assert.equal(after.toolSessionId, before.toolSessionId); assert.equal(after.sessionDeadlineAt, before.sessionDeadlineAt);
    assert.equal((await call('open', 'open-one')).session.toolSessionId, session);
    assert.equal((await call('input', 'mutate-3', { toolSessionId: session, commandId: 'mutate-3', command: { name: 'set_value', args: { planSha256, value: 3 } }, waitMs: 1000 })).status, 'completed');
    assert.equal((await call('input', 'scope-exhausted', { toolSessionId: session, commandId: 'scope-exhausted', command: { name: 'set_value', args: { planSha256, value: 4 } } })).status, 'refused');
    assert.equal(await readFile(path.join(workspace, 'calls'), 'utf8'), '1\n2\n3\n');
    // An actual late pause after staging and before paste makes zero typed mutation.
    let paused = false;
    LocalChannel.prototype.exec = async function(argv: any, options: any) {
      const result = await originalExec.call(this, argv, options);
      if (!paused && argv[0] === 'tmux' && argv[1] === 'load-buffer' && Buffer.from(options?.stdin ?? []).toString().includes('save_state')) { paused = true; await runtime.store.command({ runId: identity.runId, commandId: 'late-pause', action: 'pause', owner: 'owner', epoch: 0, revision: 0 }); }
      return result;
    };
    const late = await call('input', 'late-pause-input', { toolSessionId: session, commandId: 'late-pause-command', command: { name: 'save_state', args: {} }, waitMs: 1000 }); assert.equal(late.status, 'outcome-unknown');
    LocalChannel.prototype.exec = originalExec;
    await assert.rejects(readFile(path.join(workspace, 'saved')), /ENOENT/);
    assert.equal((await call('read', 'read-under-pause', { toolSessionId: session })).status, 'read');
    assert.equal((await call('signal', 'signal-under-pause', { toolSessionId: session, signal: 'interrupt' })).status, 'delivered');
    assert.equal((await call('close', 'close-under-pause', { toolSessionId: session })).status, 'closed');
    assert.equal((await runtime.store.effectResources()).filter((lease: any) => lease.effectId.includes(':interactive:') && !lease.released).length, 0);
    const capacityOpen = await operateTaskInteractive(deps, 'operator-capacity', capacityRequest); assert.equal(capacityOpen.status, 'opened', JSON.stringify(capacityOpen));
    assert.equal((await operateTaskInteractive(deps, 'operator-capacity', { ...capacityRequest, action: 'close', requestId: 'capacity-close', toolSessionId: capacityOpen.session.toolSessionId })).status, 'closed');
    // Lost submission ACK retains protocol token and exposes explicit observation without resend.
    actor = 'operator-lost'; ({ id: identity, adm: admission } = await installGrant('lost-ack', actor, 1));
    const second = await call('open', 'open-lost'); assert.equal(second.status, 'opened'); const secondSession = second.session.toolSessionId;
    let lost = false;
    LocalChannel.prototype.exec = async function(argv: any, options: any) {
      const result = await originalExec.call(this, argv, options);
      if (!lost && argv[0] === 'tmux' && argv[1] === 'send-keys' && argv.at(-1) === 'Enter') { lost = true; throw new Error('Fixture dropped original tmux ACK after actual Enter'); }
      return result;
    };
    const mutation = { toolSessionId: secondSession, commandId: 'once-command', command: { name: 'set_value', args: { planSha256, value: 7 } }, waitMs: 1000 };
    assert.equal((await call('input', 'once-request', mutation)).status, 'outcome-unknown'); LocalChannel.prototype.exec = originalExec;
    const retained = (await listTaskInteractiveSessions(runtime.store, identity))[0].activeCommand;
    await runtime.stop(); runtime = await startDurableRuntime({ database, manifest }); resetDeps();
    assert.equal((await call('input', 'once-request', mutation)).status, 'outcome-unknown');
    assert.equal((await listTaskInteractiveSessions(runtime.store, identity))[0].activeCommand.protocolToken, retained.protocolToken);
    assert.equal((await call('observe', 'observe-original', { toolSessionId: secondSession, commandId: 'once-command', waitMs: 1000 })).status, 'completed');
    assert.equal(await readFile(path.join(workspace, 'calls'), 'utf8'), '1\n2\n3\n7\n');
    assert.equal((await call('input', 'once-request', mutation)).outcome, 'completed');
    await runtime.store.command({ runId: identity.runId, commandId: 'handoff', action: 'handoff', owner: 'owner', epoch: 0, revision: 0, nextOwner: 'successor' });
    assert.equal((await call('input', 'stale-owner', { toolSessionId: secondSession, commandId: 'stale-owner', command: { name: 'save_state', args: {} } })).status, 'refused');
    assert.equal((await call('status', 'status-under-handoff', { toolSessionId: secondSession })).status, 'status');
    await runtime.store.command({ runId: identity.runId, commandId: 'continue-new-owner', action: 'continue', owner: 'successor', epoch: 1, revision: 0 });
    assert.equal((await call('input', 'stale-after-continue', { toolSessionId: secondSession, commandId: 'stale-after-continue', command: { name: 'save_state', args: {} } })).status, 'refused');
    admission = { ...admission, owner: 'successor', epoch: 2 };
    await runtime.store.assertEffectAdmission(admission, async () => true);
    await runtime.store.recordExternalEffectFact(identity, `admission:${actor}:authorized-new-owner`, { admission });
    const freshOwner = await call('input', 'new-owner-save', { toolSessionId: secondSession, commandId: 'new-owner-save', command: { name: 'save_state', args: {} }, waitMs: 1000 });
    assert.equal(freshOwner.status, 'completed', JSON.stringify(freshOwner));
    await runtime.store.command({ runId: identity.runId, commandId: 'cancel-new-owner', action: 'cancel', owner: 'successor', epoch: 2, revision: 0 });
    const closure = await closeTaskInteractiveSessions(deps, actor); assert.equal(closure.closed, true, JSON.stringify(closure));
    assert.equal(closure.proof.resources.length, 1); assert.equal(closure.proof.resources[0].proof.closed, true);
    assert.equal((await closeTaskInteractiveSessions(deps, actor)).closed, true);
    assert.equal((await runtime.store.effectResources()).filter((lease: any) => lease.effectId.includes(':interactive:') && !lease.released).length, 0);
    // Lost physical close acknowledgement queries the same stop request after PG reopen.
    actor = 'operator-close-ack'; ({ id: identity, adm: admission } = await installGrant('close-lost-ack', actor));
    const third = await call('open', 'open-close-ack'); assert.equal(third.status, 'opened');
    let closeLost = false;
    LocalChannel.prototype.exec = async function(argv: any, options: any) {
      const result = await originalExec.call(this, argv, options);
      if (!closeLost && argv[0] === 'tmux' && argv[1] === 'respawn-pane') { closeLost = true; throw new Error('Fixture dropped actual original stop ACK'); }
      return result;
    };
    const closeRequest = { toolSessionId: third.session.toolSessionId };
    assert.equal((await call('close', 'same-close-request', closeRequest)).status, 'uncertain'); LocalChannel.prototype.exec = originalExec;
    await runtime.stop(); runtime = await startDurableRuntime({ database, manifest }); resetDeps();
    let closed: any;
    for (let n = 0; n < 100; n++) { closed = await call('close', 'same-close-request', closeRequest); if (closed.process === 'exited') break; await new Promise(resolve => setTimeout(resolve, 25)); }
    assert.equal(closed.status, 'duplicate', JSON.stringify(closed)); assert.equal(closed.process, 'exited');
    assert.equal((await runtime.store.effectResources()).filter((lease: any) => lease.effectId.includes(':interactive:') && !lease.released).length, 0);
    // A lost native session creation ACK preserves the exact original inert session, then
    // reconnects its PID for cleanup. It never replays startup or allocates another tmux Job.
    actor = 'operator-open-ack'; ({ id: identity, adm: admission } = await installGrant('open-lost-ack', actor));
    let openLost = false, nativeCreates = 0;
    LocalChannel.prototype.exec = async function(argv: any, options: any) {
      const result = await originalExec.call(this, argv, options);
      if (argv[0] === 'tmux' && argv[1] === 'new-session') { nativeCreates++; if (!openLost) { openLost = true; throw new Error('Fixture dropped original tmux creation ACK'); } }
      return result;
    };
    assert.equal((await call('open', 'same-open-request')).status, 'uncertain');
    const originalOpen = (await listTaskInteractiveSessions(runtime.store, identity))[0]; assert.equal(originalOpen.job.pid, undefined);
    await runtime.stop(); runtime = await startDurableRuntime({ database, manifest }); resetDeps(); delete deps.resolveOperation;
    const openReplay = await call('open', 'same-open-request'); assert.equal(openReplay.status, 'uncertain'); assert.equal(openReplay.session.toolSessionId, originalOpen.toolSessionId); assert.equal(nativeCreates, 1);
    LocalChannel.prototype.exec = originalExec;
    assert.equal((await closeTaskInteractiveSessions(deps, actor)).closed, true);
    assert.equal((await runtime.store.effectResources()).filter((lease: any) => lease.effectId.includes(':interactive:') && !lease.released).length, 0);
    // Hashed phases are identities, not activity order. Retain the fixture's original idle
    // limit across PG recovery and use real completed Tcl commands with a controlled date.
    actor = 'operator-idle-order';
    const idleMaxMs = 1000, clockStart = Date.now();
    t.mock.timers.enable({ apis: ['Date'], now: clockStart });
    try {
      deps.resolveOperation = async (id: any, grant: any) => {
        const derived = await resolve(id, grant);
        return derived && { ...derived, binding: { ...derived.binding, limits: { ...derived.binding.limits, idleMaxMs } } };
      };
      ({ id: identity, adm: admission } = await installGrant('idle-order', actor));
      const idleOpened = await call('open', 'open-one'); assert.equal(idleOpened.status, 'opened', JSON.stringify(idleOpened));
      const idleSession = idleOpened.session.toolSessionId;
      const readCommand = { toolSessionId: idleSession, command: { name: 'get_value', args: {} }, waitMs: 1000 };
      t.mock.timers.setTime(clockStart + 100);
      assert.equal((await call('input', 'old-0', { ...readCommand, commandId: 'old-0' })).status, 'completed');
      t.mock.timers.setTime(clockStart + 700);
      assert.equal((await call('input', 'new-0', { ...readCommand, commandId: 'new-0' })).status, 'completed');
      const activity = (fact: any) => fact.event === 'opened' || fact.event === 'command-completed' || fact.event === 'command-failed';
      const lexical = Object.values<any>(await runtime.store.listExternalEffectFacts(identity, 'interactive:record:')).filter(activity);
      const ordered = (await runtime.store.orderedExternalEffectFacts(identity, 'interactive:record:')).map((row: any) => row.fact).filter(activity);
      assert.equal(lexical.at(-1).requestId, 'old-0', 'Fixture must reverse completion chronology in hashed phase order');
      assert.equal(ordered.at(-1).requestId, 'new-0');
      assert.equal(Date.parse(ordered.at(-1).at) - Date.parse(lexical.at(-1).at), 600);
      const idleBefore = (await listTaskInteractiveSessions(runtime.store, identity))[0];
      await runtime.stop(); runtime = await startDurableRuntime({ database, manifest }); resetDeps(); delete deps.resolveOperation;
      const idleAfter = (await listTaskInteractiveSessions(runtime.store, identity))[0];
      assert.equal(idleAfter.toolSessionId, idleSession);
      assert.equal(idleAfter.sessionDeadlineAt, idleBefore.sessionDeadlineAt);
      assert.equal((await readTaskInteractiveOperation(runtime.store, identity, target)).binding.limits.idleMaxMs, idleMaxMs);
      t.mock.timers.setTime(clockStart + 1101); // Old completion expired; newest completion still has 599 ms.
      const withinIdle = await call('input', 'within-idle', { ...readCommand, commandId: 'within-idle' });
      assert.equal(withinIdle.status, 'completed', `Newest retained activity must admit input after recovery: ${JSON.stringify(withinIdle)}`);
      t.mock.timers.setTime(clockStart + 1101 + idleMaxMs);
      const expiredIdle = await call('input', 'expired-idle', { ...readCommand, commandId: 'expired-idle' });
      assert.equal(expiredIdle.status, 'refused', JSON.stringify(expiredIdle));
      assert.match(expiredIdle.reason, /Original interactive idle deadline is exhausted/);
      assert.equal((await call('close', 'close-idle', { toolSessionId: idleSession })).status, 'closed');
      assert.equal((await runtime.store.effectResources()).filter((lease: any) => lease.effectId.includes(':interactive:') && !lease.released).length, 0);
    } finally { t.mock.timers.reset(); }
    assert.equal((await operateTaskInteractive(deps, 'model-without-grant', { action: 'open', requestId: 'forged', runId: identity.runId, ...target, ownerEpoch: 0, controlRevision: 0, bindingDigest: 'a'.repeat(64) })).status, 'refused');
  } finally {
    LocalChannel.prototype.exec = originalExec; delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    let uncertain = false;
    for (const id of identities) {
      try {
        const grants = await runtime.store.listExternalEffectFacts(id, 'child:');
        for (const value of Object.values(grants)) {
          const child = (value as any).effective?.childSessionId;
          if (child && !(await closeTaskInteractiveSessions(deps, child)).closed) uncertain = true;
        }
      } catch { uncertain = true; }
    }
    await runtime.stop(); await database.stop();
    if (uncertain) console.error(`Preserved owned interactive fixture Home for unconfirmed resource cleanup: ${home}`);
    else await rm(home, { recursive: true, force: true });
  }
});
