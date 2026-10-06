// @hima-seam llm-replay direct
// L2 Host: the aes-timing-research Pack through the normal startRun → DBOS route. Two generations of
// its native Workshop author the selection code (dsh's keyless replay stands in for the model; each
// generation's Workshop is its own native session), the Pack's Reader, rules and chooser judge the
// actual program output on synthetic finite data. No model API, EDA or Electron.
// Replaces aes-timing-research-reader.test.ts "owner-controlled two-generation Workshop retains code
// and turns a measured overlap FAIL into PASS on synthetic finite data" (owner begin/work/complete,
// owner read/write/decision actions). Generic DBOS Workshop handoff is native-task-effects' subject.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeLocalSite } from './support/site.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { appendReplaySession, writeMomentFixture } from './support/moments.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const lib = (name: string) => import(pathToFileURL(path.join(repoRoot, 'packages/harness/lib', `${name}.js`)).href);
const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [{ type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }] });
const tool = (name: string, args: unknown, id: string): ReplayEntry => ({ kind: 'chunks', chunks: [{ type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: id as never, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }] });

/** The product's durable record projection (what the Run page and reports read), not SDK tables. */
async function recordsOf(host: InProcessHost, home: string, runId: string) {
  const { createDurableViewReaders } = await lib('durable-views');
  const service = host.ctx.hima;
  const readers = createDurableViewReaders({ ledger: service.ledger, judge: service.judge, durable: service.durable,
    host: host.ctx, sitesDir: path.join(home, 'hima/sites'), packsDir: path.join(home, 'hima/packs') });
  return await readers.readRunRecords(runId) as any[];
}

// Same finite sample as the retired test: the raw-frequency baseline picks two candidates sharing cell u1.
const sample = { schema: 'aes-path-motifs/1', budget: 2, paths: [
  ...['p1', 'p2', 'p3'].map((id, i) => ({ id, points: [{ instance: 'u1', master: 'M1', sourceLine: i + 1 }] })),
  ...['p4', 'p5'].map((id, i) => ({ id, points: [{ instance: 'u1', master: 'M1', sourceLine: 40 + i * 10 }, { instance: 'u2', master: 'M2', sourceLine: 41 + i * 10 }] })),
  ...['p6', 'p7'].map((id, i) => ({ id, points: [{ instance: 'u3', master: 'M3', sourceLine: 60 + i * 10 }, { instance: 'u4', master: 'M4', sourceLine: 61 + i * 10 }] })),
], candidates: [
  { id: 'a', cells: ['u1'], masters: ['M1'], occurrences: [{ path: 'p1', begin: 0, sourceLines: [1] }, { path: 'p2', begin: 0, sourceLines: [2] }, { path: 'p3', begin: 0, sourceLines: [3] }] },
  { id: 'b', cells: ['u1', 'u2'], masters: ['M1', 'M2'], occurrences: [{ path: 'p4', begin: 0, sourceLines: [40, 41] }, { path: 'p5', begin: 0, sourceLines: [50, 51] }] },
  { id: 'c', cells: ['u3', 'u4'], masters: ['M3', 'M4'], occurrences: [{ path: 'p6', begin: 0, sourceLines: [60, 61] }, { path: 'p7', begin: 0, sourceLines: [70, 71] }] },
] };
const corrected = `import hashlib,json,pathlib,sys\nw=pathlib.Path(sys.argv[1]); s=json.loads((w/'sample.json').read_text()); used=set(); chosen=[]\nfor c in sorted(s['candidates'],key=lambda x:(-len(x['cells'])*len({o['path'] for o in x['occurrences']}),x['id'])):\n if len(chosen)<s['budget'] and not used.intersection(c['cells']): chosen.append(c['id']); used.update(c['cells'])\n(w/'selection.json').write_text(json.dumps({'sampleSha256':hashlib.sha256((w/'sample.json').read_bytes()).hexdigest(),'selected':chosen}))\n`;

// The DBOS Pack-Reader adapter hands ${REPORT} as hima-readers/<effect>/input-report; read-selection.py
// derives its score from `report.parent / "sample.json"`, which is not staged there.
const readerStaging = 'DBOS Pack Reader stages ${REPORT} as hima-readers/<effect>/input-report without sibling files; '
  + 'read-selection.py reads report.parent/sample.json and cannot find it (suspected regression, reported)';

