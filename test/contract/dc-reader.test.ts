// @hima-seam tools direct
// Ticket #11: the Design Compiler qor reader (`dc-qor-report@1`), cell area in the base vocabulary,
// and a goal rule (`clock-period-at-most`) whose threshold is a parameter bound at judge time,
// `--param target_period_ns=<ns>`. Verified at the booted-Host seam, over the local channel, on the
// real 2025-toolchain opene902 qor copy the manifest names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
import { openSession, postObserve } from './support/hima-api.ts';
import { requireOpene902Fixture } from './support/opene902-fixtures.ts';
// Also loads the `ctx.hima` declaration merge onto Context.
import type { RunView } from '@hima/harness';
import type {} from '@deepseek-ai/dsh-tools';

type Host = InProcessHost;

interface Value { type: string; value: number | null; unit: string; mode?: string; scope?: string; group?: string; unknownReason?: string }

/** The one unit each value type is bound to, restated here independently of `semantics.ts`. */
const boundUnit: Record<string, string> = {
  setup_wns: 'ns', setup_tns: 'ns', hold_wns: 'ns', clock_period: 'ns', cell_area: 'um2',
};

function assertUnitsBound(values: Value[]): void {
  for (const v of values) assert.equal(v.unit, boundUnit[v.type], `${v.type} must be read in ${boundUnit[v.type] ?? '(an unknown type)'}`);
}

function find(values: Value[], type: string): Value | undefined {
  return values.find((v) => v.type === type);
}

/** What the dc-qor-report reader declares: the report kind it accepts and every type it can emit. */
const dcReaderRef = {
  id: 'dc-qor-report',
  version: '1',
  reportKind: 'dc-qor-report',
  emits: ['setup_wns', 'setup_tns', 'clock_period', 'hold_wns', 'cell_area'],
};

interface Verdict {
  id: string;
  outcome: string;
  ruleId: string;
  ruleVersion: string;
  cites: string[];
  reason?: string;
  boundParameters?: Record<string, number>;
}

function verdicts(host: Host, runId: string): Verdict[] {
  return host.ctx.hima.ledger.records({ runId, type: 'verdict' }) as unknown as Verdict[];
}

