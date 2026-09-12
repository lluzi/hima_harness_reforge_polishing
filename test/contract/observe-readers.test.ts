// @hima-seam tools direct
// Ticket #4: typed reading — the Innovus post-route summary reader, the verify_drc reader, the
// base timing vocabulary they emit into an observation record's `values`, and the declaration each
// reader carries into the record: the report kind it accepts, the value types it can emit, and its
// own version.
//
// Since #61 the binding lives in `packages/harness/semantics.yml` rather than in a table in
// `semantics.ts`, and every reading — a bundled reader's as much as a pack script's — is held against
// it by the one validator before it can reach the ledger. That refusal is not reachable from this
// seam (nothing a caller can type reaches a bundled reader's unit choice), so what is asserted here
// is the binding's other half: every value a real report produces carries the unit its type binds to,
// checked against the table below rather than against the reader's own opinion — and every type the
// reader declares it emits is in every reading, unknown with a reason where the report is silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
import { requireOpene902Fixture } from './support/opene902-fixtures.ts';
import { assertReadAsDeclared } from './support/readings.ts';
// Loads the `ctx.hima` declaration merge onto Context.
import type {} from '@hima/harness';
import type {} from '@deepseek-ai/dsh-tools';

interface Value { type: string; value: number | null; unit: string; mode?: string; scope?: string; unknownReason?: string }

/** Every value a real report produced, held against what the bundled readers are known to read each
 *  type in (`support/readings.ts`) — the unit, and the qualifiers. The same table `pack.test.ts`
 *  holds against `packages/harness/semantics.yml`, which is what ties the file the bundle ships to
 *  what its readers actually emit. */
const assertUnitsBound = assertReadAsDeclared;

/** What the Innovus summary reader declares: the report kind it accepts and every type it can emit. */
const summaryReaderRef = {
  id: 'innovus-timing-summary',
  version: '1',
  reportKind: 'innovus-optdesign-summary',
  emits: ['setup_wns', 'setup_tns', 'hold_wns', 'hold_tns', 'placement_density', 'clock_period'],
};

/** What the verify_drc reader declares. */
const drcReaderRef = {
  id: 'innovus-verify-drc',
  version: '1',
  reportKind: 'innovus-verify-drc',
  emits: ['drc_violation_count'],
};

function find(values: Value[], type: string, scope?: string): Value | undefined {
  return values.find((v) => v.type === type && (scope === undefined || v.scope === scope));
}

