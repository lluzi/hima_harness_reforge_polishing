// @hima-seam tools direct
// Ticket #6: HimaJudge — declared deterministic rules over ledger data, the sole verdict writer,
// UNDETERMINED whenever a required value is missing or unknown. D6 and D7, at the booted-Host seam.
// Ticket #11 adds `--param <name>=<value>`, the generic mechanism a rule's declared parameter is
// bound with; the reader-specific FAIL/PASS/UNDETERMINED walk of `clock-period-at-most` itself lives
// in `dc-reader.test.ts`, which owns the dc-qor-report reader it needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
import { requireOpene902Fixture } from './support/opene902-fixtures.ts';
import { installPack, writePackFiles } from './support/pack.ts';
// Loads the `ctx.hima` declaration merge onto Context.
import type {} from '@hima/harness';
import type {} from '@deepseek-ai/dsh-tools';

type Host = InProcessHost;

/** Observe one report with the Innovus summary reader and return the run and the observation record id. */
async function observeSummary(host: Host, workspace: string, filePath: string) {
  const { kind, text, runId } = await himaCommand(host, workspace, `/hima observe local ${filePath} --reader innovus-timing-summary`);
  assert.equal(kind, 'success', text);
  assert.ok(runId, 'the observation belongs to a run');
  const observations = host.ctx.hima.ledger.records({ runId: runId!, type: 'observation' });
  assert.equal(observations.length, 1, 'exactly one observation to cite');
  return { runId: runId!, observationId: observations[0]!.id };
}

interface Verdict {
  id: string;
  writer: string;
  outcome: string;
  ruleId: string;
  ruleVersion: string;
  cites: string[];
  valuesAsRead: unknown[];
  reason?: string;
  boundParameters?: Record<string, number>;
}

function verdicts(host: Host, runId: string): Verdict[] {
  return host.ctx.hima.ledger.records({ runId, type: 'verdict' }) as unknown as Verdict[];
}

test('the judge rules the real opene902 setup summary by declared rules: all-paths WNS fails, reg2reg passes, each citing the observation it read', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { runId, observationId } = await observeSummary(host, h.workspace, fixture);
    const judged = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules setup-wns-all-nonnegative,setup-wns-reg2reg-nonnegative`);
    assert.equal(judged.kind, 'success', judged.text);
    assert.match(judged.text, /FAIL setup-wns-all-nonnegative@1/, 'the failing verdict names its rule and version');
    assert.match(judged.text, /PASS setup-wns-reg2reg-nonnegative@1/);
    assert.match(judged.text, new RegExp(`cites ${observationId}`), 'the text names the cited record');

    const written = verdicts(host, runId);
    assert.equal(written.length, 2, 'one verdict record per rule');
    const all = written.find((v) => v.ruleId === 'setup-wns-all-nonnegative')!;
    assert.equal(all.outcome, 'FAIL', 'setup WNS over all paths is -0.073 ns, below the 0 ns threshold');
    assert.equal(all.writer, 'judge', 'a verdict is written by the judge role alone');
    assert.equal(all.ruleVersion, '1');
    assert.deepEqual(all.cites, [observationId], 'it cites exactly the observation it read');
    assert.deepEqual(all.valuesAsRead, [{ type: 'setup_wns', value: -0.073, unit: 'ns', mode: 'setup', scope: 'all' }]);
    assert.equal(all.reason, undefined, 'a computed verdict needs no reason');

    const r2r = written.find((v) => v.ruleId === 'setup-wns-reg2reg-nonnegative')!;
    assert.equal(r2r.outcome, 'PASS', 'setup WNS reg2reg is 0.002 ns, at or above the threshold');
    assert.deepEqual(r2r.cites, [observationId]);
    assert.deepEqual(r2r.valuesAsRead, [{ type: 'setup_wns', value: 0.002, unit: 'ns', mode: 'setup', scope: 'reg2reg' }]);

    // Deterministic: the same ledger, judged again, yields the same verdicts.
    const again = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules setup-wns-all-nonnegative,setup-wns-reg2reg-nonnegative`);
    assert.equal(again.kind, 'success', again.text);
    const shape = (v: Verdict) => ({ outcome: v.outcome, ruleId: v.ruleId, ruleVersion: v.ruleVersion, cites: v.cites, valuesAsRead: v.valuesAsRead, reason: v.reason });
    const after = verdicts(host, runId);
    assert.equal(after.length, 4, 'the ledger is append-only: judging again adds records');
    assert.deepEqual(after.slice(2).map(shape), after.slice(0, 2).map(shape));
  } finally { await host.dispose(); await h.dispose(); }
});

