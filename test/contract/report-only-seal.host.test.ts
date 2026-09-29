// @hima-seam agent wrapped
// @hima-seam tools direct
// Issue #63: the report-only seal of an already ended test Run, in a desktop-shaped home. The live
// ATCS seal (scripts/finalize-atcs-native-test.ts) was refused twice on the tester's kit: the home had
// no `<home>/workspace` (a desktop kit keeps its workspace beside the home), and the Run's owner — a
// session the App made under the `workspace-write` preset — was denied every write of TEST.md into the
// installed Pack folder, which lies outside that workspace, with no approval channel to ask. The dry
// path never saw either, because a test home under the platform temp area is inside `workspace-write`.
//
// This drives `sealEndedTestRun`, the procedure the script runs, on the replay stand-in and the
// shipped timing-probe Pack (compiled by adding its three pipeline records), in a home made outside
// the temp areas with its workspace beside it. The owner that opened the Run is the one resumed, and
// the transcript is what a model does under the sandbox: the plain write is denied, and it retries
// the same write asking for `danger-full-access` with a justification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { HIMA_FABRIC_SECTIONS, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS, HIMA_TEST_SECTIONS, checkTestRecord, loadPack, packStage } from '@hima/harness';
import { bootInProcess, createRootAgent, sayAsUser, toolCalls, toolResults } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { packsDirOf, timingProbePackId, writePackFiles } from './support/pack.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { sealEndedTestRun } from '../../scripts/report-only-seal.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const packId = timingProbePackId;
const within = (candidate: string, root: string): boolean => candidate === root || candidate.startsWith(root + path.sep);
const record = (sections: readonly string[]): string => sections.map((s) => `## ${s}\n\nrecorded by the authoring pipeline\n`).join('\n');

/** One transcript entry: a tool call, or the closing text. The replay adapter's own chunk grammar. */
const toolCall = (id: string, name: string, args: unknown) => ({ kind: 'chunks', chunks: [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } }] });
const said = (text: string) => ({ kind: 'chunks', chunks: [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } }] });

