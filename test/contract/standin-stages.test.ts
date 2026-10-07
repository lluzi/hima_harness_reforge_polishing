// Generated stand-in flow contract: stage arithmetic, local Permit decisions, report Readers and
// containment. Stages are bounded local fixture processes; they do not prove DBOS durability.
// Actual DBOS Job/Reader execution is covered by the existing durable Host tests.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { createEmptyHome, createHimaHome, repoRoot, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { observeReport } from './support/observe-report.ts';
import { channelFor, loadSite } from '@hima/harness';
import { pathToFileURL } from 'node:url';
import { writeLocalSite } from './support/site.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import { mustBeInside, seedLocalSite, standinStages } from '../../packages/desktop/src/local-site.ts';

/** The period every sequence here asks for, in ns. Below the 2.20 ns the flow closes at with the
 *  foundry library alone — so the foundry-only synthesis misses by 0.15 — and above the 2.035 ns it
 *  closes at once a `broad` library has been adopted, so the two syntheses say different things. */
const PERIOD_NS = '2.05';

/** What the stand-in closes at with the foundry library alone: the flow's own number. */
const ACHIEVABLE_NS = 2.2;

/** The improvement a Goal of five percent asks of the two arms' critical paths. */
const FIVE_PERCENT = 0.05;

/** How long one stage may take before this test gives up on it. Every stage here sleeps nothing. */
const stageTimeoutMs = 60_000;

/** The generated flow's real Permit and the Host used to read its reports. */
interface Bench {
  readonly h: HimaHome;
  readonly host: InProcessHost;
  runId: string;
  readonly launches: { workspace: string; wrapper: string }[];
}
interface StageRun {
  readonly target: string;
  readonly exitCode: number;
  readonly log: string;
}

async function runStage(b: Bench, flowDir: string, target: string, vars: readonly string[]): Promise<StageRun> {
  const site = loadSite(path.join(b.h.home, 'hima/sites'), 'local');
  const { decideLaunch } = await import(pathToFileURL(path.join(repoRoot, 'packages/harness/lib/shell.js')).href);
  const argv = ['make', '-C', flowDir, target, ...vars];
  const decision = await decideLaunch(site, b.h.workspace, argv, channelFor(site));
  assert.equal(decision.ok, true, JSON.stringify(decision));
  b.launches.push({ workspace: decision.workspace, wrapper: argv[0]! });
  const ran = spawnSync(argv[0]!, argv.slice(1), { cwd: decision.workspace, encoding: 'utf8', timeout: stageTimeoutMs });
  assert.ifError(ran.error);
  assert.notEqual(ran.status, null, `stage ${target} returned no exit status: ${ran.stderr}`);
  return { target, exitCode: ran.status!, log: `${ran.stdout}${ran.stderr}` };
}

/** Run a stage and insist it refused, in words a person can act on, having written nothing. */
async function stageRefused(b: Bench, flowDir: string, target: string, vars: readonly string[], words: RegExp): Promise<void> {
  const run = await runStage(b, flowDir, target, vars);
  const said = await run.log;
  assert.notEqual(run.exitCode, 0, `${target} ${vars.join(' ')} was expected to be refused: ${said}`);
  assert.match(said, words, `${target} ${vars.join(' ')} says why it refused: ${said}`);
}

/** Run a stage and insist it succeeded, which is every stage but the library gate told to fail. */
async function stageOk(b: Bench, flowDir: string, target: string, vars: readonly string[]): Promise<StageRun> {
  const run = await runStage(b, flowDir, target, vars);
  if (run.exitCode !== 0) {
    assert.fail(`${target} ${vars.join(' ')} exited ${String(run.exitCode)}: ${await run.log}`);
  }
  return run;
}

/** One stage's JSON report, as the field names it writes. */
interface StageReport {
  readonly stage: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly count?: number;
  readonly cells?: readonly string[];
  readonly routes?: number;
  readonly routeFactor?: number;
  readonly adoptedInstances?: number;
  readonly distinctMasters?: number;
  readonly adoptedMasters?: number;
  readonly criticalPathNs?: number;
  readonly wnsNs?: number;
  readonly librarySetBeforeLaunch?: boolean;
  readonly generatedCellsAfterRestore?: number;
  readonly violations?: number;
}

/** Read one stage's JSON report. */
async function readReport(file: string): Promise<StageReport> {
  return JSON.parse(await readFile(file, 'utf8')) as StageReport;
}

/** Every file under a directory, by relative path and content hash: what "untouched" means here. */
async function listing(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(root, full)] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  };
  await walk(root);
  return out;
}

/** Current Probe services read the actual stage report and judge the declared rules. */
async function observed(b: Bench, file: string, reader: string, judge?: { readonly rules: string; readonly params?: Record<string, number> }) {
  const params = judge?.params;
  const result = await observeReport(b.host, b.h.workspace, { site: 'local', path: file, reader,
    ...(b.runId ? { run: b.runId } : {}),
    ...(judge ? { judge: judge.rules.split(','), params } : {}),
  });
  assert.equal(result.kind, 'success', result.text);
  assert.equal(result.record.type, 'observation');
  assert.equal(result.record.type === 'observation' ? result.record.reader.id : undefined, reader);
  b.runId = result.runId;
  return result.verdicts;
}

function verdictOf(answer: readonly { ruleId: string; outcome: string }[], ruleId: string): string {
  const verdict = answer.find(v => v.ruleId === ruleId);
  assert.ok(verdict, `the answer rules on ${ruleId}: ${JSON.stringify(answer)}`);
  return verdict.outcome;
}

interface StandinBench {
  readonly b: Bench;
  /** The flow root the Site binds: read-only to a Campaign, and never built in. */
  readonly flowRoot: string;
  readonly design: string;
  dispose(): Promise<void>;
}

/** Prepare an isolated generated flow and the real report-reading Host. */
async function bench(t: TestContext): Promise<StandinBench> {
  const h = await createHimaHome();
  try {
    const flow = await writeStandinFlow(t, h, { sleepSeconds: 0 });
    assert.ok(flow, 'the stand-in flow was generated');
    await writeLocalSite(h, {
      allowedReadRoots: [h.workspace, flow.root], allowedWriteRoots: [h.workspace],
      bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
    });
    const host = await bootInProcess(h);
    const b: Bench = { h, host, runId: '', launches: [] };
    return { b, flowRoot: flow.root, design: flow.design,
      dispose: async () => { await host.dispose(); await h.dispose(); },
    };
  } catch (error) { await h.dispose(); throw error; }
}

/** The Campaign's own copy of the flow, which is where every generation of a real Run builds (D19). */
async function copyOfTheFlow(flowRoot: string, into: string): Promise<string> {
  await cp(flowRoot, into, { recursive: true });
  return into;
}