async function writeWorkspaceFile(h: { workspace: string }, rel: string, content: string | Buffer): Promise<string> {
  const abs = path.join(h.workspace, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  return rel;
}

test('the dc-qor-report reader emits setup WNS, TNS, clock period, hold WNS, and cell area from the real opene902 qor report, with its declaration recorded', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${fixture} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    assert.ok(runId, 'a run id is reported');
    const records = host.ctx.hima.ledger.records({ runId: runId! });
    assert.equal(records.length, 1);
    const rec = records[0]!;
    assert.equal(rec.type, 'observation');
    assert.deepEqual(rec.type === 'observation' ? rec.reader : null, dcReaderRef, 'the record carries the reader that read it');
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];
    assertUnitsBound(values);

    // The numbers are exactly what the reader read before #20; what is new is that each value read
    // out of one path group names that group — here the report's one group, the clock group
    // `core_clk`. `setup_tns` sums every group and `cell_area` is stated outside them all, so
    // neither names a group: `group` says which group a value came from, never which it is about.
    assert.deepEqual(find(values, 'setup_wns'), { type: 'setup_wns', value: 0, unit: 'ns', mode: 'setup', scope: 'all', group: 'core_clk' });
    assert.deepEqual(find(values, 'setup_tns'), { type: 'setup_tns', value: 0, unit: 'ns', mode: 'setup', scope: 'all' });
    assert.deepEqual(find(values, 'clock_period'), { type: 'clock_period', value: 2.27, unit: 'ns', group: 'core_clk' });
    assert.deepEqual(find(values, 'hold_wns'), { type: 'hold_wns', value: 0, unit: 'ns', mode: 'hold', scope: 'all', group: 'core_clk' });
    assert.deepEqual(find(values, 'cell_area'), { type: 'cell_area', value: 10475.516309, unit: 'um2' });

    // The DC reader's hold WNS, judged end to end by the same generic rule the Innovus hold summary
    // uses in judge.test.ts: 0.00 ns is at or above the 0 ns threshold, so it PASSes, citing this
    // very observation.
    const judged = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules hold-wns-all-nonnegative`);
    assert.equal(judged.kind, 'success', judged.text);
    const [holdVerdict] = host.ctx.hima.ledger.records({ runId: runId!, type: 'verdict' });
    assert.ok(holdVerdict);
    assert.equal(holdVerdict.type === 'verdict' ? holdVerdict.outcome : undefined, 'PASS', 'hold WNS is 0.00 ns, at or above the 0 ns threshold');
    assert.deepEqual(holdVerdict.type === 'verdict' ? holdVerdict.cites : undefined, [rec.id], 'the verdict cites the observation it read hold WNS from');
  } finally { await host.dispose(); await h.dispose(); }
});

test('the same real report with a hold violation in it reads as a negative hold slack and FAILs the very rule the unviolated one passes', async (t) => {
  // The report above states `Worst Hold Violation: 0.00` and PASSes. The one thing changed here is
  // that number, so nothing but the violation can account for the difference. DC prints a violation
  // as a positive magnitude and `hold-wns-all-nonnegative` reads `hold_wns` as a slack that passes at
  // `>= 0`: emitting the magnitude would have a 0.02 ns hold violation pass the hold rule.
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h);
  const full = await readFile(fixture, 'utf8');
  const stated = 'Worst Hold Violation:          0.00';
  assert.ok(full.includes(stated), 'the fixture still states the line this test varies');
  const rel = await writeWorkspaceFile(h, 'reports/hold-violated.qor.rpt', full.replace(stated, 'Worst Hold Violation:          0.02'));
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    const rec = host.ctx.hima.ledger.records({ runId: runId! })[0]!;
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];
    assert.deepEqual(
      find(values, 'hold_wns'),
      { type: 'hold_wns', value: -0.02, unit: 'ns', mode: 'hold', scope: 'all', group: 'core_clk' },
      'a 0.02 ns hold violation is 0.02 ns of hold slack missing: -0.02 ns, from the group that stated it',
    );

    const judged = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules hold-wns-all-nonnegative`);
    assert.equal(judged.kind, 'success', judged.text);
    const [holdVerdict] = host.ctx.hima.ledger.records({ runId: runId!, type: 'verdict' });
    assert.ok(holdVerdict);
    assert.equal(
      holdVerdict.type === 'verdict' ? holdVerdict.outcome : undefined,
      'FAIL',
      'a report with a hold violation in it must not pass the rule that says there is none',
    );
    assert.deepEqual(holdVerdict.type === 'verdict' ? holdVerdict.cites : undefined, [rec.id]);
  } finally { await host.dispose(); await h.dispose(); }
});

test('a qor report truncated before its first path group yields unknown values with a stated reason for each, never a default', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h);
  const full = await readFile(fixture, 'utf8');
  const fenceLines = full.split(/\r?\n/).reduce<number[]>((acc, l, i) => { if (/^\*{10,}$/.test(l)) acc.push(i); return acc; }, []);
  assert.equal(fenceLines.length, 2, 'the fixture still has the two-fence header shape this test slices');
  const truncated = full.split(/\r?\n/).slice(0, fenceLines[1]! + 1).join('\n') + '\n';
  assert.ok(!truncated.includes("Timing Path Group") && !truncated.includes('Cell Area:'), 'the slice really does cut before the first path group and the area section');
  const rel = await writeWorkspaceFile(h, 'reports/truncated.qor.rpt', truncated);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    const records = host.ctx.hima.ledger.records({ runId: runId! });
    const rec = records[0]!;
    assert.equal(rec.type, 'observation');
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];
    assert.equal(values.length, 5, 'the reader still declares one entry per emitted type');
    for (const v of values) {
      assert.equal(v.value, null, `${v.type} must be unknown when the report was cut before any path group`);
      assert.ok(v.unknownReason && v.unknownReason.length > 0, `${v.type} is unknown but carries no reason`);
    }
  } finally { await host.dispose(); await h.dispose(); }
});

