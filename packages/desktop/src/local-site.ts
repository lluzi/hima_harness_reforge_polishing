// The local Site and the stand-in flow: what `pnpm run desktop --site local` seeds into a home so a
// developer runs generations that take seconds, and what the contract suite writes into every
// isolated home that runs a Job.
//
// One module, two callers, for the reason `hima-home.ts` gives: until this file existed the only
// recipe for a Site that can host the shipped pack was the test support's, and a developer who
// wanted the window against the stand-in had to read test code and copy it. The suite's
// `writeStandinFlow` and `writeLocalSite` are now views over the two writers here, so the flow a
// developer works against is the flow the suite proves things on. A third joined them with #57 for
// the same reason: `writeConvergingVariant` (its own section further down, beside the chooser it
// carries) writes the pack that converges on this flow, and the suite's `installOverConstraining` is
// a view over that one. So this module holds the flow with its nine stages ("The stages" below), the
// Site that binds it, and the pack a developer picks to watch a Loop end in the window.
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
// **The stages** (#60). `synth` was the whole of this flow while the only pack was a timing probe. A
// pack for a cell-mining and Fmax-push business has nine, and the stand-in answers every one of them
// so such a pack can be driven here — with its library gate, its zero-adoption terminal and its
// five-percent Goal all reachable — before a Site is. Each is a make target taking its inputs as
// command-line variables and writing inside the workspace, under `results/<design>/<stage>[-<arm or
// route>]/` and `logs/<design>/`:
//
//   | target         | variables beyond DESIGN            | report                                        | computed from                                      |
//   |----------------|------------------------------------|-----------------------------------------------|----------------------------------------------------|
//   | `synth`        | CLOCK_PERIOD_NS FORCE_SYNTH        | `syn/report[-<tag>]/qor.rpt`                  | `min(0, period − ACHIEVABLE_NS)` (#54, unchanged)  |
//   |                | EDA_CONTAINER_NAME RESULT_TAG      |                                               |                                                    |
//   | `mine`         | ROUTE PROFILE TOP_N CLOCK_PERIOD_NS| `mine-<route>/candidates.json`, `cells.txt`   | `min(TOP_N, base(PROFILE) + factor(ROUTE))` cells named for the route |
//   | `netlist`      | —                                  | `netlist/netlist.json`, `cells.txt`, `<c>.sp` | the union over every route mined, by identity      |
//   | `abstract`     | —                                  | `abstract/abstract.json`, `<c>.lef`           | one abstract per netlist                           |
//   | `charlib`      | CLOCK_PERIOD_NS                    | `charlib/charlib.json`, `generated.lib`       | one Liberty cell group per abstract                |
//   | `lc`           | LC_FAIL                            | `lc/lc.rpt`, `lc/generated.db`                | zero errors and a database, or an error per cell and at the least one, no database and exit 4 |
//   | `synth-custom` | CLOCK_PERIOD_NS EDA_CONTAINER_NAME | `syn-custom/report/qor.rpt`, `adoption.json`  | adoption from the library's size; slack from the achievable period it bought |
//   | `pnr`          | ARM CLOCK_PERIOD_NS                | `pnr-<arm>/postroute.summary`, `.json`        | `ACHIEVABLE_NS × (1 − GAIN_PER_MASTER × masters)`  |
//   | `verify`       | ARM VERIFY_VIOLATIONS              | `verify-<arm>/verify_drc.rpt`, `liveness.json`| the violation count, and the liveness pair per arm |
//
// One mechanism produces all of it, and it is stated in the makefile's own variables. A mining
// profile has a base yield (`narrow` 3, `steady` 12, `broad` 20 a route) and the route being mined
// adds a factor of its own to it — the sum of the route slug's characters modulo `ROUTE_SPREAD`, so
// `r1` adds 1 and `r2` adds 2 — and `TOP_N` caps the two together. The factor is the whole of what
// makes a route part of what a Strategy asks for: without it every route of one profile would yield
// the same count, and a pack mining six of them would be reading one answer six times under six
// names. It is derived from the slug and nothing else, so it is deterministic and this flow knows no
// route's name.
//
// A library of at least `ADOPTION_FLOOR` cells is adopted, one master per `CELLS_PER_MASTER` cells
// and `INSTANCES_PER_MASTER` instances of each; a smaller one is adopted not at all, which is the
// zero-adoption terminal — and `verify` still reports the library set before launch and a non-zero
// cell count after restore, because "the mapper took none of it" and "the mapper never saw it"
// produce the same adoption count and mean opposite things. Every adopted master buys
// `GAIN_PER_MASTER` of the critical path, so the two post-route arms differ by exactly what was
// adopted and their ratio is what a five-percent Goal is measured against: at the defaults, `narrow`
// improves nothing, `steady` 4.7%, `broad` 8.1%.
//
// Heavy stages (`synth`, `synth-custom`, `pnr`) sleep `STANDIN_SLEEP`, as `synth` always has; the
// light ones take what they take. A stage whose predecessor left nothing stops with exit 2 and names
// the stage to run first: the sequence is a sequence, and answering from nothing would make a
// stand-in that proves less than the tools do. A stage writing one artefact per candidate clears its
// own set (and only its own, inside the workspace) before it writes this pass's, so a rerun over a
// smaller set leaves none of the larger one behind.
//
// **What a stage refuses**, before it makes anything at all. `ROUTE` and `ARM` name a directory —
// the route's candidate set, the arm's report directory — so a value carrying path components would
// put a stage's output where the Permit resolved no write: `ARM` is one of the two arms, `ROUTE` a
// slug of lower-case letters, digits and dashes, and each is held to that shape before the first
// `mkdir` rather than after it. `TOP_N` and `VERIFY_VIOLATIONS` are held to the same canonical-integer
// grammar the parse-time table holds `STANDIN_SLEEP` and its neighbours to — `0`, or a digit that is
// not `0` and more digits — and `LC_FAIL` is exactly `0` or `1`: a malformed count that quietly became
// zero would be a gate ruling on clean evidence that was never produced, and a `01` is refused rather
// than rewritten to the `1` it would mean, because this flow does not rewrite a caller's answer, only
// refuse the one it will not use.
//
// **And what make itself is refused.** A shell check is worth only what make left for it to check.
// Make takes any `VAR=value` a command line carries, declared in this file or not, and expands it
// the moment anything references that variable — so a `ROUTE=$(shell …)` used to run its command at
// the instant `export ROUTE` put the value in a recipe's environment, and the slug check that
// followed was ruling on what that command had printed. Three blocks answer that, in the order the
// makefile runs them.
//
// *What a caller may name*, before anything else. A boundary made of make variables is only as
// strong as the command line's inability to reach the boundary itself: `standin-hold=` would switch
// every check below off, `standin-hold=$(shell …)` would run its command while make was still
// reading the file, and a `RESULTS_DIR=` of a caller's choosing would name the directory a stage
// builds and clears in. So the command line is read first by name and never by value —
// `$(.VARIABLES)` and `$(origin …)` answer with names, and a name expands to nothing and runs
// nothing — and a name that is this flow's own, or one it never declared, stops the flow in words.
// Every helper, every derived path and every declared variable is `override` as well, so a caller's
// value never wins even where nothing refuses it.
//
// *What a caller may set*, next: every declared variable frozen to `$(value …)`, the characters that
// were typed rather than what they would expand to, after which nothing in this makefile expands a
// caller's value at all. The ones a recipe reads out of the environment then reach the shell as a
// word and never as syntax; the ones make still writes into a recipe — `DESIGN`, which every path is
// named for, the numbers the arithmetic is made of, the two words a wrapper is told — are held at
// parse time to the *grammar* of their kind and not to a class of characters, because a class is not
// a shape: `--` and `1-2` are made of nothing but number characters and are not numbers, `01` is a
// whole number no report can carry, and `-x` is made of name characters and is not a name. Between
// the two lists every caller-settable variable is held by exactly one of them, by construction.
//
// *Where a removal lands*, last. `PROJECT_ROOT` is the makefile's own location and `override`n, so
// the tree a stage builds and clears in is the copy it was run from and not one of a caller's
// choosing. Each `rm` then asks, immediately beside itself, where its target *is* rather than what it
// is spelled: a `..` component and a symlink are refused in their own words, and target and root are
// each resolved on disk (`cd -P … && pwd -P`) and compared. A prefix check on the text is not that
// question — `<root>/results/../../elsewhere` begins with the root character for character and names
// a directory two levels above it, and a directory inside the root that is a symlink names wherever
// it points.
//
// Nothing in here imports a sibling module. The contract suite loads this file as TypeScript through
// Node's type stripping, which resolves specifiers literally — a `./hima-home.js` import would be a
// file that does not exist in `src/` — so what this module needs, it takes as arguments.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { exportPackMethod, installPackMethod, pipelineFiles } from '@hima/harness';
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

/**
 * Every stage the stand-in flow answers, in the order a cell-mining and Fmax-push business runs them
 * (#60). One make target each, and the makefile's `.PHONY` line is generated from this list, so a
 * stage that is here and nowhere else does not exist and a stage the makefile answers that is not
 * here cannot be seeded.
 */
export const standinStages = [
  'synth',
  'mine',
  'netlist',
  'abstract',
  'charlib',
  'lc',
  'synth-custom',
  'pnr',
  'verify',
] as const;