test('the innovus-timing-summary reader emits setup WNS/TNS, density, and an unknown clock period from the real opene902 post-route summary', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${fixture} --reader innovus-timing-summary`);
    assert.equal(kind, 'success', text);
    assert.ok(runId, 'a run id is reported');
    const records = host.ctx.hima.ledger.records({ runId: runId! });
    assert.equal(records.length, 1);
    const rec = records[0]!;
    assert.equal(rec.type, 'observation');
    assert.deepEqual(
      rec.type === 'observation' ? rec.reader : null,
      summaryReaderRef,
      'the record carries the reader that read it: its id, its version, the report kind it accepts, and the semantics it emits',
    );
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];
    assertUnitsBound(values);

    const wnsAll = find(values, 'setup_wns', 'all');
    assert.deepEqual(wnsAll, { type: 'setup_wns', value: -0.073, unit: 'ns', mode: 'setup', scope: 'all' });
    const wnsR2r = find(values, 'setup_wns', 'reg2reg');
    assert.deepEqual(wnsR2r, { type: 'setup_wns', value: 0.002, unit: 'ns', mode: 'setup', scope: 'reg2reg' });
    const tnsAll = find(values, 'setup_tns', 'all');
    assert.deepEqual(tnsAll, { type: 'setup_tns', value: -0.18, unit: 'ns', mode: 'setup', scope: 'all' });
    const density = find(values, 'placement_density');
    assert.deepEqual(density, { type: 'placement_density', value: 44.345, unit: 'percent' });
    const clockPeriod = find(values, 'clock_period');
    assert.equal(clockPeriod?.value, null, 'the summary never states a clock period');
    assert.match(clockPeriod?.unknownReason ?? '', /not stated in an Innovus optDesign summary/);
    assert.equal(clockPeriod?.unit, 'ns');

    // Nothing from a Hold-mode table leaked into a Setup-mode read — and the hold types this reader
    // declares it emits are still there, unknown, saying which mode the report actually states
    // (#61). A reader emits every type its own `emits` names or its output is refused by the one
    // validator: a hold rule applied to this reading goes UNDETERMINED with the report's own reason
    // on it, rather than for want of a value nobody said was missing.
    for (const type of ['hold_wns', 'hold_tns']) {
      const unread = find(values, type, 'all');
      assert.deepEqual(
        unread,
        { type, value: null, unit: 'ns', mode: 'hold', scope: 'all', unknownReason: 'this report states the setup mode timing table, so it says nothing about hold timing' },
        `${type} is unknown and says why, never a number this report does not hold: ${JSON.stringify(unread)}`,
      );
      assert.equal(find(values, type, 'reg2reg')?.value, null, `and the same for the reg2reg scope: ${JSON.stringify(values)}`);
    }
  } finally { await host.dispose(); await h.dispose(); }
});

test('the innovus-timing-summary reader emits hold WNS for both scopes from the real opene902 post-route hold summary', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute_hold.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${fixture} --reader innovus-timing-summary`);
    assert.equal(kind, 'success', text);
    const records = host.ctx.hima.ledger.records({ runId: runId! });
    const rec = records[0]!;
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];
    assertUnitsBound(values);

    const wnsAll = find(values, 'hold_wns', 'all');
    assert.deepEqual(wnsAll, { type: 'hold_wns', value: 0.034, unit: 'ns', mode: 'hold', scope: 'all' });
    const wnsR2r = find(values, 'hold_wns', 'reg2reg');
    assert.deepEqual(wnsR2r, { type: 'hold_wns', value: 0.034, unit: 'ns', mode: 'hold', scope: 'reg2reg' });
    // Hold TNS is genuinely 0.000 ns on both scopes in this report: a read zero, stated as a number,
    // is not the same thing as a fabricated default, and the reader must report it as it stands.
    const tnsAll = find(values, 'hold_tns', 'all');
    assert.deepEqual(tnsAll, { type: 'hold_tns', value: 0, unit: 'ns', mode: 'hold', scope: 'all' });
    const tnsR2r = find(values, 'hold_tns', 'reg2reg');
    assert.deepEqual(tnsR2r, { type: 'hold_tns', value: 0, unit: 'ns', mode: 'hold', scope: 'reg2reg' });
    const density = find(values, 'placement_density');
    assert.deepEqual(density, { type: 'placement_density', value: 44.345, unit: 'percent' });
    // A Hold summary states no Setup-mode numbers, and the setup types this reader declares are
    // there saying exactly that rather than missing (#61), as the Setup read above says of hold.
    for (const type of ['setup_wns', 'setup_tns']) {
      const unread = find(values, type, 'all');
      assert.deepEqual(
        unread,
        { type, value: null, unit: 'ns', mode: 'setup', scope: 'all', unknownReason: 'this report states the hold mode timing table, so it says nothing about setup timing' },
        `${type} is unknown and says why, never a number a hold summary does not hold: ${JSON.stringify(unread)}`,
      );
      assert.equal(find(values, type, 'reg2reg')?.value, null, `and the same for the reg2reg scope: ${JSON.stringify(values)}`);
    }
  } finally { await host.dispose(); await h.dispose(); }
});

test('the innovus-verify-drc reader emits the total violation count from the real opene902 DRC report, via the hima_observe tool', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'verify_drc.postroute.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-observe-drc' as never,
      name: 'hima_observe',
      arguments: { site: 'local', path: fixture, reader: 'innovus-verify-drc' },
      agent,
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = (result as unknown as { value?: { kind: string; recordId: string } }).value;
    assert.ok(value, 'a canonical value is returned');
    assert.equal(value.kind, 'observed');
    const rec = host.ctx.hima.ledger.record(value.recordId);
    assert.equal(rec?.type, 'observation');
    assert.deepEqual(
      rec?.type === 'observation' ? rec.reader : null,
      drcReaderRef,
      'the DRC reader declares its own report kind and the one value type it emits',
    );
    const values = (rec?.type === 'observation' ? rec.values : []) as Value[];
    assertUnitsBound(values);
    assert.deepEqual(values, [{ type: 'drc_violation_count', value: 1778, unit: 'count' }]);
  } finally { await host.dispose(); await h.dispose(); }
});

