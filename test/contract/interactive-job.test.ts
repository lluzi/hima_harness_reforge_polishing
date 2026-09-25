import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  closeInteractiveJob, interactiveCommandMarker, openInteractiveJob, observeInteractiveCommand,
  parseInteractiveRecord, readInteractiveTranscript, sendInteractiveInput, signalInteractiveJob,
  type InteractiveAuthority, type InteractiveIntent, type InteractiveQualification, type InteractiveReceipt,
  type InteractiveChannel, type InteractiveRecord, type InteractiveSession,
} from '@hima/harness';

const hash = (c: string): string => c.repeat(64);
const qualified: InteractiveQualification = {
  bindingDigest: hash('a'), adapter: { id: 'fixture-repl', version: '1', digest: hash('b'), completionProtocol: 'versioned-marker', allowsMultiline: false },
  environment: { id: 'isolated-test-fixture', digest: hash('c') }, mutation: 'qualified',
  testOnly: true,
};

/** Test transport only; production uses LocalChannel/SshChannel through the same Channel interface. */
class LocalTestChannel implements InteractiveChannel {
  readonly siteName = 'local-test';
  readFile(pathname: string) { return readFile(pathname); }
  realpath(pathname: string) { return realpath(pathname); }
  async absent(pathname: string) { try { await lstat(pathname); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; } }
  exec(argv: readonly string[], options: { readonly stdin?: Uint8Array } = {}): Promise<{ code: number; stdout: Uint8Array; stderr: string }> {
    if (!['tmux', 'tail', 'wc'].includes(argv[0] ?? '')) throw new Error(`test channel refuses ${argv[0] ?? ''}`);
    return new Promise((resolve, reject) => {
      const child = spawn(argv[0]!, argv.slice(1), { stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      if (options.stdin !== undefined) { child.stdin!.on('error', () => {}); child.stdin!.end(options.stdin); }
      const out: Buffer[] = []; let stderr = '';
      child.stdout!.on('data', (chunk: Buffer) => out.push(chunk)); child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.on('error', reject); child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr }));
    });
  }
}

class Authority implements InteractiveAuthority {
  readonly records: InteractiveRecord[] = [];
  readonly intents = new Map<string, { digest: string; receipt?: InteractiveReceipt }>();
  activeCommand?: string;
  held = false;
  refuseNextDispatch = false;
  qualification = qualified;
  jobSession?: string;
  jobStop?: { wasRunning: boolean; observedGone: boolean };

  key(intent: InteractiveIntent): string {
    return `${intent.action}:${intent.record.requestId}`;
  }

  async admit(intent: InteractiveIntent) {
    const key = this.key(intent); const old = this.intents.get(key);
    if (old) return old.digest === intent.record.operationDigest && old.receipt
      ? { kind: 'duplicate' as const, receipt: old.receipt }
      : old.digest === intent.record.operationDigest
        ? { kind: 'refused' as const, reason: 'prior intent is still uncertain' }
        : { kind: 'refused' as const, reason: 'request identity reused with different bytes' };
    if (this.held) return { kind: 'refused' as const, reason: 'parent hold blocks new interactive mutation' };
    if (intent.action === 'input') {
      if (this.activeCommand && this.activeCommand !== intent.record.commandId) return { kind: 'refused' as const, reason: 'single writer already has an in-flight command' };
      this.activeCommand = intent.record.commandId;
    }
    this.intents.set(key, { digest: intent.record.operationDigest });
    this.records.push(parseInteractiveRecord(intent.record));
    return { kind: 'reserved' as const, reservationId: `reserved:${key}`, qualification: this.qualification };
  }

  async authorizeBeforeDispatch() {
    if (this.refuseNextDispatch) { this.refuseNextDispatch = false; return { kind: 'refused' as const, reason: 'epoch/hold changed after intent' }; }
    if (this.held) return { kind: 'refused' as const, reason: 'parent hold is current' };
    return { kind: 'authorized' as const, qualification: this.qualification };
  }

