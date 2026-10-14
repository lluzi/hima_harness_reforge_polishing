// L1 private-file/binding plus L2 controlled journal IO: no SDK, model, Host or native process.
// Imports require this checkout's admitted fresh lib build.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import type { LocalContextOrigin, LocalContextLimits, LocalMemberConfiguration, LocalNativeCheckpoint } from '../../packages/harness/lib/types/oar-local-member.js';
const { captureLocalNativeFiles, verifyLocalNativeCheckpoint, validateLocalMemberContinuity,
  OarLocalMemberRuntime } = await import(new URL('../../packages/harness/lib/oar-local-member.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/oar-local-member.js');
const assertLocalNativeSessionIdentity: typeof import('../../packages/harness/lib/types/oar-local-member.js').assertLocalNativeSessionIdentity = (await import(new URL('../../packages/harness/lib/oar-local-member.js', import.meta.url).href)).assertLocalNativeSessionIdentity;

const digest = 'a'.repeat(64);
const identity = { runId: 'run', taskId: 'logical-task', effectId: 'old-effect', inputSha256: digest,
  irSha256: digest, applicationVersion: 'app', adapterVersion: 'adapter', packSha256: digest };
const limits: LocalContextLimits = { maxFiles: 8, maxBytes: 4096, maxFileBytes: 2048 };
function fixture(runtime: 'pi' | 'opencode' = 'pi') {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-context-'));
  const control = path.join(home, 'control'), cwd = path.join(home, 'work');
  fs.mkdirSync(path.join(control, 'native', 'data'), { recursive: true }); fs.mkdirSync(cwd);
  const origin: LocalContextOrigin = { identity, sessionKey: 'old-session', generation: 0,
    memberId: 'lead', runtime, nativeSession: 'original-native-id', cwd };
  const relative = runtime === 'pi' ? `pi/sessions/--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--/original.jsonl` : 'data/opencode/conversation.bin';
  const filename = path.join(control, 'native', relative); fs.mkdirSync(path.dirname(filename), { recursive: true });
  const bytes = runtime === 'pi' ? Buffer.from(JSON.stringify({ type: 'session', version: 3, id: origin.nativeSession, cwd }) + '\n'
    + JSON.stringify({ type: 'message', id: 'message', message: { role: 'user', content: 'Prior native context' } }) + '\n') : Buffer.from([0, 10, 255, 1]);
  fs.writeFileSync(filename, bytes);
  return { home, control, cwd, origin, relative, filename, bytes, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}
function captured(value: ReturnType<typeof captureLocalNativeFiles>): LocalNativeCheckpoint {
  assert.equal(value.state, 'captured'); return value.checkpoint;
}
function config(origin: LocalContextOrigin): LocalMemberConfiguration {
  return { prepared: { schema: 'hima-oar-task/1', identity: { ...identity, effectId: 'new-effect' }, projectId: 'project',
    memberId: origin.memberId, runtime: origin.runtime, modelRef: 'default', generation: 1, sessionKey: 'new-session',
    inputId: 'new-input', deadlineAt: '2026-10-14T00:00:00Z', prompt: 'Host successor result input' },
    model: { provider: 'openai-completions', model: 'current', baseUrl: 'https://example.invalid', apiKey: 'unused-fixture-key' },
    outputSchemaVersion: 'answer/1' };
}

test('old configuration stages and replays without requiring continuity; unstaged process cannot supply capture proof', async () => {
  const f = fixture();
  try {
    const assets = { oarModule: '/unused/oar.js', nodeExecutable: '/unused/node', opencodeCommand: '/unused/opencode', opencodeVersion: 'fixture' };
    const runtime = new OarLocalMemberRuntime({ home: f.home, nodeExecutable: assets.nodeExecutable, runnerModule: '/unused/runner.js', assets });
    const lease = await runtime.stage(config(f.origin), []);
    assert.deepEqual(await runtime.stage(config(f.origin), []), lease);
    await runtime.close(lease); // never started; no signal or process inventory
    await assert.rejects(runtime.captureClosedContext(lease, 'wait', limits), /actual closed owned-process proof/);
  } finally { f.cleanup(); }
});

test('Pi capture preserves exact original bytes and immutable replay despite later source changes', () => {
  const f = fixture();
  try {
    const checkpoint = captured(captureLocalNativeFiles(f.control, f.origin, 'wait', limits));
    assert.equal(checkpoint.boundary, 'after-physical-close'); assert.equal(checkpoint.files.length, 1);
    assert.ok(Object.isFrozen(checkpoint)); assert.ok(Object.isFrozen(checkpoint.origin.identity)); assert.ok(Object.isFrozen(checkpoint.files));
    assert.deepEqual(fs.readFileSync(path.join(f.control, 'checkpoints', checkpoint.checkpointId, f.relative)), f.bytes);
    fs.writeFileSync(f.filename, 'changed source');
    assert.deepEqual(captured(captureLocalNativeFiles(f.control, f.origin, 'wait', limits)), checkpoint);
    assert.deepEqual(verifyLocalNativeCheckpoint(f.control, checkpoint), checkpoint);
  } finally { f.cleanup(); }
});

test('Pi capture refuses wrong native ID/cwd and truncated or ambiguous conversations', () => {
  for (const change of ['id', 'cwd', 'truncate', 'duplicate'] as const) {
    const f = fixture();
    try {
      if (change === 'duplicate') fs.writeFileSync(path.join(path.dirname(f.filename), 'duplicate.jsonl'), f.bytes);
      else if (change === 'truncate') fs.writeFileSync(f.filename, f.bytes.subarray(0, f.bytes.length - 1));
      else fs.writeFileSync(f.filename, f.bytes.toString().replace(change === 'id' ? f.origin.nativeSession : f.cwd, 'wrong'));
      if (change === 'id' || change === 'cwd') assert.equal(captureLocalNativeFiles(f.control, f.origin, 'wait', limits).state, 'unavailable');
      else assert.throws(() => captureLocalNativeFiles(f.control, f.origin, 'wait', limits), /Truncated|Ambiguous/);
    } finally { f.cleanup(); }
  }
});

test('checkpoint replay rejects byte tampering and manifest identity/digest changes', () => {
  const f = fixture();
  try {
    const checkpoint = captured(captureLocalNativeFiles(f.control, f.origin, 'wait', limits));
    assert.throws(() => verifyLocalNativeCheckpoint(f.control, { ...checkpoint, origin: { ...f.origin, nativeSession: 'wrong' } }), /identity\/digest/);
    fs.writeFileSync(path.join(f.control, 'checkpoints', checkpoint.checkpointId, f.relative), 'tampered');
    assert.throws(() => captureLocalNativeFiles(f.control, f.origin, 'wait', limits), /size\/digest/);
  } finally { f.cleanup(); }
});

test('private native capture enforces file, count and total-byte limits without publishing partial checkpoint', () => {
  for (const constraint of ['maxFileBytes', 'maxBytes', 'maxFiles'] as const) {
    const f = fixture('opencode');
    try {
      fs.writeFileSync(path.join(path.dirname(f.filename), 'second.bin'), f.bytes);
      const bound = { ...limits, [constraint]: constraint === 'maxFiles' ? 1 : constraint === 'maxBytes' ? 7 : 3,
        ...(constraint === 'maxBytes' ? { maxFileBytes: 4 } : {}) };
      assert.throws(() => captureLocalNativeFiles(f.control, f.origin, 'wait', bound), /bound/);
      assert.equal(fs.existsSync(path.join(f.control, 'checkpoints')), false);
    } finally { f.cleanup(); }
  }
});

test('OpenCode capture keeps opaque layout and excludes recognized credential/config sidefiles', () => {
  const f = fixture('opencode');
  try {
    for (const name of ['auth.json', 'credentials.json', 'config.json', '.env', 'profiles.json'])
      fs.writeFileSync(path.join(f.control, 'native', 'data', 'opencode', name), 'sentinel-old-secret');
    const checkpoint = captured(captureLocalNativeFiles(f.control, f.origin, 'wait', limits));
    assert.equal(checkpoint.format, 'opencode-opaque-data'); assert.equal(checkpoint.files.length, 1); assert.equal(checkpoint.excluded.length, 5);
    assert.equal(checkpoint.files[0]?.path, 'data/opencode/conversation.bin');
    assert.ok(checkpoint.excluded.includes('data/opencode/auth.json'));
    assert.deepEqual(verifyLocalNativeCheckpoint(f.control, checkpoint, limits), checkpoint);
    assert.deepEqual(captured(captureLocalNativeFiles(f.control, f.origin, 'wait', limits)), checkpoint);
    assert.deepEqual(fs.readFileSync(path.join(f.control, 'checkpoints', checkpoint.checkpointId, f.relative)), f.bytes);
    for (const name of checkpoint.excluded) assert.equal(fs.existsSync(path.join(f.control, 'checkpoints', checkpoint.checkpointId, name)), false);
  } finally { f.cleanup(); }
});

test('native capture rejects symlinks and hardlinks even under an excluded credential name', () => {
  for (const kind of ['symbolic', 'hard'] as const) {
    const f = fixture('opencode');
    try {
      const filename = path.join(f.control, 'native', 'data', 'opencode', 'auth.json');
      if (kind === 'symbolic') fs.symlinkSync(f.filename, filename); else fs.linkSync(f.filename, filename);
      assert.throws(() => captureLocalNativeFiles(f.control, f.origin, 'wait', limits), /links\/special/);
    } finally { f.cleanup(); }
  }
});

test('continuity requires distinct effect/session and original Run/method/member/runtime/cwd', () => {
  const f = fixture();
  try {
    const checkpoint = captured(captureLocalNativeFiles(f.control, f.origin, 'wait', limits));
    const current = { ...config(f.origin), continuity: { kind: 'native-resume' as const, checkpoint } };
    const control = path.join(f.home, 'new-control');
    validateLocalMemberContinuity(current, control, f.cwd);
    for (const mutation of [ { sessionKey: f.origin.sessionKey }, { memberId: 'other' }, { runtime: 'opencode' as const },
      { identity: { ...current.prepared.identity, effectId: identity.effectId } },
      { identity: { ...current.prepared.identity, runId: 'other-run' } },
      { identity: { ...current.prepared.identity, packSha256: 'b'.repeat(64) } } ]) {
      assert.throws(() => validateLocalMemberContinuity({ ...current, prepared: { ...current.prepared, ...mutation } }, control, f.cwd), /continuity binding/);
    }
    assert.throws(() => validateLocalMemberContinuity(current, control, path.join(f.home, 'other-cwd')), /continuity binding/);
    assert.throws(() => assertLocalNativeSessionIdentity(current.continuity, 'new-native-id'), /Restored native session identity mismatch/);
    assertLocalNativeSessionIdentity(current.continuity, f.origin.nativeSession);
    const reconstruction = { kind: 'reconstruction' as const, origin: f.origin, contextSha256: digest };
    assert.throws(() => assertLocalNativeSessionIdentity(reconstruction, f.origin.nativeSession), /Reconstruction reused/);
    assertLocalNativeSessionIdentity(reconstruction, 'new-native-id');
    assertLocalNativeSessionIdentity(undefined, 'ordinary-id');
  } finally { f.cleanup(); }
});


test('recovered durable yield rejects fresh old-lease input without starting a process', async () => {
  const f = fixture();
  try {
    const assets = { oarModule: '/unused/oar.js', nodeExecutable: '/unused/node', opencodeCommand: '/unused/opencode', opencodeVersion: 'fixture' };
    const options = { home: f.home, nodeExecutable: assets.nodeExecutable, runnerModule: '/unused/runner.js', assets };
    const original = new OarLocalMemberRuntime(options);
    const lease = await original.stage(config(f.origin), []);
    await original.close(lease, { yieldRequestId: 'accepted-wait' }); // never started; deliberately no physical capture proof
    const recoveredRuntime = new OarLocalMemberRuntime(options);
    const recovered = await recoveredRuntime.recover(lease.sessionKey);
    assert.deepEqual(recovered, lease);
    assert.ok(recovered);
    await assert.rejects(recoveredRuntime.start(recovered), /yielded rejects start/);
    assert.equal(fs.existsSync(path.join(lease.controlDirectory, 'start.claim')), false);
    await assert.rejects(recoveredRuntime.sendInput(recovered, 'fresh-old-input', 'Must remain fenced'), /stopping rejects input/);
    assert.equal(fs.existsSync(path.join(lease.controlDirectory, 'inbox', 'fresh-old-input.json')), false);
    // The retained yield ID also rejects changing request identity on a replayed close.
    await assert.rejects(recoveredRuntime.close(recovered, { yieldRequestId: 'another-wait' }), /yield request identity reused/);
    await assert.rejects(recoveredRuntime.captureClosedContext(recovered, 'accepted-wait', limits), /actual closed owned-process proof/);
  } finally { f.cleanup(); }
});

test('recovery refuses a yield intent copied from a different member lease', async () => {
  const f = fixture();
  try {
    const assets = { oarModule: '/unused/oar.js', nodeExecutable: '/unused/node', opencodeCommand: '/unused/opencode', opencodeVersion: 'fixture' };
    const options = { home: f.home, nodeExecutable: assets.nodeExecutable, runnerModule: '/unused/runner.js', assets };
    const original = new OarLocalMemberRuntime(options);
    const lease = await original.stage(config(f.origin), []);
    await original.close(lease, { yieldRequestId: 'accepted-wait' });
    const journal = path.join(lease.controlDirectory, 'journal.jsonl');
    const rows = fs.readFileSync(journal, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const intent = rows.find(row => row.payload?.action === 'yield_intent');
    assert.ok(intent); intent.memberId = 'another-member';
    fs.writeFileSync(journal, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    await assert.rejects(new OarLocalMemberRuntime(options).recover(lease.sessionKey), /Invalid retained member yield intent/);
  } finally { f.cleanup(); }
});

test('actual stage rejects continuity without retained predecessor before copying or persisting successor configuration', async () => {
  const f = fixture('opencode');
  try {
    const checkpoint = captured(captureLocalNativeFiles(f.control, f.origin, 'wait', limits));
    const assets = { oarModule: '/unused/oar.js', nodeExecutable: '/unused/node', opencodeCommand: '/unused/opencode', opencodeVersion: 'fixture' };
    const runtime = new OarLocalMemberRuntime({ home: f.home, nodeExecutable: assets.nodeExecutable, runnerModule: '/unused/runner.js', assets });
    const current = { ...config(f.origin), workDirectory: f.cwd, continuity: { kind: 'native-resume' as const, checkpoint } };
    await assert.rejects(runtime.stage(current, []), /predecessor lease unavailable/);
    const control = path.join(f.home, 'hima', 'oar-members', current.prepared.sessionKey, 'control');
    assert.equal(fs.existsSync(path.join(control, 'config.json')), false);
    assert.equal(fs.existsSync(path.join(control, 'native', 'data', 'opencode', 'conversation.bin')), false);
  } finally { f.cleanup(); }
});

// L2 controlled observation ingress with real Node file IO; no native SDK/model.
async function journalFixture() {
  const f = fixture();
  const assets = { oarModule: '/unused/oar.js', nodeExecutable: '/unused/node', opencodeCommand: '/unused/opencode', opencodeVersion: 'fixture' };
  const options = { home: f.home, nodeExecutable: assets.nodeExecutable, runnerModule: '/unused/runner.js', assets };
  const runtime = new OarLocalMemberRuntime(options), lease = await runtime.stage(config(f.origin), []);
  const internals = runtime as any, held = internals.get(lease);
  held.nativeSession = 'controlled-native';
  await internals.journal(held, 'created', { nativeSession: held.nativeSession, runtime: 'pi' });
  return { f, runtime, lease, held, internals, options };
}
const tick = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));

test('controlled raw/reasoning flood preserves every exact row and services timers at the observed envelope', async () => {
  const x = await journalFixture();
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const expected: { kind: string; payload: unknown }[] = [];
    const acknowledgements: Promise<void>[] = [];
    let last = performance.now(), maxDelay = 0, timerTicks = 0;
    timer = setInterval(() => { const now = performance.now(); maxDelay = Math.max(maxDelay, now - last - 20); last = now; timerTicks++; }, 20);
    // 3482 rows, roughly 14MiB including row metadata, 250 rows/sec.
    for (let start = 0; start < 3482; start += 32) {
      const began = performance.now();
      for (let i = start; i < Math.min(start + 32, 3482); i++) {
        const kind = i % 2 ? 'event' : 'raw';
        const payload = { kind: kind === 'event' ? 'reasoning' : 'message_update', index: i,
          text: String(i).padStart(5, '0') + 'x'.repeat(i % 100 === 0 ? 28 * 1024 - 128 : 3680) };
        expected.push({ kind, payload });
        acknowledgements.push(Promise.resolve(x.internals.journal(x.held, kind, payload)));
      }
      await tick(Math.max(0, 128 - (performance.now() - began)));
    }
    await Promise.all(acknowledgements);
    clearInterval(timer); timer = undefined;
    assert.ok(timerTicks > 100, 'timers serviced during ingress');
    assert.ok(maxDelay < 100, `Host loop extra delay ${maxDelay.toFixed(1)}ms exceeds controlled responsiveness bound`);
    const view = await x.runtime.read(x.lease);
    const rows = view.journal.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, expected.length + 1);
    rows.forEach((row, seq) => assert.equal(row.seq, seq));
    assert.deepEqual(rows.slice(1).map(({ kind, payload }) => ({ kind, payload })), expected);
    assert.equal((await x.runtime.close(x.lease)).closed, true);
    const recovered = new OarLocalMemberRuntime(x.options);
    await recovered.recover(x.lease.sessionKey);
    assert.equal((await recovered.read(x.lease)).journal, view.journal);
  } finally { if (timer) clearInterval(timer); await x.runtime.close(x.lease); x.f.cleanup(); }
});

