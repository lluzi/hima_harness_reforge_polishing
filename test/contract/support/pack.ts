// Contract-test support: install the shipped HimaPack into the isolated home, and vary it.
//
// Packs live in the repository under `packs/` and are installed into the harness home's `hima/packs/`
// the way a customer's CAD would install one, which is also how the bundle's `packsDir` config finds
// them. The tests exercise the pack the repository ships, byte for byte, rather than a fixture that
// merely resembles it.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HimaHome } from './dsh-home.ts';
import { repoRoot } from './dsh-home.ts';
import { OVER_CONSTRAINING_CHOOSER_ID, overConstrainingChooserYaml, writeConvergingVariant } from '../../../packages/desktop/src/local-site.ts';
import { snapshotPackFolder } from '@hima/harness';

/** The pack directory the repository ships. */
export const shippedPacksDir = path.join(repoRoot, 'packs');

/** The one pack step 2 runs. */
export const timingProbePackId = 'opene902-timing-probe';
/** Method identity of the shipped contract and graphs derived from it. */
export const timingProbePackVersion = '2';

/**
 * The `words:` block the shipped contract declares (#42), spelled here so a test can vary the pack
 * into one declaring a word for a name it does not use, or into one that says nothing about its
 * Goal's own parameter — a block holding the knob's line alone, which is how `loop.test.ts` reads
 * the fallback to the name the wire carries.
 *
 * Not into one declaring no words at all. Since the Strategy became the pack's (#58) a knob with no
 * word is a pack `/hima pack check` refuses — a knob is the pack's own invention and there is
 * nothing else a person could read it under — so `[shippedWordsBlock, 'words: {}']`, which this
 * comment once offered, is a variant that now starts no Run.
 *
 * A copy of two lines of the shipped file, held true by `writePackVariant` itself: a needle that is
 * no longer there throws naming what it looked for, so the day these words are re-spelled is the day
 * this constant is edited rather than the day a variant quietly stopped varying anything.
 */
export const shippedWordsBlock = `words:
  target_period_ns: { label: clock period at most, unit: ns }
  periodNs: { label: clock period, unit: ns }`;

export interface InstalledPack { readonly id: string; readonly packsDir: string; readonly dir: string }

/** Where the bundle's `packsDir` config points inside an isolated home. */
export const packsDirOf = (h: HimaHome): string => path.join(h.home, 'hima/packs');

/** Install a shipped pack into the isolated home, copied byte for byte. */
export async function installPack(h: HimaHome, id: string = timingProbePackId): Promise<InstalledPack> {
  const packsDir = packsDirOf(h);
  const dir = path.join(packsDir, id);
  await mkdir(packsDir, { recursive: true });
  await cp(path.join(shippedPacksDir, id), dir, { recursive: true });
  return { id, packsDir, dir };
}

/**
 * The installed pack again under a new id, with one thing about it changed: a tool that runs a
 * command the Site will not allow, a contract missing an output. Varying the shipped pack rather
 * than writing a fresh one is what makes such a test mean anything — the pack under test is the one
 * the repository ships, differing only where the test says it differs.
 *
 * @param packsDir - the installed packs directory, from `installPack`.
 * @param newId - the variant's pack id, which is also its directory name.
 * @param contractReplacements - literal `[from, to]` substitutions applied to `contract.yml`.
 * @param graphReplacements - literal `[from, to]` substitutions applied to `graph.yml`.
 * @param from - the pack to vary.
 * @param files - files written into the variant's own folder, keyed by their path inside it
 *                (`choosers/<id>.yml`, `knowledge/<name>.md`). Since #57 a pack folder carries its
 *                own rules, choosers, readers and knowledge, so a variant that needs one brings it
 *                rather than expecting the bundle to ship it.
 * @returns the contract text written, so the caller can assert its variation is really in it.
 */
export async function writePackVariant(
  packsDir: string,
  newId: string,
  contractReplacements: readonly (readonly [string, string])[],
  graphReplacements: readonly (readonly [string, string])[] = [],
  from: string = timingProbePackId,
  files: Readonly<Record<string, string>> = {},
): Promise<string> {
  const dir = path.join(packsDir, newId);
  await cp(path.join(packsDir, from), dir, { recursive: true });
  await writePackFiles(dir, files);
  // A pack's declared id is its directory name, in both files, so the copy is renamed before anything
  // else is varied.
  for (const file of ['contract.yml', 'graph.yml']) {
    const at = path.join(dir, file);
    const text = await readFile(at, 'utf8');
    if (!text.includes(`id: ${from}`)) throw new Error(`${file} of pack ${from} holds no "id: ${from}" to rename`);
    await writeFile(at, text.replace(`id: ${from}`, `id: ${newId}`));
  }
  const contract = await vary(path.join(dir, 'contract.yml'), contractReplacements, 'contract');
  await vary(path.join(dir, 'graph.yml'), graphReplacements, 'graph');
  return contract;
}

/**
 * Write files into a pack folder, each under the path it is keyed by (#57): `choosers/<id>.yml`,
 * `rules/<id>.yml`, `readers/<id>.yml`, `knowledge/<name>.md`. The directories are made as needed,
 * so a pack that carried none of them gains the one the caller is giving it.
 */