  async record(value: InteractiveRecord) {
    const record = parseInteractiveRecord(value); this.records.push(record);
    const key = `${record.event.startsWith('input') || record.event === 'command-completed' || record.event === 'command-failed' ? 'input'
      : record.event.startsWith('signal') ? 'signal' : record.event.startsWith('close') ? 'close' : 'open'}:${record.requestId}`;
    const intent = this.intents.get(key);
    if (!intent) return;
    if (record.event === 'input-sent') intent.receipt = { status: 'duplicate', commandId: record.commandId, inputDigest: record.inputDigest };
    if (record.event === 'input-uncertain') intent.receipt = { status: 'duplicate', commandId: record.commandId, inputDigest: record.inputDigest };
    if (record.event === 'command-completed' || record.event === 'command-failed') { intent.receipt = { status: 'duplicate', commandId: record.commandId, inputDigest: record.inputDigest, cursorAfter: record.cursorAfter }; this.activeCommand = undefined; }
    if (record.event === 'signal-delivered') intent.receipt = { status: 'duplicate', process: 'running-or-exited' };
    if (record.event === 'closed') intent.receipt = { status: 'duplicate', process: 'exited' };
  }

  async recordJobLaunch(job: { session: string }) { this.jobSession = job.session; }
  async recordJobStop(_job: { session: string }, outcome: { wasRunning: boolean; observedGone: boolean }) { this.jobStop = outcome; }
}

const tokenFor = (commandId: string): string => Buffer.from(commandId.padEnd(24, '_')).toString('base64url').padEnd(32, '_');
const input = (session: InteractiveSession, requestId: string, commandId: string, command: Record<string, unknown>, cursorBefore: number, waitMs = 1_000) => ({
  runId: 'run-interactive', executionId: 'execution-1', nodeId: 'manual', requestId, session, commandId,
  actor: 'owner-session', ownerEpoch: 1, controlRevision: 0, callerDigest: hash('e'),
  protocolToken: tokenFor(commandId), requestDigest: 'd'.repeat(64), text: JSON.stringify({ id: commandId, _himaToken: tokenFor(commandId), ...command }),
  submit: true as const, effect: 'mutation' as const,
  cursorBefore, waitMs, commandDeadlineAt: new Date(Date.now() + 10_000).toISOString(),
});

