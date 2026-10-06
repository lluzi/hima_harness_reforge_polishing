// PLS-13: historical numeric meaning at real Host command, tool, and HTTP seams.
// Ended historical fixtures start no model, Job, SSH connection, or EDA tool.
// @hima-seam tools direct
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { exportPackMethod, installPackMethod, loadRunPack, packDigestOf, preservePackMethod, snapshotPackFolder, type ExperienceAnswer, type ExperienceJson, type RecordsView, type RunView } from '@hima/harness';
import { seedLocalSite } from '../../packages/desktop/src/local-site.ts';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { himaCommand } from './support/command.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const packId = 'opene902-timing-probe';
const originalWords = {
  goal: { target_period_ns: { label: 'clock period at most', unit: 'ns' } },
  strategy: { periodNs: { label: 'clock period', unit: 'ns' } },
};

test('old Run labels and units survive a method upgrade and an unreadable current installation on every Host read face', async (t) => {
  const h = await createHimaHome();
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  let web: Awaited<ReturnType<typeof bootHimaHost>> | undefined;
  t.after(async () => { await host?.dispose(); if (web) assert.equal(await web.stop(), 0, web.stderr()); await h.dispose(); });
  const source = path.join(h.home, 'source/packs', packId);
  await mkdir(path.dirname(source), { recursive: true });
  exportPackMethod({ from: path.join(repoRoot, 'packs', packId), to: source });
  const graphFile = path.join(source, 'graph.yml');
  const seeded = await seedLocalSite({ home: h.home, checkout: path.join(h.home, 'source') });
  host = await bootInProcess(h);
  const agent = await createRootAgent(host.ctx, h.workspace);
  const digest = packDigestOf(seeded.packDir);
  const retainedDir = preservePackMethod(snapshotPackFolder(seeded.packDir));
  assert.equal(loadRunPack(path.dirname(seeded.packDir), packId, digest).contract.version, '2');
  assert.equal(packDigestOf(source), digest, 'the installed original method matches its source');
  const contractBytes = await readFile(path.join(retainedDir, 'contract.yml'));
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const contractHash = hash(contractBytes);
  // An ended original Ledger row, owned by this real project actor; no DBOS execution is invented.
  const run = await host.ctx.hima.ledger.createRun({ campaignId: 'historical-words-fixture', siteId: 'local', packId,
    control: { mode: 'agent', owner: String(agent.id), epoch: 1, revision: 0, paused: [], executions: {}, requests: {} }, purpose: 'test', status: 'cancelled', packDigest: digest,
    goal: { target_period_ns: 2 }, firstStrategy: { periodNs: 2.25 }, strategy: { periodNs: 2.25 } });
  const writtenAt = '2026-09-01T12:00:00.000Z';
  const originalReport: ExperienceJson = { schema: 'hima-experience/1', runId: run.id, campaignId: run.campaignId,
    pack: { id: packId, version: '2' }, site: 'local', ending: { status: 'cancelled', reason: 'historical cancellation' },
    generations: [], path: [], blockers: [], cancels: [], writtenAt };
  const markdown = '# Original timing report\n\ngoal: clock period at most 2 ns\nstrategy: clock period 2.25 ns\n';
  const json = JSON.stringify(originalReport);
  const reportDir = path.join(seeded.workspaceRoot, run.id, 'historical-report');
  await mkdir(reportDir, { recursive: true });
  const mdPath = path.join(reportDir, 'experience.md');
  const jsonPath = path.join(reportDir, 'experience.json');
  await writeFile(mdPath, markdown); await writeFile(jsonPath, json);
  const record = await host.ctx.hima.ledger.appendExperience(run.id, { writtenAt,
    markdown: { path: mdPath, sha256: hash(markdown), bytes: Buffer.byteLength(markdown) },
    json: { path: jsonPath, sha256: hash(json), bytes: Buffer.byteLength(json) } });
  const reportTimes = [(await stat(mdPath)).mtimeMs, (await stat(jsonPath)).mtimeMs];
  assert.equal(host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }).length, 0);
  let callId = 0;
  const statusTool = async (): Promise<RunView & { kind: string }> => {
    const result = await host!.ctx.tools.execute({ name: 'hima_status', arguments: { run: run.id }, callId: `historical-words-${++callId}` as never, agent, signal: AbortSignal.timeout(10_000) });
    assert.equal(result.isError, false, JSON.stringify(result));
    return JSON.parse(result.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
  };
  assert.deepEqual((await statusTool()).run.words, originalWords);
  const contractFile = path.join(source, 'contract.yml');
  await writeFile(contractFile, (await readFile(contractFile, 'utf8')).replace("version: '2'", "version: '3'").replaceAll('unit: ns', 'unit: ps').replaceAll('label: clock period', 'label: upgraded period'));
  await writeFile(graphFile, (await readFile(graphFile, 'utf8')).replace("version: '2'", "version: '3'"));
  installPackMethod({ from: source, to: seeded.packDir });

  const command = await himaCommand(host, h.workspace, `/hima status ${run.id}`, undefined, agent);
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
  const contextResult = await host.ctx.tools.execute({ name: 'hima_context', arguments: { run: run.id }, callId: 'historical-context' as never, agent, signal: AbortSignal.timeout(10_000) });
  assert.equal(contextResult.isError, false, JSON.stringify(contextResult));
  const context = JSON.parse(contextResult.content.filter((item) => item.type === 'text').map((item) => item.text).join(''));
  assert.deepEqual(context.facts.run.words, originalWords);
  assert.match((await himaCommand(host, h.workspace, `/hima status ${run.id}`, undefined, agent)).text, /goal: clock period at most 2 ns/);
  await writeFile(path.join(seeded.packDir, 'contract.yml'), installedContract);
  await host.dispose();
  host = undefined;

  web = await bootHimaHost(h);
  const cookie = await openSession(web);
  const sessionId = await createLiveSession(web, cookie, h.workspace);
  const readView = async (): Promise<RunView> => {
    const response = await api(web!, cookie, `/hima/api/runs/${run.id}?sessionId=${encodeURIComponent(sessionId)}`);
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

  const reportResponse = await api(web, cookie, `/hima/api/runs/${run.id}/experience?sessionId=${encodeURIComponent(sessionId)}`);
  const answer = await reportResponse.json() as ExperienceAnswer;
  assert.equal(reportResponse.status, 200, JSON.stringify(answer));
  assert.equal(answer.markdown, markdown);
  assert.deepEqual(answer.report, originalReport);
  assert.equal(answer.experience.markdown.sha256, record.markdown.sha256);
  assert.equal(answer.experience.json.sha256, record.json.sha256);
  assert.match(answer.markdown, /clock period 2.25 ns/);
  assert.doesNotMatch(answer.markdown, /upgraded period/);
  assert.equal(await readFile(mdPath, 'utf8'), markdown);
  assert.equal(await readFile(jsonPath, 'utf8'), json, 'retained bytes are not rewritten at startup or read');
  assert.deepEqual([(await stat(mdPath)).mtimeMs, (await stat(jsonPath)).mtimeMs], reportTimes);
  assert.deepEqual(await readFile(path.join(retainedDir, 'contract.yml')), contractBytes);
  assert.equal(hash(await readFile(path.join(retainedDir, 'contract.yml'))), contractHash);
  assert.equal(loadRunPack(path.dirname(seeded.packDir), packId, digest).contract.version, '2');
  assert.equal(packDigestOf(retainedDir), digest, 'every original method file remains unchanged');
  assert.equal((await readView()).run.status, 'cancelled');
  const recordsResponse = await api(web, cookie, `/hima/api/runs/${run.id}/records?sessionId=${encodeURIComponent(sessionId)}`);
  assert.equal(recordsResponse.status, 200);
  const records = await recordsResponse.json() as RecordsView;
  assert.deepEqual(records.records.filter(item => item.type === 'experience'), [record]);
  assert.equal(records.records.filter(item => item.type === 'job').length, 0, 'historical reads start no current Jobs');
  const listResponse = await api(web, cookie, `/hima/api/runs?sessionId=${encodeURIComponent(sessionId)}`);
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json() as { runs: { id: string }[] };
  assert.deepEqual(listed.runs.map(item => item.id), [run.id], 'historical reads create no additional Run');
});