test('a qor report missing one line inside its one path group leaves only that value unknown; the rest still read', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h);
  const full = await readFile(fixture, 'utf8');
  assert.ok(full.includes('Critical Path Clk Period:      2.27'), 'the fixture still states the line this test removes');
  const cut = full.replace(/^\s*Critical Path Clk Period:.*\n/m, '');
  const rel = await writeWorkspaceFile(h, 'reports/cut-clk-period.qor.rpt', cut);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    const rec = host.ctx.hima.ledger.records({ runId: runId! })[0]!;
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];

    const clockPeriod = find(values, 'clock_period');
    assert.equal(clockPeriod?.value, null, 'the clock period line was cut');
    assert.match(clockPeriod?.unknownReason ?? '', /Critical Path Clk Period/);
    assert.match(clockPeriod?.unknownReason ?? '', /core_clk/, "the reason names the group whose line is missing");
    assert.equal(clockPeriod?.group, 'core_clk', 'the clock group is known even though its clock-period line is not');

    // Everything else in the group, and the report, still reads.
    assert.deepEqual(find(values, 'setup_wns'), { type: 'setup_wns', value: 0, unit: 'ns', mode: 'setup', scope: 'all', group: 'core_clk' });
    assert.deepEqual(find(values, 'setup_tns'), { type: 'setup_tns', value: 0, unit: 'ns', mode: 'setup', scope: 'all' });
    assert.deepEqual(find(values, 'hold_wns'), { type: 'hold_wns', value: 0, unit: 'ns', mode: 'hold', scope: 'all', group: 'core_clk' });
    assert.deepEqual(find(values, 'cell_area'), { type: 'cell_area', value: 10475.516309, unit: 'um2' });
  } finally { await host.dispose(); await h.dispose(); }
});

test('the real report with a Design Compiler built-in group added that has the worse slack: the clock period is still the clock group\'s, the setup WNS is the built-in\'s, and each names the group it came from', async (t) => {
  // The bug #20 is about, on the one real report the suite has: Design Compiler's built-in path
  // groups (`**default**`, `**async_default**`, `**clock_gating_default**`) are not clocks, and the
  // worst-slack group is routinely one of them. Reading the period off the worst group would make
  // this report state 0.50 ns — a number the design was never synthesized at — and a Loop would then
  // push the next generation against it. Only the added block differs from the real fixture, so
  // nothing but the built-in group can account for what changes here.
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h);
  const full = await readFile(fixture, 'utf8');
  const anchor = '  Cell Count';
  assert.ok(full.includes(anchor), 'the fixture still has the Cell Count section this test inserts a group before');
  const builtIn = [
    "  Timing Path Group '**async_default**'",
    '  -----------------------------------',
    '  Levels of Logic:               2.00',
    '  Critical Path Length:          0.92',
    '  Critical Path Slack:          -0.42',
    '  Critical Path Clk Period:      0.50',
    '  Total Negative Slack:         -0.42',
    '  No. of Violating Paths:        3.00',
    '  Worst Hold Violation:          0.00',
    '  Total Hold Violation:          0.00',
    '  No. of Hold Violations:        0.00',
    '  -----------------------------------',
    '',
    '',
  ].join('\n');
  const rel = await writeWorkspaceFile(h, 'reports/with-async-default.qor.rpt', full.replace(anchor, builtIn + anchor));
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    const rec = host.ctx.hima.ledger.records({ runId: runId! })[0]!;
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];
    assertUnitsBound(values);

    assert.deepEqual(
      find(values, 'clock_period'),
      { type: 'clock_period', value: 2.27, unit: 'ns', group: 'core_clk' },
      "the clock group's own period, the same 2.27 ns the unmodified fixture states, not the built-in group's 0.50",
    );
    assert.deepEqual(
      find(values, 'setup_wns'),
      { type: 'setup_wns', value: -0.42, unit: 'ns', mode: 'setup', scope: 'all', group: '**async_default**' },
      'setup WNS stays the worst slack over every group, clock or not, and says which group that was',
    );
    assert.equal(find(values, 'setup_tns')?.value, -0.42, "setup TNS still sums every group: the clock group's 0.00 and the built-in's -0.42");
    assert.deepEqual(find(values, 'cell_area'), { type: 'cell_area', value: 10475.516309, unit: 'um2' }, 'the area section was untouched');
  } finally { await host.dispose(); await h.dispose(); }
});