test('a truncated Innovus summary, cut before the timing table, yields unknown values with a stated reason, never zero and never a default', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h);
  const full = gunzipSync(await (await import('node:fs/promises')).readFile(fixture)).toString('utf8');
  // Keep only the header block (between the two "####...####" fences); cut before the banner and the table.
  const lines = full.split(/\r?\n/);
  const fenceLines = lines.reduce<number[]>((acc, l, i) => { if (/^#{10,}$/.test(l)) acc.push(i); return acc; }, []);
  assert.equal(fenceLines.length, 2, 'the fixture still has the two-fence header shape this test slices');
  const truncated = lines.slice(0, fenceLines[1]! + 1).join('\n') + '\n';
  assert.ok(!truncated.includes('Setup mode') && !truncated.includes('Density:'), 'the slice really does cut before the table and the density line');
  const rel = 'reports/truncated.summary';
  await mkdir(path.join(h.workspace, path.dirname(rel)), { recursive: true });
  await writeFile(path.join(h.workspace, rel), truncated, 'utf8');
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader innovus-timing-summary`);
    assert.equal(kind, 'success', text);
    const records = host.ctx.hima.ledger.records({ runId: runId! });
    const rec = records[0]!;
    assert.equal(rec.type, 'observation');
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];

    assert.ok(values.length > 0, 'the reader still emits something for an accepted-but-incomplete report');
    for (const v of values) {
      if (v.value === null) {
        assert.ok(v.unknownReason && v.unknownReason.length > 0, `${v.type} is unknown but carries no reason`);
      }
    }
    // Every value this slice could have carried was cut away, so every value must be unknown. The
    // check that used to stand here — `values.every(v => v.value !== 0)` — could not fail: nothing in
    // this file's readers ever emits a zero it did not read (hold TNS above really is 0.000 ns), so it
    // asserted a property of the fixture rather than of the reader. What a fabricated default would
    // actually look like is a value that is not null at all.
    assert.deepEqual(
      values.filter((v) => v.value !== null),
      [],
      'a report cut before its table yields no known value at all: nothing is defaulted, zero included',
    );

    const clockPeriod = find(values, 'clock_period');
    assert.equal(clockPeriod?.value, null);
    assert.match(clockPeriod?.unknownReason ?? '', /not stated in an Innovus optDesign summary/);
    const density = find(values, 'placement_density');
    assert.equal(density?.value, null, 'the Density: line was cut too');
    assert.ok(density?.unknownReason, 'density carries a reason when its line is missing');
  } finally { await host.dispose(); await h.dispose(); }
});

test('a report of the wrong kind is refused by the innovus-timing-summary reader, with no observation recorded', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --reader innovus-timing-summary`);
    assert.equal(kind, 'error', text);
    assert.match(text, /refused/);
    const records = host.ctx.hima.ledger.records({ runId: runId! });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.type, 'refusal');
    assert.equal(records[0]!.writer, 'executor', 'a reader refusal is the executor deciding, not the shell');
    assert.match(records[0]!.type === 'refusal' ? records[0]!.reason : '', /innovus-timing-summary/);
    assert.equal(host.ctx.hima.ledger.records({ runId: runId!, type: 'observation' }).length, 0, 'no observation for a refused reader');
  } finally { await host.dispose(); await h.dispose(); }
});

test('a report of the wrong kind is refused by the innovus-verify-drc reader, with no observation recorded', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --reader innovus-verify-drc`);
    assert.equal(kind, 'error', text);
    const records = host.ctx.hima.ledger.records({ runId: runId! });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.type, 'refusal');
    assert.equal(records[0]!.writer, 'executor');
    assert.equal(host.ctx.hima.ledger.records({ runId: runId!, type: 'observation' }).length, 0);
  } finally { await host.dispose(); await h.dispose(); }
});

test('the two Innovus readers refuse each other\'s report kind: a real summary is not a DRC report and vice versa', async (t) => {
  const summary = await requireOpene902Fixture(t, 'postroute.summary.gz');
  const drc = await requireOpene902Fixture(t, 'verify_drc.postroute.rpt');
  if (summary === undefined || drc === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(summary), path.dirname(drc)] });
  const host = await bootInProcess(h);
  try {
    const summaryAsDrc = await himaCommand(host, h.workspace, `/hima observe local ${summary} --reader innovus-verify-drc`);
    assert.equal(summaryAsDrc.kind, 'error', summaryAsDrc.text);
    const drcAsSummary = await himaCommand(host, h.workspace, `/hima observe local ${drc} --reader innovus-timing-summary`);
    assert.equal(drcAsSummary.kind, 'error', drcAsSummary.text);
  } finally { await host.dispose(); await h.dispose(); }
});