test('the judge rules hold WNS on the real opene902 hold summary as PASS, citing that observation', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute_hold.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { runId, observationId } = await observeSummary(host, h.workspace, fixture);
    const judged = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules hold-wns-all-nonnegative`);
    assert.equal(judged.kind, 'success', judged.text);
    const [verdict] = verdicts(host, runId);
    assert.ok(verdict);
    assert.equal(verdict.outcome, 'PASS', 'hold WNS is 0.034 ns');
    assert.equal(verdict.ruleId, 'hold-wns-all-nonnegative');
    assert.deepEqual(verdict.cites, [observationId]);
    assert.deepEqual(verdict.valuesAsRead, [{ type: 'hold_wns', value: 0.034, unit: 'ns', mode: 'hold', scope: 'all' }]);
  } finally { await host.dispose(); await h.dispose(); }
});

test('verdicts survive a host restart and read back unchanged, PASS and UNDETERMINED alike', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute_hold.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  let runId = '';
  let before: unknown;
  const first = await bootInProcess(h);
  try {
    ({ runId } = await observeSummary(first, h.workspace, fixture));
    const judged = await himaCommand(first, h.workspace, `/hima judge ${runId} --rules hold-wns-all-nonnegative,setup-wns-all-nonnegative`);
    assert.equal(judged.kind, 'success', judged.text);
    before = verdicts(first, runId);
    assert.deepEqual((before as Verdict[]).map((v) => v.outcome), ['PASS', 'UNDETERMINED']);
  } finally { await first.dispose(); }
  const second = await bootInProcess(h);
  try {
    assert.deepEqual(verdicts(second, runId), before, 'the durable ledger accepts and returns its verdict records');
  } finally { await second.dispose(); await h.dispose(); }
});

test('a rule about an analysis pass the report does not state is UNDETERMINED carrying the reader\'s own words for why, and one about a value type nothing read at all is UNDETERMINED with nothing to cite', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    // A setup summary states no hold-mode numbers — and since #61 the reader says so rather than
    // leaving the hold types out: it declares it emits them, and the one validator holds the set of
    // types produced against the set declared, so an unknown carrying the report's own reason is the
    // only honest thing a reading of a setup summary can say about hold timing.
    const { runId, observationId } = await observeSummary(host, h.workspace, fixture);
    const judged = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules hold-wns-all-nonnegative`);
    assert.equal(judged.kind, 'success', judged.text);
    assert.match(judged.text, /UNDETERMINED hold-wns-all-nonnegative@1/);
    const [verdict] = verdicts(host, runId);
    assert.ok(verdict);
    assert.equal(verdict.outcome, 'UNDETERMINED');
    assert.notEqual(verdict.outcome, 'PASS');
    assert.match(verdict.reason ?? '', /hold_wns/, 'the reason names the requirement it could not settle');
    assert.match(verdict.reason ?? '', /mode hold, scope all/);
    assert.match(verdict.reason ?? '', /states the setup mode timing table/, 'and carries the reader\'s own words for why it is unknown');
    assert.deepEqual(verdict.cites, [observationId], 'it cites the observation it read the unknown from');
    assert.deepEqual(verdict.valuesAsRead, [
      { type: 'hold_wns', value: null, unit: 'ns', mode: 'hold', scope: 'all', unknownReason: 'this report states the setup mode timing table, so it says nothing about hold timing' },
    ]);
  } finally { await host.dispose(); await h.dispose(); }

  // And the other case, which no reading of a summary reaches any more: a rule over a value type the
  // reading holds nothing of at all. The raw reader records a file's identity and reads no semantics
  // from it, so every rule is UNDETERMINED over it with nothing read and nothing to cite — which is
  // the branch of the judge that answers before it has any value to look at.
  const bare = await createHimaHome();
  await writeLocalSite(bare, { allowedReadRoots: [bare.workspace, path.dirname(fixture)] });
  const host2 = await bootInProcess(bare);
  try {
    const observed = await himaCommand(host2, bare.workspace, `/hima observe local ${fixture} --reader raw`);
    assert.equal(observed.kind, 'success', observed.text);
    const judged = await himaCommand(host2, bare.workspace, `/hima judge ${observed.runId!} --rules hold-wns-all-nonnegative`);
    assert.equal(judged.kind, 'success', judged.text);
    const [verdict] = verdicts(host2, observed.runId!);
    assert.ok(verdict);
    assert.equal(verdict.outcome, 'UNDETERMINED');
    assert.match(verdict.reason ?? '', /hold_wns/, 'the reason names the requirement nothing read');
    assert.deepEqual(verdict.valuesAsRead, [], 'nothing was read');
    assert.deepEqual(verdict.cites, [], 'nothing to cite');
  } finally { await host2.dispose(); await bare.dispose(); }
});