export async function writePackFiles(packDir: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [at, text] of Object.entries(files)) {
    const file = path.join(packDir, at);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

/** One pack file with its substitutions applied. A needle that is not there is the test's own
 *  mistake and says so, rather than silently writing the file back unvaried. */
async function vary(at: string, replacements: readonly (readonly [string, string])[], what: string): Promise<string> {
  let text = await readFile(at, 'utf8');
  for (const [needle, replacement] of replacements) {
    if (!text.includes(needle)) throw new Error(`the shipped ${what} holds no "${needle}" to vary`);
    text = text.replace(needle, replacement);
  }
  await writeFile(at, text);
  return text;
}

// ---------------------------------------------------------------------------------------------
// The drill-down variant (#28): a pack whose Explore node opens a Loop of its own
//
// Here rather than in the one test file that drives it, because the screenshot tool photographs the
// same pack (`scripts/workbench-screenshot.ts --pack-variant drill-down`) and a picture of a
// different graph than the suite runs would be a picture of something nobody tested.
// ---------------------------------------------------------------------------------------------

/** The drill-down variant's pack id, which is also its directory name. */
export const drillDownPackId = 'drill-down';

/**
 * The graph of a pack whose Explore node drills down: the four nodes the shipped pack runs inline
 * are a loop called `push` here, and the outer graph is one Explore node that opens it, one act node
 * that reads the report the loop left, and the wait node a `generation-limit` leads to.
 *
 * Written whole rather than patched into the shipped `graph.yml`, because a graph with a loop in it
 * is a different shape and not a different line. The *contract* is the shipped one, byte for byte
 * (`writePackVariant` copies it), so the tools, the outputs and the licences this runs on are the
 * pack the repository ships.
 *
 * The loop applies the shipped over-constraining method. Its closure is an exploration
 * ending, not evidence that the unreachable Goal was met.
 *
 * @param id - the variant's pack id, which its `graph.yml` must declare.
 * @param generationLimit - what the loop's own `converge` allows it.
 */
export const drillDownGraph = (id: string, generationLimit: number): string => `# A pack that drills down: the timing push is a loop of its own, opened by the outer graph's one
# explore node, and the outer graph goes on when that loop has closed.
id: ${id}
version: '${timingProbePackVersion}'
entry: probe

nodes:
  # Explore: opens the loop rather than applying a chooser. Its outgoing edges are labelled by the
  # outcome the loop closed with.
  - id: probe
    kind: explore
    parameters:
      opens: push

  # Act: read what the loop's last generation left, once the loop has closed.
  - id: final-read
    kind: act
    parameters:
      observes: qorReport

  - id: blocked
    kind: wait
    parameters:
      blocker: hard-blocker

edges:
  - { from: probe, to: final-read, outcome: converged }
  - { from: probe, to: blocked, outcome: generation-limit }

loops:
  push:
    entry: synthesize
    nodes:
      - id: synthesize
        kind: act
        parameters:
          tool: synth
          arguments:
            PERIOD_NS: { from: strategy, name: periodNs }

      - id: read-qor
        kind: act
        parameters:
          observes: qorReport

      - id: judge
        kind: judge
        parameters:
          rules:
            - setup-wns-all-nonnegative
            - clock-period-at-most
          bind:
            target_period_ns: { from: goal, name: target_period_ns }

      - id: next-period
        kind: explore
        parameters:
          chooser: over-constraining-push
          bind:
            stepNs: 0.05
          converge:
            read: period
            band: 0.05
            generations: 1
            generationLimit: ${String(generationLimit)}

    edges:
      - { from: synthesize, to: read-qor }
      - { from: read-qor, to: judge }
      - { from: judge, to: next-period, outcome: PASS }
      - { from: judge, to: next-period, outcome: FAIL }
      - { from: next-period, to: synthesize, revisit: true }
`;

/** Install the drill-down variant into a booted home, and answer its pack id. */
export async function installDrillDown(packsDir: string, id: string, generationLimit: number): Promise<string> {
  // Its loop's explore node names `over-constraining-push`, which since #57 no pack finds in the
  // bundle: this variant carries the file the converging variant carries.
  await writePackVariant(packsDir, id, [], [], timingProbePackId, { [`choosers/${OVER_CONSTRAINING_CHOOSER_ID}.yml`]: overConstrainingChooserYaml });
  await writeFile(path.join(packsDir, id, 'graph.yml'), drillDownGraph(id, generationLimit));
  return id;
}

// ---------------------------------------------------------------------------------------------
// The fork variant (#29): a pack whose entry node branches into two syntheses and one join
//
// Here rather than in the one test file that drives it, for the reason the drill-down variant is:
// the screenshot tool photographs the same pack (`scripts/workbench-screenshot.ts --pack-variant
// fork-join`), and a picture of a different graph than the suite runs would be a picture of
// something nobody tested.
// ---------------------------------------------------------------------------------------------

/** The fork variant's pack id, which is also its directory name. */
export const forkJoinPackId = 'fork-join';

/** What the second branch synthesizes at when nothing else says: 0.2 ns looser than this stand-in
 *  flow closes at, so the two branches ask for two periods and read two reports. */
export const forkLooserNs = 2.2;

/**
 * The graph of a pack that forks: one entry that reads what the workspace was prepared with, two
 * branches of synthesis-and-read run at once, and one judge node that waits for both.
 *
 * The entry launches nothing on purpose. A fork is edges and not a node kind, so something has to
 * draw them — and a fork source that ran a Job of its own would put a third Job in a Run whose whole
 * subject is that its two branches hold one each at the same moment. Reading the summary the
 * workspace copy already carries costs nothing and is a real act node doing a real thing.
 *
 * Branch `synthesize` asks for the Strategy's own period; branch `synth-b` asks for a period 0.2 ns
 * looser, fixed in the file, and writes its report under its own `RESULT_TAG`, so the two branches
 * synthesize into two report directories and neither reads the other's.
 *
 * @param id - the variant's pack id, which its `graph.yml` must declare.
 * @param looserNs - the literal period branch `synth-b` synthesizes at.
 */
export const forkGraph = (id: string, looserNs: number): string => `# A pack that forks: two syntheses at two periods, run at once, judged together.
id: ${id}
version: '${timingProbePackVersion}'
entry: start

nodes:
  # Act: read what this campaign's workspace was prepared with. The fork's source — it draws the two
  # unlabelled edges below — and it launches nothing, so the only jobs this run has are its branches'.
  - id: start
    kind: act
    parameters:
      observes: flowSummary

  # Branch one: the strategy's own period.
  - id: synthesize
    kind: act
    parameters:
      tool: synth
      arguments:
        PERIOD_NS: { from: strategy, name: periodNs }

  - id: read-qor
    kind: act
    parameters:
      observes: qorReport

  # Branch two: a period fixed by the pack, 0.2 ns looser, written under RESULT_TAG=b.
  - id: synth-b
    kind: act
    parameters:
      tool: synth-b
      arguments:
        PERIOD_NS: ${looserNs.toFixed(2)}

  - id: read-qor-b
    kind: act
    parameters:
      observes: qorReportB

  # The join: two incoming edges, so the run waits for both branches and judges each one's reading.
  - id: judge
    kind: judge
    parameters:
      rules:
        - setup-wns-all-nonnegative
        - clock-period-at-most
      bind:
        target_period_ns: { from: goal, name: target_period_ns }

  - id: blocked
    kind: wait
    parameters:
      blocker: hard-blocker

edges:
  - { from: start, to: synthesize }
  - { from: start, to: synth-b }
  - { from: synthesize, to: read-qor }
  - { from: read-qor, to: judge }
  - { from: synth-b, to: read-qor-b }
  - { from: read-qor-b, to: judge }
`;

/** The two outputs and the second tool the forking graph needs, added to the shipped contract. */
export const contractForFork: readonly (readonly [string, string])[] = [
  [
    `  - name: synthesisLog`,
    `  - name: qorReportB
    path: flow/results/\${design}/syn/report-b/qor.rpt
    reader: dc-qor-report
    description: The qor report the second branch's synthesis wrote, under its own RESULT_TAG.
  - name: flowSummary
    path: flow/build/\${design}/summary.txt
    description: What the campaign workspace was prepared with. Read by the entry node, before the fork.
  - name: synthesisLog`,
  ],
  [
    `# Every rule this pack's judge nodes may apply`,
    `  - id: synth-b
    file: tools/synth-b.sh
    description: >-
      The second branch's synthesis: the same flow at the period the graph fixes, writing its report
      under RESULT_TAG=b so the two branches never read one another's.
    inputs: [WORKSPACE, FLOW_ROOT, DESIGN, PERIOD_NS, CAMPAIGN]
    licences:
      Design-Compiler: 1
    argv:
      - make
      - -C
      - \${WORKSPACE}/flow
      - DESIGN=\${DESIGN}
      - synth
      - CLOCK_PERIOD_NS=\${PERIOD_NS}
      - FORCE_SYNTH=1
      - EDA_CONTAINER_NAME=hima-\${CAMPAIGN}
      - RESULT_TAG=b

# Every rule this pack's judge nodes may apply`,
  ],
];

/** The second branch's tool script: the command line the contract declares, for a person to run. */
export const synthBScript = `#!/bin/sh
# The \`synth-b\` tool of the fork variant: the second branch's synthesis, at the period the graph
# fixes, writing its report under RESULT_TAG=b so the two branches never read one another's.
set -eu
exec make -C "$WORKSPACE/flow" DESIGN="$DESIGN" synth CLOCK_PERIOD_NS="$PERIOD_NS" FORCE_SYNTH=1 EDA_CONTAINER_NAME="hima-$CAMPAIGN" RESULT_TAG=b
`;

/** Install the forking variant into a booted home, and answer its pack id. */
export async function installFork(packsDir: string, id: string, looserNs: number): Promise<string> {
  await writePackVariant(packsDir, id, contractForFork);
  await writeFile(path.join(packsDir, id, 'graph.yml'), forkGraph(id, looserNs));
  await writeFile(path.join(packsDir, id, 'tools', 'synth-b.sh'), synthBScript);
  return id;
}

// ---------------------------------------------------------------------------------------------
// The two-knob variant (#58): a pack whose contract declares a number knob and a choice knob
//
// Here rather than in the one test file that drives it, for the reason the drill-down and fork
// variants are here: a variant the suite runs is a variant anything else photographing the product
// must be able to run too, and a second spelling of it would be a second pack.
// ---------------------------------------------------------------------------------------------

/** The two-knob variant's pack id, which is also its directory name. */
export const twoKnobPackId = 'two-knob-strategy';

/** The chooser that variant carries in its own `choosers/` folder (#57). */
export const twoKnobChooserId = 'test-profile-by-outcome';

/**
 * The suite's own fixture for a chooser that sets a knob of each kind (#58), as the two-knob
 * variant's own `choosers/<id>.yml` (#57).
 *
 * It lived beside the bundle's `timing-push` while choosers resolved from one fixed directory, which
 * put a test fixture in the product. A pack folder resolves its own ids first now, so the variant
 * that names it carries it — and the header says so, as a pack's own file should.
 */
export const twoKnobChooserYaml = `# Pack data: this pack's own chooser, in its own \`choosers/\` folder (#57). It is the contract
# suite's fixture for a chooser that sets a knob of each kind (#58) — it tightens a number knob when
# the constraint passes, and sets a choice knob to one of its own declared words when the constraint
# fails — so one Run shows both kinds of knob changing, which is what the suite has to be able to
# drive.
#
# The push is deliberately past what is achievable rather than short of it: \`period − slack − guardBand\`
# walks the period *in* by the whole guard band on a met constraint, and this pack binds a band wide
# enough to overshoot the stand-in's headroom in one move (#54, #58), so a campaign that passes once
# fails next. Reading \`slack\` at all is what makes this a chooser and not a counter: on a flow that
# reports a real margin for a met period it takes the margin back too. The bundle's \`timing-push\` is
# the rule a real pack wants; this is the shape a test wants.
id: ${twoKnobChooserId}
version: '1'
title: Tighten the period on a met constraint, and change profile on a violated one

parameter:
  name: guardBandNs
  unit: ns

reads:
  period: { type: clock_period, unit: ns }
  slack: { type: setup_wns, unit: ns }

decide:
  - when: { constraint: PASS, goal: PASS }
    goalMet: true
  # Passed: push past what was measured by the guard band, and leave the profile where it is.
  - when: { constraint: PASS }
    next:
      periodNs: { sum: [period, { neg: slack }, { neg: guardBandNs }] }
  # Violated: the period stays and the profile changes, which is the knob a literal sets.
  - when: { constraint: FAIL }
    next:
      profile: dense
`;

/**
 * The `strategy:` block the shipped contract declares (#58), spelled here so a test can vary the
 * pack into one declaring a second knob — or into one declaring a knob nothing gives words for.
 *
 * A copy of three lines of the shipped file, held true by `writePackVariant` itself: a needle that
 * is no longer there throws naming what it looked for.
 */
export const shippedStrategyBlock = `strategy:
  periodNs: { type: number, unit: ns, min: 0.5, max: 10, default: 2.30 }`;

/** The two-knob variant's own declaration: the shipped number knob, and a profile chosen from a list. */
export const twoKnobStrategyBlock = `strategy:
  periodNs: { type: number, unit: ns, min: 0.5, max: 10, default: 2.40 }
  profile: { type: choice, options: [plain, balanced, dense], default: plain }`;

/** Its words: the shipped two, and one for the choice knob — which states no unit, because a profile
 *  is not measured in anything. */
export const twoKnobWordsBlock = `words:
  target_period_ns: { label: clock period at most, unit: ns }
  periodNs: { label: clock period, unit: ns }
  profile: { label: mining profile }`;

/**
 * The guard band this variant's explore node binds, and the shipped line it replaces.
 *
 * The step has to be bigger than the headroom, which is what makes this a *short* Run: the stand-in
 * reports slack the way Design Compiler does (#54), nothing at all for a period it meets, so the
 * suite's chooser tightens by exactly this band a generation until one lands below the 2.20 ns the
 * flow closes at. 2.40 declared minus 0.25 bound is 2.15, which violates — so the second generation
 * is where the choice knob moves, and the third is where the Run converges. A band of the shipped
 * 0.05 would take six generations to get there and show the same two things.
 */
export const twoKnobGuardBand: readonly [string, string] = ['stepNs: 0.05', 'guardBandNs: 0.25'];

/**
 * Install the two-knob variant into a booted home, and answer its pack id.
 *
 * The shipped pack with four things varied: a second knob on the contract, a word for it, an explore
 * node that applies the suite's own chooser — the one that tightens the number knob on a PASS and
 * sets the choice knob on a FAIL, so one Run shows both kinds of knob changing — and the guard band
 * that chooser tightens by, which is what makes one PASS enough to reach the FAIL.
 */
export async function installTwoKnobs(packsDir: string, id: string = twoKnobPackId): Promise<string> {
  await writePackVariant(
    packsDir,
    id,
    [[shippedStrategyBlock, twoKnobStrategyBlock], [shippedWordsBlock, twoKnobWordsBlock]],
    [['chooser: over-constraining-push', `chooser: ${twoKnobChooserId}`], twoKnobGuardBand],
    timingProbePackId,
    { [`choosers/${twoKnobChooserId}.yml`]: twoKnobChooserYaml },
  );
  return id;
}

// ---------------------------------------------------------------------------------------------
// Method variants. The normal shipped Pack is version 2 on over-constraining-push.
// Legacy timing-push remains an explicitly named counterexample, never a global test default.
// ---------------------------------------------------------------------------------------------

/** The chooser that variant carries in its own folder (#57): over-constrain by a step, read the
 *  violation. The bundle ships no file for it. */
export const overConstrainingChooserId = OVER_CONSTRAINING_CHOOSER_ID;
export const legacyTimingPushPackId = 'legacy-timing-push-probe';

/** The explicit legacy method binding; also used to test pack-over-bundle resolution. */
export const graphForLegacyTimingPush: readonly (readonly [string, string])[] = [[
    `      chooser: over-constraining-push
      bind:
        stepNs: 0.05`,
    `      chooser: timing-push
      bind:
        guardBandNs: 0.05`,
  ]];

/** Explicit legacy method, keeping all other current Pack inputs and tools unchanged. */
export async function installLegacyTimingPush(packsDir: string, id: string = legacyTimingPushPackId): Promise<string> {
  await writePackVariant(packsDir, id, [], graphForLegacyTimingPush);
  return id;
}
/**
 * Install the reference pack varied onto `over-constraining-push`, and answer its pack id.
 *
 * @param packsDir - the installed packs directory, from `installPack`.
 * @param id - the variant's pack id, which is also its directory name.
 * @returns the variant's pack id, so a caller reads `await installOverConstraining(...)` as the pack
 *          it is about to run.
 */
export async function installOverConstraining(packsDir: string, id: string): Promise<string> {
  const written = await writeConvergingVariant({ from: path.join(packsDir, timingProbePackId), to: path.join(packsDir, id) });
  return written.id;
}

// ---------------------------------------------------------------------------------------------
// The pack-reader variant (#61): a pack whose output is read by a script of its own
//
// Here rather than in the one test file that drives it, for the reason every variant above is here:
// a variant the suite runs is one anything else photographing the product must be able to run too,
// and a second spelling of it would be a second pack.
// ---------------------------------------------------------------------------------------------

/** The reader this variant carries: the id of `readers/<id>.yml` and of `tools/<id>.sh`. */
export const packReaderId = 'count-candidates';

/** Where that reader's script lives inside the pack folder, as its declaration names it. */
export const packReaderFile = `tools/${packReaderId}.sh`;

/** The value types the reader emits and the pack's own `semantics.yml` declares.
 *
 *  Two, because one of them has to carry qualifiers: `mode` and `scope` are the harness's two fixed
 *  vocabularies, a declaration says which words a value of a type must carry, and a fixture whose
 *  every value carried none would leave the whole qualifier half of the validator undriven. */
export const candidateCountType = 'candidate_count';
export const candidateSlackType = 'candidate_slack';

/** What the reader reads out of the mining report for each: the count as the report states it, and
 *  the slack the mined candidates were held to, which the reader derives from that count. */
export const MINED_SLACK_NS = -0.08;
export const MINED_SLACK_MODE = 'setup';
export const MINED_SLACK_SCOPE = 'reg2reg';

/** The route the variant's mining stage is run for, and the profile and cap it is run under: the
 *  stand-in yields `min(TOP_N, base(PROFILE) + factor(ROUTE))`, and `steady` bases at 12, so the cap
 *  is what decides — one number this suite can state without re-deriving the flow's arithmetic. */
export const MINED_ROUTE = 'timing';
export const MINED_TOP_N = 8;

/** The pack-local rule the judge node applies: at least one candidate, in the reader's own type. */
export const candidatesRuleId = 'candidates-at-least';

const candidatesRuleYaml = `# Pack data: this pack's own rule, over the value type its own reader emits and its own
# \`semantics.yml\` declares (#61). The bundle ships nothing that speaks of candidates.
id: ${candidatesRuleId}
version: '1'
title: The mining stage yielded at least one candidate
requires:
  - { type: ${candidateCountType} }
subject: { type: ${candidateCountType} }
predicate: { op: gte, threshold: 1, unit: count }
`;

/** The pack's own semantics: two value types the harness has never heard of, with their units, and
 *  the qualifier words a value of the second must carry. */
export const packSemanticsYaml = `# What this pack's own readers emit, and what each value type is measured in (#61). Resolved ahead
# of the bundle's \`semantics.yml\`, so a pack brings the vocabulary of its own method with it.
values:
  ${candidateCountType}:
    unit: count
    description: how many cell candidates a mining stage yielded
  ${candidateSlackType}:
    unit: ns
    mode: [${MINED_SLACK_MODE}]
    scope: [all, ${MINED_SLACK_SCOPE}]
    description: the slack the candidates of a mining stage were held to, in the pass and path group it names
`;

/**
 * The reader script: POSIX sh over the JSON the mining stage wrote, out to the file the harness
 * chose. `$1` is the report and `$2` the output, which is what the declaration's `argv` gives it.
 */
export const packReaderScript = `#!/bin/sh
# This pack's own reader (#61): read the candidate count out of a mining stage's report and write
# the two values the declaration says this reader emits — the count itself, and the slack those
# candidates were held to, which carries the analysis pass and the path group it belongs to.
# Launched by the harness as a job under the site's permit, with the report and the output file
# named on the command line.
set -eu
report="$1"
out="$2"
count=\`sed -n 's/.*"count"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$report" | head -n 1\`
test -n "$count" || { echo "[count-candidates] no \\"count\\": <n> line in $report" >&2; exit 3; }
slack=\`awk -v c="$count" 'BEGIN { printf "%.2f", -0.01 * c }'\`
printf '{ "values": [ { "type": "${candidateCountType}", "unit": "count", "value": %s }, { "type": "${candidateSlackType}", "unit": "ns", "value": %s, "mode": "${MINED_SLACK_MODE}", "scope": "${MINED_SLACK_SCOPE}" } ] }\\n' "$count" "$slack" > "$out"
`;

/** The mining tool's script: the command line the contract declares, for a person to run by hand. */
const mineScript = `#!/bin/sh
# The \`mine\` tool of the pack-reader variant: one mining stage of the stand-in flow, inside the
# campaign's own copy of it.
set -eu
exec make -C "$WORKSPACE/flow" DESIGN="$DESIGN" mine ROUTE=${MINED_ROUTE} PROFILE=steady TOP_N=${String(MINED_TOP_N)} CLOCK_PERIOD_NS="$PERIOD_NS"
`;

/** The declaration of that reader, with whatever this variant is varying in it. */
const packReaderYaml = (emits: readonly string[]): string => `# Pack data: this pack's own reader (#61). A script in the pack's tools folder, shipped to the site
# and launched as a job under the permit, whose JSON output is validated against the value types
# declared here and the semantics they resolve to.
id: ${packReaderId}
version: '1'
file: ${packReaderFile}
argv: [sh, '\${READER}', '\${REPORT}', '\${OUT}']
reportKind: standin-candidates
emits: [${emits.join(', ')}]
`;

/**
 * What a variant of this pack may vary: the script it runs, the value types its declaration says
 * that script emits, the semantics those types are declared in, and the graph a Campaign of it
 * walks. Each is the one above unless the caller states otherwise.
 *
 * Four and not more: what a *declaration* can be wrong about — an argv word that would expand, a
 * file outside the pack's tools folder, a wrapper the contract never promised — is refused before a
 * Campaign exists, so those variants are `/hima pack check`'s to drive and live beside it in
 * `pack.test.ts`. What is here is what can only be found out by running one, and the graph is here
 * because which reader a Run actually reaches is a fact about the graph: a pack whose semantics
 * redeclare a *bundled* value type has to walk to a node that reads a report with a bundled reader
 * before anything can be said about whose declaration won.
 */
export interface PackReaderVariation {
  readonly script?: string;
  readonly emits?: readonly string[];
  readonly semantics?: string;
  readonly graph?: (id: string) => string;
}

/** The graph of the pack-reader variant: mine, read it with the pack's own reader, judge it. */
export const packReaderGraph = (id: string): string => `# A pack whose output is read by a script of its own (#61): mine a route's candidates, read the
# report with the pack's own reader, and judge the value that reader emitted.
id: ${id}
version: '${timingProbePackVersion}'
entry: mine

nodes:
  - id: mine
    kind: act
    parameters:
      tool: mine
      arguments:
        PERIOD_NS: { from: strategy, name: periodNs }

  - id: read-candidates
    kind: act
    parameters:
      observes: candidates

  - id: judge
    kind: judge
    parameters:
      rules:
        - ${candidatesRuleId}

  - id: blocked
    kind: wait
    parameters:
      blocker: hard-blocker

edges:
  - { from: mine, to: read-candidates }
  - { from: read-candidates, to: judge }
`;

/** The shipped contract's lines this variant replaces, spelled here so `writePackVariant` throws the
 *  day one of them is re-spelled rather than silently varying nothing. */
const contractForPackReader = (): readonly (readonly [string, string])[] => [
  [
    '  - name: synthesisLog',
    `  - name: candidates
    path: flow/results/\${design}/mine-${MINED_ROUTE}/candidates.json
    reader: ${packReaderId}
    description: The candidate set the mining stage wrote, read by this pack's own reader script.
  - name: synthesisLog`,
  ],
  [
    'environment:\n  wrappers:\n    - make',
    'environment:\n  wrappers:\n    - make\n    - sh',
  ],
  [
    '# Every rule this pack\'s judge nodes may apply',
    `  - id: mine
    file: tools/mine.sh
    description: >-
      One mining stage of the stand-in flow, at the strategy's clock period, inside the campaign's
      own copy of the flow.
    inputs: [WORKSPACE, DESIGN, PERIOD_NS]
    argv:
      - make
      - -C
      - \${WORKSPACE}/flow
      - DESIGN=\${DESIGN}
      - mine
      - ROUTE=${MINED_ROUTE}
      - PROFILE=steady
      - TOP_N=${String(MINED_TOP_N)}
      - CLOCK_PERIOD_NS=\${PERIOD_NS}

# Every rule this pack's judge nodes may apply`,
  ],
  ['  - setup-wns-all-nonnegative', `  - ${candidatesRuleId}\n  - setup-wns-all-nonnegative`],
  [shippedWordsBlock, 'words:\n  periodNs: { label: clock period, unit: ns }'],
];

/**
 * Install the pack-reader variant into a booted home, and answer its pack id.
 *
 * The shipped pack with a mining tool, an output at what that tool writes, a reader of its own for
 * that output, the semantics that reader's one value type is declared in, and a pack-local rule over
 * it. Everything else is the pack the repository ships.
 *
 * @param packsDir - the installed packs directory, from `installPack`.
 * @param id - the variant's pack id, which is also its directory name.
 * @param vary - what this variant varies from the one above, for the negatives.
 */
export async function installPackReader(packsDir: string, id: string, vary: PackReaderVariation = {}): Promise<string> {
  await writePackVariant(packsDir, id, contractForPackReader(), [], timingProbePackId, {
    [`readers/${packReaderId}.yml`]: packReaderYaml(vary.emits ?? [candidateCountType, candidateSlackType]),
    [packReaderFile]: vary.script ?? packReaderScript,
    'tools/mine.sh': mineScript,
    'semantics.yml': vary.semantics ?? packSemanticsYaml,
    [`rules/${candidatesRuleId}.yml`]: candidatesRuleYaml,
  });
  await writeFile(path.join(packsDir, id, 'graph.yml'), (vary.graph ?? packReaderGraph)(id));
  return id;
}

/**
 * The graph of the variant whose semantics redeclare a **bundled** value type (#61): synthesize, and
 * read what that produced with the reader this bundle ships.
 *
 * The pack's own reader is declared and never walked to, which is the point: what is under test is
 * the reading a *bundled* reader takes inside a Run of a pack, and whose `semantics.yml` it is held
 * against. The pack still declares that reader because a value type its own file declares and none
 * of its own readers emits is a pack `/hima pack check` refuses.
 */
export const packReaderBundledGraph = (id: string): string => `# A pack whose own semantics redeclare a value type the bundle also declares (#61), reading the
# report that declares it with the reader this bundle ships.
id: ${id}
version: '${timingProbePackVersion}'
entry: synthesize

nodes:
  - id: synthesize
    kind: act
    parameters:
      tool: synth
      arguments:
        PERIOD_NS: { from: strategy, name: periodNs }

  - id: read-qor
    kind: act
    parameters:
      observes: qorReport

  - id: judge
    kind: judge
    parameters:
      rules:
        - ${candidatesRuleId}

  - id: blocked
    kind: wait
    parameters:
      blocker: hard-blocker

edges:
  - { from: synthesize, to: read-qor }
  - { from: read-qor, to: judge }
`;

// ---------------------------------------------------------------------------------------------
// The release seal (#64): a `VERSION.yml` a test can write over a folder it made.
// ---------------------------------------------------------------------------------------------

/**
 * A valid `VERSION.yml` for a pack folder as it now stands, built from the harness's own hashes.
 *
 * Here and not in each test file because the hashes have to be the harness's: a seal a test computed
 * with its own idea of what a pack folder is would pass its own check and say nothing about the one
 * the product applies. `snapshotPackFolder` is the one reading the release itself seals, so a seal written
 * through this is the seal `/hima pack release` would have written — which is what lets a test vary
 * exactly one thing about it and assert on the refusal that names that one thing.
 *
 * @param dir - the pack folder to seal.
 * @param seal - the pack id, the version its contract declares, and the run its test record names.
 * @returns the file's text.
 */
export function versionFileFor(dir: string, seal: { pack: string; version: string; run: string }): string {
  const files = snapshotPackFolder(dir).sealFiles();
  return [
    `pack: '${seal.pack}'`,
    `version: '${seal.version}'`,
    `released: '${new Date().toISOString()}'`,
    'test:',
    "  record: 'TEST.md'",
    `  run: '${seal.run}'`,
    'files:',
    ...files.map(([at, sha]) => `  '${at}': '${sha}'`),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// The workshop variant (#62): a pack whose mining node is a workshop the model writes the script of
//
// Here rather than in the one test file that drives it, for the reason every variant above is here:
// a variant the suite runs is one anything else photographing the product must be able to run too,
// and a second spelling of it would be a second pack.
// ---------------------------------------------------------------------------------------------

/** The workshop variant's pack id, which is also its directory name. */
export const workshopPackId = 'workshop-probe';

/** The workshop this variant declares, and the node of its graph that opens one. Both are `mine`:
 *  a node names a workshop, and a pack with one of each has nothing to tell apart. */
export const workshopId = 'mine';

/** Where that workshop's directory is, relative to the Campaign workspace, and the one file of it
 *  the fabric runs. */
export const workshopDirectory = `hima-workshop/${workshopId}`;
export const workshopEntry = 'miner.sh';

/** The word the code record carries for every file this workshop's model writes. */
export const workshopLanguage = 'shell';

/** The knowledge file this variant carries, declared in its contract's `knowledge:` and readable by
 *  the workshop's moment through `hima_workshop_knowledge`. */
export const workshopKnowledgeFile = 'mining.md';
export const workshopKnowledgePurpose = 'how a mining stage of this method states what it yielded';

/**
 * The one sentence of that file a workshop's script has to act on: what the pack says a mining
 * stage's report states, and where on this flow the number actually comes from.
 *
 * Spelled here so the file, the reader that reads what the file describes, and the test that asserts
 * the knowledge tool really answered cannot drift apart in the fixture.
 *
 * Concrete on purpose, since the live check of 2026-09-12. A real model read a purpose that said
 * "state how many cell candidates that synthesis left" and a knowledge file that said the count is
 * the only member anything reads, and wrote three hundred honest lines that hunted for a netlist, a
 * metrics file and a placed DEF in turn — because nothing on this flow says what to count, and a
 * model with no source for a number will look for one everywhere. What a pack owes its workshop is
 * the number's source, in the pack's own words; this is that sentence.
 */
export const workshopKnowledgeMarker = 'the whole number of thousands of square microns of the "Cell Area:" the post-synthesis report states';

const workshopKnowledgeMarkdown = `# Mining, as this method states it

A mining stage of this method yields a set of cell candidates and states how many it yielded. The
report is a small JSON document at the output the contract names, and the only member anything reads
off it is the count.

**Where the count comes from on this flow.** The post-synthesis report the workshop may read
(\`qorReport\`) carries an \`Area\` section with a \`Cell Area:\` line, in square microns. A mining
stage's candidate count on this flow is ${workshopKnowledgeMarker} — so
\`Cell Area:             10475.516309\` is \`{ "count": 10 }\`. Nothing else in the report is a
candidate count, and no netlist, metrics file or layout on this flow states one: that line is the
source.

State it as the JSON object the reader reads, at the path the workshop is told it must produce:

\`\`\`json
{ "count": 10 }
\`\`\`

Nothing else about the set is recorded here. What the candidates *are* is the pack's business and the
flow's; what a Campaign judges is how many there were, and the pack's own reader is what turns that
number into an observation.
`;

/** The workshop block this variant adds to the shipped contract, and the knowledge it declares. */
const workshopBlock = (vary: WorkshopVariation): string => `# What this pack knows, one entry per file under its own \`knowledge/\`.
knowledge:
  - file: ${workshopKnowledgeFile}
    purpose: ${workshopKnowledgePurpose}

# The workshops of this pack (#62): the scopes where the model writes a script and the fabric runs it.
workshops:
  - id: ${workshopId}
    purpose: >-
      Write the mining stage of this method. The campaign has already synthesized at this
      generation's clock period; what is missing is the script that states how many cell candidates
      that synthesis left, in the shape this pack's own reader reads.
    directory: ${vary.directory ?? workshopDirectory}
    entry: ${vary.entry ?? workshopEntry}
    language: ${workshopLanguage}${vary.inputs === undefined ? '' : `
    inputs: [${vary.inputs.join(', ')}]`}
    reads: [${(vary.reads ?? ['qorReport']).join(', ')}]
    knowledge: [${(vary.knowledge ?? [workshopKnowledgeFile]).join(', ')}]
    produces: ${vary.produces ?? 'candidates'}
    argv: [${(vary.argv ?? ['sh', '\${ENTRY}', '\${WORKSPACE}', '\${DESIGN}']).map((w) => `'${w}'`).join(', ')}]${vary.licences === undefined ? '' : `
    licences: { ${Object.entries(vary.licences).map(([name, seats]) => `${name}: ${String(seats)}`).join(', ')} }`}

# Every rule this pack's judge nodes may apply`;

/**
 * What a variant of the workshop pack may vary: the declaration's own fields, and the graph a
 * Campaign of it walks. Each is the one above unless the caller states otherwise.
 *
 * What is here is what `/hima pack check` and the pack load are about — a `produces` with no reader,
 * a wrapper the contract never declared, a directory that climbs out or collides with the anatomy's
 * own, a knowledge file the contract does not declare — because those are the refusals a pack test
 * drives, and each of them is one field of this declaration.
 */
export interface WorkshopVariation {
  readonly directory?: string;
  readonly entry?: string;
  readonly argv?: readonly string[];
  readonly produces?: string;
  readonly reads?: readonly string[];
  readonly knowledge?: readonly string[];
  /** The argument names the node supplies that `argv` may reference — omitted from the declaration
   *  altogether unless a caller states them, for the case a pack declares one of the six the harness
   *  binds itself. */
  readonly inputs?: readonly string[];
  /** Seats of the Site's licences a Job of this workshop holds, for the fitness case a tool's has. */
  readonly licences?: Readonly<Record<string, number>>;
  /** Wrappers this contract declares beyond `make` and `sh` — for the case a contract declares one
   *  and the Site's own Permit refuses it, which no load-time check can catch. */
  readonly wrappers?: readonly string[];
  readonly graph?: (id: string) => string;
}

/**
 * The graph of the workshop variant: synthesize at the strategy's period, write and run the mining
 * script in the workshop, read what it produced with the pack's own reader, and judge it.
 *
 * `synthesize` is first because the workshop `reads` the report it writes: what the moment is given
 * to read has to be there before the moment opens.
 */
export const workshopGraph = (id: string): string => `# A pack whose mining stage is a workshop (#62): the model writes the script, the fabric runs it as
# a job, and the node after it reads what it produced through the pack's own reader.
id: ${id}
version: '${timingProbePackVersion}'
entry: synthesize

nodes:
  - id: synthesize
    kind: act
    parameters:
      tool: synth
      arguments:
        PERIOD_NS: { from: strategy, name: periodNs }

  - id: ${workshopId}
    kind: act
    parameters:
      workshop: ${workshopId}

  - id: read-candidates
    kind: act
    parameters:
      observes: candidates

  - id: judge
    kind: judge
    parameters:
      rules:
        - ${candidatesRuleId}

  - id: blocked
    kind: wait
    parameters:
      blocker: hard-blocker

edges:
  - { from: synthesize, to: ${workshopId} }
  - { from: ${workshopId}, to: read-candidates }
  - { from: read-candidates, to: judge }
`;

/**
 * Install the workshop variant into a booted home, and answer its pack id.
 *
 * The shipped pack with an output at what a mining stage writes, the reader variant's own reader and
 * semantics for it, a pack-local rule over the value type that reader emits, one knowledge file, and
 * the workshop declaration itself. Everything else is the pack the repository ships.
 *
 * @param packsDir - the installed packs directory, from `installPack`.
 * @param id - the variant's pack id, which is also its directory name.
 * @param vary - what this variant varies from the one above, for the pack-check negatives.
 */
export async function installWorkshopPack(packsDir: string, id: string = workshopPackId, vary: WorkshopVariation = {}): Promise<string> {
  await writePackVariant(
    packsDir,
    id,
    [
      [
        '  - name: synthesisLog',
        `  - name: candidates
    path: flow/results/\${design}/mine-${MINED_ROUTE}/candidates.json
    reader: ${packReaderId}
    description: The candidate set the workshop's own script wrote, read by this pack's own reader script.
  - name: synthesisLog`,
      ],
      [
        'environment:\n  wrappers:\n    - make',
        ['environment:', '  wrappers:', '    - make', '    - sh', ...(vary.wrappers ?? []).map((w) => `    - ${w}`)].join('\n'),
      ],
      ['# Every rule this pack\'s judge nodes may apply', workshopBlock(vary)],
      ['  - setup-wns-all-nonnegative', `  - ${candidatesRuleId}\n  - setup-wns-all-nonnegative`],
      [shippedWordsBlock, 'words:\n  periodNs: { label: clock period, unit: ns }'],
    ],
    [],
    timingProbePackId,
    {
      [`readers/${packReaderId}.yml`]: packReaderYaml([candidateCountType, candidateSlackType]),
      [packReaderFile]: packReaderScript,
      'semantics.yml': packSemanticsYaml,
      [`rules/${candidatesRuleId}.yml`]: candidatesRuleYaml,
      [`knowledge/${workshopKnowledgeFile}`]: workshopKnowledgeMarkdown,
    },
  );
  await writeFile(path.join(packsDir, id, 'graph.yml'), (vary.graph ?? workshopGraph)(id));
  return id;
}
