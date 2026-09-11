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

/** The pack directory the repository ships. */
export const shippedPacksDir = path.join(repoRoot, 'packs');

/** The one pack step 2 runs. */
export const timingProbePackId = 'opene902-timing-probe';

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
 * @returns the contract text written, so the caller can assert its variation is really in it.
 */
export async function writePackVariant(
  packsDir: string,
  newId: string,
  contractReplacements: readonly (readonly [string, string])[],
  graphReplacements: readonly (readonly [string, string])[] = [],
  from: string = timingProbePackId,
): Promise<string> {
  const dir = path.join(packsDir, newId);
  await cp(path.join(packsDir, from), dir, { recursive: true });
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
 * The loop's explore node applies `over-constraining-push` and not the reference pack's
 * `timing-push` (#54). What this variant is *for* is a Loop that drills down and closes on its own
 * convergence, and on a stand-in that reports slack the way Design Compiler does — nothing at all
 * for a period it meets — `timing-push` loosens by its guard band every generation and closes on the
 * generation limit instead (D45). The method is the only thing varied: the same step of 0.05 ns, the
 * same `converge` block, the same everything else.
 *
 * @param id - the variant's pack id, which its `graph.yml` must declare.
 * @param generationLimit - what the loop's own `converge` allows it.
 */
export const drillDownGraph = (id: string, generationLimit: number): string => `# A pack that drills down: the timing push is a loop of its own, opened by the outer graph's one
# explore node, and the outer graph goes on when that loop has closed.
id: ${id}
version: '1'
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
  await writePackVariant(packsDir, id, []);
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
version: '1'
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
export const twoKnobGuardBand: readonly [string, string] = ['guardBandNs: 0.05', 'guardBandNs: 0.25'];

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
    [['chooser: timing-push', 'chooser: test-profile-by-outcome'], twoKnobGuardBand],
  );
  return id;
}

// ---------------------------------------------------------------------------------------------
// The over-constraining variant (#54): the shipped pack on the second shipped chooser
//
// The reference pack keeps `timing-push`, which is a stand-in for a method rather than the method
// itself (D45): it asks a met period how much margin it had, and a tool that reports `0.00` slack
// for every met period answers nothing, so the push loosens by its guard band every generation and
// converges on nothing. Since the stand-in flow now reports slack the way Design Compiler does, a
// test whose subject is a Campaign that *reaches* an ending runs the pack varied onto
// `over-constraining-push`, which never reads the margin of a met period.
//
// Here rather than in one test file because five suites and the screenshot tool need the same
// variation, and a second spelling of "the shipped pack with the honest chooser" would be a second
// pack under test.
// ---------------------------------------------------------------------------------------------

/** The second chooser the harness ships (#54): over-constrain by a step, read the violation. */
export const overConstrainingChooserId = 'over-constraining-push';

/**
 * The `chooser:` and `bind:` lines the shipped `graph.yml` states for its explore node, and the ones
 * that put `over-constraining-push` there instead. The reference pack's guard band is 0.05 ns and
 * the variant's step is the same 0.05 ns, so the two differ in method and in nothing else.
 *
 * Spelled as the shipped file spells them and held true by `writePackVariant`, which throws naming
 * what it looked for: the day `graph.yml` re-indents this block is the day this constant is edited,
 * not the day a variant quietly stopped varying anything.
 */
export const graphForOverConstraining: readonly (readonly [string, string])[] = [[
  `      chooser: timing-push
      bind:
        guardBandNs: 0.05`,
  `      chooser: ${overConstrainingChooserId}
      bind:
        stepNs: 0.05`,
]];

/**
 * Install the shipped pack varied onto `over-constraining-push`, and answer its pack id.
 *
 * @param packsDir - the installed packs directory, from `installPack`.
 * @param id - the variant's pack id, which is also its directory name.
 * @returns the variant's pack id, so a caller reads `await installOverConstraining(...)` as the pack
 *          it is about to run.
 */
export async function installOverConstraining(packsDir: string, id: string): Promise<string> {
  await writePackVariant(packsDir, id, [], graphForOverConstraining);
  return id;
}