test('a qor report whose only path groups are Design Compiler built-ins: the clock period is unknown with a reason naming the groups found, and setup WNS is still the worst of them', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const synthetic = [
    '****************************************',
    'Report : qor',
    'Design : testBuiltInsOnly',
    'Version: X-2025.06-SP3',
    'Date   : Mon Jan  1 00:00:00 2024',
    '****************************************',
    '',
    '',
    "  Timing Path Group '**default**'",
    '  -----------------------------------',
    '  Critical Path Slack:          -0.30',
    '  Critical Path Clk Period:      1.00',
    '  Total Negative Slack:         -0.30',
    '  Worst Hold Violation:          0.00',
    '  -----------------------------------',
    '',
    '',
    "  Timing Path Group '**clock_gating_default**'",
    '  -----------------------------------',
    '  Critical Path Slack:          -0.10',
    '  Critical Path Clk Period:      2.00',
    '  Total Negative Slack:         -0.10',
    '  Worst Hold Violation:          0.00',
    '  -----------------------------------',
    '',
    '',
    '  Area',
    '  -----------------------------------',
    '  Cell Area:                  321.5',
    '',
  ].join('\n');
  const rel = await writeWorkspaceFile(h, 'reports/built-ins-only.qor.rpt', synthetic);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    const rec = host.ctx.hima.ledger.records({ runId: runId! })[0]!;
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];

    const clockPeriod = find(values, 'clock_period');
    assert.equal(clockPeriod?.value, null, 'a built-in group states a period, but it is not the clock the Run asked for');
    assert.equal(clockPeriod?.group, undefined, 'no group supplied it, so none is named');
    assert.match(clockPeriod?.unknownReason ?? '', /\*\*default\*\*/, 'the reason names the groups the report did state');
    assert.match(clockPeriod?.unknownReason ?? '', /\*\*clock_gating_default\*\*/);

    assert.deepEqual(
      find(values, 'setup_wns'),
      { type: 'setup_wns', value: -0.30, unit: 'ns', mode: 'setup', scope: 'all', group: '**default**' },
      'setup WNS is the worst slack whichever kind of group holds it',
    );
    assert.deepEqual(find(values, 'cell_area'), { type: 'cell_area', value: 321.5, unit: 'um2' });
  } finally { await host.dispose(); await h.dispose(); }
});

test('two clock path groups: setup WNS is the minimum slack naming its group, setup TNS sums every group, hold WNS is the worst violation as a slack, and the clock period is unknown because two clocks are stated', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const synthetic = [
    '****************************************',
    'Report : qor',
    'Design : testMulti',
    'Version: X-2025.06-SP3',
    'Date   : Mon Jan  1 00:00:00 2024',
    '****************************************',
    '',
    '',
    "  Timing Path Group 'clk_a'",
    '  -----------------------------------',
    '  Levels of Logic:              10.00',
    '  Critical Path Length:          0.10',
    '  Critical Path Slack:          -0.05',
    '  Critical Path Clk Period:      1.00',
    '  Total Negative Slack:         -0.05',
    '  No. of Violating Paths:        1.00',
    '  Worst Hold Violation:          0.02',
    '  Total Hold Violation:          0.02',
    '  No. of Hold Violations:        1.00',
    '  -----------------------------------',
    '',
    '',
    "  Timing Path Group 'clk_b'",
    '  -----------------------------------',
    '  Levels of Logic:              12.00',
    '  Critical Path Length:          0.12',
    '  Critical Path Slack:          -0.20',
    '  Critical Path Clk Period:      1.50',
    '  Total Negative Slack:         -0.25',
    '  No. of Violating Paths:        2.00',
    '  Worst Hold Violation:          0.00',
    '  Total Hold Violation:          0.00',
    '  No. of Hold Violations:        0.00',
    '  -----------------------------------',
    '',
    '',
    '  Area',
    '  -----------------------------------',
    '  Cell Area:                  500.123456',
    '  Design Area:                500.123456',
    '',
  ].join('\n');
  const rel = await writeWorkspaceFile(h, 'reports/multi-group.qor.rpt', synthetic);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    const rec = host.ctx.hima.ledger.records({ runId: runId! })[0]!;
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];

    assert.deepEqual(find(values, 'setup_wns'), { type: 'setup_wns', value: -0.20, unit: 'ns', mode: 'setup', scope: 'all', group: 'clk_b' }, 'worst (minimum) slack over both groups, naming the group it was read from');

    // Both groups are named after a clock, so the report alone does not say which of them is the
    // clock the Run asked a period for. Reading either one's period would be a guess a Loop then
    // pushes against, so the period is unknown, and the reason names the clocks that were found.
    const clockPeriod = find(values, 'clock_period');
    assert.equal(clockPeriod?.value, null, 'a two-clock report does not state which period the Run asked for');
    assert.equal(clockPeriod?.group, undefined, 'no single group supplied it, so no group is named');
    assert.match(clockPeriod?.unknownReason ?? '', /clk_a/);
    assert.match(clockPeriod?.unknownReason ?? '', /clk_b/);

    assert.equal(find(values, 'setup_tns')?.value, -0.05 + -0.25, 'setup TNS sums every group\'s total negative slack');
    assert.equal(find(values, 'setup_tns')?.group, undefined, 'a sum over every group came from no one group');
    assert.deepEqual(find(values, 'hold_wns'), { type: 'hold_wns', value: -0.02, unit: 'ns', mode: 'hold', scope: 'all', group: 'clk_a' }, 'hold WNS is the worst (largest) hold violation over both groups, as the slack it stands for, naming the group that stated it');
    assert.deepEqual(find(values, 'cell_area'), { type: 'cell_area', value: 500.123456, unit: 'um2' });
  } finally { await host.dispose(); await h.dispose(); }
});