test('one durable tmux Job preserves REPL state, single-writer receipts, transcript cursors, waits, signals and close', async (t) => {
  const root = process.cwd();
  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'hima-interactive-'));
  const workspace = path.join(testRoot, 'workspace'); await mkdir(workspace);
  t.after(() => rm(testRoot, { recursive: true, force: true }));
  const on = new LocalTestChannel(); const authority = new Authority();
  const fixture = path.join(root, 'test/fixtures/interactive-job/repl.mjs');
  const tmuxFixture = `hima-base-index-${process.pid}`;
  const keeper = spawnSync('tmux', ['new-session', '-d', '-s', tmuxFixture, 'sleep', '60'], { encoding: 'utf8' });
  assert.equal(keeper.status, 0, keeper.stderr);
  const nonzeroBase = spawnSync('tmux', ['set-option', '-g', 'base-index', '1'], { encoding: 'utf8' });
  assert.equal(nonzeroBase.status, 0, nonzeroBase.stderr);
  t.after(() => { spawnSync('tmux', ['kill-session', '-t', `=${tmuxFixture}`], { timeout: 15_000 }); });
  let session: InteractiveSession | undefined;
  try {
    const opened = await openInteractiveJob(on, {
      siteName: 'local', runId: 'run-interactive', executionId: 'execution-1', nodeId: 'manual', requestId: 'open-1',
      actor: 'owner-session', ownerEpoch: 1, controlRevision: 0, callerDigest: hash('f'),
      workspace, argv: [process.execPath, fixture, 'fixture-repl', '1'], name: 'repl',
      sessionDeadlineAt: new Date(Date.now() + 60_000).toISOString(), startupWaitMs: 1_000,
    }, authority);
    if (opened.status === 'uncertain' && opened.session !== undefined) session = opened.session;
    assert.equal(opened.status, 'opened', opened.status === 'uncertain' || opened.status === 'refused' ? opened.reason : undefined);
    if (opened.status !== 'opened') return;
    assert.equal(opened.readiness, 'ready');
    session = opened.session;
    assert.equal(authority.jobSession, session.toolSessionId, 'the ordinary existing Job fact owns the same process identity');
    const initial = await readInteractiveTranscript(on, session);

    const set = await sendInteractiveInput(on, input(session, 'request-set', 'set-1', { op: 'set', key: 'answer', value: 42 }, initial.cursor.end), authority);
    assert.equal(set.status, 'completed');
    if (set.status !== 'completed') return;
    assert.equal(set.acknowledged, true, JSON.stringify(set.transcript));
    assert.match(set.transcript.text, new RegExp(interactiveCommandMarker(tokenFor('set-1'), 'DONE')));
    const setIntent = authority.records.find((record) => record.event === 'input-intent' && record.commandId === 'set-1');
    assert.ok(setIntent && setIntent.event === 'input-intent');
    assert.equal(setIntent.actor, 'owner-session'); assert.equal(setIntent.ownerEpoch, 1); assert.equal(setIntent.controlRevision, 0);
    assert.notEqual(setIntent.commandDeadlineAt, session.sessionDeadlineAt, 'command and session deadlines remain separate');
    assert.doesNotMatch(JSON.stringify(authority.records), /"value":42/, 'generic records retain byte identity, not raw operator input');

    const get = await sendInteractiveInput(on, input(session, 'request-get', 'get-1', { op: 'get', key: 'answer' }, set.transcript.cursor.end), authority);
    assert.equal(get.status, 'completed');
    if (get.status !== 'completed') return;
    assert.match(get.transcript.text, /VALUE answer=42/, 'the second command reads state held by the same process');
    const duplicate = await sendInteractiveInput(on, input(session, 'request-get', 'get-1', { op: 'get', key: 'answer' }, set.transcript.cursor.end), authority);
    assert.equal(duplicate.status, 'duplicate', 'same request and byte digest returns its durable receipt without another paste');
    const changed = await sendInteractiveInput(on, input(session, 'request-get', 'get-1', { op: 'get', key: 'different' }, set.transcript.cursor.end), authority);
    assert.equal(changed.status, 'refused'); assert.match(changed.reason!, /different bytes/);

    const slowRequest = input(session, 'request-slow', 'slow-1', { op: 'slow', ms: 350 }, get.transcript.cursor.end, 20);
    const slow = await sendInteractiveInput(on, slowRequest, authority);
    assert.equal(slow.status, 'sent');
    if (slow.status !== 'sent') return;
    assert.equal(slow.acknowledged, true, JSON.stringify(slow.transcript)); assert.doesNotMatch(slow.transcript.text, /slow-1:DONE/);
    const overlapping = await sendInteractiveInput(on, input(session, 'request-overlap', 'get-overlap', { op: 'get', key: 'answer' }, slow.transcript.cursor.end), authority);
    assert.equal(overlapping.status, 'refused'); assert.match(overlapping.reason!, /single writer/);
    const finishedSlow = await observeInteractiveCommand(on, { ...slowRequest, cursorBefore: slow.transcript.cursor.start, waitMs: 1_000 }, authority);
    assert.equal(finishedSlow.status, 'completed', 'call wait timeout does not kill or reset the command/session');

    const fakeRequest = input(session, 'request-fake', 'fake-1', { op: 'fake-prompt', ms: 120 }, finishedSlow.status === 'completed' ? finishedSlow.transcript.cursor.end : 0, 20);
    const fake = await sendInteractiveInput(on, fakeRequest, authority);
    assert.equal(fake.status, 'sent', 'a prompt-like prefix is not an exact versioned completion marker');
    const fakeDone = await observeInteractiveCommand(on, { ...fakeRequest, waitMs: 1_000 }, authority);
    assert.equal(fakeDone.status, 'completed');

    const spam = await sendInteractiveInput(on, input(session, 'request-spam', 'spam-1', { op: 'spam', bytes: 8_192 }, fakeDone.status === 'completed' ? fakeDone.transcript.cursor.end : 0), authority);
    assert.equal(spam.status, 'completed');
    const gap = await readInteractiveTranscript(on, session, 0, 128);
    assert.equal(gap.cursor.gap?.reason, 'window-exceeded'); assert.equal(gap.cursor.bytes <= 128, true);

    const failed = await sendInteractiveInput(on, input(session, 'request-fail', 'fail-1', { op: 'not-a-command' }, gap.cursor.end), authority);
    assert.equal(failed.status, 'failed', 'adapter failure ends the command lease without becoming a successful completion');
    if (failed.status === 'failed') assert.match(failed.transcript.text, /HIMA-?.*|ERROR unknown op/);

    const unavailable = { ...session, qualification: { ...session.qualification, mutation: 'unavailable' as const } };
    const deniedMutation = await sendInteractiveInput(on, input(unavailable, 'request-unqualified', 'set-x', { op: 'set', key: 'x', value: 1 }, gap.cursor.end), authority);
    assert.equal(deniedMutation.status, 'refused'); assert.match(deniedMutation.reason!, /no exact approved/);

    authority.refuseNextDispatch = true;
    const race = await sendInteractiveInput(on, input(session, 'request-race', 'set-race', { op: 'set', key: 'x', value: 2 }, gap.cursor.end), authority);
    assert.equal(race.status, 'outcome-unknown', 'reason' in race ? race.reason : undefined); assert.match(race.reason!, /lost authority/);
    authority.activeCommand = undefined; // test authority reconciliation of a proven pre-paste refusal

    const interruptRequest = input(session, 'request-interrupt-target', 'slow-2', { op: 'slow', ms: 5_000 }, gap.cursor.end, 10);
    const running = await sendInteractiveInput(on, interruptRequest, authority); assert.equal(running.status, 'sent');
    const interrupted = await signalInteractiveJob(on, { runId: 'run-interactive', executionId: 'execution-1', nodeId: 'manual',
      requestId: 'signal-1', actor: 'owner-session', ownerEpoch: 1, controlRevision: 0, callerDigest: hash('a'), session, signal: 'interrupt' }, authority);
    assert.equal(interrupted.status, 'delivered');
    const afterInterrupt = await observeInteractiveCommand(on, { ...interruptRequest, waitMs: 1_000 }, authority);
    assert.equal(afterInterrupt.status, 'completed');

    const exit = await sendInteractiveInput(on, input(session, 'request-exit', 'exit-1', { op: 'exit' }, afterInterrupt.status === 'completed' ? afterInterrupt.transcript.cursor.end : 0), authority);
    assert.equal(exit.status, 'completed');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const closed = await closeInteractiveJob(on, { runId: 'run-interactive', executionId: 'execution-1', nodeId: 'manual', requestId: 'close-1',
      actor: 'owner-session', ownerEpoch: 1, controlRevision: 0, callerDigest: hash('b'), session }, authority);
    assert.equal(closed.status, 'closed');
    assert.deepEqual(authority.jobStop, { wasRunning: false, observedGone: true }, 'normal adapter exit is not rewritten as a killed Job');

    const uncertain = await sendInteractiveInput(on, input(session, 'request-after-close', 'lost-1', { op: 'set', key: 'lost', value: 1 }, gap.cursor.end), authority);
    assert.equal(uncertain.status, 'outcome-unknown');
    const noResend = await sendInteractiveInput(on, input(session, 'request-after-close', 'lost-1', { op: 'set', key: 'lost', value: 1 }, gap.cursor.end), authority);
    assert.equal(noResend.status, 'duplicate', 'an uncertain send remains fenced and is never auto-replayed');
  } finally {
    if (session) spawnSync('tmux', ['kill-session', '-t', `=${session.toolSessionId}`], { timeout: 15_000 });
  }
});