// Delaying the real FileHandle sync provides a durability oracle, not a latency proof.
async function holdNextSync() {
  const original = fs.promises.open;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { entered = resolve; });
  fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
    const fd = await original(...args);
    if (String(args[0]).endsWith('journal.jsonl')) {
      const sync = fd.sync.bind(fd);
      fd.sync = async () => { entered(); await gate; await sync(); };
    }
    return fd;
  }) as typeof fs.promises.open;
  return { reached, release, restore: () => { fs.promises.open = original; } };
}

test('read and finished publication await ordered fsync, and busy input cannot overtake original terminal', async () => {
  const f = fixture(), heldSync = await holdNextSync();
  const assets = { oarModule: '/unused', nodeExecutable: '/unused', opencodeCommand: '/unused', opencodeVersion: 'fixture' };
  const runtime = new OarLocalMemberRuntime({ home: f.home, nodeExecutable: '/unused', runnerModule: '/unused', assets });
  try {
    const lease = await runtime.stage(config(f.origin), []), internals = runtime as any, h = internals.get(lease);
    h.nativeSession = 'controlled-native'; h.authorized = true;
    const wires: any[] = []; h.child = { connected: true, send: (value: unknown) => { wires.push(value); } };
    h.current = { id: 'original', initial: false, received: false };
    internals.observe(h, { type: 'received', payload: { inputId: 'original' } });
    internals.observe(h, { type: 'terminal', payload: { inputId: 'original', outcome: { kind: 'completed' } } });
    internals.observe(h, { type: 'finished', inputId: 'original', text: 'ordinary native completion' });
    await Promise.race([heldSync.reached, tick(500).then(() => { throw Error('Async durable writer did not reach controlled sync barrier'); })]);
    await runtime.sendInput(lease, 'busy-input', 'Queued until durable original finish');
    let visible = false;
    const read = runtime.read(lease).then(value => { visible = true; return value; });
    await tick(30);
    assert.equal(visible, false); assert.equal(h.current.id, 'original'); assert.equal(wires.length, 0);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(lease.controlDirectory, 'state.json'), 'utf8')).phase, 'completed');
    heldSync.release(); await read;
    for (let n = 0; n < 50 && !wires.length; n++) await tick(10);
    assert.equal(wires[0]?.id, 'busy-input');
    const rows = (await runtime.read(lease)).journal.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(rows.findIndex(row => row.kind === 'finished') < rows.findIndex(row => row.payload?.action === 'send_intent'));
    await runtime.close(lease);
  } finally { heldSync.release(); heldSync.restore(); await runtime.stopAll(); f.cleanup(); }
});

