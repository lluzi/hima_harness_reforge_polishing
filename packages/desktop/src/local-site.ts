// The local Site and the stand-in flow: what `pnpm run desktop --site local` seeds into a home so a
// developer runs generations that take seconds, and what the contract suite writes into every
// isolated home that runs a Job.
//
// One module, two callers, for the reason `hima-home.ts` gives: until this file existed the only
// recipe for a Site that can host the shipped pack was the test support's, and a developer who
// wanted the window against the stand-in had to read test code and copy it. The suite's
// `writeStandinFlow` and `writeLocalSite` are now views over the two writers here, so the flow a
// developer works against is the flow the suite proves things on.
//
// What makes the stand-in a stand-in rather than a mock is that the pack cannot tell: it is a
// directory holding the same pieces the run contract copies, driven by a makefile with the same
// `synth` target and the same command-line variables, producing a report at the same path inside
// the workspace. Its `synth` sleeps (so a Job is demonstrably still running while someone looks at
// it), can be told to fail its first N attempts (so a Retry allowance has something real to retry),
// and writes a qor report into the results path the contract names.
//
// The report is computed from the period it was asked for, which is what makes a Loop on this flow
// behave the way a Loop on Design Compiler does: the flow has one number of its own, the period it
// can actually close at (`achievableNs`), and every generation's setup slack is
// `min(0, period − achievable)`.
//
// The `min(0, …)` is the whole of it, and it is there because of what D45 cost. Design Compiler
// stops optimizing the moment the constraint it was given is met, so it reports a setup slack of
// exactly `0.00` for *every* period at or above the one the design can close at: a met period says
// nothing whatever about the margin behind it. Only a violated period states a number, and what it
// states is the shortfall. This flow used to report `period − achievable` unconditionally —
// continuous and positive above the achievable period — and that one difference was enough to hide
// a divergence: a chooser that reads the margin of a met period walked in and converged here while
// the same chooser on the reference site loosened by its guard band every generation and converged
// on nothing (D45, `docs/validation/2026-09-10-step3-acceptance-attempt1-failed.md`). A stand-in
// that is kinder than the tool it stands in for is a stand-in that proves nothing, so it reports
// `0.00` at and above the achievable period and the shortfall below it, and a pack whose push rule
// cannot live with that finds out here rather than on a Site.
//
// `RESULT_TAG` is the one knob the real flow does not have, and it exists for exactly one thing: two
// syntheses of one Campaign running at the same moment (#29). Unset — which is every generation of
// the shipped pack — the flow writes `results/<design>/syn/report/qor.rpt` and counts its failures in
// `build/<design>/fail-remaining`, exactly as it always did. Set, it writes
// `results/<design>/syn/report-<tag>/qor.rpt` and counts in `build/<design>/fail-remaining-<tag>`, so
// a pack whose fork runs a second tool with `RESULT_TAG=b` gets a report of its own to read and a
// failure counter of its own to spend, and neither branch reads or exhausts the other's. It is a
// stand-in's affordance and not a claim about Design Compiler: a real flow's second branch would
// write somewhere else by binding its own results directory.
//
// Nothing in here imports a sibling module. The contract suite loads this file as TypeScript through
// Node's type stripping, which resolves specifiers literally — a `./hima-home.js` import would be a
// file that does not exist in `src/` — so what this module needs, it takes as arguments.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The one local Site's name: what a site file, a `--site` flag and a route body call it. */
export const LOCAL_SITE_NAME = 'local';

/** The design the stand-in flow builds, spelled as the reference flow's manifests spell it. */
const STANDIN_DESIGN = 'opene902';

/** The pack the local Site is seeded for: the one this repository ships. */
const TIMING_PROBE_PACK_ID = 'opene902-timing-probe';

/** How long `synth` sleeps before it produces anything, unless a caller says otherwise. */
const STANDIN_SLEEP_SECONDS = 3;

/**
 * The clock period this flow can actually close at, in nanoseconds, unless a caller says otherwise:
 * 2.20 ns, a little tighter than the 2.27 ns the pinned opene902 report was produced at, so the
 * stand-in stands in for the same design without claiming to be its measurement.
 *
 * Every generation's setup slack is `min(0, period − this)`, as Design Compiler reports one: nothing
 * at all when the period asked for is met, and the shortfall when it is not. It is the one number
 * that decides what a Loop on this flow does: a Campaign started loose meets its goal at once, and
 * one started tight is told by how much it missed and by nothing else.
 */
