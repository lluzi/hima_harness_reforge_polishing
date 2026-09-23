import test from 'node:test';
import assert from 'node:assert/strict';
import { bootInProcess, createChildAgent, createRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';

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
  assert.match(JSON.stringify(childOpen), /native child Agent.*raw terminal/i);

  const pending = resultValue(await call(sideTalk, 'terminal_send', { sessionId, text: 'sleep 10', run_in_background: true }));
  assert.equal(pending.kind, 'background');
  const interrupted = resultValue(await call(sideTalk, 'terminal_signal', { sessionId, signal: 'SIGINT' }));
  assert.equal(interrupted.delivered, true);
  const closed = resultValue(await call(sideTalk, 'terminal_close', { sessionId }));
  assert.equal(closed.outcome, 'closed');
});
