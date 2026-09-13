// PLS-19: actual owner, controlled code and local Job; no model or Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import type { ExecutionActionRequest, RunRecord, LedgerRecord, RunView } from '@hima/harness';

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
    // Exercise the compiled shared projection using actual Host records; no moment rows are fabricated.
    const projection = (await import(new URL('../../packages/harness/lib/record-views.js', import.meta.url).href)).standingWorkshop as
      (run: RunRecord, records: readonly LedgerRecord[]) => RunView['workshop'];
    const workshopView = () => projection(host.ctx.hima.ledger.run(runId!)!, host.ctx.hima.ledger.records({ runId: runId! }));
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
    assert.equal(workshopView()?.executionId, executionId);
    assert.equal(workshopView()?.state, 'writing');
    assert.equal(workshopView()?.sessionId, undefined, 'the view does not invent a model-moment session before code exists');
    const input = await act('read', { executionId, output: 'numbers' });
    assert.equal(input.kind, 'accepted');
    assert.match(JSON.stringify(input.data), /3\\n7\\n11/);
    const knowledge = await act('knowledge', { executionId, file: 'sum.md' });
    assert.equal(knowledge.kind, 'accepted');
    assert.match(JSON.stringify(knowledge.data), /sum/i);
    const knowledgeRecord = host.ctx.hima.ledger.records({ runId, type: 'knowledge' }).find((record) => record.type === 'knowledge');
    assert.ok(knowledgeRecord?.type === 'knowledge', 'only the successful tool read is durable knowledge-use evidence');
    if (knowledgeRecord?.type !== 'knowledge') throw new Error('knowledge record missing');
    assert.equal(knowledgeRecord.nodeId, 'analyze');
    assert.equal(knowledgeRecord.attempt, 1);
    assert.equal(knowledgeRecord.sessionId, String(owner.id));
    assert.equal(knowledgeRecord.file, 'sum.md');
    assert.match(knowledgeRecord.purpose, /sum/i);
    const heldKnowledge = await host.ctx.hima.readMaterial(runId, knowledgeRecord.id);
    assert.equal(heldKnowledge.kind, 'read', JSON.stringify(heldKnowledge));
    assert.match(heldKnowledge.kind === 'read' ? heldKnowledge.text : '', /sum/i);
    const script = 'sleep 2\nmkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
    const written = await act('write', { executionId, path: 'entry.sh', content: script });
    assert.equal(written.kind, 'accepted');
    assert.equal((written.data as { wrote?: boolean }).wrote, true);
    assert.ok(written.receipt);
    const admitted = host.ctx.hima.ledger.run(runId)!.control!.requests[written.receipt.requestId]!;
    const duplicate = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: admitted.epoch,
      expectedRevision: admitted.revision, requestId: written.receipt.requestId, action: 'write', executionId, path: 'entry.sh', content: script });
    assert.equal(duplicate.kind, 'duplicate');
    assert.deepEqual(duplicate.data, written.data);
    const reviewedScript = `${script}# reviewed version\n`;
    assert.equal((await act('write', { executionId, path: 'entry.sh', content: reviewedScript })).kind, 'accepted');
    const versions = host.ctx.hima.ledger.records({ runId, type: 'code' });
    assert.equal(versions.length, 2, 'one path has two durable code versions, each with its own hash');
    const code = versions.findLast((record) => record.type === 'code');
    assert.ok(code?.type === 'code');
    assert.equal(code.sessionId, String(owner.id));
    assert.equal(workshopView()?.state, 'written');
    assert.equal(workshopView()?.sessionId, String(owner.id), 'the displayed code author is the actual conversational Agent');
    assert.deepEqual(workshopView()?.codeRecordIds, [code.id]);
    assert.ok(code.path.includes(`/.executions/${executionId}/`));
    assert.equal(await readFile(code.path, 'utf8'), reviewedScript);
    const heldCode = await host.ctx.hima.readMaterial(runId, code.id);
    assert.equal(heldCode.kind, 'read', JSON.stringify(heldCode));
    assert.equal(heldCode.kind === 'read' ? heldCode.text : '', reviewedScript);
    const otherRun = await host.ctx.hima.ledger.createRun({ campaignId: 'other-material-owner', siteId: 'local' });
    assert.equal((await host.ctx.hima.readMaterial(otherRun.id, code.id)).kind, 'none', 'a record id from this Run cannot expose a different Run\'s file');
    const forbidden = await host.ctx.hima.ledger.appendCode(otherRun.id, {
      nodeId: 'outside-permit', attempt: 1, sessionId: 'fixture-owner', workshop: 'fixture-workshop',
      path: '/outside-the-local-site-permit/recorded.sh', sha256: code.sha256, bytes: code.bytes, language: 'sh',
    });
    assert.equal((await host.ctx.hima.readMaterial(otherRun.id, forbidden.id)).kind, 'unreadable', 'the actual Site Permit refuses a recorded path outside its read roots');
    await writeFile(code.path, '# tampered\n');
    assert.equal((await host.ctx.hima.readMaterial(runId, code.id)).kind, 'changed', 'changed current bytes cannot impersonate a recorded version');
    await writeFile(code.path, reviewedScript);
    await rm(code.path);
    assert.equal((await host.ctx.hima.readMaterial(runId, code.id)).kind, 'unreadable', 'a missing recorded version is never replaced with another file');
    await writeFile(code.path, reviewedScript);
    const inspection = await act('read', { executionId, path: 'entry.sh' });
    assert.equal(inspection.kind, 'accepted');
    assert.match(JSON.stringify(inspection.data), /awk/);
    assert.equal((await act('pause', { nodeId: 'analyze' })).kind, 'accepted');
    assert.equal((await act('read', { executionId, output: 'numbers' })).kind, 'accepted', 'inspection remains available during a pause');
    assert.equal((await act('continue', { nodeId: 'analyze' })).kind, 'accepted');
    const escape = await act('write', { executionId, path: '../escape.sh', content: 'bad' });
    assert.equal((escape.data as { wrote?: boolean } | undefined)?.wrote ?? false, false);
    assert.equal((await act('work', { executionId })).kind, 'accepted');
    assert.equal(workshopView()?.state, 'running');
    assert.ok(workshopView()?.jobSession, 'the projection names the actual launched Job');
    assert.equal((await act('write', { executionId, path: 'entry.sh', content: 'echo forged' })).kind, 'refused');
    assert.equal(await readFile(code.path, 'utf8'), reviewedScript);
    await waitUntil('the owned Workshop Job result is ready', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === executionId && execution.phase === 'ready'));
    assert.equal(workshopView()?.state, 'awaiting-completion', 'successful Job work alone is not explicit Agent completion');
    assert.equal((await act('complete', { executionId })).kind, 'accepted');
    assert.equal(workshopView()?.state, 'done');
    const reading = await act('begin', { nodeId: 'read-analysis' });
    assert.ok(reading.receipt?.executionId);
    assert.equal((await act('work', { executionId: reading.receipt.executionId })).kind, 'accepted');
    await waitUntil('the declared reader validates the actual output', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === reading.receipt!.executionId && execution.phase === 'ready'));
    assert.equal((await act('complete', { executionId: reading.receipt.executionId })).kind, 'accepted');
    const observations = host.ctx.hima.ledger.records({ runId, type: 'observation' });
    assert.ok(observations.some((record) => record.type === 'observation'
      && record.values.some((value) => value.type === 'scaled_sum' && value.value === 42 && value.unit === 'count')),
    'the declared reader measured exactly 42 count from the generated output');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'session' }).length, 0, 'no separate model moment was opened or claimed closed');
    await host.ctx.hima.cancelRun(runId);
    assert.equal((await host.ctx.hima.readMaterial(runId, code.id)).kind, 'read', 'cancelling a Run does not erase its already recorded material history');
    const report = await host.ctx.hima.readExperience(runId);
    assert.equal(report.kind, 'read', JSON.stringify(report));
    if (report.kind === 'read') {
      assert.equal(report.json.schema, 'hima-experience/3');
      if (report.json.schema === 'hima-experience/3') {
        assert.equal(report.json.code.length, 2);
        assert.equal(report.json.knowledge.length, 1);
      }
    }
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});


