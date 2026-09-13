// L3: one actual local Host/Workshop revision, retained history, report and Pack archive in Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { killSessions, localHome, sessionsOf, waitUntil } from './support/fabric.ts';
import { repoRoot } from './support/dsh-home.ts';
import { bootDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { api } from './support/hima-api.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { writeExecutionReplay } from './support/agent-execution-replay.ts';
import { writeExperience, writeRunAssets, type ExecutionActionRequest, type RevisionProposal, type RunView } from '@hima/harness';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const identity = (value: unknown): string => {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)).map(([key, field]) => [key, stable(field)])) : item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
};

async function installRevisionPack(home: string, packDir: string): Promise<void> {
  await mkdir(packDir, { recursive: true });
  for (const file of ['contract.yml', 'graph.yml', 'semantics.yml', 'readers', 'rules', 'tools', 'knowledge']) {
    await cp(path.join(repoRoot, 'test/fixtures/pipeline/workshop', file), path.join(packDir, file), { recursive: true });
  }
  for (const file of ['contract.yml', 'graph.yml']) {
    const target = path.join(packDir, file);
    const text = await readFile(target, 'utf8');
    await writeFile(target, text.replaceAll('authored-workshop', 'revision-assets-ui'));
  }
  await writeFile(path.join(packDir, 'PACK.md'), '# Local revision and archive UI fixture\n');
  await writeFile(path.join(home, 'numbers.txt'), '3\n7\n11\n');
}