test('multiple path groups, one missing its Critical Path Slack line: setup WNS goes unknown naming that group, while TNS and hold WNS (whose lines are complete) still read', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const synthetic = [
    '****************************************',
    'Report : qor',
    'Design : testMultiMissingSlack',
    'Version: X-2025.06-SP3',
    'Date   : Mon Jan  1 00:00:00 2024',
    '****************************************',
    '',
    '',
    "  Timing Path Group 'clk_a'",
    '  -----------------------------------',
    '  Levels of Logic:              10.00',
    '  Critical Path Length:          0.10',
    '  Critical Path Slack:          -0.05',
    '  Critical Path Clk Period:      1.00',
    '  Total Negative Slack:         -0.05',
    '  No. of Violating Paths:        1.00',
    '  Worst Hold Violation:          0.02',
    '  Total Hold Violation:          0.02',
    '  No. of Hold Violations:        1.00',
    '  -----------------------------------',
    '',
    '',
    // clk_b states no Critical Path Slack line at all: a partially unparseable group, not merely a
    // group with a worse (or better) reading than clk_a's.
    "  Timing Path Group 'clk_b'",
    '  -----------------------------------',
    '  Levels of Logic:              12.00',
    '  Critical Path Length:          0.12',
    '  Critical Path Clk Period:      1.50',
    '  Total Negative Slack:         -0.25',
    '  No. of Violating Paths:        2.00',
    '  Worst Hold Violation:          0.00',
    '  Total Hold Violation:          0.00',
    '  No. of Hold Violations:        0.00',
    '  -----------------------------------',
    '',
    '',
    '  Area',
    '  -----------------------------------',
    '  Cell Area:                  500.123456',
    '  Design Area:                500.123456',
    '',
  ].join('\n');
  const rel = await writeWorkspaceFile(h, 'reports/multi-group-missing-slack.qor.rpt', synthetic);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    const rec = host.ctx.hima.ledger.records({ runId: runId! })[0]!;
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];

    const setupWns = find(values, 'setup_wns');
    assert.equal(setupWns?.value, null, 'clk_b never states a slack, so the minimum over "every group" cannot be honestly computed');
    assert.match(setupWns?.unknownReason ?? '', /Critical Path Slack/);
    assert.match(setupWns?.unknownReason ?? '', /clk_b/, 'the reason names the group missing the line, not just "some group"');
    assert.equal(setupWns?.group, undefined, 'no group could be chosen, so none is named');

    // The clock period no longer rides on the worst-slack choice: it is unknown here because the
    // report states two clocks, which is true whether or not clk_b stated a slack.
    const clockPeriod = find(values, 'clock_period');
    assert.equal(clockPeriod?.value, null, 'a two-clock report does not state which period the Run asked for');
    assert.doesNotMatch(clockPeriod?.unknownReason ?? '', /Critical Path Slack/, 'the missing slack line is not why the period is unknown');
    assert.match(clockPeriod?.unknownReason ?? '', /clk_a/);
    assert.match(clockPeriod?.unknownReason ?? '', /clk_b/);

    // Both other group-folded values state their line in every group, so they still read: the one
    // missing line taints only the values it feeds, never the whole observation.
    assert.equal(find(values, 'setup_tns')?.value, -0.05 + -0.25, 'setup TNS still sums every group\'s total negative slack');
    assert.deepEqual(find(values, 'hold_wns'), { type: 'hold_wns', value: -0.02, unit: 'ns', mode: 'hold', scope: 'all', group: 'clk_a' }, 'hold WNS still reads: both groups state their Worst Hold Violation line');
    assert.deepEqual(find(values, 'cell_area'), { type: 'cell_area', value: 500.123456, unit: 'um2' });
  } finally { await host.dispose(); await h.dispose(); }
});