test('every stage of the stand-in runs as a bounded fixture under the local Permit, writes its report inside the workspace with the inputs it was computed from, and leaves the bound flow root exactly as it was', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    const before = await listing(flowRoot);
    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'broad', 'flow'));
    const results = path.join(flow, 'results', design);
    const D = `DESIGN=${design}`;

    // A disallowed wrapper is refused by the production Permit before any fixture process starts.
    const site = loadSite(path.join(b.h.home, 'hima/sites'), 'local');
    const { decideLaunch } = await import(pathToFileURL(path.join(repoRoot, 'packages/harness/lib/shell.js')).href);
    const refused = await decideLaunch(site, b.h.workspace, ['perl', '-e', '1'], channelFor(site));
    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.match(refused.reason, /perl.*not an allowed wrapper/, JSON.stringify(refused));
    assert.equal(b.launches.length, 0, 'no process was started for the refused wrapper');

    // 1. Foundry-only synthesis: the stage that was already here, unchanged. 2.05 misses the 2.20 the
    // flow closes at by 0.15, and Design Compiler states a shortfall and never a margin (#54).
    await stageOk(b, flow, 'synth', [D, `CLOCK_PERIOD_NS=${PERIOD_NS}`, 'FORCE_SYNTH=1', 'EDA_CONTAINER_NAME=hima-t60']);
    const foundrySaid = await observed(b, path.join(results, 'syn/report/qor.rpt'), 'dc-qor-report', {
      rules: 'setup-wns-all-nonnegative,clock-period-at-most',
      params: { target_period_ns: Number(PERIOD_NS) },
    });
    assert.equal(verdictOf(foundrySaid, 'setup-wns-all-nonnegative'), 'FAIL', `the foundry-only synthesis missed: ${foundrySaid}`);
    assert.equal(verdictOf(foundrySaid, 'clock-period-at-most'), 'PASS', `and was read at the period it was asked for: ${foundrySaid}`);
    const foundryQor = await readFile(path.join(results, 'syn/report/qor.rpt'), 'utf8');
    assert.match(foundryQor, /^\s*Critical Path Slack:\s+-0\.15$/m, `it misses 2.05 by 0.15: ${foundryQor}`);
    assert.match(foundryQor, /^\s*Critical Path Clk Period:\s+2\.05$/m, `and the report states the period it was asked for: ${foundryQor}`);

    // 2 and 3. Mining, once per route, each with its own candidate set. `broad` yields twenty a route
    // and `TOP_N=10` reserves ten of them, so each route contributes ten and the union is twenty.
    for (const route of ['r1', 'r2']) {
      await stageOk(b, flow, 'mine', [D, `ROUTE=${route}`, 'PROFILE=broad', 'TOP_N=10', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
      const candidates = await readReport(path.join(results, `mine-${route}`, 'candidates.json'));
      assert.deepEqual(
        candidates.inputs,
        { design, route, profile: 'broad', topN: 10, periodNs: 2.05 },
        `the mining report echoes what it was asked for: ${JSON.stringify(candidates.inputs)}`,
      );
      assert.equal(candidates.count, 10, `TOP_N caps the profile's yield of twenty at ten a route: ${JSON.stringify(candidates)}`);
      assert.deepEqual(candidates.cells, Array.from({ length: 10 }, (_, i) => `${route}_c${String(i + 1)}`), 'and names them for their route');
    }

    // 4. The transistor netlists: one per candidate of the union over every route mined.
    await stageOk(b, flow, 'netlist', [D]);
    const netlist = await readReport(path.join(results, 'netlist', 'netlist.json'));
    assert.deepEqual(netlist.inputs, { design, routes: 2 }, `the merge says how many route sets it read: ${JSON.stringify(netlist.inputs)}`);
    assert.equal(netlist.count, 20, 'ten from each of two routes, de-duplicated by identity');
    assert.ok(existsSync(path.join(results, 'netlist', 'r1_c1.sp')), 'and one netlist file per candidate');

    // 5. The abstract layouts, one per netlist.
    await stageOk(b, flow, 'abstract', [D]);
    const abstract = await readReport(path.join(results, 'abstract', 'abstract.json'));
    assert.deepEqual(abstract.inputs, { design }, JSON.stringify(abstract.inputs));
    assert.equal(abstract.count, 20);
    assert.ok(existsSync(path.join(results, 'abstract', 'r2_c10.lef')), 'and one abstract per candidate');

    // 6. The characterised Liberty, one cell group per abstract.
    await stageOk(b, flow, 'charlib', [D, `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
    const charlib = await readReport(path.join(results, 'charlib', 'charlib.json'));
    assert.deepEqual(charlib.inputs, { design, periodNs: 2.05 }, JSON.stringify(charlib.inputs));
    assert.equal(charlib.count, 20);
    const liberty = await readFile(path.join(results, 'charlib', 'generated.lib'), 'utf8');
    assert.equal((liberty.match(/^ {2}cell \(/gm) ?? []).length, 20, 'twenty cell groups in the generated Liberty');
    assert.equal(
      (liberty.match(/internal_power/g) ?? []).length,
      20,
      'each with an internal_power group, which a Liberty without one is silently biased in its own favour by',
    );

    // 7. The library gate, told to fail: the report is written first and the stage then stops, so the
    // evidence of the failure survives it, and no database is left for the next stage to mistake for
    // a passed gate.
    const failed = await runStage(b, flow, 'lc', [D, 'LC_FAIL=1']);
    const failedSaid = await failed.log;
    // The Job's exit code is make's own 2, because make reports "a recipe failed" and never the code
    // the recipe left; the stage's own 4 — the gate, and not a stage run out of order, which is 2 —
    // is in what make said about it.
    assert.equal(failed.exitCode, 2, `the hard gate stopped the flow: ${failedSaid}`);
    assert.match(failedSaid, /\[lc\] Error 4/, `and the gate is what stopped it: ${failedSaid}`);
    assert.match(failedSaid, /\[stand-in\] Error: the generated library did not compile/, failedSaid);
    const failedReport = await readFile(path.join(results, 'lc', 'lc.rpt'), 'utf8');
    assert.match(failedReport, /^\s*Errors:\s+20$/m, `one error per cell it would not compile: ${failedReport}`);
    assert.match(failedReport, /^\s*Database Written:\s+no$/m, failedReport);
    assert.equal(existsSync(path.join(results, 'lc', 'generated.db')), false, 'and there is no database');

    // 8. The same gate, passed.
    await stageOk(b, flow, 'lc', [D]);
    const lcReport = await readFile(path.join(results, 'lc', 'lc.rpt'), 'utf8');
    assert.match(lcReport, /^\s*Errors:\s+0$/m, lcReport);
    assert.match(lcReport, /^\s*Cells Compiled:\s+20$/m, lcReport);
    assert.ok(existsSync(path.join(results, 'lc', 'generated.db')), 'and the database it wrote is there');

    // 9. Synthesis with the generated library, and the adoption it resolved. Twenty cells is above the
    // floor, so the mapper takes one master per four of them and nine instances of each — and the
    // design now closes at 2.20 × (1 − 5 × 0.015) = 2.035, which meets the 2.05 the foundry-only
    // synthesis missed.
    await stageOk(b, flow, 'synth-custom', [D, `CLOCK_PERIOD_NS=${PERIOD_NS}`, 'EDA_CONTAINER_NAME=hima-t60']);
    const adoption = await readReport(path.join(results, 'syn-custom', 'adoption.json'));
    assert.deepEqual(adoption.inputs, { design, periodNs: 2.05, libraryCells: 20 }, JSON.stringify(adoption.inputs));
    assert.equal(adoption.distinctMasters, 5, JSON.stringify(adoption));
    assert.equal(adoption.adoptedInstances, 45, JSON.stringify(adoption));
    const customSaid = await observed(b, path.join(results, 'syn-custom/report/qor.rpt'), 'dc-qor-report', {
      rules: 'setup-wns-all-nonnegative,clock-period-at-most',
      params: { target_period_ns: Number(PERIOD_NS) },
    });
    assert.equal(verdictOf(customSaid, 'setup-wns-all-nonnegative'), 'PASS', `the generated library meets 2.05: ${customSaid}`);
    assert.equal(verdictOf(customSaid, 'clock-period-at-most'), 'PASS', JSON.stringify(customSaid));
    const customQor = await readFile(path.join(results, 'syn-custom/report/qor.rpt'), 'utf8');
    assert.match(customQor, /^\s*Critical Path Slack:\s+0\.00$/m, `a met period states no margin: ${customQor}`);
    assert.match(customQor, /^\s*Critical Path Clk Period:\s+2\.05$/m, customQor);

    // 10 and 11. The two post-route arms, matched, each with a report directory of its own. The
    // foundry arm closes at the flow's own 2.20; the generated arm at the 2.035 its five adopted
    // masters bought it.
    const arms = {
      foundry: { wns: '-0.150', masters: 0 },
      generated: { wns: '0.015', masters: 5 },
    };
    const postRoute: Record<string, StageReport> = {};
    for (const [arm, want] of Object.entries(arms)) {
      await stageOk(b, flow, 'pnr', [D, `ARM=${arm}`, `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
      const post = await readReport(path.join(results, `pnr-${arm}`, 'postroute.json'));
      postRoute[arm] = post;
      assert.deepEqual(post.inputs, { design, periodNs: 2.05, arm }, JSON.stringify(post.inputs));
      assert.equal(post.adoptedMasters, want.masters, JSON.stringify(post));
      const said = await observed(b, path.join(results, `pnr-${arm}`, 'postroute.summary'), 'innovus-timing-summary', {
        rules: 'setup-wns-all-nonnegative,setup-wns-reg2reg-nonnegative',
      });
      const met = !want.wns.startsWith('-');
      assert.equal(verdictOf(said, 'setup-wns-all-nonnegative'), met ? 'PASS' : 'FAIL', `the ${arm} arm's post-route margin at 2.05: ${said}`);
      assert.equal(verdictOf(said, 'setup-wns-reg2reg-nonnegative'), met ? 'PASS' : 'FAIL', JSON.stringify(said));
      const summary = await readFile(path.join(results, `pnr-${arm}`, 'postroute.summary'), 'utf8');
      assert.match(summary, new RegExp(`^\\|\\s+WNS \\(ns\\):\\| ${want.wns}\\s+\\| ${want.wns}\\s+\\|$`, 'm'), `the ${arm} arm's two scopes: ${summary}`);
      assert.match(summary, /^Density: 48\.500%$/m, `and the density line the reader folds: ${summary}`);
    }
    // The five-percent Goal is measured on the two critical paths just read, and on nothing this
    // test knew before it read them.
    const improvement = postRoute['foundry']!.criticalPathNs! / postRoute['generated']!.criticalPathNs! - 1;
    assert.ok(improvement >= FIVE_PERCENT, `a broad library meets the five-percent Goal: ${improvement.toFixed(4)}`);

    // 12 and 13. The verification session, once per arm, with the liveness pair the zero-adoption
    // terminal turns on: the foundry arm never had the generated library in its library set and sees
    // no generated cell after restore; the generated arm had it and sees all twenty.
    await stageOk(b, flow, 'verify', [D, 'ARM=foundry']);
    assert.deepEqual(
      await readReport(path.join(results, 'verify-foundry', 'liveness.json')),
      { stage: 'verify', inputs: { design, arm: 'foundry', violations: 0 }, librarySetBeforeLaunch: false, generatedCellsAfterRestore: 0, adoptedMasters: 0, violations: 0 },
    );
    await stageOk(b, flow, 'verify', [D, 'ARM=generated']);
    assert.deepEqual(
      await readReport(path.join(results, 'verify-generated', 'liveness.json')),
      { stage: 'verify', inputs: { design, arm: 'generated', violations: 0 }, librarySetBeforeLaunch: true, generatedCellsAfterRestore: 20, adoptedMasters: 5, violations: 0 },
    );
    // Both arms' DRC reports go through the reader that reads one. No shipped rule speaks for a
    // violation count, so what the session found is read from the very line the reader counts from.
    for (const arm of ['foundry', 'generated']) {
      await observed(b, path.join(results, `verify-${arm}`, 'verify_drc.rpt'), 'innovus-verify-drc');
      const drc = await readFile(path.join(results, `verify-${arm}`, 'verify_drc.rpt'), 'utf8');
      assert.match(drc, /^\s*Total Violations : 0 Viols\.$/m, `the ${arm} session found none: ${drc}`);
      assert.match(drc, /^#\s+Command:\s+verify_drc -limit 1000000 -check_only cell /m, `and checked cell geometry with a raised limit: ${drc}`);
      assert.match(drc, new RegExp(`^#\\s+Inputs:\\s+arm=${arm} librarySet=(true|false) generatedCells=\\d+ violations=0$`, 'm'), `and the report says what it was asked for: ${drc}`);
    }

    // Actual Permit decisions precede every fixture process; DBOS execution is tested elsewhere.
    assert.deepEqual([...new Set(b.launches.map(item => item.wrapper))], ['make']);
    assert.deepEqual([...new Set(b.launches.map(item => item.workspace))], [realpathSync(b.h.workspace)]);

    // And the flow the Site binds — the one a Campaign copies and never builds in — is byte for byte
    // what it was before any of this ran.
    assert.deepEqual(await listing(flowRoot), before, 'the bound flow root is untouched: every stage built in the copy');
  } finally {
    await dispose();
  }
});

test('the profile a mining stage is asked for decides adoption and the two arms: zero adoption with the library still live, adoption that moves too little, and adoption that meets the five-percent Goal', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    const D = `DESIGN=${design}`;
    /** What each profile yields at `TOP_N=20` over route `r1` — its base yield and the 1 that route's
     *  own name adds, capped at 20 for `broad` — and what that yield buys. */
    const expected = {
      narrow: { cells: 4, masters: 0, instances: 0, critical: 2.2, violations: 0 },
      steady: { cells: 13, masters: 3, instances: 27, critical: 2.101, violations: 3 },
      broad: { cells: 20, masters: 5, instances: 45, critical: 2.035, violations: 0 },
    };
    const improvements: number[] = [];

    for (const [profile, want] of Object.entries(expected)) {
      const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, profile, 'flow'));
      const results = path.join(flow, 'results', design);
      await stageOk(b, flow, 'mine', [D, 'ROUTE=r1', `PROFILE=${profile}`, 'TOP_N=20', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
      const candidates = await readReport(path.join(results, 'mine-r1', 'candidates.json'));
      assert.equal(candidates.count, want.cells, `${profile} yields what it declares: ${JSON.stringify(candidates)}`);
      await stageOk(b, flow, 'netlist', [D]);
      await stageOk(b, flow, 'abstract', [D]);
      await stageOk(b, flow, 'charlib', [D, `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
      await stageOk(b, flow, 'lc', [D]);
      await stageOk(b, flow, 'synth-custom', [D, `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
      const adoption = await readReport(path.join(results, 'syn-custom', 'adoption.json'));
      assert.equal(adoption.distinctMasters, want.masters, `${profile}: ${JSON.stringify(adoption)}`);
      assert.equal(adoption.adoptedInstances, want.instances, `${profile}: ${JSON.stringify(adoption)}`);

      await stageOk(b, flow, 'pnr', [D, 'ARM=foundry', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
      await stageOk(b, flow, 'pnr', [D, 'ARM=generated', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
      const foundry = await readReport(path.join(results, 'pnr-foundry', 'postroute.json'));
      const generated = await readReport(path.join(results, 'pnr-generated', 'postroute.json'));
      assert.equal(foundry.criticalPathNs, ACHIEVABLE_NS, `the foundry arm is the same flow every time: ${JSON.stringify(foundry)}`);
      assert.equal(generated.criticalPathNs, want.critical, `${profile}: ${JSON.stringify(generated)}`);
      // Measured on the two numbers just read, so what this asserts about the Goal is what the two
      // arms reported and not what the test expected them to report.
      improvements.push(Number((foundry.criticalPathNs! / generated.criticalPathNs! - 1).toFixed(4)));

      await stageOk(b, flow, 'verify', [D, 'ARM=generated', `VERIFY_VIOLATIONS=${String(want.violations)}`]);
      const live = await readReport(path.join(results, 'verify-generated', 'liveness.json'));
      // The half of the zero-adoption terminal that makes it a result rather than a mistake: the
      // mapper saw every cell of the library and took none of them.
      assert.equal(live.generatedCellsAfterRestore, want.cells, `${profile}: the library was live after restore: ${JSON.stringify(live)}`);
      assert.equal(live.adoptedMasters, want.masters, `${profile}: ${JSON.stringify(live)}`);
      assert.equal(live.violations, want.violations, `${profile}: ${JSON.stringify(live)}`);
      assert.deepEqual(live.inputs, { design, arm: 'generated', violations: want.violations }, `${profile}: the session says what it was asked for: ${JSON.stringify(live.inputs)}`);
      await observed(b, path.join(results, 'verify-generated', 'verify_drc.rpt'), 'innovus-verify-drc');
      const drc = await readFile(path.join(results, 'verify-generated', 'verify_drc.rpt'), 'utf8');
      assert.match(drc, new RegExp(`^\\s*Total Violations : ${String(want.violations)} Viols\\.$`, 'm'), `${profile}: the session reported what it was told to find: ${drc}`);
      assert.match(drc, new RegExp(`violations=${String(want.violations)}$`, 'm'), `${profile}: and the DRC report's header carries the count it was asked for: ${drc}`);
    }

    assert.deepEqual(improvements, [0, 0.0471, 0.0811], `the three profiles' measured improvements: ${JSON.stringify(improvements)}`);
    assert.deepEqual(
      improvements.map((i) => i >= FIVE_PERCENT),
      [false, false, true],
      'a narrow library adopts nothing and moves nothing, a middling one adopts and still misses, and only the broad one meets the Goal',
    );
  } finally {
    await dispose();
  }
});

test('the candidate count follows the route as well as the profile, deterministically, so two routes mined under one profile are not one set counted twice', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'routes', 'flow'));
    const results = path.join(flow, 'results', design);
    const D = `DESIGN=${design}`;
    /** `TOP_N` high enough not to cap, so what is being read is the yield itself. */
    const counts: Record<string, number> = {};

    for (const route of ['r1', 'r2']) {
      await stageOk(b, flow, 'mine', [D, `ROUTE=${route}`, 'PROFILE=broad', 'TOP_N=30', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
      const candidates = await readReport(path.join(results, `mine-${route}`, 'candidates.json'));
      assert.equal(candidates.inputs['route'], route, `the report says which route it mined: ${JSON.stringify(candidates.inputs)}`);
      assert.ok(candidates.routeFactor !== undefined, `and what that route added to the profile's yield: ${JSON.stringify(candidates)}`);
      assert.ok(candidates.routeFactor >= 0 && candidates.routeFactor < 3, `a bounded factor: ${JSON.stringify(candidates)}`);
      assert.equal(candidates.count, 20 + candidates.routeFactor, `the broad profile's twenty, and the route's own factor: ${JSON.stringify(candidates)}`);
      assert.equal(candidates.cells?.length, candidates.count, `and one cell named for the route per candidate: ${JSON.stringify(candidates)}`);
      counts[route] = candidates.count;
    }
    assert.notEqual(counts['r1'], counts['r2'], `two routes under one profile and one TOP_N are different sets: ${JSON.stringify(counts)}`);

    // Deterministic: the same route mined again yields the same set, which is what lets a pack's
    // Strategy be driven here and read the same numbers twice.
    await stageOk(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=30', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
    const again = await readReport(path.join(results, 'mine-r1', 'candidates.json'));
    assert.equal(again.count, counts['r1'], `mined again, r1 is what it was: ${JSON.stringify(again)}`);
  } finally {
    await dispose();
  }
});

test('a stage rerun over a smaller candidate set leaves none of the larger one behind', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'shrinking', 'flow'));
    const results = path.join(flow, 'results', design);
    const D = `DESIGN=${design}`;
    /** Every artefact of one kind a stage left in its own directory. */
    const artefacts = async (stage: string, suffix: string): Promise<string[]> =>
      (await readdir(path.join(results, stage))).filter((name) => name.endsWith(suffix)).sort();

    // A broad route first: twenty-one candidates, and one netlist and one abstract for each.
    await stageOk(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=30', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
    await stageOk(b, flow, 'netlist', [D]);
    await stageOk(b, flow, 'abstract', [D]);
    const wide = (await readReport(path.join(results, 'netlist', 'netlist.json'))).count!;
    assert.equal((await artefacts('netlist', '.sp')).length, wide, 'one transistor netlist per candidate');
    assert.equal((await artefacts('abstract', '.lef')).length, wide, 'and one abstract per netlist');
    assert.ok(existsSync(path.join(results, 'netlist', `r1_c${String(wide)}.sp`)), 'including the last of them');

    // Then the same route mined narrow, which reserves far fewer. Every stage owns its own artefacts
    // and clears them, so what is left is this pass's set and not this pass's over the last one's:
    // a `.sp` file for a candidate nobody mined would be read by the next stage as a candidate.
    await stageOk(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=narrow', 'TOP_N=30', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
    await stageOk(b, flow, 'netlist', [D]);
    await stageOk(b, flow, 'abstract', [D]);
    const narrow = (await readReport(path.join(results, 'netlist', 'netlist.json'))).count!;
    assert.ok(narrow < wide, `narrow mines fewer than broad: ${String(narrow)} of ${String(wide)}`);
    assert.equal((await artefacts('netlist', '.sp')).length, narrow, `only this pass's netlists are left: ${JSON.stringify(await artefacts('netlist', '.sp'))}`);
    assert.equal((await artefacts('abstract', '.lef')).length, narrow, `and only this pass's abstracts: ${JSON.stringify(await artefacts('abstract', '.lef'))}`);
    assert.equal(existsSync(path.join(results, 'netlist', `r1_c${String(wide)}.sp`)), false, 'the last of the larger set is gone');
    assert.equal(existsSync(path.join(results, 'abstract', `r1_c${String(wide)}.lef`)), false, 'and so is its abstract');

    // And the library characterised from them holds this pass's cells and no more.
    await stageOk(b, flow, 'charlib', [D, `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
    const liberty = await readFile(path.join(results, 'charlib', 'generated.lib'), 'utf8');
    assert.equal((liberty.match(/^ {2}cell \(/gm) ?? []).length, narrow, `one cell group per candidate: ${liberty}`);
  } finally {
    await dispose();
  }
});

test('the stand-in refuses a route, an arm, a count or a switch it cannot safely use, and refuses it before it makes a directory for it', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    // The bound flow root is outside the workspace, and it is what a `..` climb out of a stage's
    // output path reaches first. Nothing below may touch it.
    const outside = await listing(flowRoot);
    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'refused', 'flow'));
    const results = path.join(flow, 'results', design);
    const D = `DESIGN=${design}`;

    // A route or an arm with path components in it would put a stage's output somewhere the Permit
    // never resolved. Both are refused, and the refusal is what happens first: no directory is made
    // for a value the stage will not use.
    await stageRefused(b, flow, 'mine', [D, 'ROUTE=../../escape', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] mine: ROUTE must be a slug/);
    await stageRefused(b, flow, 'mine', [D, 'ROUTE=R1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] mine: ROUTE must be a slug/);
    await stageRefused(b, flow, 'mine', [D, 'ROUTE=-r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] mine: ROUTE must be a slug/);
    await stageRefused(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=../../x', 'TOP_N=10'], /\[stand-in\] mine: unknown PROFILE/);
    await stageRefused(b, flow, 'pnr', [D, 'ARM=../x', `CLOCK_PERIOD_NS=${PERIOD_NS}`], /\[stand-in\] pnr: unknown ARM/);
    await stageRefused(b, flow, 'verify', [D, 'ARM=../x'], /\[stand-in\] verify: unknown ARM/);

    // A malformed count or switch is refused in words too, rather than becoming a zero that reads as
    // clean evidence: a gate ruling on a violation count that silently became zero is a gate that
    // passed on nothing.
    await stageRefused(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=-1'], /\[stand-in\] mine: TOP_N must be a whole number/);
    await stageRefused(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=ten'], /\[stand-in\] mine: TOP_N must be a whole number/);
    await stageRefused(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=1.5'], /\[stand-in\] mine: TOP_N must be a whole number/);
    await stageRefused(b, flow, 'verify', [D, 'ARM=foundry', 'VERIFY_VIOLATIONS=lots'], /\[stand-in\] verify: VERIFY_VIOLATIONS must be a whole number/);
    await stageRefused(b, flow, 'verify', [D, 'ARM=foundry', 'VERIFY_VIOLATIONS=-3'], /\[stand-in\] verify: VERIFY_VIOLATIONS must be a whole number/);
    await stageRefused(b, flow, 'lc', [D, 'LC_FAIL=2'], /\[stand-in\] lc: LC_FAIL must be 0 or 1/);
    await stageRefused(b, flow, 'lc', [D, 'LC_FAIL=yes'], /\[stand-in\] lc: LC_FAIL must be 0 or 1/);

    // Nothing was made for any of them, here or anywhere a `..` could have climbed to.
    assert.equal(existsSync(results), false, `no stage made an output directory for a value it refused: ${results}`);
    assert.deepEqual(await listing(flowRoot), outside, 'and the tree outside the workspace is exactly what it was');
  } finally {
    await dispose();
  }
});

test('a value make itself would have expanded, a project root of someone else\'s choosing and a design with a path in it are all refused, and nothing outside the workspace is written', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    // What "outside the workspace" means here: the bound flow root, which a Campaign reads and
    // nothing writes, and which is what a `..` climb or a redirected project root reaches first.
    const outside = await listing(flowRoot);
    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'contained', 'flow'));
    const results = path.join(flow, 'results', design);
    const D = `DESIGN=${design}`;
    /** A file outside the workspace that no stage may create: one per value, named for it. */
    const canary = (name: string): string => path.join(flowRoot, `canary-${name}`);
    const elsewhere = path.join(flowRoot, 'elsewhere');

    // Where this flow builds is the makefile's own location, and a caller may not move it: a stage
    // whose project root were someone else's would make and remove files in a tree the Permit
    // resolved no write in at all.
    await stageRefused(b, flow, 'mine', [D, `PROJECT_ROOT=${elsewhere}`, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] PROJECT_ROOT/);
    // And the design names a directory under that root, so it is held to a slug before any of the
    // paths built from it exist.
    await stageRefused(b, flow, 'mine', ['DESIGN=../x', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] DESIGN must be made of/);
    await stageRefused(b, flow, 'netlist', ['DESIGN=../x'], /\[stand-in\] DESIGN must be made of/);

    // A value make itself would have expanded. Make expands a command-line value the moment it
    // references the variable — before any recipe has run — so a `$(shell …)` in one ran its
    // command before the shell below could look at it at all. These eleven are handed to `make`
    // directly as argv so whitespace and make expressions reach the generated makefile unchanged.
    // Each canary is outside the workspace.
    const expanded: readonly (readonly [string, string, readonly string[]])[] = [
      ['route', 'mine', [D, `ROUTE=$(shell touch ${canary('route')})`, 'PROFILE=broad', 'TOP_N=10']],
      ['profile', 'mine', [D, 'ROUTE=r1', `PROFILE=$(shell touch ${canary('profile')})`, 'TOP_N=10']],
      ['count', 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', `TOP_N=$(shell touch ${canary('count')})`]],
      ['arm', 'verify', [D, `ARM=$(shell touch ${canary('arm')})`]],
      ['violations', 'verify', [D, 'ARM=foundry', `VERIFY_VIOLATIONS=$(shell touch ${canary('violations')})`]],
      ['design', 'mine', [`DESIGN=$(shell touch ${canary('design')})`, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10']],
      ['root', 'mine', [D, `PROJECT_ROOT=$(shell touch ${canary('root')})`, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10']],
      ['period', 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10', `CLOCK_PERIOD_NS=$(shell touch ${canary('period')})`]],
      // And the three the makefile's own boundary is made of, which a caller must not be able to
      // reach: the helper that holds every other value, a name this flow has never heard of, and a
      // variable this flow exports into a recipe's environment rather than writing into its text.
      ['helper', 'mine', [D, `standin-hold=$(shell touch ${canary('helper')})`, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10']],
      ['unknown', 'mine', [D, `NOT_A_VARIABLE_OF_THIS_FLOW=$(shell touch ${canary('unknown')})`, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10']],
      ['container', 'mine', [D, `EDA_CONTAINER_NAME=$(shell touch ${canary('container')})`, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10']],
    ];
    const said = new Map<string, string>();
    for (const [name, target, vars] of expanded) {
      const ran = spawnSync('make', ['-C', flow, target, ...vars], { encoding: 'utf8', timeout: stageTimeoutMs });
      said.set(name, `${ran.stdout}${ran.stderr}(exit ${String(ran.status)})`);
      assert.notEqual(ran.status, 0, `${target} with an expanding ${name} was expected to be refused: ${said.get(name)!}`);
    }

    // Nothing make was handed ran. Each canary is the command it would have run for that value.
    for (const [name] of expanded) {
      assert.equal(existsSync(canary(name)), false, `nothing was run for the ${name} make would have expanded: ${said.get(name)!}`);
    }
    assert.equal(existsSync(elsewhere), false, `and no stage built anywhere but under the flow it was run from: ${elsewhere}`);
    assert.equal(existsSync(results), false, `nor made an output directory for a value it refused: ${results}`);
    assert.deepEqual(await listing(flowRoot), outside, 'and the tree outside the workspace is exactly what it was');

    // And each refusal says which value it would not have, in words a person can act on. Ruled on
    // together rather than one assertion after another, so a run in which one of the eleven said
    // the wrong thing says which one and not merely that the first of them did.
    const words: Readonly<Record<string, RegExp>> = {
      route: /\[stand-in\] mine: ROUTE must be a slug/,
      profile: /\[stand-in\] mine: unknown PROFILE/,
      count: /\[stand-in\] mine: TOP_N must be a whole number/,
      arm: /\[stand-in\] verify: unknown ARM/,
      violations: /\[stand-in\] verify: VERIFY_VIOLATIONS must be a whole number/,
      design: /\[stand-in\] DESIGN must be made of/,
      root: /\[stand-in\] PROJECT_ROOT/,
      period: /\[stand-in\] CLOCK_PERIOD_NS must be a number/,
      helper: /\[stand-in\] this flow takes only the variables it declares/,
      unknown: /\[stand-in\] this flow takes only the variables it declares/,
      container: /\[stand-in\] EDA_CONTAINER_NAME must be made of/,
    };
    const matched = 'said which value it would not have';
    assert.deepEqual(
      Object.fromEntries(Object.entries(words).map(([name, rx]) => [name, rx.test(said.get(name)!) ? matched : `said instead: ${said.get(name)!}`])),
      Object.fromEntries(Object.keys(words).map((name) => [name, matched])),
      'every refusal names the value it would not have',
    );
  } finally {
    await dispose();
  }
});

test('the makefile takes the variables it declares and no others, holds each to the shape its kind may have, and keeps its own out of a caller\'s reach', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    // The tree a redirected stage would build in: outside the workspace, beside the bound flow root.
    const outsideRoot = path.join(b.h.home, 'outside-t60');
    await mkdir(outsideRoot, { recursive: true });
    const outside = await listing(flowRoot);
    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'declared', 'flow'));
    const results = path.join(flow, 'results', design);
    const D = `DESIGN=${design}`;

    // Every case uses the production Permit decision before its bounded make fixture. Three kinds are under
    // test at once: a variable this flow keeps for itself (the helper that holds every other value,
    // a path this flow derives, and — the boundary's own two names, which a command line cannot win
    // but must still be told it may not have), a name this flow has never declared, and a value
    // whose shape its kind may not have — a switch that is not 0 or 1, a whole number spelled `--`
    // or `01`, a decimal spelled `1-2`, `1..2`, `1...2`, `.5` or `5.`, a slug beginning with a dash,
    // a container name with a path in it.
    const refusals: readonly (readonly [string, readonly string[], RegExp])[] = [
      ['the helper that holds every value', [D, 'standin-hold=', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] this flow takes only the variables it declares/],
      ['a path this flow derives', [D, `RESULTS_DIR=${path.join(outsideRoot, 'redirected')}`, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] RESULTS_DIR is this flow's own/],
      ['the shell a recipe runs in', [D, 'SHELL=/bin/echo', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] SHELL is this flow's own/],
      // The boundary's own two names: a command line cannot make either win (both are `override`),
      // but a fix that only stopped it winning would still let the attempt through unrefused.
      ['the boundary\'s own list of what a caller may set', [D, 'standin-caller-variables=EVIL', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] this flow takes only the variables it declares/],
      ['the boundary\'s own list of what a caller may not touch', [D, 'standin-own-variables=EVIL', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] this flow takes only the variables it declares/],
      ['a name it never declared', [D, 'NOT_A_VARIABLE_OF_THIS_FLOW=1', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] this flow takes only the variables it declares/],
      ['a container name with a path in it', [D, 'EDA_CONTAINER_NAME=../x', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] EDA_CONTAINER_NAME must be made of/],
      ['an effort with a path in it', [D, 'DC_COMPILE_EFFORT=../x', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] DC_COMPILE_EFFORT must be made of/],
      ['a switch that is neither 0 nor 1', [D, 'FORCE_SYNTH=2', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] FORCE_SYNTH must be 0 or 1/],
      ['a whole number spelled with two minus signs', [D, 'ROUTE_SPREAD=--', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] ROUTE_SPREAD must be a whole number/],
      ['a duration with a leading zero', [D, 'STANDIN_SLEEP=01', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] STANDIN_SLEEP must be a number/],
      ['a negative duration', [D, 'STANDIN_SLEEP=-0.01', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] STANDIN_SLEEP must be zero or more/],
      ['a whole number with a leading zero', [D, 'ROUTE_SPREAD=01', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] ROUTE_SPREAD must be a whole number/],
      ['a decimal with a minus sign inside it', [D, 'CLOCK_PERIOD_NS=1-2', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] CLOCK_PERIOD_NS must be a number/],
      // The dot grammar's own adjacent-separator gap: `$(subst)` turns each dot into a space, and
      // make's word-splitting collapses a run of them into one, so `1..2` and `1...2` used to count
      // the same two words `1.2` does.
      ['a decimal with two dots in a row', [D, 'CLOCK_PERIOD_NS=1..2', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] CLOCK_PERIOD_NS must be a number/],
      ['a decimal with three dots in a row', [D, 'CLOCK_PERIOD_NS=1...2', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] CLOCK_PERIOD_NS must be a number/],
      ['a decimal with nothing before its dot', [D, 'CLOCK_PERIOD_NS=.5', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] CLOCK_PERIOD_NS must be a number/],
      ['a decimal with nothing after its dot', [D, 'CLOCK_PERIOD_NS=5.', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] CLOCK_PERIOD_NS must be a number/],
      ['a slug beginning with a dash', ['DESIGN=-x', 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=10'], /\[stand-in\] DESIGN must be made of/],
    ];
    // Collected and ruled on together, so a run that let one of them through says which one and
    // not merely that the first of seventeen failed.
    const said: Record<string, string> = {};
    const refused = 'refused, and said which value it would not have';
    for (const [what, vars, words] of refusals) {
      const run = await runStage(b, flow, 'mine', vars);
      const text = await run.log;
      said[what] = run.exitCode === 0 ? `ran anyway, exit 0: ${text}` : words.test(text) ? refused : `refused, but said: ${text}`;
    }
    assert.deepEqual(said, Object.fromEntries(refusals.map(([what]) => [what, refused])), 'every one of them is refused in words a person can act on');

    // And none of them built anything, here or where one of them named.
    assert.equal(existsSync(results), false, `no stage made an output directory for a value it refused: ${results}`);
    assert.deepEqual(await listing(outsideRoot), {}, 'nor anything in the tree one of them tried to build in');
    assert.deepEqual(await listing(flowRoot), outside, 'and the tree outside the workspace is exactly what it was');
  } finally {
    await dispose();
  }
});

test('what a stage removes is resolved on disk before it is removed: a symlinked output directory and a design that climbs out of the project root are both refused', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    // Two trees outside the project root, each holding one artefact of the kind a stage removes.
    // `netlist` clears the `.sp` files in the directory it owns; neither of these is that directory.
    const outsideRoot = path.join(b.h.home, 'outside-t60');
    const pointedAt = path.join(outsideRoot, 'pointed-at');
    await mkdir(pointedAt, { recursive: true });
    await writeFile(path.join(pointedAt, 'victim.sp'), '* not this stage\'s to remove\n');
    const climbedTo = path.join(outsideRoot, 'climbed-to');
    await mkdir(path.join(climbedTo, 'mine-r1'), { recursive: true });
    await writeFile(path.join(climbedTo, 'mine-r1', 'cells.txt'), 'r1_c1\n');
    await mkdir(path.join(climbedTo, 'netlist'), { recursive: true });
    await writeFile(path.join(climbedTo, 'netlist', 'victim.sp'), '* nor this\n');
    const untouched = await listing(outsideRoot);
    const outside = await listing(flowRoot);

    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'physical', 'flow'));
    const D = `DESIGN=${design}`;

    // A route is mined so `netlist` has something to merge, and then the directory `netlist` owns
    // and clears is replaced by a symlink to a tree outside the project root. Every path the stage
    // composes is still under the root, character for character; where the `rm` lands is not.
    await stageOk(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=2', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
    symlinkSync(pointedAt, path.join(flow, 'results', design, 'netlist'));
    const redirected = await runStage(b, flow, 'netlist', [D]);
    const saidOfTheLink = await redirected.log;
    assert.notEqual(redirected.exitCode, 0, `netlist through a symlinked output directory was expected to be refused: ${saidOfTheLink}`);
    assert.match(saidOfTheLink, /\[stand-in\] netlist: refusing to remove anything through a symlink/, saidOfTheLink);

    // And the other way out: `..` components in the design every path is derived from. The helper
    // that holds the design to a slug is what stands between a caller and that, so this asks for
    // both at once — the helper switched off and a design that climbs — and neither is a caller's.
    // What actually stops this one is the boundary above refusing `standin-hold=` as an undeclared
    // name — DESIGN's own value is never even looked at — so this case does not reach the removal
    // guard's own `..` branch, and a regression in that branch alone would not turn this red. The
    // next test gives that branch a path of its own.
    const climbing = path.relative(path.join(flow, 'results'), climbedTo);
    const climbed = await runStage(b, flow, 'netlist', [`DESIGN=${climbing}`, 'standin-hold=']);
    const saidOfTheClimb = await climbed.log;
    assert.notEqual(climbed.exitCode, 0, `netlist with a design climbing to ${climbedTo} was expected to be refused: ${saidOfTheClimb}`);
    assert.match(saidOfTheClimb, /\[stand-in\] this flow takes only the variables it declares/, saidOfTheClimb);

    assert.deepEqual(await listing(outsideRoot), untouched, 'and both trees outside the project root are exactly what they were');
    assert.deepEqual(await listing(flowRoot), outside, 'as is the bound flow root');
  } finally {
    await dispose();
  }
});

test('the removal guard\'s own ".." refusal fires in its own words when it is what a target actually reaches, rather than being inferred from a case no declared variable can produce', async () => {
  // Every declared variable is held to a grammar that admits no "/" at all (DESIGN and RESULT_TAG
  // to a name, ROUTE and ARM to a slug), and the boundary above refuses a command line that names
  // the helper those grammars are built from before any value is looked at — so nothing the launch
  // face can type ever puts a ".." into a removal target, and the committed climb case above is
  // refused two layers before it could reach `mustBeInside`'s own ".." branch. That branch is
  // defence in depth, and this calls the shell this module actually ships (`mustBeInside`,
  // exported for exactly this), directly, with a target no declared surface could produce, so a
  // regression in the branch itself — and not only in what stops the climb case above — is red
  // here. This is a direct unit call on the guard's own shell; the cases above exercise the
  // generated flow's declared surface.
  const h = await createEmptyHome();
  try {
    const root = path.join(h.home, 'guard-root');
    await mkdir(path.join(root, 'sub'), { recursive: true });
    const outside = path.join(h.home, 'guard-outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'victim'), 'not the guard\'s to remove\n');
    // Inside the root character for character, until the kernel walks the ".." back out of it —
    // the shape a redirected removal would have to carry, and the one no declared variable can.
    const target = `${root}/sub/../../${path.basename(outside)}`;

    const flow = path.join(h.home, 'guard-flow');
    await mkdir(flow, { recursive: true });
    const guard = mustBeInside('check', '$$out').join(' ');
    await writeFile(path.join(flow, 'Makefile'), [
      'SHELL := /bin/sh',
      `PROJECT_ROOT := ${root}`,
      '.PHONY: check',
      'check:',
      `\t@out="$(TARGET)"; ${guard} rm -rf "$$out"; echo removed`,
      '',
    ].join('\n'));

    const ran = spawnSync('make', ['-C', flow, 'check', `TARGET=${target}`], { encoding: 'utf8', timeout: stageTimeoutMs });
    const said = `${ran.stdout}${ran.stderr}`;
    assert.notEqual(ran.status, 0, `a target reaching the guard through a ".." component was expected to be refused: ${said}`);
    // The physical resolution steps beside this branch would refuse the same target too, but with
    // their own generic wording — so asserting this exact message, and not merely a non-zero exit,
    // is what a removed ".." branch cannot satisfy even though the target is still refused overall.
    assert.match(said, /\[stand-in\] check: refusing to remove anything through a "\.\." path/, `and refused in the guard's own words: ${said}`);
    assert.ok(existsSync(path.join(outside, 'victim')), 'and the file outside was never touched');
  } finally {
    await h.dispose();
  }
});

test('a recipe-held count spelled with a leading zero is refused, the same canonical-integer grammar the parse-time table holds', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'canonical', 'flow'));
    const results = path.join(flow, 'results', design);
    const D = `DESIGN=${design}`;

    // `01` is a whole number, but not the one canonical-integer grammar spells it in — `0`, or a
    // digit that is not `0` and more digits — and TOP_N and VERIFY_VIOLATIONS are recipe-held rather
    // than parse-time-held for a reason fix pass 1 ruled on: each is refused in its own stage's
    // words, naming the stage, before that stage makes anything. A `01` used to be silently
    // rewritten to the `1` it meant, so a report could never carry an unreadable number; now it is
    // refused instead, exactly as `STANDIN_SLEEP=01` already was at parse time, because this flow
    // does not rewrite a caller's answer, only refuse the one it will not use.
    await stageRefused(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=01', `CLOCK_PERIOD_NS=${PERIOD_NS}`], /\[stand-in\] mine: TOP_N must be a whole number, zero or more, spelled without a leading zero/);
    assert.equal(existsSync(results), false, `nor made an output directory for a value it refused: ${results}`);
    await stageRefused(b, flow, 'verify', [D, 'ARM=foundry', 'VERIFY_VIOLATIONS=01'], /\[stand-in\] verify: VERIFY_VIOLATIONS must be a whole number, zero or more, spelled without a leading zero/);
  } finally {
    await dispose();
  }
});

test('the library gate fails on request even with an empty candidate set: a positive error count, no database, and the flow stopped', async (t) => {
  const { b, flowRoot, design, dispose } = await bench(t);
  try {
    const flow = await copyOfTheFlow(flowRoot, path.join(b.h.workspace, 'empty', 'flow'));
    const results = path.join(flow, 'results', design);
    const D = `DESIGN=${design}`;

    // `TOP_N=0` reserves none of the route's candidates, so every stage after it carries an empty
    // set: no netlist, no abstract, a Liberty with no cell group in it.
    await stageOk(b, flow, 'mine', [D, 'ROUTE=r1', 'PROFILE=broad', 'TOP_N=0', `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
    const candidates = await readReport(path.join(results, 'mine-r1', 'candidates.json'));
    assert.equal(candidates.count, 0, `nothing was reserved: ${JSON.stringify(candidates)}`);
    assert.deepEqual(candidates.cells, [], JSON.stringify(candidates));
    await stageOk(b, flow, 'netlist', [D]);
    await stageOk(b, flow, 'abstract', [D]);
    await stageOk(b, flow, 'charlib', [D, `CLOCK_PERIOD_NS=${PERIOD_NS}`]);
    const charlib = await readReport(path.join(results, 'charlib', 'charlib.json'));
    assert.equal(charlib.count, 0, `and the library has no cell group in it: ${JSON.stringify(charlib)}`);

    // The gate is told to fail, and what decides that is the request and not how many cells there
    // were to compile: an error count counted off an empty set would have been zero, which reads as
    // a library that compiled cleanly, and a database would have been written on the strength of it.
    const failed = await runStage(b, flow, 'lc', [D, 'LC_FAIL=1']);
    const said = await failed.log;
    assert.equal(failed.exitCode, 2, `the gate stopped the flow: ${said}`);
    assert.match(said, /\[lc\] Error 4/, `and the gate is what stopped it: ${said}`);
    const report = await readFile(path.join(results, 'lc', 'lc.rpt'), 'utf8');
    assert.match(report, /^\s*Cells Compiled:\s+0$/m, report);
    assert.match(report, /^\s*Errors:\s+[1-9][0-9]*$/m, `a failing compile records errors it found: ${report}`);
    assert.match(report, /^\s*Database Written:\s+no$/m, report);
    assert.equal(existsSync(path.join(results, 'lc', 'generated.db')), false, 'and there is no database');

    // The same empty set, not told to fail, compiles to a database: it is the request that decides.
    await stageOk(b, flow, 'lc', [D]);
    assert.ok(existsSync(path.join(results, 'lc', 'generated.db')), 'the gate passed leaves one');
  } finally {
    await dispose();
  }
});

test('seeding a home for the local Site says which stages the stand-in answers, and the flow it generates declares every one of them', async () => {
  const h = await createEmptyHome();
  try {
    const seeded = await seedLocalSite({ home: h.home, checkout: repoRoot });
    const said = seeded.did.join('\n');
    for (const stage of standinStages) {
      assert.ok(said.includes(stage), `the seeding names the ${stage} stage: ${said}`);
    }
    const makefile = await readFile(path.join(seeded.flow.root, 'Makefile'), 'utf8');
    const phony = /^\.PHONY:(.*)$/m.exec(makefile);
    assert.ok(phony, `the generated flow declares its targets: ${makefile.slice(0, 400)}`);
    assert.deepEqual(phony[1]!.trim().split(/\s+/), [...standinStages], 'and the ones it declares are the ones the module names');
  } finally {
    await h.dispose();
  }
});
