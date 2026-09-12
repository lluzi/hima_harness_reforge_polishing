// PLS-13: historical numeric meaning at real Host command, tool, and HTTP seams.
// The wait-only method starts no model, Job, SSH connection, or EDA tool.
// @hima-seam tools direct
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportPackMethod, installPackMethod, type RunView } from '@hima/harness';
import { seedLocalSite } from '../../packages/desktop/src/local-site.ts';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { himaCommand } from './support/command.ts';
import { api, openSession } from './support/hima-api.ts';

const packId = 'opene902-timing-probe';
const originalWords = {
  goal: { target_period_ns: { label: 'clock period at most', unit: 'ns' } },
  strategy: { periodNs: { label: 'clock period', unit: 'ns' } },
};

test('old Run labels and units survive a method upgrade and an unreadable current installation on every Host read face', async (t) => {
  const previous = process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '1';
  t.after(() => { if (previous === undefined) delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE; else process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = previous; });
  const h = await createHimaHome();
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  let web: Awaited<ReturnType<typeof bootHimaHost>> | undefined;
  t.after(async () => { await host?.dispose(); await web?.stop(); await h.dispose(); });
  const source = path.join(h.home, 'source/packs', packId);
  await mkdir(path.dirname(source), { recursive: true });
  exportPackMethod({ from: path.join(repoRoot, 'packs', packId), to: source });
  const graphFile = path.join(source, 'graph.yml');
  await writeFile(graphFile, (await readFile(graphFile, 'utf8')).replace('entry: synthesize', 'entry: blocked'));
  const seeded = await seedLocalSite({ home: h.home, checkout: path.join(h.home, 'source') });
  host = await bootInProcess(h);
  // Actual public Host admission, explicitly marked test. No owner models a pre-agent Run.
  const opened = await host.ctx.hima.startRun({ pack: packId, site: 'local', goal: { target_period_ns: 2 }, strategy: { periodNs: 2.25 }, test: true });
  assert.ok(opened.kind === 'ran', JSON.stringify(opened));
  assert.equal(opened.run.status, 'waiting');
  assert.ok(opened.run.packDigest);
  assert.equal(host.ctx.hima.ledger.records({ runId: opened.run.id, type: 'job' }).length, 0);
  const agent = await createRootAgent(host.ctx, h.workspace);
  let callId = 0;
  const statusTool = async (): Promise<RunView & { kind: string }> => {
    const result = await host!.ctx.tools.execute({ name: 'hima_status', arguments: { run: opened.run.id }, callId: `historical-words-${++callId}` as never, agent, signal: AbortSignal.timeout(10_000) });
    assert.equal(result.isError, false, JSON.stringify(result));
    return JSON.parse(result.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
  };
  assert.deepEqual((await statusTool()).run.words, originalWords);
  const contractFile = path.join(source, 'contract.yml');
  await writeFile(contractFile, (await readFile(contractFile, 'utf8')).replace("version: '2'", "version: '3'").replaceAll('unit: ns', 'unit: ps').replaceAll('label: clock period', 'label: upgraded period'));
  await writeFile(graphFile, (await readFile(graphFile, 'utf8')).replace("version: '2'", "version: '3'"));
  installPackMethod({ from: source, to: seeded.packDir });

  const command = await himaCommand(host, h.workspace, `/hima status ${opened.run.id}`);
  assert.equal(command.kind, 'success', command.text);
  assert.match(command.text, /goal: clock period at most 2 ns/);
  assert.match(command.text, /strategy: clock period 2.25 ns/);
  const upgradedView = await statusTool();
  assert.equal(upgradedView.kind, 'run');
  assert.deepEqual(upgradedView.run.words, originalWords);
  const installedContract = await readFile(path.join(seeded.packDir, 'contract.yml'), 'utf8');
  await writeFile(path.join(seeded.packDir, 'contract.yml'), 'invalid: [');
  const unreadableView = await statusTool();
  assert.equal(unreadableView.kind, 'run', JSON.stringify(unreadableView));
  assert.deepEqual(unreadableView.run.words, originalWords);
  const contextResult = await host.ctx.tools.execute({ name: 'hima_context', arguments: { run: opened.run.id }, callId: 'historical-context' as never, agent, signal: AbortSignal.timeout(10_000) });
  assert.equal(contextResult.isError, false, JSON.stringify(contextResult));
  const context = JSON.parse(contextResult.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
  assert.deepEqual(context.facts.run.words, originalWords);
  assert.match((await himaCommand(host, h.workspace, `/hima status ${opened.run.id}`)).text, /goal: clock period at most 2 ns/);
  await writeFile(path.join(seeded.packDir, 'contract.yml'), installedContract);
  await host.dispose();
  host = undefined;

  web = await bootHimaHost(h);
  const cookie = await openSession(web);
  const readView = async (): Promise<RunView> => {
    const response = await api(web!, cookie, `/hima/api/runs/${opened.run.id}`);
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text);
  };
  assert.deepEqual((await readView()).run.words, originalWords);
  const choicesResponse = await api(web, cookie, `/hima/api/start-options?pack=${packId}&site=local`);
  assert.equal(choicesResponse.status, 200);
  const choices = await choicesResponse.json() as { words?: RunView['run']['words'] };
  assert.deepEqual(choices.words?.goal.target_period_ns, { label: 'upgraded period at most', unit: 'ps' });
  await writeFile(path.join(seeded.packDir, 'contract.yml'), 'invalid: [');
  assert.deepEqual((await readView()).run.words, originalWords);

  // Ending this real waiting Run after the upgrade generates its report from the retained method.
  const cancelled = await api(web, cookie, `/hima/api/runs/${opened.run.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200, await cancelled.text());
  const reportResponse = await api(web, cookie, `/hima/api/runs/${opened.run.id}/experience`);
  const report = await reportResponse.text();
  assert.equal(reportResponse.status, 200, report);
  assert.match(report, /clock period 2.25 ns/);
  assert.doesNotMatch(report, /upgraded period/);
});

test('historical Run records with missing or unavailable method identity never borrow current labels', async (t) => {
  const h = await createHimaHome();
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  let web: Awaited<ReturnType<typeof bootHimaHost>> | undefined;
  t.after(async () => { await host?.dispose(); await web?.stop(); await h.dispose(); });
  await seedLocalSite({ home: h.home, checkout: repoRoot });
  host = await bootInProcess(h);
  const agent = await createRootAgent(host.ctx, h.workspace);
  const runIds: string[] = [];
  for (const [identity, digest] of [['missing', undefined], ['unavailable', '0'.repeat(64)]] as const) {
    // Public Run records describe legacy/unknown identity, with no invented execution or verdict.
    const run = await host.ctx.hima.ledger.createRun({ campaignId: `historical-${identity}-fixture`, siteId: 'local', packId, purpose: 'test', goal: { target_period_ns: 2 }, strategy: { periodNs: 2.25 }, ...(digest === undefined ? {} : { packDigest: digest }) });
    runIds.push(run.id);
    const command = await himaCommand(host, h.workspace, `/hima status ${run.id}`);
    assert.equal(command.kind, 'success', command.text);
    assert.match(command.text, /target_period_ns/);
    assert.doesNotMatch(command.text, /clock period|\bns\b/);
    const result = await host.ctx.tools.execute({ name: 'hima_status', arguments: { run: run.id }, callId: `historical-${identity}` as never, agent, signal: AbortSignal.timeout(10_000) });
    assert.equal(result.isError, false, JSON.stringify(result));
    const answer = JSON.parse(result.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
    if (digest === undefined) {
      assert.equal(answer.kind, 'run');
      assert.equal(answer.run.words, undefined);
    } else {
      assert.equal(answer.kind, 'unreadable');
      assert.match(answer.reason, /no verified original snapshot/);
    }
  }
  await host.dispose();
  host = undefined;
  web = await bootHimaHost(h);
  const cookie = await openSession(web);
  for (const runId of runIds) {
    const response = await api(web, cookie, `/hima/api/runs/${runId}`);
    assert.equal(response.status, 200);
    const view = await response.json() as RunView;
    assert.equal(view.run.words, undefined);
    assert.deepEqual(view.run.goal, { target_period_ns: 2 });
  }
});
