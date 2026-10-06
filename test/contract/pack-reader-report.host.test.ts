// L2 Host: a Pack's own Reader on the DBOS route (task-effect adapter hima-task-effect/2). The
// Reader's ${REPORT} is the output where the contract put it, so it may read the evidence beside it
// (pack-anatomy); collection refuses a report whose bytes changed while the Reader ran, and the Run
// then records no observation. Real local Site, stand-in mining stage, public start route. No model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './support/dsh-home.ts';
import { localFabric, waitUntil } from './support/fabric.ts';
import { candidateCountType, installPackReader, MINED_TOP_N, packReaderScript, packsDirOf } from './support/pack.ts';
import { confirmAdmission } from './support/u9-admission.ts';
import type { InProcessHost } from './support/boot-inprocess.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';

const countLine = 'test -n "$count" || { echo "[count-candidates] no \\"count\\": <n> line in $report" >&2; exit 3; }\n';
function readerScript(extra: string): string {
  assert.ok(packReaderScript.includes(countLine), 'the fixture Reader still reads its count before writing values');
  return packReaderScript.replace(countLine, countLine + extra);
}
/** Reads the mining stage's cells.txt beside the report and holds the count to it. */
const siblingReader = readerScript(`cells="$(dirname "$report")/cells.txt"
test -s "$cells" || { echo "[count-candidates] no cells.txt beside $report" >&2; exit 4; }
lines=\`wc -l < "$cells" | tr -d ' '\`
test "$lines" = "$count" || { echo "[count-candidates] cells.txt has $lines lines, report says $count" >&2; exit 5; }
`);
/** Changes the report's bytes while it reads it, which collection must refuse. */
const changingReader = readerScript(`printf ' ' >> "$report"
`);

async function observationsOf(host: InProcessHost, home: string, runId: string): Promise<any[]> {
  const { createDurableViewReaders } = await import(pathToFileURL(path.join(repoRoot, 'packages/harness/lib/durable-views.js')).href);
  const service = host.ctx.hima;
  const readers = createDurableViewReaders({ ledger: service.ledger, judge: service.judge, durable: service.durable,
    host: host.ctx, sitesDir: path.join(home, 'hima/sites'), packsDir: path.join(home, 'hima/packs') });
  return await readers.readRunRecords(runId, 'observation') as any[];
}

test('a DBOS Pack Reader reads the evidence beside ${REPORT} and records its observation', { timeout: 120_000 }, async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  assert.ok(local);
  const { h, host, dispose } = local;
  try {
    const pack = await installPackReader(packsDirOf(h), 'reader-sibling', { script: siblingReader });
    const { runId } = await confirmAdmission(host, h, pack, { goal: { target_period_ns: 2 }, budget: { generations: 1 } });
    let observations: any[] = [];
    await waitUntil('the Pack Reader records its observation', async () => {
      observations = await observationsOf(host, h.home, runId);
      const context = await host.ctx.hima.readExecutionContext(runId);
      return observations.length > 0 || (context.durable?.outcome as { state?: string } | undefined)?.state !== undefined;
    }, 90_000, 100);
    const context = await host.ctx.hima.readExecutionContext(runId);
    const evidence = JSON.stringify({ observations, tasks: (context.durable as any)?.tasks?.map((task: any) => ({ id: task.identity?.taskId, state: task.state })) });
    assert.equal(observations.length, 1, evidence);
    assert.equal(observations[0].reader.id, 'count-candidates', evidence);
    assert.match(observations[0].path, /mine-timing\/candidates\.json$/, 'the observation names the report where the contract put it');
    assert.deepEqual(observations[0].values.find((value: any) => value.type === candidateCountType)?.value, MINED_TOP_N, evidence);
  } finally { await dispose(); }
});

test('a DBOS Pack Reader whose report bytes change while it reads is refused and records no observation', { timeout: 120_000 }, async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  assert.ok(local);
  const { h, host, dispose } = local;
  try {
    const pack = await installPackReader(packsDirOf(h), 'reader-changing', { script: changingReader });
    const { runId } = await confirmAdmission(host, h, pack, { goal: { target_period_ns: 2 }, budget: { generations: 1 } });
    const refused = (task: any) => task.identity?.taskId === 'read-candidates' && /changed while it was read/.test(JSON.stringify(task.state));
    await waitUntil('collection refuses the changed report', async () =>
      ((await host.ctx.hima.readExecutionContext(runId)).durable as any)?.tasks?.some(refused) === true, 90_000, 100);
    const context = await host.ctx.hima.readExecutionContext(runId);
    const task = (context.durable as any).tasks.find(refused);
    assert.notEqual(task.state.state, 'succeeded', JSON.stringify(task));
    assert.match(JSON.stringify(task.state), /Reader count-candidates report .*candidates\.json changed while it was read/);
    assert.deepEqual(await observationsOf(host, h.home, runId), [], 'the refused reading is not recorded as an observation');
    assert.equal(((context.durable as any).outcome?.committed ?? {})['read-candidates'], undefined, 'no committed Reader result');
  } finally { await dispose(); }
});