test('report-only seal in a desktop-shaped home: the App-made workspace-write owner writes TEST.md into the installed Pack and seals, and the ended Run is unchanged', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0, desktopShaped: true });
  if (!local) return;
  const { h } = local;
  t.after(() => h.dispose());
  assert.ok(!within(h.workspace, h.home), 'the workspace lies beside the home, as a desktop kit keeps it');
  const packDir = path.join(packsDirOf(h), packId);
  await writePackFiles(packDir, { 'INTENT.md': record(HIMA_INTENT_SECTIONS), 'SPEC.md': record(HIMA_SPEC_SECTIONS), 'FABRIC.md': record(HIMA_FABRIC_SECTIONS) });
  assert.equal(packStage(packDir).stage, 'compiled', JSON.stringify(packStage(packDir)));
  // The source tree the tested bytes came from; the seal copies TEST.md and VERSION.yml into it.
  const sourcePacksDir = path.join(path.dirname(path.dirname(h.home)), 'source-packs');
  await mkdir(sourcePacksDir, { recursive: true });
  await cp(packDir, path.join(sourcePacksDir, packId), { recursive: true });

  // 1. The owner: a root session in the workspace under the App's own permission preset, which opens
  //    the test Run and sees it end.
  let runId = ''; let ownerId = '';
  const opening = await bootInProcess(h);
  try {
    // dsh's permission-preset service (`@deepseek-ai/dsh-permission-presets`, not a dependency of this
    // checkout), the one the App's permission picker writes through.
    const presets = (opening.ctx as unknown as { permissionPresets: { set(session: unknown, name: string): void; current(session: unknown): string } }).permissionPresets;
    const owner = await createRootAgent(opening.ctx, h.workspace);
    presets.set(owner.session, 'workspace-write');
    assert.equal(presets.current(owner.session), 'workspace-write', 'the owner runs under the App\'s workspace-write preset');
    ownerId = String(owner.id);
    // A three-second time box ends the owned test Run by its budget without a node run: the cheapest
    // honest ending, and one the report-only seal must record exactly as it is.
    const started = await opening.ctx.hima.startRun({ pack: packId, site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: ownerId, test: true, timeBoxMs: 3000 });
    assert.equal(started.kind, 'ran', JSON.stringify(started));
    if (started.kind !== 'ran') return;
    assert.equal(started.run.purpose, 'test');
    runId = started.run.id;
    // What a real Campaign leaves behind and the record must name: refusals and generated code,
    // appended through the Ledger's own typed appenders while the Run is still open.
    const ledger = opening.ctx.hima.ledger;
    await ledger.appendRefusal(runId, { path: path.join(h.workspace, 'outside/one.json'), reason: 'cannot resolve outside/one.json: outside the Permit' });
    await ledger.appendRefusal(runId, { path: path.join(h.workspace, 'outside/two.json'), reason: 'cannot resolve outside/two.json:\nnot bound' });
    const codeAt = path.join(h.workspace, 'workshops/probe.py'); const codeBytes = 'print(1)\n';
    await mkdir(path.dirname(codeAt), { recursive: true }); await writeFile(codeAt, codeBytes);
    await ledger.appendCode(runId, { nodeId: 'synthesize', attempt: 1, sessionId: ownerId, workshop: 'probe-workshop',
      path: codeAt, sha256: createHash('sha256').update(codeBytes).digest('hex'), bytes: codeBytes.length, language: 'python' });
    await waitUntil('the test Run ends', () => opening.ctx.hima.ledger.run(runId)?.status?.startsWith('ended-') === true, 30_000);
    // An ended Run is closed by its archive; the live Run the seal is for had delivered its archive.
    await waitUntil('the ended Run\'s archive is delivered', () => opening.ctx.hima.ledger.records({ runId })
      .some((r) => r.type === 'archive' && (r as { delivery?: string }).delivery === 'complete'), 30_000)
      .catch((error: unknown) => { throw new Error(`${String(error)}: ${JSON.stringify(opening.ctx.hima.ledger.records({ runId }).filter((r) => r.type === 'archive'))}`); });
    assert.equal(opening.ctx.hima.ledger.run(runId)?.control?.owner, ownerId, 'the Run is the owner\'s');
  } finally { await opening.dispose(); }

  // 2. What the resumed owner does, as a model under the sandbox does it: the plain write, then the
  //    same write asking for the wider mode with a reason; then the release through the Hima tool.
  const inspect = await bootInProcess(h);
  let status = ''; let runBefore = ''; let recordsBefore = ''; let refusalIds: string[] = []; let codeShas: string[] = [];
  try {
    const run = inspect.ctx.hima.ledger.run(runId)!;
    status = String(run.status);
    runBefore = JSON.stringify(run); recordsBefore = JSON.stringify(inspect.ctx.hima.ledger.records({ runId }));
    refusalIds = inspect.ctx.hima.ledger.records({ runId }).filter((r) => r.type === 'refusal').map((r) => r.id);
    codeShas = inspect.ctx.hima.ledger.records({ runId }).filter((r) => r.type === 'code').map((r) => (r as { sha256: string }).sha256);
  } finally { await inspect.dispose(); }
  const testAt = path.join(packDir, 'TEST.md');
  const testRecord = [
    '## Site', '', 'Run on site `local`, the stand-in flow.', '',
    '## Run', '', `run: ${runId}`, '',
    '## Ending', '', `status: ${status}`, '',
    '## Generations', '', 'As the Run recorded them.', '',
    '## Code', '', ...codeShas.map((sha) => `- ${sha} workshops/probe.py`), '',
    '## Refusals', '', ...refusalIds.map((id) => `- ${id}`), '',
    '## Disagreements', '', 'none', '',
  ].join('\n');
  const override = path.join(h.home, 'report-only-seal.override.json');
  // The grant is one folder: the same wider ask for a file outside it is still refused.
  const outsideAt = path.join(h.home, 'outside-the-pack.md');
  const factsAt = path.join(h.workspace, 'seal', 'test-record-facts.md');
  // A stale record from an earlier attempt: structurally tested, but its Refusals do not hold.
  await writeFile(testAt, testRecord.replace(refusalIds.map((id) => `- ${id}`).join('\n'), 'UNFILLED'));
  assert.equal(packStage(packDir).stage, 'tested', 'the stale record stands structurally');
  await writeFile(override, JSON.stringify([
    toolCall('call-read-facts', 'read', { file_path: factsAt }),
    // dsh overwrites only a file the session has read; the stale record is read, then replaced whole.
    toolCall('call-read-stale', 'read', { file_path: testAt }),
    toolCall('call-write-outside', 'write', { file_path: outsideAt, content: 'not the Pack', sandbox_permissions: 'danger-full-access',
      justification: 'A file outside the installed Pack folder.' }),
    toolCall('call-write', 'write', { file_path: testAt, content: testRecord }),
    toolCall('call-write-wider', 'write', { file_path: testAt, content: testRecord, sandbox_permissions: 'danger-full-access',
      justification: 'The test record belongs in the installed Pack folder, which lies outside this workspace.' }),
    toolCall('call-check', 'hima_pack_check', { pack: packId, site: 'local' }),
    said(`TEST.md records run ${runId}, ended ${status}.`),
    toolCall('call-release', 'hima_pack_release', { pack: packId }),
    said('Sealed.'),
  ]));
  const session = path.join(h.home, 'report-only-seal.session.jsonl');
  await writeFile(session, JSON.stringify({ version: 0, type: 'session', id: 'session-report-only-seal', createdAt: 0, cwd: '{{cwd}}' }) + '\n');
  await writeReplayOverlay(h.home, { file: session, overrideFile: override });
  await appendFile(homePatchFile(h.home), QUIET_TITLE_ROW);
  assert.match(await readFile(homePatchFile(h.home), 'utf8'), /- id: llm-deepseek\n  disabled: true\n/, 'the model route is the replay adapter');

  // 3. The seal, exactly as the script runs it, with no <home>/workspace and no --workspace given.
  const host = await bootInProcess(h);
  let calls: string[] = []; let failures: string[] = [];
  try {
    await host.ctx.hima.reconciled;
    let resumed: Parameters<typeof toolCalls>[0] | undefined;
    const sealing = sealEndedTestRun(host, { homeRoot: h.home, runId, packId, sourcePacksDir,
      model: { provider: 'deepseek-official', model: 'deepseek-flash' }, say: sayAsUser,
      ready: (owner) => { resumed = owner; } });
    const sealed = await sealing.catch((error: unknown) => {
      calls = resumed ? toolCalls(resumed).map((c) => c.name) : [];
      failures = resumed ? toolResults(resumed).filter((r) => r.failed).map((r) => r.text) : [];
      throw new Error(`${String(error)}\nowner calls: ${JSON.stringify(calls)}\nowner refusals: ${JSON.stringify(failures)}`);
    });
    calls = toolCalls(sealed.owner).map((c) => c.name);
    failures = toolResults(sealed.owner).filter((r) => r.failed).map((r) => r.text);
    assert.equal(String(sealed.owner.id), ownerId, 'the seal resumed the Run\'s own owner');
    assert.equal(sealed.workspace, h.workspace, 'the owner\'s workspace is the desktop workspace, not <home>/workspace');
    assert.deepEqual(calls, ['read', 'read', 'write', 'write', 'write', 'hima_pack_check', 'hima_pack_release'], JSON.stringify(calls));
    // The facts file: line-based, from the Ledger, naming exactly what the check demands.
    assert.equal(sealed.facts.path, factsAt);
    const facts = await readFile(factsAt, 'utf8');
    assert.equal(sealed.facts.lines, facts.split('\n').length - 1);
    assert.deepEqual([sealed.facts.refusals, sealed.facts.code], [2, 1]);
    assert.match(facts, new RegExp(`^status: ${status}$`, 'm'));
    for (const id of refusalIds) assert.match(facts, new RegExp(`^- ${id.replace(/[#]/g, '\\$&')}: `, 'm'), `the facts name refusal ${id}`);
    for (const sha of codeShas) assert.ok(facts.includes(`- ${sha} `), `the facts name code ${sha}`);
    assert.ok(facts.split('\n').every((line) => line.length < 2000), 'every line fits one read');
    assert.ok(facts.includes('cannot resolve outside/two.json: not bound'), 'a multi-line reason is one line');
    assert.match(toolResults(sealed.owner)[0]!.text, /Test record facts for run/, 'the owner read the facts');
    assert.equal(failures.length, 2, `the outside write and the plain write were refused, and nothing else: ${JSON.stringify(failures)}`);
    assert.match(failures[0]!, /sandbox escalation to "danger-full-access" requires approval, but no approval channel is available/);
    assert.equal(existsSync(outsideAt), false, 'nothing was written outside the granted folder');
    assert.match(failures[1]!, /sandbox: file access denied under workspace-write mode/);

    const checked = checkTestRecord(loadPack(packsDirOf(h), packId), host.ctx.hima.ledger);
    assert.equal(checked?.run, runId); assert.equal(checked?.error, undefined, checked?.error);
    assert.equal(packStage(packDir).stage, 'released');
    assert.equal(await readFile(testAt, 'utf8'), testRecord);
    const version = parse(await readFile(path.join(packDir, 'VERSION.yml'), 'utf8')) as { test: { run: string } };
    assert.equal(version.test.run, runId);
    assert.deepEqual([...HIMA_TEST_SECTIONS], testRecord.match(/^## (.+)$/gm)!.map((s) => s.slice(3)));
    assert.equal(await readFile(sealed.test.path, 'utf8'), testRecord, 'TEST.md landed in the source Pack');
    assert.equal(sealed.version.path, path.join(sourcePacksDir, packId, 'VERSION.yml'));
    assert.equal(await readFile(sealed.version.path, 'utf8'), await readFile(path.join(packDir, 'VERSION.yml'), 'utf8'));
  } finally { await host.dispose(); }
  const after = await bootInProcess(h);
  try {
    const added = after.ctx.hima.ledger.records({ runId }).filter((r) => !recordsBefore.includes(`"${r.id}"`));
    assert.deepEqual(added, [], 'sealing appended no record to the ended Run');
    assert.deepEqual(JSON.parse(JSON.stringify(after.ctx.hima.ledger.run(runId))), JSON.parse(runBefore), 'sealing changed nothing about the ended Run');
    assert.deepEqual(JSON.parse(JSON.stringify(after.ctx.hima.ledger.records({ runId }))), JSON.parse(recordsBefore), 'sealing changed none of its records');
  } finally { await after.dispose(); }
});