test('stop during unacked completion fences fresh input and prevents late completed publication', async () => {
  const f = fixture(), heldSync = await holdNextSync();
  const assets = { oarModule: '/unused', nodeExecutable: '/unused', opencodeCommand: '/unused', opencodeVersion: 'fixture' };
  const runtime = new OarLocalMemberRuntime({ home: f.home, nodeExecutable: '/unused', runnerModule: '/unused', assets });
  try {
    const lease = await runtime.stage(config(f.origin), []), internals = runtime as any, h = internals.get(lease);
    h.nativeSession = 'controlled-native'; h.current = { id: 'original', initial: false, received: false };
    internals.observe(h, { type: 'received', payload: { inputId: 'original' } });
    internals.observe(h, { type: 'terminal', payload: { inputId: 'original', outcome: { kind: 'completed' } } });
    internals.observe(h, { type: 'finished', inputId: 'original', text: 'ordinary completion' });
    await Promise.race([heldSync.reached, tick(500).then(() => { throw Error('Async durable writer did not reach controlled sync barrier'); })]);
    const closing = runtime.close(lease, { yieldRequestId: 'durable-yield' });
    await assert.rejects(runtime.sendInput(lease, 'forbidden', 'No late replay'), /stopping rejects input/);
    heldSync.release(); await closing;
    assert.equal(fs.existsSync(path.join(lease.controlDirectory, 'inbox', 'forbidden.json')), false);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(lease.controlDirectory, 'state.json'), 'utf8')).phase, 'completed');
  } finally { heldSync.release(); heldSync.restore(); await runtime.stopAll(); f.cleanup(); }
});

