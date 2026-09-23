// Native-session qualification for S05 M1 / S06 C1-a.  It boots the real Hima
// profile in an isolated DSH home and never sends a model turn or starts a Job.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootInProcess, createChildAgent, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';

test('a real isolated Host persists a root session and resumes its effective model without a model turn', async (t) => {
  const home = await createHimaHome();
  t.after(() => home.dispose());

  let id: string;
  let effective: { provider: string; model: string };
  let host = await bootInProcess(home);
  try {
    const root = await createRootAgent(host.ctx, home.workspace);
    id = String(root.id);
    effective = { provider: root.options.provider!, model: root.options.model! };
    assert.equal(root.session.header.cwd, home.workspace);
    assert.equal(root.session.deriveMessages().length, 0, 'creation alone must not manufacture a transcript');
    assert.equal(host.ctx.get('agents')!.list().length, 1, 'the isolated Host owns one live root Agent');
  } finally {
    await host.dispose();
  }

  host = await bootInProcess(home);
  try {
    const resumed = await resumeTestAgent(host.ctx, id!, effective!);
    try {
      assert.equal(String(resumed.agent.id), id);
      assert.deepEqual(resumed.agent.options, effective, 'resume must use the explicit effective model selection');
      assert.equal(resumed.agent.session.header.cwd, home.workspace);
      assert.equal(resumed.agent.session.deriveMessages().length, 0, 'read-only resume must not invent a transcript or ask a model');
    } finally {
      await resumed.dispose();
    }
    assert.equal(host.ctx.get('agents')!.list().length, 0, 'the native handle disposer removes the resumed live Agent');
  } finally {
    await host.dispose();
  }
});

test('a native child preserves explicit lineage across Host restart without inheriting parent transcript', async (t) => {
  const home = await createHimaHome();
  t.after(() => home.dispose());
  let parentId: string;
  let childId: string;
  let effective: { provider: string; model: string };
  let host = await bootInProcess(home);
  try {
    const parent = await createRootAgent(host.ctx, home.workspace);
    const child = await createChildAgent(host.ctx, parent, home.workspace);
    parentId = String(parent.id); childId = String(child.id);
    effective = { provider: child.options.provider!, model: child.options.model! };
    assert.equal(host.ctx.get('agents')!.isOwnedBy(child.id, parent), true);
    assert.deepEqual(host.ctx.get('agents')!.roots().map((agent) => String(agent.id)), [parentId]);
    assert.equal(child.session.header.parentSession, parent.id);
    assert.equal(child.session.header.origin, 'subagent');
    assert.equal(child.session.header.delegationDepth, 1);
    assert.equal(child.session.deriveMessages().length, 0, 'a child needs an explicit seed to inherit history');
  } finally { await host.dispose(); }

  host = await bootInProcess(home);
  try {
    const resumed = await resumeTestAgent(host.ctx, childId!, effective!);
    try {
      assert.equal(String(resumed.agent.id), childId);
      assert.equal(resumed.agent.session.header.parentSession, parentId);
      assert.equal(resumed.agent.session.header.origin, 'subagent');
      assert.equal(resumed.agent.session.header.delegationDepth, 1);
      assert.equal(resumed.agent.session.deriveMessages().length, 0, 'resume must not fabricate parent history');
    } finally { await resumed.dispose(); }
  } finally { await host.dispose(); }
});
