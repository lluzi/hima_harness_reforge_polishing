// @hima-seam tools direct
// Bounded real V4 Flash research over a source-verified AES sample; no EDA.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packDigestOf, packStage } from '@hima/harness';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { bootInProcess, createRootAgent } from '../test/contract/support/boot-inprocess.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { writeLocalSite } from '../test/contract/support/site.ts';
import { prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';
import { guardInstalled, runLive, sha256 } from './live-check-workshop.ts';

const packId = 'aes-timing-research';
const inputFile = process.env.HIMA_AES_SAMPLE;
if (!inputFile) throw new Error('HIMA_AES_SAMPLE must name the verified research input');
const sampleBytes = readFileSync(inputFile);
const expectedHash = 'e8b21153b49da2935c8f742618a0b55ce67390b69d921b7f0208936161138570';
if (sha256(sampleBytes) !== expectedHash) throw new Error('this acceptance requires the admitted AES sample identity');
const admittedStage = packStage(path.join(repoRoot, 'packs', packId));
if (!['compiled', 'tested', 'released'].includes(admittedStage.stage)) {
  throw new Error('research Pack is not compiled; no Host or model started: ' + JSON.stringify(admittedStage));
}

await runLive('live-check-aes-research', 10, async (check) => {
  const home = await createHimaHome(); check.home = home;
  await prepareHimaHome({ home: home.home, bundleMode: 'installed' });
  const folder = path.join(packsDirOf(home), packId);
  cpSync(path.join(repoRoot, 'packs', packId), folder, { recursive: true });
  const flow = path.join(home.home, 'research-flow');
  mkdirSync(flow);
  for (const name of ['prepare.py', 'baseline.py']) cpSync(path.join(folder, 'tools', name), path.join(flow, name));
  writeFileSync(path.join(flow, 'sample.json'), sampleBytes);
  writeFileSync(path.join(flow, 'README.md'), 'Site-staged finite AES research input. Run /usr/bin/python3 prepare.py WORKSPACE in a Campaign copy. It copies sample.json and baseline.py to that workspace; the Workshop reads both through its declared outputs. Baseline is a measured reference, not a novel algorithm. The sample carries real probe provenance; it is not an EDA rerun.\n');
  const bundle = realpathSync(path.join(home.profileDir, 'node_modules/@hima/harness'));
  await writeLocalSite(home, { allowedReadRoots: [flow, home.workspace], allowedWriteRoots: [home.workspace],
    allowedWrappers: ['/usr/bin/python3'], licences: {}, bindings: { flowRoot: flow, workspaceRoot: home.workspace } });
  writeFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');
  check.observed.realEdaRequested = false;
  check.observed.packFolder = folder;
  check.observed.sample = { sha256: expectedHash, source: JSON.parse(sampleBytes.toString()).source };
  check.observed.methodBeforeTest = packDigestOf(folder);
  check.observed.minimumScore = 21;
  process.chdir(home.workspace);
  const host = await bootInProcess(home); check.attach(host);
  const chat = check.track(await createRootAgent(host.ctx, home.workspace));
  const opened = await host.ctx.tools.execute({ name: 'hima_author', arguments: { pack: packId }, agent: chat,
    callId: 'research-author-open' as never, signal: AbortSignal.timeout(20_000) });
  if (opened.isError) throw new Error('native author workspace could not open');
  const author = check.track(host.ctx.agents.get((opened as unknown as { value: { sessionId: string } }).value.sessionId as never)!);
  guardInstalled(check, host, [folder, bundle, flow, home.workspace], folder);
  check.observed.owner = String(author.id);
  await check.say(author, [
    '/hima-test Run ' + packId + ' on local with fixed Goal minimum_score=21, algorithmRevision=0, generations=2, retries=1, timeBox=10.',
    'The Golden Flow for this test is ' + flow + '; its README, sample and baseline are readable in place. The method is already compiled; do not reauthor it.',
    'This is analysis of an actual validated AES timing/netlist sample, not a new EDA experiment. Its objective and object identities are in the declared input and knowledge.',
    'You are the same conversation owner for every node. Use hima_run, hima_context and hima_execute; complete only ready nodes and explicitly decide at Explore with actual observation/verdict citations.',
    'Read declared knowledge, sample and baselineCode. At revision0 copy and execute the supplied raw-frequency reference script unchanged to establish a measured reference. This is not your innovation. Preserve its code and actual overlap/constraint feedback.',
    'After the recorded baseline failure, explicitly select algorithmRevision=1 within this same Run and write your own corrected, data-dependent, self-contained Python algorithm. Account for shared physical cells and the scoring objective. Compute from input; do not bake sample ids, scores or absolute paths into code. A held-out subset will also be checked after this Run.',
    'Use exact Workshop argv and result schema from recommend/knowledge. No oracle, outside files, external Agent/model or alternate executor. The Goal stays fixed. Invalid objects or malformed output cannot support a conclusion. Let real Job completion notifications arrive instead of busy polling.',
    'When done, write TEST.md from hima_status with standalone run/status lines and every code hash. Distinguish copied reference from revised algorithm and bounded analysis from Boolean buildability or Fmax improvement. Preserve method bytes; do not release yet.',
  ].join('\n'));
  check.require('the first native test turn admitted its actual Run',
    host.ctx.hima.ledger.runs().some(r => r.packId === packId), host.ctx.hima.ledger.runs());
  for (let i = 0; i < 4 && !existsSync(path.join(folder, 'TEST.md')); i++) {
    await check.until('node work has settled', () => {
      const run = host.ctx.hima.ledger.runs().find(r => r.packId === packId);
      return !run || !host.ctx.hima.executionContext(run.id).executions.some(e => e.phase === 'working');
    }, 60_000);
    await check.say(author, 'Continue the already authorized same Run from actual facts. If ended, write truthful TEST.md with all code hashes; no additional Run or method changes.');
  }
  const runs = host.ctx.hima.ledger.runs().filter(r => r.packId === packId);
  check.require('exactly one actual owned research Run', runs.length === 1 && runs[0]?.control?.owner === String(author.id), runs);
  const run = runs[0]!;
  const records = host.ctx.hima.ledger.records({ runId: run.id });
  const prepared = records.find(r => r.type === 'workspace' && r.event === 'prepared');
  check.require('actual prepared workspace is recorded', prepared?.type === 'workspace', prepared);
  if (prepared?.type !== 'workspace') throw new Error('workspace unavailable');
  check.require('research kept the admitted input bytes unchanged',
    sha256(readFileSync(path.join(prepared.workspace, 'sample.json'))) === expectedHash
    && sha256(readFileSync(path.join(prepared.workspace, 'flow/sample.json'))) === expectedHash,
    { workspace: prepared.workspace, sampleSha256: expectedHash });
  check.observed.workspace = prepared.workspace;
  const observations = records.filter(r => r.type === 'observation');
  const value = (generation: number, type: string) => observations.filter(r => r.generation === generation).flatMap(r => r.values).find(v => v.type === type)?.value;
  check.require('executed reference exposes actual overlap failure', value(1, 'conflict_count') === 1 && value(1, 'selection_score') === 16, observations.filter(r => r.generation === 1));
  check.require('revised executable reaches independent score without overlap', value(2, 'conflict_count') === 0 && value(2, 'selection_score') === 21, observations.filter(r => r.generation === 2));
  check.require('fixed research Goal met within budget', run.status === 'ended-goal-met' && run.goal?.minimum_score === 21 && run.generation === 2, run);
  const codes = records.filter(r => r.type === 'code');
  const executed = Object.values(run.control!.executions).flatMap(execution => {
    const entry = execution.intent?.workshop?.entry;
    if (!entry || execution.phase !== 'completed') return [];
    const code = codes.find(r => r.path === entry.path && r.sha256 === entry.sha256 && r.generation === execution.generation);
    check.require('launch entry is bound to a recorded code version ' + execution.id, code !== undefined, { entry, execution });
    return code ? [{ ...code, executionId: execution.id }] : [];
  });
  check.require('same Agent executed distinct baseline and revised code', executed.some(r => r.generation === 1) && executed.some(r => r.generation === 2)
    && new Set(executed.map(r => r.sha256)).size >= 2 && executed.every(r => r.sessionId === String(author.id)), executed);
  const baselineHash = sha256(readFileSync(path.join(flow, 'baseline.py')));
  check.require('generation one launched the exact staged reference baseline',
    executed.some(r => r.generation === 1 && r.sha256 === baselineHash), { baselineHash, executed });
  check.require('knowledge was actually read and recorded', records.some(r => r.type === 'knowledge'), records.filter(r => r.type === 'knowledge'));
  check.require('no hidden research moment substituted for owner', !records.some(r => r.type === 'session'), records.filter(r => r.type === 'session'));
  check.require('method identity preserved during test', packDigestOf(folder) === check.observed.methodBeforeTest, packDigestOf(folder));
  check.require('actual test record valid', packStage(folder).stage === 'tested', packStage(folder));
  check.observed.runId = run.id;
  check.observed.codeFiles = executed.map(r => ({ record: r.id, generation: r.generation, execution: r.executionId, path: r.path, sha256: r.sha256 }));
  await check.say(author, '/hima-release Release the tested research method through the native tool. Preserve baseline failure and scientific scope; no manual VERSION.yml or method changes.');
  check.require('native release sealed tested research method', packStage(folder).stage === 'released', packStage(folder));
  cpSync(folder, path.join(check.out, 'pack'), { recursive: true });
  mkdirSync(path.join(check.out, 'code'));
  for (const [index, code] of executed.entries()) {
    const bytes = readFileSync(code.path);
    check.require('exported code matches execution record ' + code.id, sha256(bytes) === code.sha256, code);
    writeFileSync(path.join(check.out, 'code', 'generation-' + code.generation + '-' + index + '.py'), bytes);
  }
});