const STANDIN_ACHIEVABLE_NS = 2.2;

/**
 * What every generation of the stand-in reports as its worst hold violation: none. Hold is not what
 * this flow explores — the Loop pushes the setup period, and a hold margin that moved with it would
 * be a second exploration nobody asked for — and Design Compiler prints `0.00` when no path is short
 * of hold, which the dc reader reads as a hold slack of exactly zero.
 */
const STANDIN_HOLD_VIOLATION = '0.00';

/** The licence that pack's `synth` tool holds a seat of, which this Site must therefore declare. */
const STANDIN_LICENCE = 'Design-Compiler';

export interface StandinFlowRequest {
  /** Where the flow is generated: the directory a site file binds as `flowRoot`. */
  readonly root: string;
  readonly design?: string;
  /** How many seconds `synth` sleeps before it produces anything. */
  readonly sleepSeconds?: number;
  /** How many attempts fail with exit 3 before one succeeds, for the untagged `synth`. Default 0. */
  readonly failures?: number;
  /**
   * How many attempts fail first, per `RESULT_TAG` — one counter per tagged tool, keyed by the tag.
   *
   * A tag is its own tool writing its own report (`RESULT_TAG` below), so it is its own counter too:
   * a fork of two branches that shared one would have whichever branch reached the flow first spend
   * the other's failures, and a test that aimed a failure at one branch would be a test of a race.
   */
  readonly failuresByTag?: Readonly<Record<string, number>>;
  /** The clock period this flow closes at, in ns: every generation's slack is `min(0, period − this)`. */
  readonly achievableNs?: number;
}

export interface StandinFlow {
  readonly root: string;
  readonly design: string;
  /** The clock period this flow closes at, in ns, as it was generated. */
  readonly achievableNs: number;
  /** Where the counter that makes `synth` fail lives, inside the tree the contract copies. */
  readonly failFile: string;
}

/**
 * Generate the stand-in flow at `root`. Every file is rewritten: the flow is the generator's, and a
 * Campaign never runs in it — a generation runs in the copy the workspace preparation makes.
 *
 * @param req - where, which design, what it closes at, how slow, how many failures first.
 * @returns the flow root and what is in it.
 */
export async function writeStandinFlow(req: StandinFlowRequest): Promise<StandinFlow> {
  const design = req.design ?? STANDIN_DESIGN;
  const achievableNs = req.achievableNs ?? STANDIN_ACHIEVABLE_NS;
  const root = path.resolve(req.root);
  // The pieces `contract.yml` copies. Every one of them must be there, because preparation fails
  // closed on a flow root missing a piece the contract names.
  await mkdir(path.join(root, 'flows', design), { recursive: true });
  await mkdir(path.join(root, 'manifests'), { recursive: true });
  await mkdir(path.join(root, 'build', design), { recursive: true });
  await mkdir(path.join(root, 'sources', design), { recursive: true });
  // The Design Zoo's Makefile runs `tools/make_dc_inputs.py` in its prepare target, so `tools` is one
  // of the pieces a workspace copy must carry; the stand-in ships a placeholder under the same name.
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'flows', design, 'config.mk'), `# stand-in flow config for ${design}\n`);
  await writeFile(path.join(root, 'manifests', 'designs.tsv'), `design\tstandin\n${design}\tyes\n`);
  await writeFile(path.join(root, 'build', design, 'summary.txt'), `stand-in build inputs for ${design}\n`);
  await writeFile(path.join(root, 'sources', design, `${design}.v`), `// stand-in RTL for ${design}\n`);
  await writeFile(path.join(root, 'tools', 'make_dc_inputs.py'), '#!/usr/bin/env python3\n# stand-in for the Design Zoo tool the real flow runs while preparing inputs\n');
  const failFile = path.join(root, 'build', design, 'fail-remaining');
  await writeFile(failFile, `${String(req.failures ?? 0)}\n`);
  // One counter per RESULT_TAG, beside the untagged one and named the same way the report directory
  // is: a tagged tool fails on its own account.
  for (const [tag, failures] of Object.entries(req.failuresByTag ?? {})) {
    await writeFile(path.join(root, 'build', design, `fail-remaining-${tag}`), `${String(failures)}\n`);
  }
  await writeFile(path.join(root, 'Makefile'), standinMakefile(design, achievableNs, req.sleepSeconds ?? STANDIN_SLEEP_SECONDS));
  return { root, design, achievableNs, failFile };
}