test('the dc-qor-report reader accepts a gzip-compressed report transparently, as the Innovus readers do', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const synthetic = [
    '****************************************',
    'Report : qor',
    'Design : testGzip',
    'Version: X-2025.06-SP3',
    'Date   : Mon Jan  1 00:00:00 2024',
    '****************************************',
    '',
    '',
    "  Timing Path Group 'core_clk'",
    '  -----------------------------------',
    '  Critical Path Slack:           0.00',
    '  Critical Path Clk Period:      3.00',
    '  Total Negative Slack:          0.00',
    '  Worst Hold Violation:          0.00',
    '  -----------------------------------',
    '',
    '',
    '  Area',
    '  -----------------------------------',
    '  Cell Area:                  123.456',
    '',
  ].join('\n');
  const rel = await writeWorkspaceFile(h, 'reports/gzipped.qor.rpt.gz', gzipSync(Buffer.from(synthetic, 'utf8')));
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${rel} --reader dc-qor-report`);
    assert.equal(kind, 'success', text);
    const rec = host.ctx.hima.ledger.records({ runId: runId! })[0]!;
    const values = (rec.type === 'observation' ? rec.values : []) as Value[];
    assert.deepEqual(find(values, 'clock_period'), { type: 'clock_period', value: 3.00, unit: 'ns', group: 'core_clk' });
    assert.deepEqual(find(values, 'cell_area'), { type: 'cell_area', value: 123.456, unit: 'um2' });
  } finally { await host.dispose(); await h.dispose(); }
});

test('a report of the wrong kind is refused by the dc-qor-report reader, with no observation recorded', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --reader dc-qor-report`);
    assert.equal(kind, 'error', text);
    assert.match(text, /refused/);
    const records = host.ctx.hima.ledger.records({ runId: runId! });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.type, 'refusal');
    assert.equal(records[0]!.writer, 'executor', 'a reader refusal is the executor deciding, not the shell');
    assert.match(records[0]!.type === 'refusal' ? records[0]!.reason : '', /dc-qor-report/);
    assert.equal(host.ctx.hima.ledger.records({ runId: runId!, type: 'observation' }).length, 0, 'no observation for a refused reader');
  } finally { await host.dispose(); await h.dispose(); }
});

test('the acceptance command: /hima observe --reader dc-qor-report --judge clock-period-at-most --param target_period_ns=<ns>, FAIL at a tighter target, PASS at a looser one', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    // Tighter than the report's 2.27 ns clock period: FAIL, citing the observation this very command made.
    // (`kind` reports whether the invocation itself ran without error; a FAIL or UNDETERMINED verdict
    // is a successful judgment, not a failed command — the same distinction the step-1 tests draw.)
    const failing = await himaCommand(host, h.workspace, `/hima observe local ${fixture} --reader dc-qor-report --judge clock-period-at-most --param target_period_ns=2.0`);
    assert.equal(failing.kind, 'success', failing.text);
    assert.match(failing.text, /^observed /m, 'the observation is reported');
    assert.match(failing.text, /FAIL clock-period-at-most@1/);
    const failObservationId = host.ctx.hima.ledger.records({ runId: failing.runId!, type: 'observation' })[0]!.id;
    assert.ok(failing.text.includes(failObservationId), 'and the verdict is reported alongside the observation it cites, in the one invocation');
    const [failVerdict] = verdicts(host, failing.runId!);
    assert.ok(failVerdict);
    assert.equal(failVerdict.outcome, 'FAIL', '2.27 ns is not at most 2.0 ns');
    assert.deepEqual(failVerdict.cites, [failObservationId]);
    assert.deepEqual(failVerdict.boundParameters, { target_period_ns: 2.0 }, 'the verdict carries the value bound to the parameter');

    // Looser than 2.27 ns: PASS.
    const passing = await himaCommand(host, h.workspace, `/hima observe local ${fixture} --reader dc-qor-report --judge clock-period-at-most --param target_period_ns=2.3`);
    assert.equal(passing.kind, 'success', passing.text);
    assert.match(passing.text, /PASS clock-period-at-most@1/);
    const passObservationId = host.ctx.hima.ledger.records({ runId: passing.runId!, type: 'observation' })[0]!.id;
    const [passVerdict] = verdicts(host, passing.runId!);
    assert.ok(passVerdict);
    assert.equal(passVerdict.outcome, 'PASS', '2.27 ns is at most 2.3 ns');
    assert.deepEqual(passVerdict.cites, [passObservationId]);
    assert.deepEqual(passVerdict.boundParameters, { target_period_ns: 2.3 });

    // No --param at all: UNDETERMINED, naming the parameter, never a silent pass or fail.
    const unbound = await himaCommand(host, h.workspace, `/hima observe local ${fixture} --reader dc-qor-report --judge clock-period-at-most`);
    assert.equal(unbound.kind, 'success', unbound.text);
    assert.match(unbound.text, /UNDETERMINED clock-period-at-most@1/);
    const [unboundVerdict] = verdicts(host, unbound.runId!);
    assert.ok(unboundVerdict);
    assert.equal(unboundVerdict.outcome, 'UNDETERMINED');
    assert.match(unboundVerdict.reason ?? '', /target_period_ns/, 'the reason names the unbound parameter');
    assert.equal(unboundVerdict.boundParameters, undefined, 'nothing was bound, so the key is absent, never a null or empty object');
  } finally { await host.dispose(); await h.dispose(); }
});