test('overflow rejects before sequence allocation, drains accepted prefix, retains Home and stays unknown after recovery', async () => {
  const f = fixture(), heldSync = await holdNextSync();
  const assets = { oarModule: '/unused', nodeExecutable: '/unused', opencodeCommand: '/unused', opencodeVersion: 'fixture' };
  const options = { home: f.home, nodeExecutable: '/unused', runnerModule: '/unused', assets };
  const runtime = new OarLocalMemberRuntime(options);
  try {
    const lease = await runtime.stage(config(f.origin), []), internals = runtime as any, h = internals.get(lease);
    const accepted: Promise<void>[] = [];
    for (let n = 0; n < 4096; n++) accepted.push(Promise.resolve(internals.journal(h, 'raw', { index: n })));
    const seq = h.seq;
    await assert.rejects(Promise.resolve(internals.journal(h, 'raw', { overflowing: true })), /queue bound/);
    assert.equal(h.seq, seq);
    heldSync.release(); await Promise.all(accepted);
    assert.equal((await runtime.close(lease)).closed, false);
    await assert.rejects(runtime.read(lease), /queue bound/);
    const rows = fs.readFileSync(path.join(lease.controlDirectory, 'journal.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, seq); rows.forEach((row, n) => assert.equal(row.seq, n));
    assert.ok(fs.existsSync(lease.controlDirectory));
    const recovered = new OarLocalMemberRuntime(options); await recovered.recover(lease.sessionKey);
    await assert.rejects(recovered.read(lease), /queue bound/);
    await assert.rejects(recovered.captureClosedContext(lease, 'no-fabricated-capture', limits), /queue bound|retention|closure unconfirmed/);
    assert.equal((await recovered.close(lease)).closed, false);
  } finally { heldSync.release(); heldSync.restore(); await runtime.stopAll(); f.cleanup(); }
});

test('actual journal open failure stays observable through read, closure and recovered capture', async () => {
  const f = fixture();
  const assets = { oarModule: '/unused', nodeExecutable: '/unused', opencodeCommand: '/unused', opencodeVersion: 'fixture' };
  const options = { home: f.home, nodeExecutable: '/unused', runnerModule: '/unused', assets };
  const runtime = new OarLocalMemberRuntime(options);
  try {
    const lease = await runtime.stage(config(f.origin), []), internals = runtime as any, h = internals.get(lease);
    fs.mkdirSync(path.join(lease.controlDirectory, 'journal.jsonl')); // real OS open fails EISDIR
    await assert.rejects(Promise.resolve(internals.journal(h, 'raw', { sentinel: 'retained failure' })), /retention unavailable/);
    await assert.rejects(runtime.read(lease), /retention unavailable/);
    assert.equal((await runtime.close(lease)).closed, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(lease.controlDirectory, 'state.json'), 'utf8')).phase, 'unknown');
    assert.ok(fs.existsSync(lease.controlDirectory));
  } finally { await runtime.stopAll(); f.cleanup(); }
});