test('a summary truncated inside its timing table is UNDETERMINED with the reader\'s own reason, never PASS', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h);
  // Cut the real summary just before its "WNS (ns):" row: the Setup mode header survives, the values do not.
  const full = gunzipSync(await readFile(fixture)).toString('utf8');
  const lines = full.split(/\r?\n/);
  const wnsRow = lines.findIndex((l) => /WNS \(ns\):/.test(l));
  assert.ok(wnsRow > 0, 'the fixture still has the WNS row this test cuts');
  const truncated = lines.slice(0, wnsRow).join('\n') + '\n';
  assert.ok(truncated.includes('Setup mode') && !truncated.includes('WNS (ns):'), 'the slice keeps the mode header and drops the values');
  const rel = 'reports/cut-mid-table.summary';
  await mkdir(path.join(h.workspace, path.dirname(rel)), { recursive: true });
  await writeFile(path.join(h.workspace, rel), truncated, 'utf8');
  const host = await bootInProcess(h);
  try {
    const { runId, observationId } = await observeSummary(host, h.workspace, rel);
    const judged = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules setup-wns-all-nonnegative`);
    assert.equal(judged.kind, 'success', judged.text);
    const [verdict] = verdicts(host, runId);
    assert.ok(verdict);
    assert.equal(verdict.outcome, 'UNDETERMINED', 'an unknown value is never a pass and never a fail');
    assert.match(verdict.reason ?? '', /setup_wns/, 'the reason names the unknown requirement');
    assert.match(verdict.reason ?? '', /no "WNS \(ns\):" row found/, 'and carries the reader\'s stated reason');
    assert.deepEqual(verdict.cites, [observationId], 'it cites the observation it read the unknown from');
    assert.deepEqual(verdict.valuesAsRead, [
      { type: 'setup_wns', value: null, unit: 'ns', mode: 'setup', scope: 'all', unknownReason: 'no "WNS (ns):" row found in the setup mode timing table' },
    ]);
  } finally { await host.dispose(); await h.dispose(); }
});

test('an unknown rule id is an error, never a silent pass, and writes no verdict', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { runId } = await observeSummary(host, h.workspace, fixture);
    const judged = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules setup-wns-all-nonnegative,no-such-rule`);
    assert.equal(judged.kind, 'error', judged.text);
    assert.match(judged.text, /no-such-rule/);
    assert.deepEqual(verdicts(host, runId), [], 'no rule of the batch was judged');

    // A version that does not exist is refused the same way.
    const wrongVersion = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules setup-wns-all-nonnegative@99`);
    assert.equal(wrongVersion.kind, 'error', wrongVersion.text);
    assert.deepEqual(verdicts(host, runId), []);
  } finally { await host.dispose(); await h.dispose(); }
});

test('only the judge can append a verdict: the ledger hands its capability out once and the tool face never reaches it', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const ledger = host.ctx.hima.ledger as unknown as Record<string, unknown>;
    assert.equal(typeof ledger.appendVerdict, 'undefined', 'the ledger exposes no appendVerdict to callers');
    assert.throws(
      () => host.ctx.hima.ledger.takeVerdictWriter(),
      /already been handed out/,
      'the one verdict-writer capability is the judge\'s; a second caller cannot get it',
    );

    const judge = host.ctx.hima.judge;
    assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(judge)).sort(), ['constructor', 'evaluate'], 'the judge answers one question and nothing else');
    assert.deepEqual(Reflect.ownKeys(judge), [], 'the judge holds no agent, session, or conversation of its own');

    // The tool face observes; it never writes a verdict of its own.
    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-observe-nojudge' as never,
      name: 'hima_observe',
      arguments: { site: 'local', path: fixture, reader: 'innovus-timing-summary' },
      agent,
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = (result as unknown as { value?: { runId: string; verdicts?: unknown[] } }).value!;
    assert.equal(value.verdicts, undefined, 'an observation carries no verdict the tool wrote itself');
    assert.deepEqual(verdicts(host, value.runId), [], 'and none reached the ledger');
  } finally { await host.dispose(); await h.dispose(); }
});

test('one invocation of /hima observe --judge runs read, ledger, and judge, and returns the verdict with its cited record', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(
      host,
      h.workspace,
      `/hima observe local ${fixture} --reader innovus-timing-summary --judge setup-wns-all-nonnegative,hold-wns-all-nonnegative`,
    );
    assert.equal(kind, 'success', text);
    assert.ok(runId);
    const observationId = host.ctx.hima.ledger.records({ runId: runId!, type: 'observation' })[0]!.id;
    assert.match(text, /^observed /m, 'the observation is reported');
    assert.ok(text.includes(observationId), 'and named by its record id');
    assert.match(text, /FAIL setup-wns-all-nonnegative@1/, 'and the verdict with it, in the one invocation');
    assert.match(text, new RegExp(`cites ${observationId}`));
    assert.match(text, /UNDETERMINED hold-wns-all-nonnegative@1/, 'a rule this observation cannot answer stays undetermined');

    const written = verdicts(host, runId!);
    assert.equal(written.length, 2);
    assert.deepEqual(written.map((v) => v.outcome), ['FAIL', 'UNDETERMINED']);
    assert.deepEqual(written[0]!.cites, [observationId]);
  } finally { await host.dispose(); await h.dispose(); }
});

test('the hima_observe tool judges the rules it is given, in the same invocation, through the same service', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute_hold.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-observe-judge' as never,
      name: 'hima_observe',
      arguments: { site: 'local', path: fixture, reader: 'innovus-timing-summary', judge: ['hold-wns-all-nonnegative'] },
      agent,
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = (result as unknown as { value?: { runId: string; recordId: string; verdicts?: { outcome: string; ruleId: string; ruleVersion: string; cites: string[] }[] } }).value!;
    assert.equal(value.verdicts?.length, 1);
    const verdict = value.verdicts![0]!;
    assert.equal(verdict.outcome, 'PASS');
    assert.equal(verdict.ruleId, 'hold-wns-all-nonnegative');
    assert.equal(verdict.ruleVersion, '1');
    assert.deepEqual(verdict.cites, [value.recordId], 'the verdict cites the observation of this very invocation');
    const written = verdicts(host, value.runId);
    assert.equal(written.length, 1);
    assert.equal(written[0]!.writer, 'judge', 'the tool face asked; the judge wrote');
  } finally { await host.dispose(); await h.dispose(); }
});

test('--judge with no value is a usage error, not a silent pass: it never reads, never runs, and writes nothing', async (t) => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    // A trailing `--judge` with nothing after it must not be read as "no --judge given".
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --judge`);
    assert.equal(kind, 'error', text);
    assert.match(text, /usage: \/hima observe/, 'a usage message, not a silent success');
    assert.match(text, /--judge/);
    assert.equal(runId, undefined, 'no run id appears: the flags are validated before observe ever creates a run');

    // The naive whitespace tokenizer this command uses (`rawInput.split(/\s+/).filter(Boolean)`) drops empty
    // tokens outright, so a literal `--judge ""` can never surface as flags = [..., '--judge', '']; the only
    // way this tokenizer can see "present but valueless" is the trailing-flag case exercised above.

    // The same validation guards --reader: present without a value is a usage error too, before any read.
    const readerCase = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --reader`);
    assert.equal(readerCase.kind, 'error', readerCase.text);
    assert.match(readerCase.text, /usage: \/hima observe/);
    assert.equal(readerCase.runId, undefined, 'no run id appears for this validation error either');

    // A well-formed call right after proves the ledger and site were untouched by the rejected attempts.
    const good = await himaCommand(host, h.workspace, `/hima observe local ${report.rel}`);
    assert.equal(good.kind, 'success', good.text);
    assert.ok(good.runId);
    const observations = host.ctx.hima.ledger.records({ runId: good.runId!, type: 'observation' });
    assert.equal(observations.length, 1, 'the first and only record on this run is its own observation');
  } finally { await host.dispose(); await h.dispose(); }
});

test('a malformed --param is a usage error on both /hima judge and /hima observe --judge: nothing is read, nothing is written', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { runId } = await observeSummary(host, h.workspace, fixture);

    const noEquals = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules setup-wns-all-nonnegative --param target_period_ns`);
    assert.equal(noEquals.kind, 'error', noEquals.text);
    assert.match(noEquals.text, /--param/);

    const notNumeric = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules setup-wns-all-nonnegative --param target_period_ns=notanumber`);
    assert.equal(notNumeric.kind, 'error', notNumeric.text);
    assert.match(notNumeric.text, /--param/);

    assert.deepEqual(verdicts(host, runId), [], 'no rule was judged by either malformed attempt');

    // Same validation on the combined observe+judge command, before the run is even created.
    const report = await writeSampleReport(h);
    const combined = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --judge setup-wns-all-nonnegative --param =2.0`);
    assert.equal(combined.kind, 'error', combined.text);
    assert.match(combined.text, /--param/);
    assert.equal(combined.runId, undefined, 'the flags are validated before observe ever creates a run');
  } finally { await host.dispose(); await h.dispose(); }
});