/**
 * The stand-in makefile. `PROJECT_ROOT` comes from the makefile's own location, exactly as the Design
 * Zoo's does, so a copy of this flow builds into the copy and never into the original — the property
 * the whole workspace design rests on (D19).
 *
 * `synth` computes its own report rather than copying one. Three numbers come out of `awk`, in the
 * two decimals Design Compiler prints: the setup slack, which is the shortfall against the period
 * this flow closes at and `0.00` whenever there is none, because a tool that has met its constraint
 * stops optimizing and reports no margin (D45, and the file header above); the total negative slack,
 * which is that slack when it is negative and zero when it is not; and the period itself, echoed
 * back as the report's own. `awk` because make has no arithmetic and `/bin/sh` has no decimals, and
 * because a report whose numbers were rounded differently from Design Compiler's would be a stand-in
 * the reader could tell apart.
 *
 * Recipe lines are tab-indented, as make requires, and `$$` is a literal `$` to make.
 *
 * @param design - the design the report names.
 * @param achievableNs - the clock period this flow closes at.
 * @param sleepSeconds - how long `synth` sleeps first.
 * @returns the makefile text.
 */
function standinMakefile(design: string, achievableNs: number, sleepSeconds: number): string {
  const report = qorReportLines(design, '$$slack', '$$period', '$$tns', '$$hold');
  return [
    '# Stand-in flow for the local Site. Generated; never committed.',
    '# Same target, same command-line variables, same output paths as the Design Zoo flow.',
    'SHELL := /bin/sh',
    '',
    'PROJECT_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))',
    `DESIGN ?= ${design}`,
    'CLOCK_PERIOD_NS ?= 10.0',
    'FORCE_SYNTH ?= 0',
    'DC_COMPILE_EFFORT ?= fast',
    'EDA_CONTAINER_NAME ?= none',
    `STANDIN_SLEEP ?= ${String(sleepSeconds)}`,
    '# What this flow can actually close at, and the hold violation it never has.',
    `ACHIEVABLE_NS ?= ${achievableNs.toFixed(2)}`,
    `HOLD_VIOLATION ?= ${STANDIN_HOLD_VIOLATION}`,
    '',
    '# What this generation writes under, when the tool asked for a tag of its own (see the README).',
    'RESULT_TAG ?=',
    'TAG_SUFFIX := $(if $(RESULT_TAG),-$(RESULT_TAG),)',
    '',
    'REPORT_DIR := $(PROJECT_ROOT)/results/$(DESIGN)/syn/report$(TAG_SUFFIX)',
    'LOG_DIR := $(PROJECT_ROOT)/logs/$(DESIGN)',
    'FAIL_FILE := $(PROJECT_ROOT)/build/$(DESIGN)/fail-remaining$(TAG_SUFFIX)',
    '',
    '.PHONY: synth',
    'synth:',
    '\t@mkdir -p "$(REPORT_DIR)" "$(LOG_DIR)" "$(PROJECT_ROOT)/build/$(DESIGN)"',
    '\t@echo "[stand-in] synth design=$(DESIGN) period=$(CLOCK_PERIOD_NS) tag=$(RESULT_TAG) force=$(FORCE_SYNTH) container=$(EDA_CONTAINER_NAME)" >> "$(LOG_DIR)/dc_shell.log"',
    '\t@sleep $(STANDIN_SLEEP)',
    '\t@remaining=`cat "$(FAIL_FILE)" 2>/dev/null || echo 0`; \\',
    '\t if [ "$$remaining" -gt 0 ] 2>/dev/null; then \\',
    '\t   expr "$$remaining" - 1 > "$(FAIL_FILE)"; \\',
    '\t   echo "[stand-in] failing on purpose; $$remaining attempt(s) were left to fail" >> "$(LOG_DIR)/dc_shell.log"; \\',
    // The same failure on the Job's own standard output, which is the log a blocker quotes, laid
    // out the way a tool lays a failure out: a headline, an empty pair of lines, and the line that
    // says what it means. The blank pair is deliberate — dc_shell brackets its errors the same way,
    // and whatever quotes this tail must quote it exactly as the Job wrote it, blank lines and all.
    '\t   printf \'%s\\n\' "[stand-in] Error: synthesis was told to fail this attempt" "" "" "[stand-in] $$remaining attempt(s) were left to fail; nothing was written to $(REPORT_DIR)"; \\',
    '\t   exit 3; \\',
    '\t fi; \\',
    '\t period=`awk -v p="$(CLOCK_PERIOD_NS)" \'BEGIN { printf "%.2f", p }\'`; \\',
    // `min(0, p − a)`: nothing to report when the period asked for is met, the shortfall when it is
    // not. Design Compiler's own behaviour, and the point of D45.
    '\t slack=`awk -v p="$(CLOCK_PERIOD_NS)" -v a="$(ACHIEVABLE_NS)" \'BEGIN { short = p - a; printf "%.2f", (short < 0 ? short : 0) }\'`; \\',
    '\t tns=`awk -v s="$$slack" \'BEGIN { printf "%.2f", (s < 0 ? s : 0) }\'`; \\',
    '\t hold="$(HOLD_VIOLATION)"; \\',
    '\t printf \'%s\\n\' \\',
    ...report.map((line) => `\t   "${line}" \\`),
    '\t   > "$(REPORT_DIR)/qor.rpt"; \\',
    '\t echo "[stand-in] wrote $(REPORT_DIR)/qor.rpt at period $$period with setup slack $$slack" >> "$(LOG_DIR)/dc_shell.log"',
    '',
  ].join('\n');
}