test('historical Run records with missing or unavailable method identity never borrow current labels', async (t) => {
  const h = await createHimaHome();
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  let web: Awaited<ReturnType<typeof bootHimaHost>> | undefined;
  t.after(async () => { await host?.dispose(); if (web) assert.equal(await web.stop(), 0, web.stderr()); await h.dispose(); });
  await seedLocalSite({ home: h.home, checkout: repoRoot });
  host = await bootInProcess(h);
  const agent = await createRootAgent(host.ctx, h.workspace);
  const runIds: string[] = [];
  for (const [identity, digest] of [['missing', undefined], ['unavailable', '0'.repeat(64)]] as const) {
    // Public Run records describe legacy/unknown identity, with no invented execution or verdict.
    const run = await host.ctx.hima.ledger.createRun({ campaignId: `historical-${identity}-fixture`, siteId: 'local', packId, control: { mode: 'agent', owner: String(agent.id), epoch: 1, revision: 0, paused: [], executions: {}, requests: {} }, status: 'cancelled', purpose: 'test', goal: { target_period_ns: 2 }, strategy: { periodNs: 2.25 }, ...(digest === undefined ? {} : { packDigest: digest }) });
    runIds.push(run.id);
    assert.equal(host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }).length, 0);
    const command = await himaCommand(host, h.workspace, `/hima status ${run.id}`, undefined, agent);
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
  const sessionId = await createLiveSession(web, cookie, h.workspace);
  for (const runId of runIds) {
    const response = await api(web, cookie, `/hima/api/runs/${runId}?sessionId=${encodeURIComponent(sessionId)}`);
    assert.equal(response.status, 200);
    const view = await response.json() as RunView;
    assert.equal(view.run.words, undefined);
    assert.deepEqual(view.run.goal, { target_period_ns: 2 });
  }
});