test('the hima_observe tool binds --param the same way: judging clock-period-at-most with params target_period_ns yields the same outcome', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-observe-param' as never,
      name: 'hima_observe',
      arguments: { site: 'local', path: fixture, reader: 'dc-qor-report', judge: ['clock-period-at-most'], params: { target_period_ns: 2.0 } },
      agent,
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = (result as unknown as { value?: { runId: string; verdicts?: { outcome: string; ruleId: string; boundParameters?: Record<string, number> }[] } }).value!;
    assert.equal(value.verdicts?.length, 1);
    assert.equal(value.verdicts![0]!.outcome, 'FAIL', 'the tool binds the same 2.0 ns target the command line would');
    assert.deepEqual(value.verdicts![0]!.boundParameters, { target_period_ns: 2.0 });
  } finally { await host.dispose(); await h.dispose(); }
});

test('the hima_observe tool rejects a non-numeric params value with an error result naming the parameter, writing no observation and no verdict', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    // A prior, well-formed observation on its own run: proves the rejected call below neither adds
    // to it nor creates a run of its own — the params check runs before observe, not after.
    const { runId } = await himaCommand(host, h.workspace, `/hima observe local ${fixture} --reader dc-qor-report`);
    assert.ok(runId);
    const before = host.ctx.hima.ledger.records({ runId: runId! });
    assert.equal(before.length, 1, 'one observation exists before the rejected call');

    const result = await host.ctx.tools.execute({
      callId: 'call-hima-observe-bad-param' as never,
      name: 'hima_observe',
      arguments: {
        site: 'local',
        path: fixture,
        run: runId,
        reader: 'dc-qor-report',
        judge: ['clock-period-at-most'],
        params: { target_period_ns: 'abc' },
      },
      agent,
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(result.isError, true, 'a non-numeric parameter is rejected, never silently dropped');
    const failure = (result as unknown as { error?: { message: string } }).error;
    assert.match(failure?.message ?? '', /target_period_ns/, 'the error names the offending parameter');

    const after = host.ctx.hima.ledger.records({ runId: runId! });
    assert.deepEqual(after, before, 'the rejected call wrote no observation and no verdict to the existing run');
  } finally { await host.dispose(); await h.dispose(); }
});

test('POST /hima/api/observe binds params the same way: the run view shows the same outcome the command and the tool give', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'syn/qor.rpt');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootHimaHost(h);
  try {
    const cookie = await openSession(host);
    const res = await postObserve(host, cookie, {
      site: 'local',
      path: fixture,
      reader: 'dc-qor-report',
      judge: ['clock-period-at-most'],
      params: { target_period_ns: 2.3 },
    });
    const body = await res.json() as RunView;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.verdicts.length, 1);
    assert.equal(body.verdicts[0]!.outcome, 'PASS', 'the route binds the same 2.3 ns target the command line and the tool would');
    assert.deepEqual(body.verdicts[0]!.boundParameters, { target_period_ns: 2.3 });
  } finally {
    const code = await host.stop();
    assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    await h.dispose();
  }
});
