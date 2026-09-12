// PLS-19: actual owner, controlled code and local Job; no model or Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import type { ExecutionActionRequest } from '../../packages/harness/src/fabric.js';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

test('the actual conversational owner reads inputs and knowledge, writes a version and launches it without a hidden model session', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/authored-workshop');
  await mkdir(packDir, { recursive: true });
  for (const file of ['contract.yml', 'graph.yml', 'semantics.yml', 'readers', 'rules', 'tools', 'knowledge']) {
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop', file), path.join(packDir, file), { recursive: true });
  }
  await writeFile(path.join(packDir, 'PACK.md'), '# Numeric analysis mechanism fixture\n');
  await writeFile(path.join(home.flow.root, 'numbers.txt'), '3\n7\n11\n');
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    let request = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `workshop-${++request}`, action, ...fields });
    };
    const begun = await act('begin', { nodeId: 'analyze' });
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    const description = await act('recommend', { executionId });
    assert.equal(description.kind, 'accepted');
    assert.match(JSON.stringify(description.data), /result\.txt/);
    const input = await act('read', { executionId, output: 'numbers' });
    assert.equal(input.kind, 'accepted');
    assert.match(JSON.stringify(input.data), /3\\n7\\n11/);
    const knowledge = await act('knowledge', { executionId, file: 'sum.md' });
    assert.equal(knowledge.kind, 'accepted');
    assert.match(JSON.stringify(knowledge.data), /sum/i);
    const script = 'sleep 2\nmkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
    const written = await act('write', { executionId, path: 'entry.sh', content: script });
    assert.equal(written.kind, 'accepted');
    assert.equal((written.data as { wrote?: boolean }).wrote, true);
    const code = host.ctx.hima.ledger.records({ runId, type: 'code' }).find((record) => record.type === 'code');
    assert.ok(code?.type === 'code');
    assert.equal(code.sessionId, String(owner.id));
    assert.ok(code.path.includes(`/.executions/${executionId}/`));
    assert.equal(await readFile(code.path, 'utf8'), script);
    const inspection = await act('read', { executionId, path: 'entry.sh' });
    assert.equal(inspection.kind, 'accepted');
    assert.match(JSON.stringify(inspection.data), /awk/);
    const escape = await act('write', { executionId, path: '../escape.sh', content: 'bad' });
    assert.equal((escape.data as { wrote?: boolean } | undefined)?.wrote ?? false, false);
    assert.equal((await act('work', { executionId })).kind, 'accepted');
    assert.equal((await act('write', { executionId, path: 'entry.sh', content: 'echo forged' })).kind, 'refused');
    assert.equal(await readFile(code.path, 'utf8'), script);
    await waitUntil('the owned Workshop Job result is ready', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === executionId && execution.phase === 'ready'));
    assert.equal((await act('complete', { executionId })).kind, 'accepted');
    const reading = await act('begin', { nodeId: 'read-analysis' });
    assert.ok(reading.receipt?.executionId);
    assert.equal((await act('work', { executionId: reading.receipt.executionId })).kind, 'accepted');
    await waitUntil('the declared reader validates the actual output', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === reading.receipt!.executionId && execution.phase === 'ready'));
    assert.equal((await act('complete', { executionId: reading.receipt.executionId })).kind, 'accepted');
    const observations = host.ctx.hima.ledger.records({ runId, type: 'observation' });
    assert.match(JSON.stringify(observations), /42/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'session' }).length, 0, 'no separate model moment was opened or claimed closed');
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});