test('write and sync failures never acknowledge or publish accepted observations and recover as unknown', async () => {
  for (const failure of ['write', 'sync'] as const) {
    const f = fixture(), original = fs.promises.open;
    const assets = { oarModule: '/unused', nodeExecutable: '/unused', opencodeCommand: '/unused', opencodeVersion: 'fixture' };
    const options = { home: f.home, nodeExecutable: '/unused', runnerModule: '/unused', assets };
    const runtime = new OarLocalMemberRuntime(options);
    fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
      const fd = await original(...args);
      if (String(args[0]).endsWith('journal.jsonl')) {
        if (failure === 'sync') fd.sync = async () => { throw Error('Controlled fsync fault'); };
        else fd.write = (async () => { throw Error('Controlled write fault'); }) as typeof fd.write;
      }
      return fd;
    }) as typeof fs.promises.open;
    try {
      const lease = await runtime.stage(config(f.origin), []), internals = runtime as any, h = internals.get(lease);
      await assert.rejects(Promise.resolve(internals.journal(h, 'raw', { index: 0 })), /retention unavailable/);
      await assert.rejects(runtime.read(lease), /retention unavailable/);
      assert.equal((await runtime.close(lease)).closed, false);
      assert.equal(h.journalState?.fd, undefined, 'failed writer releases its owned file descriptor');
      assert.equal(fs.existsSync(path.join(lease.controlDirectory, 'result.json')), false);
      fs.promises.open = original;
      const recovered = new OarLocalMemberRuntime(options); await recovered.recover(lease.sessionKey);
      await assert.rejects(recovered.read(lease), /retention unavailable/);
      assert.equal((await recovered.close(lease)).closed, false);
      await assert.rejects(recovered.captureClosedContext(lease, 'failure-capture', limits), /retention|closure unconfirmed/);
      assert.ok(fs.existsSync(lease.controlDirectory));
    } finally { fs.promises.open = original; await runtime.stopAll(); f.cleanup(); }
  }
});