test('a rule that declares no parameter ignores an unrelated --param entirely: same outcome, and boundParameters stays absent', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, path.dirname(fixture)] });
  const host = await bootInProcess(h);
  try {
    const { runId } = await observeSummary(host, h.workspace, fixture);
    const judged = await himaCommand(host, h.workspace, `/hima judge ${runId} --rules setup-wns-reg2reg-nonnegative --param unrelated=42`);
    assert.equal(judged.kind, 'success', judged.text);
    assert.match(judged.text, /PASS setup-wns-reg2reg-nonnegative@1/, 'the same PASS this rule always gives on this fixture, --param or not');
    const [verdict] = verdicts(host, runId);
    assert.ok(verdict);
    assert.equal(verdict.outcome, 'PASS');
    assert.equal(verdict.boundParameters, undefined, 'this rule has no declared parameter, so nothing is bound onto its verdict');
  } finally { await host.dispose(); await h.dispose(); }
});

// ---------------------------------------------------------------------------------------------
// Which file a rule id answers to is the Run's pack's to say (#57)
// ---------------------------------------------------------------------------------------------

/**
 * The bundle's own goal rule again, at a version only this file carries, for a pack to hold in its
 * own `rules/`.
 *
 * The same predicate, so a Campaign of that pack judges the same thing; a different version, because
 * that is what makes the two files distinguishable in a verdict — a verdict at `@1` could only have
 * come from the bundle.
 */