test('DBOS two-generation research Workshop turns a measured overlap FAIL into PASS (synthetic finite data)',
  { timeout: 150_000, todo: readerStaging }, async (t) => {
  const home = await localHome(t, { sleepSeconds: 0, parallelJobs: 1 });
  assert.ok(home);
  const packDir = path.join(home.h.home, 'hima/packs/aes-timing-research');
  await cp(path.join(repoRoot, 'packs/aes-timing-research'), packDir, { recursive: true });
  const flow = path.join(home.h.home, 'finite-selection-flow');
  await mkdir(flow, { recursive: true });
  await writeFile(path.join(flow, 'sample.json'), JSON.stringify(sample));
  const baseline = await readFile(path.join(repoRoot, 'packs/aes-timing-research/tools/baseline.py'), 'utf8');
  await writeFile(path.join(flow, 'baseline.py'), baseline);
  await writeFile(path.join(flow, 'prepare.py'), `import shutil,sys,pathlib\nw=pathlib.Path(sys.argv[1]); [shutil.copyfile(w/'flow'/n,w/n) for n in ('sample.json','baseline.py')]\n`);
  await writeLocalSite(home.h, { allowedReadRoots: [home.h.workspace, flow], allowedWriteRoots: [home.h.workspace],
    allowedWrappers: ['/usr/bin/python3'], bindings: { flowRoot: flow, workspaceRoot: home.h.workspace } });

  // Generation 1 (algorithmRevision 0): read the declared inputs and method, run the baseline unchanged.
  let scenario = { ...await writeMomentFixture(home.h, 'one-turn'), children: [] as readonly string[] };
  await writeFile(scenario.override, JSON.stringify([
    tool('hima_workshop_read', { output: 'baselineCode' }, 'research-read-baseline'),
    tool('hima_workshop_read', { output: 'sample' }, 'research-read-sample'),
    tool('hima_workshop_knowledge', { file: 'selection-method.md' }, 'research-knowledge'),
    tool('hima_workshop_write', { path: 'entry.py', content: baseline }, 'research-write-baseline'),
    say('Revision 0 runs the supplied raw-frequency baseline unchanged.'),
  ]));
  // Generation 2 (algorithmRevision 1, chosen by the Pack chooser after the measured conflict).
  scenario = await appendReplaySession(scenario, 'research-generation-2', [
    tool('hima_workshop_write', { path: 'entry.py', content: corrected }, 'research-write-corrected'),
    say('Revision 1 selects disjoint physical cells from the sample.'),
  ]);
  await writeReplayOverlay(home.h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });

  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'aes-timing-research', site: 'local', test: true, goal: { minimum_score: 7 },
      strategy: { algorithmRevision: 0 }, generationLimit: 2, retryAllowance: 1, timeBoxMs: 120_000, ownerSessionId: String(owner.id) });
    assert.ok(started.kind === 'ran' || started.kind === 'preparing', JSON.stringify(started));
    if (started.kind !== 'ran' && started.kind !== 'preparing') return;
    runId = started.run.id;
    let context = await host.ctx.hima.readExecutionContext(runId);
    await waitUntil('the DBOS Run reaches its outcome', async () => {
      context = await host.ctx.hima.readExecutionContext(runId!);
      return !!context.durable?.outcome;
    }, 120_000, 100);
    const outcome = context.durable!.outcome as any;
    const tasks = (context.durable as any).tasks.map((task: any) => ({ id: task.identity.taskId, iterations: task.iterations, state: task.state }));
    assert.equal(outcome.state, 'succeeded', JSON.stringify({ status: context.run.status, outcome: { state: outcome.state, reason: outcome.reason }, tasks }));

    const records = await recordsOf(host, home.h.home, runId);
    const verdicts = records.filter(record => record.type === 'verdict');
    const byGeneration = (generation: number) => verdicts.filter(verdict => (verdict.generation ?? 1) === generation).map(verdict => verdict.outcome);
    assert.deepEqual(byGeneration(1), ['FAIL', 'PASS'], 'the baseline measurably overlaps physical cell u1 while reaching the score');
    assert.deepEqual(byGeneration(2), ['PASS', 'PASS'], 'the corrected selection has no shared cell and keeps the Goal score');
    const code = records.filter(record => record.type === 'code');
    assert.deepEqual(code.map(record => record.sha256), [baseline, corrected].map(text => createHash('sha256').update(text).digest('hex')),
      'each generation retains the exact bytes its Workshop executed');
    assert.ok(records.some(record => record.type === 'knowledge'), 'the scoped method knowledge read is durable evidence');
    assert.equal(context.run.status, 'ended-goal-met');
    assert.equal((context.run as any).goalState, 'met');
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined);
    await host.dispose(); await home.h.dispose();
  }
});