/**
 * The qor report the stand-in writes, as the `dc-qor-report` reader reads one: the `Report : qor`
 * header it keys on, one path group named as the real opene902 report names its clock group, the
 * four lines the reader folds, and the cell-area line outside any group.
 *
 * The four numbers are strings because the only caller is the makefile above, which passes the names
 * of the shell variables its recipe computes them into (`$$slack` and its kin) and gets back the
 * lines `printf` writes: make has no arithmetic, so the report's numbers are not known here and
 * cannot be. The lines are a function of their own rather than a literal in the recipe so that the
 * shape the `dc-qor-report` reader keys on is stated once, in one readable block.
 *
 * @param design - the design the report names.
 * @param slack - the critical path's setup slack.
 * @param period - the clock period the group was synthesized at.
 * @param tns - the group's total negative slack.
 * @param holdViolation - the worst hold violation, which the reader negates into the hold slack.
 * @returns the report, line by line.
 */
function qorReportLines(design: string, slack: string, period: string, tns: string, holdViolation: string): string[] {
  return [
    '****************************************',
    'Report : qor',
    `Design : ${design}`,
    'Version: stand-in',
    '****************************************',
    '',
    "  Timing Path Group 'core_clk'",
    '  -----------------------------------',
    `  Critical Path Slack:           ${slack}`,
    `  Critical Path Clk Period:      ${period}`,
    `  Total Negative Slack:          ${tns}`,
    `  Worst Hold Violation:          ${holdViolation}`,
    '  -----------------------------------',
    '',
    '  Area',
    '  -----------------------------------',
    '  Cell Area:             10475.516309',
    '',
  ];
}

export interface LocalSiteRequest {
  /** The home's `hima/sites`, where the bundle's `sitesDir` config points. */
  readonly sitesDir: string;
  /** Where Campaign workspaces are created; the Permit must allow writes under it. */
  readonly workspaceRoot: string;
  readonly allowedReadRoots?: readonly string[];
  readonly allowedWriteRoots?: readonly string[];
  readonly allowedWrappers?: readonly string[];
  /** What this Site binds for the inputs a HimaPack's run contract names. */
  readonly bindings?: Readonly<Record<string, string>>;
  /** The Site's declared job cap. One unless a caller's subject is two Jobs at once. */
  readonly parallelJobs?: number;
  /**
   * How many seats of each licence this Site declares. Left alone, it declares one
   * `Design-Compiler` seat per job slot: the shipped pack's `synth` tool holds one, so a Site
   * declaring none could host no pack at all, and one per slot leaves the licence exactly as loose
   * as the job cap — a stand-in flow holds no real seat, and this Site should not invent a scarcity
   * that is not there. A caller whose subject *is* a licence says what this Site has here.
   */
  readonly licences?: Readonly<Record<string, number>>;
}

export interface LocalSite {
  readonly name: string;
  readonly sitesDir: string;
  readonly sitePath: string;
  readonly permitPath: string;
}