test('the native workbench keeps a superseded Workshop version readable beside its current revision and archived report', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  const pack = 'revision-assets-ui';
  await installRevisionPack(home.flow.root, path.join(home.h.home, 'hima/packs', pack));
  const host = await bootInProcess(home.h); let runId: string | undefined; let sessions: string[] = [];
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return; runId = started.run.id;
    let request = 0;
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch,
        expectedRevision: control.revision, requestId: `revision-assets-${++request}`, action, ...fields });
    };
    const begun = await act('begin', { nodeId: 'analyze' }); assert.equal(begun.kind, 'accepted');
    const executionId = begun.receipt!.executionId!;
    assert.equal((await act('recommend', { executionId })).kind, 'accepted');
    assert.equal((await act('knowledge', { executionId, file: 'sum.md' })).kind, 'accepted');
    const original = 'mkdir -p "$2/research/analysis"\nawk -v scale="$3" \'{sum+=$1} END {print sum*scale}\' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n';
    assert.equal((await act('write', { executionId, path: 'entry.sh', content: original })).kind, 'accepted');
    assert.equal((await act('work', { executionId })).kind, 'accepted');
    await waitUntil('original Workshop is ready', () => host.ctx.hima.executionContext(runId!).executions.some((item) => item.id === executionId && item.phase === 'ready'));
    assert.equal((await act('complete', { executionId })).kind, 'accepted');
    const read = await act('begin', { nodeId: 'read-analysis' }); assert.equal(read.kind, 'accepted');
    const readId = read.receipt!.executionId!;
    assert.equal((await act('work', { executionId: readId })).kind, 'accepted');
    await waitUntil('original report read is ready', () => host.ctx.hima.executionContext(runId!).executions.some((item) => item.id === readId && item.phase === 'ready'));
    assert.equal((await act('complete', { executionId: readId })).kind, 'accepted');
    const context = host.ctx.hima.executionContext(runId);
    const source = host.ctx.hima.ledger.records({ runId, type: 'code' }).findLast((record) => record.type === 'code');
    const workspace = host.ctx.hima.ledger.records({ runId }).find((record) => record.type === 'workspace');
    assert.ok(source?.type === 'code' && workspace?.type === 'workspace');
    const revised = `${original}# revision retained for audit\n`;
    const proposal: RevisionProposal = { revisionId: 'audit-analysis-v2', method: { id: context.method!.id, version: context.method!.version, digest: context.method!.digest },
      inputThroughSeq: context.run.nextSeq - 1, inputs: [{ recordId: workspace.id, contentIdentity: identity(workspace) }],
      reason: 'retain the completed algorithm while correcting its next version', changedNodes: ['analyze'], affectedNodes: ['analyze', 'read-analysis', 'judge'],
      changes: [{ nodeId: 'analyze', scope: 'workshop', path: 'entry.sh', fromSha256: source.sha256, content: revised, sourceRecordId: source.id }] };
    assert.equal((await act('revise', { revision: proposal })).kind, 'accepted');
    await host.ctx.hima.cancelRun(runId);
    const deps = { ledger: host.ctx.hima.ledger, sitesDir: path.join(home.h.home, 'hima/sites'), packsDir: path.join(home.h.home, 'hima/packs') };
    const experience = await writeExperience(deps, runId); assert.ok(experience.kind === 'written' || experience.kind === 'already');
    const archive = await writeRunAssets(deps, runId); assert.ok(archive.kind === 'written' || archive.kind === 'already');
    const view = (await import(new URL('../../packages/harness/lib/remote.js', import.meta.url).href)).runView(host.ctx.hima.ledger, host.ctx.hima.ledger.run(runId)!);
    assert.equal(view.run.status, 'cancelled'); assert.equal(view.revisions[0]?.revisionId, proposal.revisionId);
    assert.ok(view.archive?.delivery === 'complete'); assert.ok(view.experience); assert.ok(view.knowledge.length > 0);
    const expired = await host.ctx.hima.startRun({ pack, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id), timeBoxMs: 1 });
    assert.ok('run' in expired);
    const expiredId = expired.run.id;
    await waitUntil('a real finite Campaign stops at its hard boundary', () => host.ctx.hima.ledger.run(expiredId)?.status === 'ended-budget-exhausted');
    sessions = sessionsOf(host, runId); await host.dispose();
    const replay = await writeExecutionReplay(home.h); const port = await freePort();
    const driver = await bootDriver(t, { existing: home.h, remoteDebuggingPort: port, model: { replay }, theme: 'light', window: { width: 1440, height: 960 },
      env: { HIMA_TEST_SILENT_AGENT: '1', HIMA_TEST_LEGACY_AUTO_DRIVE: '0' } });
    if (!driver) { killSessions(sessions); return; }
    const browser = await inspectWindow(port);
    try {
      await driver.open('/'); await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
      await browser.markText('button', 'Continue', 'notice-continue'); assert.ok((await driver.click('notice-continue')).ok);
      const desktopHost = await driver.host(); assert.ok(desktopHost.ok); const cookie = await driver.cookie();
      const created = await api(desktopHost, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        type: 'client-request', rpcId: 'revision-assets-workspace', method: 'workspace/create', payload: { args: { request: { path: home.h.workspace } } },
      }) });
      assert.equal((await created.json() as { result: { ok: boolean } }).result.ok, true);
      await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
      await browser.markText('button', 'New Session', 'revision-assets-session'); assert.ok((await driver.click('revision-assets-session')).ok);
      await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
      assert.ok((await driver.click('open-workbench')).ok); assert.ok((await driver.wait('studio', 'Research workspace')).ok);
      assert.ok((await driver.fill('studio-run', runId)).ok);
      assert.ok((await driver.wait('run-revisions', 'audit-analysis-v2')).ok);
      assert.ok((await driver.click('revision-expand-audit-analysis-v2')).ok);
      const revisions = await driver.read('run-revisions'); assert.ok(revisions.ok);
      assert.match(revisions.text, /earlier records excluded from current evidence/); assert.match(revisions.text, /records reused/);
      const materials = await driver.read('run-material'); assert.ok(materials.ok);
      assert.match(materials.text, /superseded/); assert.match(materials.text, /method knowledge/);
      assert.ok((await driver.click(`material-${source.id}`)).ok);
      assert.ok((await driver.wait('material-content', 'awk -v scale', 12_000)).ok);
      assert.ok((await driver.click('archive-verify')).ok);
      assert.ok((await driver.wait('run-archive', 'experience.md', 12_000)).ok);
      assert.ok((await driver.click('archive-material-experience.md')).ok);
      assert.ok((await driver.wait('archive-content', 'Recorded code versions', 12_000)).ok);
      const archived = await driver.read('archive-content'); assert.ok(archived.ok);
      assert.match(archived.text, /Knowledge and input provenance/); assert.match(archived.text, /The budget/);
      if (process.env.HIMA_UI_ARTIFACTS) {
        await mkdir(process.env.HIMA_UI_ARTIFACTS, { recursive: true });
        assert.ok((await driver.screenshot(path.join(process.env.HIMA_UI_ARTIFACTS, 'revision-history-archive.png'))).ok);
      }
      await driver.fill('studio-run', expiredId);
      await browser.wait(`document.querySelector('[data-hima-region="studio-status"]')?.getAttribute('data-hima-state-status') === 'ended-budget-exhausted'`);
      await browser.markText('summary', 'Budget and resource use', 'budget-details');
      assert.ok((await driver.click('budget-details')).ok);
      const stopped = await driver.read('studio-status'); assert.ok(stopped.ok);
      assert.equal(stopped.state.status, 'ended-budget-exhausted');
      assert.match(stopped.text, /time box/i);
      assert.equal(await browser.evaluate<boolean>(`Boolean(document.querySelector('[data-hima-control="cancel"]'))`), false, 'ended Campaign offers no active stop action');
      if (process.env.HIMA_UI_ARTIFACTS) assert.ok((await driver.screenshot(path.join(process.env.HIMA_UI_ARTIFACTS, 'campaign-budget-stopped.png'))).ok);
    } catch (error) { t.diagnostic(await browser.evaluate<string>('document.body.innerText')); throw error; }
    finally { browser.close(); await driver.dispose(); killSessions(sessions); }
  } finally {
    if (runId && sessions.length === 0) { sessions = sessionsOf(host, runId); await host.ctx.hima.cancelRun(runId).catch(() => undefined); }
    killSessions(sessions);
    await host.dispose().catch(() => undefined); await home.h.dispose();
  }
});