const packsOwnGoalRule = `id: clock-period-at-most
version: '2'
title: Clock period is at most the bound target period, in the pack's own copy of the rule
parameter:
  name: target_period_ns
  unit: ns
requires:
  - type: clock_period
subject:
  type: clock_period
predicate:
  op: lte
  threshold:
    parameter: target_period_ns
  unit: ns
`;

test('a run whose pack this machine cannot load is refused by /hima judge, naming the pack and why, rather than judged on the bundle\'s copy of the rule', async (t) => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  // A pack carrying its own copy of the goal rule, which is the whole reason a Run resolves through
  // its pack at all: judged through this pack the verdict is at `@2`, judged through the bundle it is
  // at `@1`, and those are two different rules with one id.
  const installed = await installPack(h);
  await writePackFiles(installed.dir, { 'rules/clock-period-at-most.yml': packsOwnGoalRule });
  const host = await bootInProcess(h);
  try {
    const run = await host.ctx.hima.ledger.createRun({ campaignId: 'campaign-unloadable-pack', siteId: 'local', packId: installed.id });
    // ...and then the pack stops loading, which is what an editing mistake, a half-finished install or
    // a removed folder looks like to this host.
    await rm(path.join(installed.dir, 'contract.yml'));
    const judged = await himaCommand(host, h.workspace, `/hima judge ${run.id} --rules clock-period-at-most`);
    for (const line of judged.text.split('\n')) t.diagnostic(line);
    assert.equal(judged.kind, 'error', judged.text);
    assert.ok(judged.text.includes(installed.id), `the refusal names the pack whose rules could not be reached: ${judged.text}`);
    assert.match(judged.text, /contract\.yml/, `and says why it would not load, in the loader's own words: ${judged.text}`);
    assert.deepEqual(
      verdicts(host, run.id),
      [],
      'and writes nothing: a verdict from a rule this Run\'s pack never selected is worse than no verdict at all',
    );
  } finally { await host.dispose(); await h.dispose(); }
});