/**
 * Write the local Site and its Permit: a site named `local` whose Permit allows reads under the
 * roots given, Jobs under the write roots, and the few wrappers a local Job is launched through.
 * The write roots and wrappers are what make this Site able to run a Job at all: a Permit with
 * neither refuses every launch, which is the fail-closed default the reference Permit had before
 * Jobs existed.
 *
 * `bindings` are what a HimaPack's run contract asks this Site for — the flow root, the design, the
 * workspace root. A site written without them is a Site that has bound no pack, which is what
 * `/hima pack check` must name rather than assume.
 *
 * @param req - where the site files go and what they say.
 * @returns the site's name and where its two files are.
 */
export async function writeLocalSite(req: LocalSiteRequest): Promise<LocalSite> {
  const sitesDir = path.resolve(req.sitesDir);
  await mkdir(sitesDir, { recursive: true });
  const permitPath = path.join(sitesDir, `${LOCAL_SITE_NAME}.permit.yml`);
  const sitePath = path.join(sitesDir, `${LOCAL_SITE_NAME}.yml`);
  const readRoots = req.allowedReadRoots ?? [req.workspaceRoot];
  const writeRoots = req.allowedWriteRoots ?? [req.workspaceRoot];
  // What a *Job's* command may be here, and nothing else. The channel's own verbs — the probes, the
  // job plumbing, the workspace plumbing — are never on this list: they are governed by the write
  // roots above, and a wrapper runs with whatever arguments a launch names.
  const wrappers = req.allowedWrappers ?? ['sh', 'make'];
  const list = (name: string, values: readonly string[]): string[] =>
    values.length === 0 ? [`${name}: []`] : [`${name}:`, ...values.map((v) => `  - ${v}`)];
  await writeFile(permitPath, [
    '# Permit for the local site: what the agent may do here. Edited by the site owner.',
    ...list('allowedReadRoots', readRoots),
    ...list('allowedWriteRoots', writeRoots),
    ...list('allowedWrappers', wrappers),
    'forbidden: [services, licences, network, deletions, downloads]',
    '',
  ].join('\n'));
  const bindings = Object.entries(req.bindings ?? {});
  const parallelJobs = req.parallelJobs ?? 1;
  const licences = Object.entries(req.licences ?? { [STANDIN_LICENCE]: parallelJobs });
  await writeFile(sitePath, [
    `name: ${LOCAL_SITE_NAME}`,
    'kind: local',
    `workspaceRoot: ${req.workspaceRoot}`,
    `permit: ./${LOCAL_SITE_NAME}.permit.yml`,
    ...(bindings.length === 0 ? [] : ['bindings:', ...bindings.map(([k, v]) => `  ${k}: ${v}`)]),
    'capacity:',
    '  cores: 8',
    '  memoryGiB: 16',
    `  parallelJobs: ${String(parallelJobs)}`,
    ...(licences.length === 0 ? ['  licences: {}'] : ['  licences:', ...licences.map(([name, seats]) => `    ${name}: ${String(seats)}`)]),
    '',
  ].join('\n'));
  return { name: LOCAL_SITE_NAME, sitesDir, sitePath, permitPath };
}

export type ReportCopy = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

/** The shape of `test/fixtures/opene902.manifest.json`, as much of it as a copy check reads. */
interface ReportManifest {
  readonly localCopyDir: string;
  readonly files: Readonly<Record<string, string>>;
}

/**
 * The verified local copy of one real report the manifest names. Vendor content never enters the
 * repository: the copies live under the manifest's `localCopyDir`, outside it, and each is checked
 * against the SHA-256 the manifest records before anything reads it as real.
 *
 * @param manifestPath - the fixture manifest.
 * @param name - the file, as the manifest lists it (`syn/qor.rpt`).
 * @returns the absolute path of a copy whose hash matches, or the reason there is none.
 */
export async function verifiedReportCopy(manifestPath: string, name: string): Promise<ReportCopy> {
  let manifest: ReportManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ReportManifest;
  } catch (err) {
    return { ok: false, reason: `cannot read the fixture manifest ${manifestPath}: ${(err as Error).message}` };
  }
  const expected = manifest.files[name];
  if (expected === undefined) return { ok: false, reason: `"${name}" is not listed in ${manifestPath}` };
  const abs = path.join(manifest.localCopyDir, name);
  let bytes: Buffer;
  try {
    bytes = await readFile(abs);
  } catch (err) {
    return { ok: false, reason: `opene902 fixture copy missing at ${abs} (${(err as Error).message}); see ${manifestPath}` };
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    return { ok: false, reason: `opene902 fixture at ${abs} has sha256 ${actual}, manifest expects ${expected}: local copy is stale or wrong` };
  }
  return { ok: true, path: abs };
}