export interface StandinFlowRequest {
  /** Where the flow is generated: the directory a site file binds as `flowRoot`. */
  readonly root: string;
  readonly design?: string;
  /** How many seconds `synth` sleeps before it produces anything. */
  readonly sleepSeconds?: number;
  /** How many attempts fail with exit 3 before one succeeds, for the untagged `synth`. Default 0. */
  readonly failures?: number;
  /**
   * **A symlink the `synth` stage plants at the Campaign workspace root** before it writes anything
   * — `<name>` pointing at `<to>`, made once and left alone afterwards. Nothing plants one unless a
   * caller asks for it, and the shipped `pnpm run desktop --site local` flow never does.
   *
   * Test infrastructure, beside `failures` and `sleepSeconds`, and here for the same reason those
   * two are: a contract test needs a Site where something has *happened* — a Job of the Campaign's
   * own having left a link in the workspace is exactly what the harness's resolved-root rule is
   * about, and a test that planted one from outside would be racing the fabric for the window
   * between the workspace being prepared and the next node opening.
   *
   * `name` is a slug and `to` is a relative path of plain segments, both held here before a
   * character of makefile is generated ({@link heldPlantLink}): what a stage would otherwise
   * interpolate into a shell line is the one place a value has to be held.
   */
  readonly plantsLink?: { readonly name: string; readonly to: string };
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
  /** Every stage this flow answers, as the makefile declares them (#60). */
  readonly stages: readonly string[];
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
  // Before the first `mkdir`, so a plant this generator will not spell leaves no half-written flow
  // behind it. The makefile's own generator asks the same question again of the same value.
  if (req.plantsLink !== undefined) heldPlantLink(req.plantsLink);
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
  await writeFile(path.join(root, 'Makefile'), standinMakefile(design, achievableNs, req.sleepSeconds ?? STANDIN_SLEEP_SECONDS, req.plantsLink));
  return { root, design, achievableNs, failFile, stages: standinStages };
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
 * Every other stage (#60) is generated by `stageRecipes` below, from the same three numbers: the
 * period it was asked for, the profile its candidates were mined under, and the arm it is for.
 *
 * Recipe lines are tab-indented, as make requires, and `$$` is a literal `$` to make.
 *
 * @param design - the design the report names.
 * @param achievableNs - the clock period this flow closes at.
 * @param sleepSeconds - how long `synth` sleeps first.
 * @param plantsLink - the symlink `synth` plants at the workspace root first, when a caller asked
 *                     for one; nothing is planted and nothing is generated for it otherwise.
 * @returns the makefile text.
 */
function standinMakefile(design: string, achievableNs: number, sleepSeconds: number, plantsLink?: { readonly name: string; readonly to: string }): string {
  const report = qorReportLines(design, '$$slack', '$$period', '$$tns', '$$hold');
  return [
    '# Stand-in flow for the local Site. Generated; never committed.',
    '# Same target, same command-line variables, same output paths as the Design Zoo flow.',
    '',
    ...callerBoundary(),
    '',
    '# The shell every recipe runs in, held after the block above has refused a caller who named it.',
    'override SHELL := /bin/sh',
    '',
    ...projectRoot(),
    '',
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
    '',
    ...stageVariables(),
    '',
    ...heldValues(),
    '',
    ...derivedPaths(),
    '',
    ...plantedLink(plantsLink),
    '',
    `.PHONY: ${standinStages.join(' ')}`,
    'synth:',
    '\t@mkdir -p "$(REPORT_DIR)" "$(LOG_DIR)" "$(PROJECT_ROOT)/build/$(DESIGN)"',
    // Before anything is written, including a seeded failure: what a test that plants one is about is
    // the state of the workspace at the *next* node, and a stage that failed still ran.
    //
    // Only where the name is free — `-e` for anything that resolves and `-L` for a link that does
    // not, since `-e` follows one. Both, because `ln -s x d` with a *directory* at `d` makes the link
    // inside it, which would be this recipe quietly rearranging a directory belonging to something
    // else; and because the second generation's synth must find its own link already there and leave
    // it alone rather than fail the stage.
    '\t@if [ -n "$(STANDIN_PLANT_LINK)" ] && [ ! -e "$(WORKSPACE_ROOT)/$(STANDIN_PLANT_LINK)" ] && [ ! -L "$(WORKSPACE_ROOT)/$(STANDIN_PLANT_LINK)" ]; then \\',
    '\t   ln -s "$(STANDIN_PLANT_LINK_TO)" "$(WORKSPACE_ROOT)/$(STANDIN_PLANT_LINK)"; \\',
    '\t   echo "[stand-in] planted $(WORKSPACE_ROOT)/$(STANDIN_PLANT_LINK) -> $(STANDIN_PLANT_LINK_TO)" >> "$(LOG_DIR)/dc_shell.log"; \\',
    '\t fi',
    '\t@echo "[stand-in] synth design=$(DESIGN) period=$(CLOCK_PERIOD_NS) tag=$(RESULT_TAG) force=$(FORCE_SYNTH) container=$$EDA_CONTAINER_NAME" >> "$(LOG_DIR)/dc_shell.log"',
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
    ...stageRecipes(design),
  ].join('\n');
}

/**
 * The command-line variables the stages after `synth` take, and the numbers the stand-in's own
 * arithmetic is made of. Every one is a `?=` default, so a caller states what it means to vary and
 * nothing else, and a pack's contract names these spellings and no others.
 *
 * The constants at the bottom are the whole of the model, with the three mining yields in `mine`'s
 * own recipe: a library of at least `ADOPTION_FLOOR` cells is adopted, one master per
 * `CELLS_PER_MASTER` cells and `INSTANCES_PER_MASTER` instances of each; every adopted master buys
 * `GAIN_PER_MASTER` of the critical path; and `POST_ROUTE_DENSITY` is what both arms report, because
 * placement density is not what this flow explores and one that moved with the period would be a
 * second exploration nobody asked for. They are the flow's own numbers, not a claim about any tool —
 * what they buy is a library gate, a zero-adoption terminal and a five-percent Goal a pack can be
 * driven against here, before a Site is reached.
 */
function stageVariables(): string[] {
  return [
    '# What the mining stage is asked for: which route it is mining, which profile\'s bounded',
    '# parameter map it mines under (narrow, steady or broad), and how many of that route\'s own',
    '# candidates are reserved. The profile and the route decide the yield; TOP_N caps it.',
    'ROUTE ?=',
    'PROFILE ?=',
    'TOP_N ?= 10',
    '# The library stage\'s hard gate, told to fail: the report is written, no database is, and the',
    '# stage stops the flow with exit 4.',
    'LC_FAIL ?= 0',
    '# Which post-route arm a stage is for: the foundry library alone, or the generated one beside it.',
    'ARM ?=',
    '# What the verification session reports having found. Nothing, unless a caller wants a gate to bite.',
    'VERIFY_VIOLATIONS ?= 0',
    '',
    '# The stand-in\'s own arithmetic, all of it; the three mining base yields are in mine\'s recipe',
    '# below. ROUTE_SPREAD is how far apart two routes mined under one profile are: the route\'s own',
    '# name is summed into a number and taken modulo this, and that factor is added to the base yield,',
    '# so a route is part of what a mining Strategy asks for and not a label on one answer.',
    'ROUTE_SPREAD ?= 3',
    'ADOPTION_FLOOR ?= 10',
    'CELLS_PER_MASTER ?= 4',
    'INSTANCES_PER_MASTER ?= 9',
    'GAIN_PER_MASTER ?= 0.015',
    'POST_ROUTE_DENSITY ?= 48.500',
  ];
}

/**
 * Where this flow builds, and the boundary everything else is inside of.
 *
 * `PROJECT_ROOT` is the makefile's own location, exactly as the Design Zoo's is, so a copy of this
 * flow builds into the copy and never into the original — the property the whole workspace design
 * rests on (D19). What is new (#60) is that a caller cannot move it: every directory a stage makes
 * and every file a stage removes is under it, so a project root of someone else's choosing would put
 * both where the Permit resolved no write at all. `override` is what holds it, and `callerBoundary`
 * above has already refused a caller who named it, so a caller who tried is told rather than
 * quietly ignored.
 *
 * @returns the two lines, before anything is derived from anything.
 */
function projectRoot(): string[] {
  return [
    '# Where this flow builds, and the boundary everything below it is inside of: the makefile\'s own',
    '# location, so a copy of this flow builds into the copy (D19). Not a caller\'s to move — every',
    '# directory a stage makes and every file a stage removes is under it, and the block above has',
    '# already refused a command line that named it.',
    'override PROJECT_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))',
  ];
}

/** The characters a name is made of, as make's own space-separated list. The underscore is among
 *  them because a Campaign id may carry one (`campaignIdPattern`, `packages/harness/src/workspace.ts`)
 *  and every tool line passes `EDA_CONTAINER_NAME=hima-<campaign>`, and because a design is called
 *  what a foundry's manifests call it. None of these characters can name another directory. */
const NAME_CHARS = [...'abcdefghijklmnopqrstuvwxyz0123456789_-'].join(' ');

/** The characters a whole number is made of, the same way. */
const DIGIT_CHARS = [...'0123456789'].join(' ');

/**
 * The variables a recipe holds rather than the parse-time table: each names a directory or rules a
 * gate, each is refused by the stage that takes it — in that stage's own words, naming the stage —
 * before the stage makes anything for it, and each reaches the shell as an environment word that
 * make never wrote into a recipe's text.
 */
const RECIPE_HELD_VARIABLES = ['ROUTE', 'PROFILE', 'TOP_N', 'LC_FAIL', 'ARM', 'VERIFY_VIOLATIONS'] as const;

/**
 * The ones make itself still writes into a recipe, and the grammar each is held to at parse time.
 *
 * A kind is a grammar and not a character class, because a character class is not a shape: `--` and
 * `1-2` are made of nothing but number characters and are not numbers, and `01` is a whole number
 * spelled in a way no report can carry. So a whole number is `0` or a non-zero digit and more
 * digits; a switch is one of two words; a number is a whole number, optionally signed, optionally
 * followed by one dot and digits; and a name is lower-case letters, digits, dashes and underscores
 * not beginning with a dash.
 */
const HELD_VARIABLES: readonly (readonly [string, 'name' | 'integer' | 'switch' | 'decimal'])[] = [
  ['DESIGN', 'name'], ['RESULT_TAG', 'name'], ['EDA_CONTAINER_NAME', 'name'], ['DC_COMPILE_EFFORT', 'name'],
  ['CLOCK_PERIOD_NS', 'decimal'], ['ACHIEVABLE_NS', 'decimal'], ['HOLD_VIOLATION', 'decimal'],
  ['GAIN_PER_MASTER', 'decimal'], ['POST_ROUTE_DENSITY', 'decimal'], ['FORCE_SYNTH', 'switch'],
  ['STANDIN_SLEEP', 'decimal'], ['ROUTE_SPREAD', 'integer'], ['ADOPTION_FLOOR', 'integer'],
  ['CELLS_PER_MASTER', 'integer'], ['INSTANCES_PER_MASTER', 'integer'],
];

/**
 * The variables a caller may set — every one of which is held by one of the two lists above and by
 * nothing else, because it is made of them. A variable added to the flow and to neither list cannot
 * become a caller's: the boundary refuses every name it does not carry, so a hole in the coverage is
 * a refusal and never a value nothing rules on.
 */
const CALLER_VARIABLES: readonly string[] = [...HELD_VARIABLES.map(([name]) => name), ...RECIPE_HELD_VARIABLES];

/** The ones a recipe reads out of the environment rather than make writing them into it. */
const EXPORTED_VARIABLES: readonly string[] = [...RECIPE_HELD_VARIABLES, 'EDA_CONTAINER_NAME', 'DC_COMPILE_EFFORT'];

/** Every path this flow writes, derived from the root and the values held, and named here so the
 *  boundary can refuse a caller who tried to set one. */
const DERIVED_PATHS: readonly (readonly [string, string])[] = [
  // The Campaign workspace this copy of the flow is inside: the copy's own parent, since preparation
  // copies the golden flow to `<workspace>/flow`. Derived like every other path, from the root and
  // nothing else, and refused from the command line for the same reason the root is.
  ['WORKSPACE_ROOT', '$(abspath $(PROJECT_ROOT)/..)'],
  ['TAG_SUFFIX', '$(if $(RESULT_TAG),-$(RESULT_TAG),)'],
  ['REPORT_DIR', '$(PROJECT_ROOT)/results/$(DESIGN)/syn/report$(TAG_SUFFIX)'],
  ['LOG_DIR', '$(PROJECT_ROOT)/logs/$(DESIGN)'],
  ['FAIL_FILE', '$(PROJECT_ROOT)/build/$(DESIGN)/fail-remaining$(TAG_SUFFIX)'],
  ['RESULTS_DIR', '$(PROJECT_ROOT)/results/$(DESIGN)'],
  ['BUILD_DIR', '$(PROJECT_ROOT)/build/$(DESIGN)'],
];

/** What the plant is spelled as in the makefile, when a caller asked for one. Never a caller's to
 *  set — the generator decides both words, and the boundary at the top of the file refuses a command
 *  line that names either: a caller who could assign them would be choosing where a symlink is made
 *  and what it points at. */
const PLANT_VARIABLES = ['STANDIN_PLANT_LINK', 'STANDIN_PLANT_LINK_TO'] as const;

/** The variables this flow keeps for itself, which a caller is told about by name rather than
 *  quietly ignored: where it builds, the shell it runs in, every path it derives, and the plant. */
const OWN_VARIABLES: readonly string[] = ['SHELL', 'PROJECT_ROOT', ...DERIVED_PATHS.map(([name]) => name), ...PLANT_VARIABLES];

/** A planted link's own name: a slug, so it is one plain segment of a path and can name no other
 *  directory. The grammar a route or a profile is held to in this flow, asked on this side. */
const PLANT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** One segment of what a planted link points at: letters, digits, and the three inner punctuation
 *  characters a directory name carries. `..` is not one — a segment begins with a letter or a digit
 *  — and neither is an empty word, so a leading, trailing or doubled `/` is refused with it. */
const PLANT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Hold a plant to its grammar, on **this** side, before a character of it is generated.
 *
 * The wave-2 lesson, applied to the one value this generator takes that ends up inside a shell line:
 * `ln -s "$(STANDIN_PLANT_LINK_TO)" "$(WORKSPACE_ROOT)/$(STANDIN_PLANT_LINK)"` is make writing two
 * values into a recipe, and a value with a quote, a `$` or a `;` in it would be the shell's syntax
 * rather than the shell's word. A check written into the recipe would be the second line and not the
 * boundary; this is the boundary. The name is one plain segment and the target is a relative path of
 * plain segments — between them there is no `..`, no absolute path, no shell metacharacter and no
 * makefile expansion, so what the recipe runs is a link made inside the workspace, pointing inside
 * the workspace, and nothing else.
 *
 * @param plantsLink - the link a caller asked `synth` to plant.
 * @returns the same pair, once it is one this generator will spell.
 */
function heldPlantLink(plantsLink: { readonly name: string; readonly to: string }): { readonly name: string; readonly to: string } {
  if (!PLANT_NAME.test(plantsLink.name)) {
    throw new Error(`plantsLink.name is the link's own name and must be a slug of lower-case letters, digits and dashes starting with a letter or a digit; got "${plantsLink.name}"`);
  }
  const segments = plantsLink.to.split('/');
  if (!segments.every((segment) => PLANT_SEGMENT.test(segment))) {
    throw new Error(`plantsLink.to is a relative path of plain segments, each beginning with a letter or a digit — no "..", no leading or doubled "/", nothing a shell would read as syntax; got "${plantsLink.to}"`);
  }
  return plantsLink;
}

/**
 * The two words the plant is, as the makefile holds them — empty when no caller asked for one, which
 * is every flow but a test's.
 *
 * `override`, and named in `OWN_VARIABLES` above, so a command line can neither set them nor switch
 * the plant on for a flow generated without one: the empty value is what the `synth` recipe tests,
 * and a caller able to assign it would be choosing where a symlink is made on a Site.
 *
 * @param plantsLink - the link, already held by {@link heldPlantLink} on the way in; asked again
 *                     here because this is where the characters become makefile text.
 * @returns the two lines.
 */
function plantedLink(plantsLink?: { readonly name: string; readonly to: string }): string[] {
  const held = plantsLink === undefined ? undefined : heldPlantLink(plantsLink);
  return [
    '# A symlink the synth stage plants at the campaign workspace root before it writes anything, for',
    '# a test that needs the workspace to have been rearranged by a job rather than by the test. Empty',
    '# unless this flow was generated with one, and not a caller\'s to set: both names are refused by',
    '# the block at the top of this file.',
    `override STANDIN_PLANT_LINK := ${held?.name ?? ''}`,
    `override STANDIN_PLANT_LINK_TO := ${held?.to ?? ''}`,
  ];
}

/**
 * What a caller may *name*, before this makefile does anything else at all.
 *
 * Make takes any `VAR=value` a command line carries, whatever the makefile knows of it, and expands
 * it the moment something references the variable. A boundary made of make variables is therefore
 * only as strong as the command line's inability to reach the boundary itself: a `standin-hold=`
 * and every held value goes unheld, a `standin-hold=$(shell …)` and the command runs while make is
 * still reading this file. `override` stops a caller's value from winning; it does not tell the
 * caller, and it covers only the names this file thought to write it on.
 *
 * So the command line is read here, first, by name and never by value — and read *before* this
 * flow's own boundary names exist, which is what makes the boundary's own names as refused as any
 * other. `standin-caller-variables` and `standin-own-variables` are two names like any the makefile
 * declares later; a caller typing one on the command line cannot make it win (both are `override`),
 * but a fix that stopped there would still let the attempt through unrefused, because by the time
 * anything asked where that name came from, this file's own assignment had already answered
 * "override" in its place. So the scan runs first, while every one of this flow's names — these two
 * included — is still whatever the command line made it, and only then do the two lists it reads get
 * their own values. `$(.VARIABLES)` answers with the names make knows and `$(origin …)` with where
 * each came from: both are names, and a name expands to nothing and runs nothing. A name this flow
 * keeps for itself is refused as such; a name this flow has never declared — its own boundary names
 * among them — is refused as that; and what is left is exactly the declared surface, which the block
 * further down holds to its shapes.
 *
 * @returns the refusals, to stand at the top of the makefile.
 */
function callerBoundary(): string[] {
  return [
    '# ---- What a caller may name ------------------------------------------------------------------',
    '#',
    '# First, because everything below rests on it. Make takes any VAR=value a command line carries,',
    '# declared here or not, and expands it the moment something references the variable — so a',
    '# caller able to name a variable this flow uses for itself could switch the boundary below off',
    '# from outside it. The command line is therefore read here by name and never by value, and',
    '# before this flow\'s own two lists are given their values — so a caller who typed one of their',
    '# names cannot win (both are override) and is not merely let through unrefused either:',
    '# $(.VARIABLES) and $(origin ...) answer with names, and a name expands to nothing and runs',
    '# nothing. What survives these two refusals is exactly the surface the next block holds.',
    'override standin-given := $(strip $(foreach v,$(.VARIABLES),$(if $(filter command line,$(origin $(v))),$(v))))',
    `override standin-caller-variables := ${CALLER_VARIABLES.join(' ')}`,
    `override standin-own-variables := ${OWN_VARIABLES.join(' ')}`,
    'override standin-given-ours := $(filter $(standin-own-variables),$(standin-given))',
    '$(if $(standin-given-ours),$(error [stand-in] $(firstword $(standin-given-ours)) is this flow\'s own and is not a caller\'s to set; got "$(value $(firstword $(standin-given-ours)))"),)',
    'override standin-given-unknown := $(filter-out $(standin-caller-variables),$(standin-given))',
    '$(if $(standin-given-unknown),$(error [stand-in] this flow takes only the variables it declares; it does not take $(standin-given-unknown)),)',
  ];
}

/**
 * What a caller may set, held to what it may hold — the whole of the value boundary, in one block,
 * before the first path is derived and before the first recipe runs.
 *
 * Make expands a command-line value the moment anything references the variable, which is long
 * before a recipe could examine it: a `ROUTE=$(shell …)` used to run its command at the instant
 * `export ROUTE` put the variable in a recipe's environment, and the slug check that followed was
 * ruling on what the command had printed. So every caller-settable variable is frozen here to
 * `$(value …)` — the characters the caller typed rather than what they would expand to — and after
 * these lines nothing in this makefile expands a caller's value at all.
 *
 * What then holds each one depends on how it reaches its stage. The ones a recipe reads out of the
 * environment reach the shell as a word and never as syntax, and each recipe refuses one it will not
 * use before it makes a directory for it, naming the stage and the variable. The ones make itself
 * still writes into a recipe — the design every path is named for, the numbers the arithmetic is
 * made of, the two words a wrapper is told — are held here at parse time, because a value make
 * interpolates is the shell's to parse and a path component in one would name another directory.
 * Between the two lists every variable a caller may set is held by exactly one of them, because
 * `CALLER_VARIABLES` is made of them.
 *
 * What holds them is a grammar per kind and not a character class, because a class is not a shape:
 * `--` and `1-2` are made of nothing but number characters and are not numbers, `01` is a whole
 * number spelled so that no report can carry it, and `-x` is made of name characters and is not a
 * name. Each grammar is `override` and each of their names is refused at the top of the file, so the
 * boundary cannot be switched off by the command line it exists to hold.
 *
 * @returns the block, ready to join into the makefile.
 */
function heldValues(): string[] {
  return [
    '# ---- What a caller may set, and what it may hold --------------------------------------------',
    '#',
    '# Make expands a command-line value the moment anything references the variable — before any',
    '# recipe has run — so a value holding "$(shell ...)" would run its command before the shell could',
    '# look at it. Every one of them is frozen here to the characters the caller typed, which is what',
    '# $(value ...) answers with; nothing below this block expands a caller\'s value.',
    ...CALLER_VARIABLES.map((name) => `override ${name} := $(value ${name})`),
    '',
    '# These reach their recipe through the environment and are read there as "$NAME". A value make',
    '# had written into a recipe would be the shell\'s to parse — a quote or a "$(...)" in it would be',
    '# syntax and not a word — and these are the ones a caller varies most. Each recipe refuses one it',
    '# cannot safely use, in its own words, before it makes anything for it.',
    ...EXPORTED_VARIABLES.map((name) => `export ${name}`),
    '',
    '# The rest make still writes into the recipes, so they are held here, before the first path is',
    '# derived from them — each to the grammar of its kind and not merely to a class of characters,',
    '# because "--", "1-2" and "01" are made of number characters and are not numbers a report can',
    '# carry, and "-x" is made of name characters and is not a name. standin-only takes every',
    '# character of a class out of a value one at a time and asks what is left; the kinds are built',
    '# on top of it. Every one of these is override, and every one of their names is refused by the',
    '# block at the top of this file: a boundary a command line can redefine is not one.',
    `override standin-digits := ${DIGIT_CHARS}`,
    `override standin-name-chars := ${NAME_CHARS}`,
    'override standin-strip = $(if $(2),$(call standin-strip,$(subst $(firstword $(2)),,$(1)),$(wordlist 2,$(words $(2)),$(2))),$(1))',
    'override standin-one-word = $(if $(word 2,$(1)),,y)',
    'override standin-only = $(if $(strip $(call standin-strip,$(1),$(2))),,y)',
    '# A whole number: 0, or a digit that is not 0 and more digits. Nothing else is one.',
    'override standin-is-integer = $(and $(call standin-one-word,$(1)),$(1),$(call standin-only,$(1),$(standin-digits)),$(if $(filter 0,$(1)),y,$(if $(filter 0%,$(1)),,y)))',
    '# A switch: one of two words.',
    'override standin-is-switch = $(and $(call standin-one-word,$(1)),$(filter 0 1,$(1)))',
    '# A number: a whole number, optionally signed, optionally followed by one dot and digits. The',
    '# minus is taken off first, so what is left may hold none; one dot at most, at neither end, and',
    '# never two in a row — $(subst) turns each dot into a space so $(word) can count the parts on',
    '# either side of it, and make\'s $(word)/$(wordlist) collapse a run of spaces into one separator',
    '# the way a shell collapses a run of blanks, so "1..2" and "1.2" would count the same two words',
    '# without the $(findstring ..,...) below refusing the run before it is ever split.',
    'override standin-unsigned = $(patsubst -%,%,$(1))',
    'override standin-parts = $(subst ., ,$(call standin-unsigned,$(1)))',
    'override standin-dec-one-sign = $(if $(findstring -,$(call standin-unsigned,$(1))),,y)',
    'override standin-dec-dot-inside = $(if $(filter .% %.,$(call standin-unsigned,$(1))),,y)',
    'override standin-dec-no-double-dot = $(if $(findstring ..,$(call standin-unsigned,$(1))),,y)',
    'override standin-dec-one-dot = $(if $(word 3,$(call standin-parts,$(1))),,y)',
    'override standin-dec-whole = $(call standin-is-integer,$(firstword $(call standin-parts,$(1))))',
    'override standin-dec-fraction = $(if $(word 2,$(call standin-parts,$(1))),$(call standin-only,$(word 2,$(call standin-parts,$(1))),$(standin-digits)),y)',
    'override standin-is-decimal = $(and $(call standin-one-word,$(1)),$(1),$(call standin-dec-one-sign,$(1)),$(call standin-dec-dot-inside,$(1)),$(call standin-dec-no-double-dot,$(1)),$(call standin-dec-one-dot,$(1)),$(call standin-dec-whole,$(1)),$(call standin-dec-fraction,$(1)))',
    '# A name: lower-case letters, digits, dashes and underscores, not beginning with a dash. None',
    '# of them can name another directory. It may be empty, which is what an unset RESULT_TAG is;',
    '# DESIGN is required to be something by the line below instead.',
    'override standin-is-name = $(and $(call standin-one-word,$(1)),$(call standin-only,$(1),$(standin-name-chars)),$(if $(filter -%,$(1)),,y))',
    'override standin-integer-words := a whole number, zero or more, spelled without a leading zero',
    'override standin-switch-words := 0 or 1',
    'override standin-decimal-words := a number: digits, at most one dot, an optional leading minus, and no leading zero',
    'override standin-name-words := made of lower-case letters, digits, dashes and underscores, and must not begin with a dash',
    'override standin-hold = $(if $(call standin-is-$(2),$(value $(1))),,$(error [stand-in] $(1) must be $(standin-$(2)-words); got "$(value $(1))"))',
    '',
    '# And what each of them is.',
    '$(if $(value DESIGN),,$(error [stand-in] DESIGN must be given: it names the directory every report is written under))',
    ...HELD_VARIABLES.map(([name, kind]) => `$(call standin-hold,${name},${kind})`),
    // Existing local report/recovery fixtures use subsecond delays. They remain numeric words;
    // a negative delay is refused before any recipe writes a directory.
    '$(if $(filter -%,$(value STANDIN_SLEEP)),$(error [stand-in] STANDIN_SLEEP must be zero or more),)',
  ];
}

/**
 * Every path this flow writes, derived in one place from the root above and the values just held.
 *
 * They are derived here and not beside their variables because of the order the holding needs: a
 * path built from `DESIGN` before `DESIGN` was held would be a path built from whatever was typed.
 * Each is `override`, and each of their names is refused at the top of the file: a caller who could
 * assign one of these would name the directory a stage builds and clears in, which is the whole of
 * what the project root is for.
 *
 * @returns the derived paths, ready to join into the makefile.
 */
function derivedPaths(): string[] {
  return [
    '# Every path this flow writes, from the root above and the values just held — and from nothing',
    '# else, which is what makes "inside the workspace" a property and not a hope. Not a caller\'s to',
    '# assign: the block at the top of this file refuses a command line that names one.',
    ...DERIVED_PATHS.map(([name, value]) => `override ${name} := ${value}`),
  ];
}

/**
 * One recipe made of several shell lines. Make hands the whole of it to one shell — the lines are
 * joined with backslash continuations — so they share variables, and a caller ends its own
 * statements. The first line carries make's `@`, which is what keeps a stage's output the tool's own
 * and not a transcript of the recipe.
 *
 * @param lines - the shell, statement by statement.
 * @returns the recipe, ready to join into the makefile.
 */
function recipe(lines: readonly string[]): string {
  return lines.map((line, i) => (i === 0 ? `\t@${line}` : `\t ${line}`)).join(' \\\n');
}

/**
 * The shell one stage runs before it makes anything of a value: refuse one it will not use.
 *
 * `ROUTE` and `ARM` decide a directory under the workspace, and a value carrying path components
 * would put a stage's output where the Permit resolved no write at all — so they are held to a shape
 * that has none, and held to it before the first `mkdir`. `TOP_N` and `VERIFY_VIOLATIONS` are counts
 * a gate rules on later, and a malformed one quietly becoming zero is false evidence of a clean
 * result, which is worse than no evidence.
 *
 * The value is read out of the environment (`$NAME`, which `export` above puts there) and never
 * interpolated into this text, so what the shell examines is the value and not whatever the value
 * would have parsed as; `case` is the shell's own way of asking what a string is made of, and the
 * two patterns between them reject every character outside the class.
 *
 * @param stage - the target, so a refusal says which stage refused.
 * @param name - the variable, spelled as a caller spells it on the command line.
 * @returns one shell statement, for `recipe` above.
 */
function mustBeSlug(stage: string, name: string): string {
  return `case "$$${name}" in "" | [!a-z0-9]* | *[!a-z0-9-]*) echo "[stand-in] ${stage}: ${name} must be a slug of lower-case letters, digits and dashes starting with a letter or a digit; got \\"$$${name}\\"" >&2; exit 2 ;; esac;`;
}

/**
 * The same, for a count: the canonical-integer grammar the parse-time table holds `STANDIN_SLEEP`
 * and its neighbours to — `0`, or a digit that is not `0` and more digits, and nothing else — read
 * out of the environment and refused in the stage's own words instead of at parse time.
 *
 * `01` is refused here rather than rewritten to the `1` it would mean: a count silently canonicalized
 * is a count make never held to a shape at all, and a report is written with numbers in it that a
 * caller's own `01` never reaches — the same reason `STANDIN_SLEEP=01` is refused rather than read as
 * one. The two patterns are one `case`, tested in order: the first rejects anything that is not a
 * non-empty run of digits, the second — reached only once the first has passed — rejects a run that
 * begins with `0` and is longer than one digit, which is every spelling `0` itself is not.
 */
function mustBeCount(stage: string, name: string): string {
  const refuse = (why: string): string =>
    `echo "[stand-in] ${stage}: ${name} must be ${why}; got \\"$$${name}\\"" >&2; exit 2`;
  return `case "$$${name}" in "" | *[!0-9]*) ${refuse('a whole number, zero or more')} ;; 0) ;; 0*) ${refuse('a whole number, zero or more, spelled without a leading zero')} ;; esac;`;
}

/**
 * The shell one stage runs before it removes anything: refuse a target that does not resolve, on
 * disk, under the project root.
 *
 * A prefix check on the text is not that question. `<root>/results/../../elsewhere/netlist` begins
 * with the root character for character and names a directory two levels above it; a directory
 * inside the root that is a symlink names wherever it points; and the root itself may be reached
 * through a symlink, so even two honest paths need not compare. What settles it is where each of
 * them *is*: `cd -P … && pwd -P` walks the path the kernel walks, resolving every symlink and every
 * `..` as it goes, and the comparison is between the two answers.
 *
 * The `..` and the symlink are refused in their own words first, before the resolution, so a person
 * reading a refusal is told which of the three things was wrong rather than being shown two paths
 * that do not match. Nothing a caller sets can produce either any more — the root is `override`n,
 * the design is held to a slug and the command line cannot name the helper that holds it — which is
 * exactly why this stands next to the `rm`: it is what makes the removal's containment a property of
 * the removal and not an inference from four things elsewhere all holding at once.
 *
 * Exported so a test can call the shell this module actually ships, directly, with a `what` of its
 * own choosing: every declared variable is held to a grammar that cannot put a `..` or a symlink into
 * a removal path, so the committed flow's own `DESIGN`/`ROUTE`/etc. can never reach the `..` branch
 * below on their own — a test that wants to prove that branch still refuses has to hand it a target
 * the declared surface could never produce, which is what a direct call is for.
 *
 * @param stage - the target, so a refusal says which stage refused.
 * @param what - the shell expression naming the directory, as the recipe spells it.
 * @returns the shell statements, for `recipe` below.
 */
export function mustBeInside(stage: string, what: string): string[] {
  const refuse = (why: string): string => `echo "[stand-in] ${stage}: ${why}" >&2; exit 2`;
  return [
    `case "${what}" in ".." | "../"* | *"/../"* | *"/..") ${refuse(`refusing to remove anything through a \\"..\\" path; got \\"${what}\\"`)} ;; esac;`,
    `if [ -L "${what}" ]; then ${refuse(`refusing to remove anything through a symlink; got \\"${what}\\"`)}; fi;`,
    'standin_root=`cd -P "$(PROJECT_ROOT)" 2>/dev/null && pwd -P`;',
    `standin_here=\`cd -P "${what}" 2>/dev/null && pwd -P\`;`,
    `if [ -z "$$standin_root" ] || [ -z "$$standin_here" ]; then ${refuse(`could not resolve \\"${what}\\" or the project root on disk`)}; fi;`,
    `case "$$standin_here" in "$$standin_root"/*) ;; *) ${refuse(`refusing to remove anything outside the project root, which is \\"$$standin_root\\"; \\"${what}\\" is \\"$$standin_here\\"`)} ;; esac;`,
  ];
}

/**
 * The shell that writes one stage's JSON report. Each entry of `body` is one line of JSON as it is to
 * read in the file, with `$$name` where a shell variable's value goes; the quoting `printf` needs is
 * added here, in the one place, rather than at each of the seven stages that writes one.
 *
 * @param body - the report's lines, between its braces.
 * @param into - the file, as the shell should see it (quoted by the caller).
 * @returns the shell lines, for `recipe` above.
 */
function writeJson(body: readonly string[], into: string): string[] {
  return [
    "printf '%s\\n'",
    ...['{', ...body, '}'].map((line) => `"${line.replaceAll('"', '\\"')}"`),
    `> ${into};`,
  ];
}

/**
 * The Innovus post-route summary the stand-in writes for one arm, as the `innovus-timing-summary`
 * reader reads one: the `Command: optDesign` line it keys on, the setup-mode table header naming the
 * two scopes, the WNS and TNS rows, and the placement density. The header block above it carries the
 * inputs this arm's numbers were computed from, so a person reading the report knows the period and
 * the arm without the JSON beside it.
 *
 * @param design - the design the report names.
 * @returns the report, line by line, with the recipe's own shell variables in it.
 */
function postRouteSummaryLines(design: string): string[] {
  return [
    '###############################################################',
    '#  Generated by:      stand-in flow',
    `#  Design:            ${design}`,
    '#  Inputs:            period=$$period arm=$$ARM adoptedMasters=$$masters',
    '#  Command:           optDesign -postRoute -outDir ./RPT -prefix postroute -setup',
    '###############################################################',
    '',
    '------------------------------------------------------------------',
    '     optDesign Final Non-SI Timing Summary',
    '------------------------------------------------------------------',
    '',
    '+--------------------+---------+---------+',
    '|     Setup mode     |   all   | reg2reg |',
    '+--------------------+---------+---------+',
    '|           WNS (ns):| $$wns  | $$wns  |',
    '|           TNS (ns):| $$tns  | $$tns  |',
    '+--------------------+---------+---------+',
    '',
    'Density: $(POST_ROUTE_DENSITY)%',
    '------------------------------------------------------------------',
  ];
}

/**
 * The DRC report one verification session writes, as the `innovus-verify-drc` reader reads one: the
 * `Command: verify_drc` line it keys on and the `Total Violations` line it counts from.
 *
 * The command line states the two options the legacy's verification gate had to assert were set —
 * `-check_only cell`, without which cell geometry is not checked at all, and a raised `-limit`,
 * whose default once suppressed all but one of 356,917 records. The stand-in states them because a
 * pack's gate reads them: a report that did not say so is a report the gate must refuse.
 *
 * @param design - the design the report names.
 * @returns the report, line by line, with the recipe's own shell variables in it.
 */
function verifyDrcLines(design: string): string[] {
  return [
    '###############################################################',
    '#  Generated by:      stand-in flow',
    `#  Design:            ${design}`,
    '#  Inputs:            arm=$$ARM librarySet=$$libset generatedCells=$$cells violations=$$viols',
    '#  Command:           verify_drc -limit 1000000 -check_only cell -report ./verify_drc.rpt',
    '###############################################################',
    '',
    '  Total Violations : $$viols Viols.',
  ];
}

/**
 * The eight stages after `synth`, each a make target taking its inputs as command-line variables and
 * writing its report inside the workspace. The sequence is a sequence: a stage whose predecessor left
 * nothing stops with exit 2 and says which stage to run first, rather than answering from nothing.
 *
 * What each computes, and from what, is the module header's table. The one thing worth repeating
 * here is why the arithmetic is `awk`'s: make has none and `/bin/sh` has no decimals, and a report
 * whose numbers were rounded differently from the tools' would be a stand-in a reader could tell
 * apart.
 *
 * @param design - the design the reports name.
 * @returns the makefile's remaining lines.
 */
function stageRecipes(design: string): string[] {
  const customQor = qorReportLines(design, '$$slack', '$$period', '$$tns', '$$hold');
  // One `awk` over a cell list, turning it into the JSON array a report carries.
  const cellsArray = (file: string): string =>
    `cells=\`awk '{ printf "%s\\"%s\\"", (NR > 1 ? ", " : ""), $$0 }' ${file}\`;`;
  return [
    // Mining, per route. The candidate set is the route's — its cells are named for it — and how
    // many of them there are follows the profile's base yield and the route's own factor, capped by
    // what the route reserves.
    'mine:',
    recipe([
      'test -n "$$ROUTE" || { echo "[stand-in] mine needs ROUTE=<name>: the route being mined" >&2; exit 2; };',
      mustBeSlug('mine', 'ROUTE'),
      'test -n "$$PROFILE" || { echo "[stand-in] mine needs PROFILE=<name>: narrow, steady or broad" >&2; exit 2; };',
      mustBeCount('mine', 'TOP_N'),
      'case "$$PROFILE" in',
      'narrow) base=3 ;;',
      'steady) base=12 ;;',
      'broad) base=20 ;;',
      '*) echo "[stand-in] mine: unknown PROFILE \\"$$PROFILE\\"; this flow knows narrow, steady and broad" >&2; exit 2 ;;',
      'esac;',
      'out="$(RESULTS_DIR)/mine-$$ROUTE";',
      'mkdir -p "$$out" "$(LOG_DIR)";',
      // What this route adds to its profile's base yield: the sum of its own characters, taken
      // modulo ROUTE_SPREAD. Every character of a validated route is in the alphabet below, so
      // `index` gives each one a number without leaving awk, and two routes that differ at all
      // usually differ here — which is the whole point: a count that followed the profile alone
      // would make every route of one profile the same answer under a different name.
      'factor=`awk -v r="$$ROUTE" -v s="$(ROUTE_SPREAD)" \'BEGIN { n = 0; for (i = 1; i <= length(r); i++) n += index("abcdefghijklmnopqrstuvwxyz0123456789-", substr(r, i, 1)); printf "%d", (s > 0 ? n % s : 0) }\'`;',
      'count=`awk -v b="$$base" -v f="$$factor" -v n="$$TOP_N" \'BEGIN { y = b + f; printf "%d", (n < y ? n : y) }\'`;',
      'period=`awk -v p="$(CLOCK_PERIOD_NS)" \'BEGIN { printf "%.2f", p }\'`;',
      ': > "$$out/cells.txt";',
      'i=1;',
      'while [ "$$i" -le "$$count" ]; do printf \'%s\\n\' "$${ROUTE}_c$$i" >> "$$out/cells.txt"; i=`expr $$i + 1`; done;',
      cellsArray('"$$out/cells.txt"'),
      ...writeJson([
        '  "stage": "mine",',
        '  "inputs": { "design": "$(DESIGN)", "route": "$$ROUTE", "profile": "$$PROFILE", "topN": $$TOP_N, "periodNs": $$period },',
        '  "count": $$count,',
        '  "routeFactor": $$factor,',
        '  "cells": [$$cells]',
      ], '"$$out/candidates.json"'),
      'echo "[stand-in] mine route=$$ROUTE profile=$$PROFILE topN=$$TOP_N yielded $$count candidate(s) (base $$base, route factor $$factor)" >> "$(LOG_DIR)/mine-$$ROUTE.log"',
    ]),
    '',
    // The transistor netlists, one per candidate of the union over every route mined. The merge is
    // by identity, which is what de-duplicates two routes that found the same function class.
    'netlist:',
    recipe([
      'out="$(RESULTS_DIR)/netlist";',
      'set -- "$(RESULTS_DIR)"/mine-*/cells.txt;',
      'test -f "$$1" || { echo "[stand-in] netlist: nothing mined under $(RESULTS_DIR); run mine first" >&2; exit 2; };',
      'routes=`ls -d "$(RESULTS_DIR)"/mine-*/ | wc -l | tr -d " "`;',
      'mkdir -p "$$out" "$(LOG_DIR)";',
      // This stage owns the `.sp` files in its own directory, so it clears them before it writes
      // this pass's: a netlist left over from a larger candidate set is a candidate the next stage
      // would lay out and characterise, and the library would hold cells nobody mined.
      ...mustBeInside('netlist', '$$out'),
      'rm -f "$$out"/*.sp;',
      'cat "$$@" | sort -u > "$$out/cells.txt";',
      'count=`wc -l < "$$out/cells.txt" | tr -d " "`;',
      'while read -r c; do printf \'%s\\n\' "* stand-in transistor netlist for $$c" > "$$out/$$c.sp"; done < "$$out/cells.txt";',
      cellsArray('"$$out/cells.txt"'),
      ...writeJson([
        '  "stage": "netlist",',
        '  "inputs": { "design": "$(DESIGN)", "routes": $$routes },',
        '  "count": $$count,',
        '  "cells": [$$cells]',
      ], '"$$out/netlist.json"'),
      'echo "[stand-in] netlist merged $$routes route set(s) into $$count candidate(s)" >> "$(LOG_DIR)/netlist.log"',
    ]),
    '',
    // The abstract layouts: site-legal widths and pins, routing not closed, one per netlist.
    'abstract:',
    recipe([
      'src="$(RESULTS_DIR)/netlist"; out="$(RESULTS_DIR)/abstract";',
      'test -f "$$src/cells.txt" || { echo "[stand-in] abstract: no transistor netlists at $$src; run netlist first" >&2; exit 2; };',
      'mkdir -p "$$out" "$(LOG_DIR)";',
      // Its own artefact set, cleared the same way and for the same reason as netlist's.
      ...mustBeInside('abstract', '$$out'),
      'rm -f "$$out"/*.lef;',
      'cp "$$src/cells.txt" "$$out/cells.txt";',
      'count=`wc -l < "$$out/cells.txt" | tr -d " "`;',
      'while read -r c; do printf \'%s\\n\' "MACRO $$c" "  CLASS CORE ;" "  SIZE 0.400 BY 1.400 ;" "END $$c" > "$$out/$$c.lef"; done < "$$out/cells.txt";',
      ...writeJson([
        '  "stage": "abstract",',
        '  "inputs": { "design": "$(DESIGN)" },',
        '  "count": $$count',
      ], '"$$out/abstract.json"'),
      'echo "[stand-in] abstract laid out $$count cell(s)" >> "$(LOG_DIR)/abstract.log"',
    ]),
    '',
    // The characterised Liberty, one cell group per abstract. Every group carries an
    // `internal_power` group because a Liberty without one compiles cleanly and scores every
    // generated cell at about zero internal power — a bias in the generated library's own favour
    // that nothing downstream can see.
    'charlib:',
    recipe([
      'src="$(RESULTS_DIR)/abstract"; out="$(RESULTS_DIR)/charlib";',
      'test -f "$$src/cells.txt" || { echo "[stand-in] charlib: no abstract layouts at $$src; run abstract first" >&2; exit 2; };',
      'mkdir -p "$$out" "$(LOG_DIR)";',
      'cp "$$src/cells.txt" "$$out/cells.txt";',
      'count=`wc -l < "$$out/cells.txt" | tr -d " "`;',
      'period=`awk -v p="$(CLOCK_PERIOD_NS)" \'BEGIN { printf "%.2f", p }\'`;',
      'printf \'%s\\n\' "library (generated_$(DESIGN)) {" "  delay_model : table_lookup;" > "$$out/generated.lib";',
      'while read -r c; do printf \'%s\\n\' "  cell ($$c) {" "    area : 0.560;" "    internal_power () { related_pin : \\"A\\"; }" "  }" >> "$$out/generated.lib"; done < "$$out/cells.txt";',
      'printf \'%s\\n\' "}" >> "$$out/generated.lib";',
      ...writeJson([
        '  "stage": "charlib",',
        '  "inputs": { "design": "$(DESIGN)", "periodNs": $$period },',
        '  "count": $$count,',
        '  "library": "generated.lib"',
      ], '"$$out/charlib.json"'),
      'echo "[stand-in] charlib characterised $$count cell(s) into $$out/generated.lib" >> "$(LOG_DIR)/charlib.log"',
    ]),
    '',
    // The library gate. The report is written before the stage stops, so the evidence of a failure
    // survives it, and a failing gate leaves no database at all — including the one an earlier pass
    // wrote, which a gate reading the directory would otherwise take for this pass's.
    'lc:',
    recipe([
      'case "$$LC_FAIL" in 0|1) ;; *) echo "[stand-in] lc: LC_FAIL must be 0 or 1; got \\"$$LC_FAIL\\"" >&2; exit 2 ;; esac;',
      'src="$(RESULTS_DIR)/charlib"; out="$(RESULTS_DIR)/lc";',
      'test -f "$$src/generated.lib" || { echo "[stand-in] lc: no Liberty at $$src/generated.lib; run charlib first" >&2; exit 2; };',
      'mkdir -p "$$out" "$(LOG_DIR)";',
      'count=`wc -l < "$$src/cells.txt" | tr -d " "`;',
      ...mustBeInside('lc', '$$out'),
      'rm -f "$$out/generated.db";',
      // Told to fail, the gate fails: the error count is one per cell it would not compile, and one
      // at the least, because a request to fail over an empty set that counted its errors off the set
      // would report none and read as a library that compiled cleanly.
      'if [ "$$LC_FAIL" = 1 ]; then errors=`awk -v c="$$count" \'BEGIN { printf "%d", (c > 0 ? c : 1) }\'`; written=no; else errors=0; written=yes; fi;',
      'printf \'%s\\n\'',
      '"****************************************"',
      '"Report : library compile"',
      '"Library: generated_$(DESIGN)"',
      '"Design : $(DESIGN)"',
      '"Inputs : design=$(DESIGN) cells=$$count lcFail=$$LC_FAIL"',
      '"****************************************"',
      '""',
      '"  Cells Compiled:   $$count"',
      '"  Errors:           $$errors"',
      '"  Database Written: $$written"',
      '> "$$out/lc.rpt";',
      'if [ "$$LC_FAIL" = 1 ]; then',
      'echo "[stand-in] lc: the library gate stopped the flow with $$errors error(s) and wrote no database" >> "$(LOG_DIR)/lc.log";',
      'printf \'%s\\n\' "[stand-in] Error: the generated library did not compile" "" "" "[stand-in] $$errors error(s); nothing was written to $$out/generated.db";',
      'exit 4;',
      'fi;',
      'printf \'%s\\n\' "stand-in compiled library for $(DESIGN): $$count cell(s)" > "$$out/generated.db";',
      'echo "[stand-in] lc compiled $$count cell(s) with 0 errors and wrote $$out/generated.db" >> "$(LOG_DIR)/lc.log"',
    ]),
    '',
    // Synthesis with the generated library, and the adoption it resolves. The qor report is a
    // Design Compiler one, so its setup slack is `min(0, period − achievable)` exactly as `synth`'s
    // is (#54) — what the generated library changed is the achievable period, not how a met one is
    // reported. The adopted-master count is left where the two post-route arms read it.
    'synth-custom:',
    recipe([
      'src="$(RESULTS_DIR)/charlib"; out="$(RESULTS_DIR)/syn-custom";',
      'test -f "$(RESULTS_DIR)/lc/generated.db" || { echo "[stand-in] synth-custom: no compiled library at $(RESULTS_DIR)/lc/generated.db; the library gate has not been passed" >&2; exit 2; };',
      'mkdir -p "$$out/report" "$(LOG_DIR)" "$(BUILD_DIR)";',
      'echo "[stand-in] synth-custom design=$(DESIGN) period=$(CLOCK_PERIOD_NS) container=$$EDA_CONTAINER_NAME" >> "$(LOG_DIR)/syn-custom.log";',
      'sleep $(STANDIN_SLEEP);',
      'cells=`wc -l < "$$src/cells.txt" | tr -d " "`;',
      'masters=`awk -v c="$$cells" -v f="$(ADOPTION_FLOOR)" -v d="$(CELLS_PER_MASTER)" \'BEGIN { printf "%d", (c >= f ? int(c / d) : 0) }\'`;',
      'instances=`awk -v m="$$masters" -v i="$(INSTANCES_PER_MASTER)" \'BEGIN { printf "%d", m * i }\'`;',
      'achievable=`awk -v a="$(ACHIEVABLE_NS)" -v m="$$masters" -v g="$(GAIN_PER_MASTER)" \'BEGIN { printf "%.4f", a * (1 - m * g) }\'`;',
      'period=`awk -v p="$(CLOCK_PERIOD_NS)" \'BEGIN { printf "%.2f", p }\'`;',
      'slack=`awk -v p="$(CLOCK_PERIOD_NS)" -v a="$$achievable" \'BEGIN { short = p - a; printf "%.2f", (short < 0 ? short : 0) }\'`;',
      'tns=`awk -v s="$$slack" \'BEGIN { printf "%.2f", (s < 0 ? s : 0) }\'`;',
      'hold="$(HOLD_VIOLATION)";',
      'printf \'%s\\n\'',
      ...customQor.map((line) => `"${line}"`),
      '> "$$out/report/qor.rpt";',
      ...writeJson([
        '  "stage": "synth-custom",',
        '  "inputs": { "design": "$(DESIGN)", "periodNs": $$period, "libraryCells": $$cells },',
        '  "adoptedInstances": $$instances,',
        '  "distinctMasters": $$masters',
      ], '"$$out/adoption.json"'),
      'printf \'%s\\n\' "$$masters" > "$(BUILD_DIR)/adopted-masters";',
      'echo "[stand-in] synth-custom adopted $$instances instance(s) of $$masters master(s) and closes at $$achievable ns" >> "$(LOG_DIR)/syn-custom.log"',
    ]),
    '',
    // The post-route arms, matched but for the library each was run with, each writing into a report
    // directory of its own. This is where the five-percent Goal is measured, so the margin here is
    // the measured one and is positive when the period is met: the `min(0, …)` above is Design
    // Compiler's behaviour on a met constraint and not a post-route summary's.
    'pnr:',
    recipe([
      'test -n "$$ARM" || { echo "[stand-in] pnr needs ARM=foundry|generated" >&2; exit 2; };',
      // The arm is what names this stage's output directory, so it is held to the two this flow has
      // before anything is made for it: a value that is neither is refused, not created.
      'case "$$ARM" in',
      'foundry) masters=0 ;;',
      'generated) test -f "$(BUILD_DIR)/adopted-masters" || { echo "[stand-in] pnr: the generated arm needs the adoption record at $(BUILD_DIR)/adopted-masters; run synth-custom first" >&2; exit 2; }; masters=`cat "$(BUILD_DIR)/adopted-masters"` ;;',
      '*) echo "[stand-in] pnr: unknown ARM \\"$$ARM\\"; this flow knows foundry and generated" >&2; exit 2 ;;',
      'esac;',
      'out="$(RESULTS_DIR)/pnr-$$ARM";',
      'mkdir -p "$$out" "$(LOG_DIR)";',
      'echo "[stand-in] pnr arm=$$ARM design=$(DESIGN) period=$(CLOCK_PERIOD_NS)" >> "$(LOG_DIR)/pnr-$$ARM.log";',
      'sleep $(STANDIN_SLEEP);',
      'critical=`awk -v a="$(ACHIEVABLE_NS)" -v m="$$masters" -v g="$(GAIN_PER_MASTER)" \'BEGIN { printf "%.4f", a * (1 - m * g) }\'`;',
      'period=`awk -v p="$(CLOCK_PERIOD_NS)" \'BEGIN { printf "%.2f", p }\'`;',
      'wns=`awk -v p="$$period" -v c="$$critical" \'BEGIN { printf "%.3f", p - c }\'`;',
      'tns=`awk -v w="$$wns" \'BEGIN { printf "%.3f", (w < 0 ? w : 0) }\'`;',
      'printf \'%s\\n\'',
      ...postRouteSummaryLines(design).map((line) => `"${line.replaceAll('"', '\\"')}"`),
      '> "$$out/postroute.summary";',
      ...writeJson([
        '  "stage": "pnr",',
        '  "inputs": { "design": "$(DESIGN)", "periodNs": $$period, "arm": "$$ARM" },',
        '  "adoptedMasters": $$masters,',
        '  "criticalPathNs": $$critical,',
        '  "wnsNs": $$wns',
      ], '"$$out/postroute.json"'),
      'echo "[stand-in] pnr arm=$$ARM closed at $$critical ns with $$masters adopted master(s)" >> "$(LOG_DIR)/pnr-$$ARM.log"',
    ]),
    '',
    // The verification session, one per arm and one checker invocation in it. Beside the DRC report
    // it writes the liveness pair the zero-adoption terminal turns on: whether the generated library
    // was in the library set before the session launched, and how many generated cells the restored
    // database answers with. "The mapper took none of it" and "the mapper never saw it" produce the
    // same adoption count and mean opposite things, and these two numbers are what tells them apart.
    'verify:',
    recipe([
      'test -n "$$ARM" || { echo "[stand-in] verify needs ARM=foundry|generated" >&2; exit 2; };',
      mustBeCount('verify', 'VERIFY_VIOLATIONS'),
      'case "$$ARM" in',
      'foundry) libset=false; cells=0; masters=0 ;;',
      'generated) test -f "$(RESULTS_DIR)/charlib/cells.txt" || { echo "[stand-in] verify: the generated arm needs the generated library at $(RESULTS_DIR)/charlib; run charlib first" >&2; exit 2; }; test -f "$(BUILD_DIR)/adopted-masters" || { echo "[stand-in] verify: the generated arm needs the adoption record at $(BUILD_DIR)/adopted-masters; run synth-custom first" >&2; exit 2; }; libset=true; cells=`wc -l < "$(RESULTS_DIR)/charlib/cells.txt" | tr -d " "`; masters=`cat "$(BUILD_DIR)/adopted-masters"` ;;',
      '*) echo "[stand-in] verify: unknown ARM \\"$$ARM\\"; this flow knows foundry and generated" >&2; exit 2 ;;',
      'esac;',
      'out="$(RESULTS_DIR)/verify-$$ARM";',
      'mkdir -p "$$out" "$(LOG_DIR)";',
      'viols=`awk -v v="$$VERIFY_VIOLATIONS" \'BEGIN { printf "%d", v }\'`;',
      'printf \'%s\\n\'',
      ...verifyDrcLines(design).map((line) => `"${line.replaceAll('"', '\\"')}"`),
      '> "$$out/verify_drc.rpt";',
      ...writeJson([
        '  "stage": "verify",',
        '  "inputs": { "design": "$(DESIGN)", "arm": "$$ARM", "violations": $$viols },',
        '  "librarySetBeforeLaunch": $$libset,',
        '  "generatedCellsAfterRestore": $$cells,',
        '  "adoptedMasters": $$masters,',
        '  "violations": $$viols',
      ], '"$$out/liveness.json"'),
      'echo "[stand-in] verify arm=$$ARM librarySet=$$libset generatedCells=$$cells violations=$$viols" >> "$(LOG_DIR)/verify-$$ARM.log"',
    ]),
    '',
  ];
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

// ---------------------------------------------------------------------------------------------
// The converging pack variant (#57): the reference pack with a push rule of its own, in its own
// `choosers/` folder
//
// Here, beside the flow it converges on, for the reason the flow itself is here: the suite, the
// screenshot tool and `pnpm run desktop --site local` all need "the reference pack with the
// over-constraining push", and three spellings of it would be three packs under test. The suite's
// `installOverConstraining` is a view over the writer below, exactly as its `writeStandinFlow` is a
// view over the one above.
//
// Why the variant exists at all (D45). The reference pack names `timing-push`, which asks a met
// period how much margin it had and pushes by the answer; the flow above reports none, so that rule
// loosens by its guard band every generation and converges on nothing. The reference pack keeps it
// — what its chooser should be is the step-4 pack authors' to say — so a Campaign that *reaches* an
// ending on this flow is a Campaign of this variant.
// ---------------------------------------------------------------------------------------------

/** The converging variant's pack id, which is also its directory name. */
export const CONVERGING_PACK_ID = 'over-constraining-probe';

/** The chooser that variant carries, by id. Since #57 the bundle ships no file for it: a push rule
 *  is the method a pack sells, and a method lives in the pack folder. */
export const OVER_CONSTRAINING_CHOOSER_ID = 'over-constraining-push';

/**
 * That chooser, as the variant's own `choosers/<id>.yml` (#57).
 *
 * Spelled here rather than shipped beside the bundle's `timing-push`, which is where it lived while
 * choosers resolved from one fixed directory. A pack folder resolves its own ids first now, so this
 * is a file the variant carries — and the header says so, because a person who opens it inside a
 * pack should not have to work out whether the harness put it there.
 */
export const overConstrainingChooserYaml = `# Pack data: this pack's own push rule, in its own \`choosers/\` folder, resolved ahead of anything
# the bundle ships (#57, D46). A chooser is data and never code (D38) — a person adjusts the rule
# here, beside the pack's graph, without reading TypeScript.
#
# Why this pack does not use the bundled push (D45). That rule asks a met period how much margin it
# had and pushes by the answer. A tool that reports no margin for a met period does not answer that
# question: it states a setup slack of exactly 0.00 whenever the period it was given is met, because
# it stops optimizing the moment the constraint is satisfied. So on such a tool that clause reads
# \`period − 0 + guardBand\` and loosens the period by the guard band every generation, which is the
# trace the step-3 acceptance on the reference site recorded (D45) — six generations walking from
# 2.28 ns out to 2.53 ns, converging on nothing.
#
# The method here never asks a met period what it had to spare. It asks for less than it believes is
# possible and lets the tool say by how much it was wrong:
#
# - The constraint PASSED — the tool said nothing about the margin, because a met period is all it
#   says. Take one step tighter and ask again; that is the over-constraining, and \`stepNs\` is how
#   coarse the walk in is.
# - The constraint FAILED — now the tool has stated something: the design missed by \`|slack|\`, so
#   \`period + |slack|\` is the period it can actually close at. Ask for one step less than that. The
#   next generation misses by that same step, states the same achievable period, and asks for the
#   same number again — two successive generations asking and measuring the same period, which is
#   what a pack's \`converge:\` calls having stopped learning. The violation is on record, which is
#   the fact the Campaign was run to find.
# - Both the constraint and the goal PASSED — the design closed and reached what the Run was for.
#   There is no next strategy; the decision is that the Goal is met.
#
# So a Campaign on this chooser ends \`ended-goal-met\` when the goal is reachable and
# \`ended-converged\` one step below the achievable period when it is not, on a tool that reports zero
# slack for a met period and on one that reports a real margin alike: the PASS clause never reads the
# margin, so it cannot be misled by a tool that has none to give.
id: ${OVER_CONSTRAINING_CHOOSER_ID}
version: '1'
title: Over-constrain the clock period by one step and read the violation

# The one number the pack binds, in its explore node's \`bind:\`: how far the walk in moves each
# generation while nothing is violated, and how far above the violated period the exploration settles.
parameter:
  name: stepNs
  unit: ns

# What is read out of the Run's latest observation: the period is the one the report stated and never
# the one the Run asked for, so a tool that clamped the period is not pushed against as if it had
# honoured the request.
reads:
  period: { type: clock_period, unit: ns }
  slack: { type: setup_wns, unit: ns }

# First matching \`when\` wins. \`constraint\` is the verdict of the judge node's first rule — the one
# the outgoing edge was chosen by — and \`goal\` the verdict of its goal rule.
# \`next\` sets this pack's own strategy knobs by name, and a knob it does not name carries over.
# \`/hima pack check\` holds every one of them against the contract beside this file.
decide:
  - when: { constraint: PASS, goal: PASS }
    goalMet: true
  - when: { constraint: PASS }
    next:
      periodNs: { sum: [period, { neg: stepNs }] }
  - when: { constraint: FAIL }
    next:
      periodNs: { sum: [period, { abs: slack }, { neg: stepNs }] }
`;

/**
 * The `chooser:` and `bind:` lines the reference pack's `graph.yml` states for its explore node, and
 * the ones the converging variant states instead. The reference guard band is 0.05 ns and this
 * step is the same 0.05 ns, so the two packs differ in method and in nothing else.
 *
 * A literal `[from, to]` pair, applied by `writeConvergingVariant` below, which throws naming what
 * it looked for: the day `graph.yml` re-indents this block is the day this constant is edited, not
 * the day a variant quietly stopped varying anything.
 */
export const CONVERGING_GRAPH_LINES: readonly [string, string] = [
  `      chooser: timing-push
      bind:
        guardBandNs: 0.05`,
  `      chooser: ${OVER_CONSTRAINING_CHOOSER_ID}
      bind:
        stepNs: 0.05`,
];

export interface ConvergingVariantRequest {
  /** The pack folder to vary: the reference pack, wherever it is shipped or installed. */
  readonly from: string;
  /** Where the variant goes. Its directory name is the variant's pack id, in both of its files. */
  readonly to: string;
}

/**
 * Write the reference pack again as the converging variant: the same contract, the same graph but
 * for the explore node's chooser, and that chooser carried in the variant's own `choosers/` folder.
 *
 * Generated privately, then installed through the same method manifest as the reference Pack.
 * Customer assets and previous methods survive a generated variant update too.
 *
 * @param req - the pack to vary and where to put it.
 * @returns the variant's pack id and directory.
 * @throws when the pack varied from does not hold the lines this varies, which is a copy of that
 *         pack's own file having drifted rather than a variant that varied nothing.
 */
export async function writeConvergingVariant(req: ConvergingVariantRequest): Promise<{ readonly id: string; readonly dir: string }> {
  const destination = path.resolve(req.to);
  const id = path.basename(destination);
  await mkdir(path.dirname(destination), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(destination), '.hima-variant-'));
  const dir = path.join(staging, id);
  try {
    exportPackMethod({ from: path.resolve(req.from), to: dir });
    // This generated derivative has not run its own authoring pipeline. The original pack's test
    // record and seal cannot certify the different method below.
    for (const file of Object.values(pipelineFiles)) await rm(path.join(dir, file), { force: true });
    // A pack's declared id is its directory name, in both files.
    for (const file of ['contract.yml', 'graph.yml']) {
      const at = path.join(dir, file);
      const text = await readFile(at, 'utf8');
      const renamed = text.replace(/^id: .+$/m, `id: ${id}`);
      if (renamed === text) throw new Error(`${at} holds no "id:" line to rename to ${id}`);
      await writeFile(at, renamed);
    }
    const graphAt = path.join(dir, 'graph.yml');
    const graph = await readFile(graphAt, 'utf8');
    const [needle, replacement] = CONVERGING_GRAPH_LINES;
    if (!graph.includes(needle) && !graph.includes(replacement)) throw new Error(`${graphAt} holds no explore node stating\n${needle}\nto vary onto ${OVER_CONSTRAINING_CHOOSER_ID}`);
    await writeFile(graphAt, graph.replace(needle, replacement));
    await mkdir(path.join(dir, 'choosers'), { recursive: true });
    await writeFile(path.join(dir, 'choosers', `${OVER_CONSTRAINING_CHOOSER_ID}.yml`), overConstrainingChooserYaml);
    installPackMethod({ from: dir, to: destination });
    return { id, dir: destination };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
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
  /** The converging variant's directory inside the home, beside the reference pack (#57). */
  readonly convergingPackDir: string;
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
 * `did` also says which stages the flow answers (#60). The makefile is the flow, so what a seeded
 * home can run is whatever that makefile has targets for, and a person who has just been given a
 * home should be told what they are rather than having to read the file.
 *
 * Pack updates replace only verified method files and preserve run-assets plus original method
 * snapshots. Unknown ownership, changed content at the same version and interrupted updates refuse
 * installation. The generated flow and two Site files are refreshed; the workspace root is created
 * when absent and otherwise left intact.
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
  installPackMethod({ from: shippedPack, to: packDir });
  did.push(`local site: installed the shipped pack ${TIMING_PROBE_PACK_ID} into ${packDir}`);

  // Keep the named variant for existing fixtures and saved selections. The shipped v2 Pack
  // already uses this corrected method; both identities carry their chooser inside the Pack.
  const converging = await writeConvergingVariant({ from: shippedPack, to: path.join(packsDir, CONVERGING_PACK_ID) });
  did.push(`local site: installed the converging variant ${converging.id} into ${converging.dir}, which carries ${OVER_CONSTRAINING_CHOOSER_ID} in its own choosers/`);
  did.push(`local site: pick ${converging.id} on the start form to watch a campaign converge; the shipped ${TIMING_PROBE_PACK_ID} also uses the corrected method`);

  const localDir = path.join(home, LOCAL_DIR);
  const flow = await writeStandinFlow({ root: path.join(localDir, 'standin-flow') });
  did.push(`local site: generated the stand-in flow at ${flow.root}`);
  did.push(`local site: the stand-in computes its own qor report per generation, closing at ${flow.achievableNs.toFixed(2)} ns; these are simulated values, not measured EDA results`);
  did.push(`local site: the stand-in answers these stages: ${flow.stages.join(', ')}`);

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

  return { site, flow, packDir, convergingPackDir: converging.dir, workspaceRoot, did };
}