for (const tamperHelper of [false, true]) test(`a begun Workshop draft retains its original author's code across handoff${tamperHelper ? ' and refuses a changed helper even when the new owner rewrites only entry' : ' and launches unchanged'}`, async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/authored-workshop');
  await mkdir(packDir, { recursive: true });
  for (const file of ['contract.yml', 'graph.yml', 'semantics.yml', 'readers', 'rules', 'tools', 'knowledge']) {
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop', file), path.join(packDir, file), { recursive: true });
  }
  await writeFile(path.join(packDir, 'PACK.md'), '# Numeric analysis handoff fixture\n');
  await writeFile(path.join(home.flow.root, 'numbers.txt'), '3\n7\n11\n');
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const original = await createRootAgent(host.ctx, home.h.workspace);
    const successor = await createRootAgent(host.ctx, home.h.workspace);
    let actor = String(original.id);
    const prepared = await host.ctx.hima.startRun({ pack: 'authored-workshop', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor });
    assert.equal(prepared.kind, 'ran');
    if (prepared.kind !== 'ran') return;
    runId = prepared.run.id;
    let sequence = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor, expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `handoff-${++sequence}`, action, ...fields });
    };
    const begun = await act('begin', { nodeId: 'analyze' });
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    const entry = 'set -eu\n. "$1/helper.sh"\nmkdir -p "$2/research/analysis"\nprintf "%s\\n" "$answer" > "$2/research/analysis/result.txt"\n';
    assert.equal((await act('write', { executionId, path: 'entry.sh', content: entry })).kind, 'accepted');
    assert.equal((await act('write', { executionId, path: 'helper.sh', content: 'answer=42\n' })).kind, 'accepted');
    const oldCode = host.ctx.hima.ledger.records({ runId, type: 'code' });
    assert.equal(oldCode.length, 2);
    const helper = oldCode.find((record) => record.type === 'code' && record.path.endsWith('/helper.sh'));
    assert.ok(helper?.type === 'code');
    const handoff = await act('handoff', { targetOwner: String(successor.id) });
    assert.equal(handoff.kind, 'accepted', handoff.reason);
    actor = String(successor.id);
    assert.equal((await act('continue')).kind, 'accepted');
    if (tamperHelper) {
      await writeFile(helper.path, 'answer=999\n');
      assert.equal((await act('write', { executionId, path: 'entry.sh', content: entry })).kind, 'accepted');
    }
    const work = await act('work', { executionId });
    assert.equal(work.kind, 'accepted');
    const launches = host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched');
    if (tamperHelper) {
      assert.equal(launches.length, 0, "rewriting entry never drops another author's helper hash from this execution");
      assert.equal(work.context.executions.find((execution) => execution.id === executionId)?.phase, 'failed');
      assert.match(JSON.stringify(host.ctx.hima.ledger.records({ runId, type: 'node' })), /helper.sh.*recorded|recorded.*helper.sh/);
      const entry = oldCode.find((record) => record.type === 'code' && record.path.endsWith('/entry.sh'));
      assert.ok(entry?.type === 'code');
      if (entry?.type === 'code') assert.equal((await host.ctx.hima.readMaterial(runId, entry.id)).kind, 'read', 'a failed node retains readable earlier recorded material');
    } else {
      assert.equal(launches.length, 1, 'the admitted execution owns the unchanged draft after explicit handoff');
      await waitUntil('the unchanged handed-off code finishes', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === executionId && execution.phase === 'ready'));
      assert.equal(await readFile(path.join(prepared.workspace, 'research/analysis/result.txt'), 'utf8'), '42\n');
    }
    assert.deepEqual(host.ctx.hima.ledger.records({ runId, type: 'code' }).slice(0, 2), oldCode, 'handoff preserves the original code records and authors');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'session' }).length, 0);
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});