export interface SeedLocalSiteRequest {
  /** The `$DSH_HOME` the host will boot from. */
  readonly home: string;
  /** The checkout the pack and the fixture manifest come from. */
  readonly checkout: string;
}

export interface SeededLocalSite {
  readonly site: LocalSite;
  readonly flow: StandinFlow;
  /** The installed pack's directory inside the home. */
  readonly packDir: string;
  readonly workspaceRoot: string;
  /** One line per thing done or found, in order, for whoever asked to see it. */
  readonly did: readonly string[];
}

/** Where the seeding puts what it makes, all under one directory of the home's `hima/`. */
const LOCAL_DIR = 'hima/local';

/**
 * Seed a home with everything a Run on the local Site needs, so `pnpm run desktop --site local`
 * opens a window in which `/hima run opene902-timing-probe --site local --goal target_period_ns=2.0`
 * runs a Campaign in seconds: the shipped pack installed into `hima/packs`, the stand-in flow
 * generated under `hima/local/standin-flow`, a workspace root under `hima/local/workspace`, and the
 * `local` site file and Permit binding the two.
 *
 * Each generation's report is the stand-in's own, computed from the period that generation was asked
 * for. It used to copy the real opene902 qor fixture when this machine held a verified copy, which
 * made every generation report the same numbers — fine while a Run was one generation, and useless
 * to a Loop, which would have watched a period that never moved and called it converged at once. So
 * the seeding says which period the flow closes at instead, and `did` says so, because a person
 * reading a generation's result should know that these numbers are the stand-in's arithmetic and not
 * Design Compiler's.
 *
 * Idempotent, and deliberate about what it will overwrite: the pack copy, the flow and the two site
 * files are the checkout's and the generator's, so they are refreshed on every seeding; the
 * workspace root is where a developer's Campaigns and their results live, so it is created when
 * absent and otherwise not touched at all.
 *
 * @param req - the home to seed and the checkout to seed it from.
 * @returns what was made, and the lines saying so.
 * @throws when the checkout ships no pack to install.
 */
export async function seedLocalSite(req: SeedLocalSiteRequest): Promise<SeededLocalSite> {
  const home = path.resolve(req.home);
  const checkout = path.resolve(req.checkout);
  const did: string[] = [];

  const shippedPack = path.join(checkout, 'packs', TIMING_PROBE_PACK_ID);
  if (!existsSync(path.join(shippedPack, 'contract.yml'))) throw new Error(`the checkout ships no pack at ${shippedPack}`);
  const packsDir = path.join(home, 'hima/packs');
  const packDir = path.join(packsDir, TIMING_PROBE_PACK_ID);
  await mkdir(packsDir, { recursive: true });
  await rm(packDir, { recursive: true, force: true });
  await cp(shippedPack, packDir, { recursive: true });
  did.push(`local site: installed the shipped pack ${TIMING_PROBE_PACK_ID} into ${packDir}`);

  const localDir = path.join(home, LOCAL_DIR);
  const flow = await writeStandinFlow({ root: path.join(localDir, 'standin-flow') });
  did.push(`local site: generated the stand-in flow at ${flow.root}`);
  did.push(`local site: the stand-in computes its own qor report per generation, closing at ${flow.achievableNs.toFixed(2)} ns; these are simulated values, not measured EDA results`);

  const workspaceRoot = path.join(localDir, 'workspace');
  if (existsSync(workspaceRoot)) {
    did.push(`local site: the workspace root ${workspaceRoot} is already there and is left as it is`);
  } else {
    await mkdir(workspaceRoot, { recursive: true });
    did.push(`local site: made the workspace root ${workspaceRoot}`);
  }

  const site = await writeLocalSite({
    sitesDir: path.join(home, 'hima/sites'),
    workspaceRoot,
    allowedReadRoots: [workspaceRoot, flow.root],
    allowedWriteRoots: [workspaceRoot],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot },
  });
  did.push(`local site: wrote ${site.sitePath} binding flowRoot to the stand-in, and its permit ${site.permitPath}`);

  return { site, flow, packDir, workspaceRoot, did };
}
