import test from 'node:test';
import assert from 'node:assert/strict';
import { bootInProcess, createChildAgent, createRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { timingProbePackId } from './support/pack.ts';

const resultValue = (result: unknown): Record<string, unknown> => {
  const value = (result as { value?: unknown }).value;
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), JSON.stringify(result));
  return value as Record<string, unknown>;
};

test('ordinary side talk owns an interactive terminal while a foreign or child Agent is refused', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const host = await bootInProcess(h);
  t.after(() => host.dispose());
  const sideTalk = await createRootAgent(host.ctx, h.workspace);
  const foreign = await createRootAgent(host.ctx, h.workspace);
  const child = await createChildAgent(host.ctx, sideTalk, h.workspace);
  let sequence = 0;
  const call = (agent: typeof sideTalk, name: string, arguments_: Record<string, unknown>) => host.ctx.tools.execute({
    callId: `terminal-${++sequence}` as never, name, arguments: arguments_, agent, signal: AbortSignal.timeout(10_000),
  });

  const opened = resultValue(await call(sideTalk, 'terminal_open', { type: 'shell', name: 'f1' }));
  const sessionId = String(opened.sessionId);
  assert.ok(sessionId.length > 0);
  const waiting = resultValue(await call(sideTalk, 'terminal_send', { sessionId, text: 'read answer; printf "answer=%s\\n" "$answer"' }));
  assert.ok(['stdin_read', 'inferred_idle'].includes(String(waiting.waitReason)),
    `interactive read settles through a documented readiness path: ${String(waiting.waitReason)}`);
  const answered = resultValue(await call(sideTalk, 'terminal_send', { sessionId, text: 'accepted' }));
  assert.match(String(answered.viewport), /answer=accepted/);
  const read = resultValue(await call(sideTalk, 'terminal_read', { sessionId, count: 20 }));
  assert.match(String(read.text), /answer=accepted/);

  const foreignRead = await call(foreign, 'terminal_read', { sessionId, count: 1 });
  assert.equal((foreignRead as { isError?: boolean }).isError, true);
  assert.match(JSON.stringify(foreignRead), /belongs to another agent/);
  const childOpen = await call(child, 'terminal_open', { type: 'shell', name: 'child' });
  assert.equal((childOpen as { isError?: boolean }).isError, true);
  assert.match(JSON.stringify(childOpen), /native child Agent.*raw (?:shell or )?terminal/i);
  const childBash = await call(child, 'bash', {
    command: 'printf ordinary-child-ok',
    description: 'Ordinary coding child shell remains available',
  });
  assert.equal(childBash.isError, false, JSON.stringify(childBash));

  const pending = resultValue(await call(sideTalk, 'terminal_send', { sessionId, text: 'sleep 10', run_in_background: true }));
  assert.equal(pending.kind, 'background');
  const interrupted = resultValue(await call(sideTalk, 'terminal_signal', { sessionId, signal: 'SIGINT' }));
  assert.equal(interrupted.delivered, true);
  const closed = resultValue(await call(sideTalk, 'terminal_close', { sessionId }));
  assert.equal(closed.outcome, 'closed');
});

test('a Campaign owner cannot occupy its turn with raw bash or a persistent terminal', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const sideTalk = await createRootAgent(host.ctx, home.h.workspace);
    const campaignChild = await createChildAgent(host.ctx, owner, home.h.workspace);
    const successor = await createChildAgent(host.ctx, sideTalk, home.h.workspace);
    const started = await host.ctx.hima.startRun({
      pack: timingProbePackId,
      site: 'local',
      goal: { target_period_ns: 2 },
      ownerSessionId: String(owner.id),
    });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;

    let sequence = 0;
    const call = (agent: typeof owner, name: string, arguments_: Record<string, unknown>) => host.ctx.tools.execute({
      callId: `campaign-shell-${++sequence}` as never,
      name,
      arguments: arguments_,
      agent,
      signal: AbortSignal.timeout(2_000),
    });

    const ownerBash = await call(owner, 'bash', {
      command: 'sleep 600',
      description: 'Attempt to wait for a Campaign Job outside Hima',
    });
    assert.equal(ownerBash.isError, true, 'a Campaign owner cannot hide a long Job wait in raw bash');
    assert.match(JSON.stringify(ownerBash), /Campaign Agent.*raw (?:shell|terminal)/i);

    const ownerTerminal = await call(owner, 'terminal_open', { type: 'shell', name: 'campaign-wait' });
    assert.equal(ownerTerminal.isError, true);
    assert.match(JSON.stringify(ownerTerminal), /Campaign Agent.*raw (?:shell|terminal)/i);

    const childBash = await call(campaignChild, 'bash', {
      command: 'sleep 600',
      description: 'Attempt to bypass Campaign delegation with a raw shell',
    });
    assert.equal(childBash.isError, true);
    assert.match(JSON.stringify(childBash), /(?:native child Agent.*raw (?:shell|terminal)|needs a recorded Hima delegation)/i);

    const childTerminal = await call(campaignChild, 'terminal_open', { type: 'shell', name: 'campaign-child-wait' });
    assert.equal(childTerminal.isError, true);
    assert.match(JSON.stringify(childTerminal), /(?:native child Agent.*raw (?:shell|terminal)|needs a recorded Hima delegation)/i);

    const control = host.ctx.hima.ledger.run(runId)!.control!;
    const handed = await host.ctx.hima.executionAction({
      runId,
      actor: String(owner.id),
      expectedEpoch: control.epoch,
      expectedRevision: control.revision,
      requestId: 'handoff-to-native-child-owner',
      action: 'handoff',
      targetOwner: String(successor.id),
    });
    assert.equal(handed.kind, 'accepted', handed.reason);
    const successorBash = await call(successor, 'bash', {
      command: 'sleep 600',
      description: 'Attempt raw shell after an explicit Run handoff',
    });
    assert.equal(successorBash.isError, true);
    assert.match(JSON.stringify(successorBash), /Campaign Agent.*raw (?:shell|terminal)/i);

    const sideTalkBash = await call(sideTalk, 'bash', {
      command: 'printf side-talk-ok',
      description: 'Ordinary Side Talk shell remains available',
    });
    assert.equal(sideTalkBash.isError, false, JSON.stringify(sideTalkBash));
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose();
    await home.h.dispose();
  }
});
