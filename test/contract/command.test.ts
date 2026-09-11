// @hima-seam commands direct
// Ticket #2: a user-invocable Hima version command runs without a model turn and reports bundle and host versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
// Loads the `ctx.commands` declaration merge onto Context.
import type {} from '@deepseek-ai/dsh-commands';

const bundleVersion = JSON.parse(readFileSync(path.join(repoRoot, 'packages/harness/package.json'), 'utf8')).version as string;
const hostVersion = JSON.parse(readFileSync(path.join(repoRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version as string;

test('/hima version answers with the bundle and host versions, without a model turn', async () => {
  const h = await createHimaHome();
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    const seqBefore = agent.session.seq;
    const exec = await host.ctx.commands.execute(agent, '/hima version', [], AbortSignal.timeout(10_000));
    assert.ok(exec, 'the hima command resolves');
    assert.equal(exec.result.kind, 'success', JSON.stringify(exec.result));
    const text = exec.result.kind === 'success' ? exec.result.text ?? '' : '';
    assert.match(text, new RegExp(`HimaHarness ${bundleVersion.replaceAll('.', '\\.')}`), 'bundle version reported');
    assert.match(text, new RegExp(`DeepSeek Harness ${hostVersion.replaceAll('.', '\\.')}`), 'host version reported');
    assert.ok(agent.session.seq > seqBefore, 'the command left its command/run and command/done records');
  } finally {
    await host.dispose();
    await h.dispose();
  }
});
