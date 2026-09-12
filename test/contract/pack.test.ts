// Ticket #12: the pack anatomy, the opene902 timing probe, site bindings, and workspace preparation.
// A HimaPack is a folder of plain files; a Site binds the inputs its run contract names; and a
// Campaign gets a workspace of its own with the flow copied into it, so no generation ever writes
// the Site's own results. Everything here is driven through the booted host: the `/hima pack`
// command face in, the HimaLedger and the channel's audit out.
//
// Local checks and preparation only. Real Site cases remain in pack.live.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { createHimaHome, repoRoot, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { graphForLegacyTimingPush, installDrillDown, installPack, packsDirOf, shippedPacksDir, timingProbePackId, versionFileFor, writePackFiles, writePackVariant } from './support/pack.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import { killSessions } from './support/fabric.ts';
import { bundledReaderValues } from './support/readings.ts';
import { checkPack, clearRemoteCommands, heldToOneInode, HIMA_FABRIC_SECTIONS, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS, HIMA_TEST_SECTIONS, jobPlumbing, loadPack, loadSite, packDigestOf, packStageOf, packVersionFile, quote, readOnlyProbes, readSemanticsFile, remoteCommands, shippedSemanticsFile, workspacePlumbing } from '@hima/harness';
// The bundled reader library's own declarations, which this file holds against the bundle's own
// semantics: a reader's `emits` is TypeScript and the vocabulary it draws on is a YAML file, and
// nothing else in the suite has both open at once.
import { bundledReaders } from '@hima/harness';
import type { LedgerRecord, SemanticDeclaration, WorkspaceRecord } from '@hima/harness';

/** Is there anything at this path on this machine? */
const isThere = async (at: string): Promise<boolean> => stat(at).then(() => true, () => false);

const recordsOf = (host: InProcessHost, runId: string): LedgerRecord[] => host.ctx.hima.ledger.records({ runId });

const workspaceRecords = (host: InProcessHost, runId: string): WorkspaceRecord[] =>
  recordsOf(host, runId).filter((r): r is WorkspaceRecord => r.type === 'workspace');

/** A local home with the shipped pack installed, a stand-in flow, and a site that binds it. */
async function localPackHome(
  t: import('node:test').TestContext,
  opts: {
    /** What the site file binds, given the home and the generated flow. Defaults to all three inputs. */
    bindings?: (h: HimaHome, flowRoot: string) => Record<string, string>;
    failures?: number;
    sleepSeconds?: number;
  } = {},
): Promise<{ h: HimaHome; host: InProcessHost; flowRoot: string; dispose(): Promise<void> } | undefined> {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, { failures: opts.failures, sleepSeconds: opts.sleepSeconds });
  if (!flow) { await h.dispose(); return undefined; }
  await installPack(h);
  await writeLocalSite(h, {
    // The flow root is read, never written; the workspace root is the one place writes are allowed.
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    bindings: (opts.bindings ?? ((home, flowRoot) => ({ flowRoot, design: flow.design, workspaceRoot: home.workspace })))(h, flow.root),
  });
  const host = await bootInProcess(h);
  return { h, host, flowRoot: flow.root, dispose: async () => { await host.dispose(); await h.dispose(); } };
}

// ---------------------------------------------------------------------------------------------
// The anatomy: a pack is plain files a person reads.
// ---------------------------------------------------------------------------------------------

test('the shipped pack is a folder of plain files whose graph is act, act, judge, explore, with PASS and FAIL into the explore node and one revisit edge back', async () => {
  const dir = path.join(shippedPacksDir, timingProbePackId);
  for (const file of ['PACK.md', 'contract.yml', 'graph.yml', 'tools/synth.sh']) {
    assert.ok((await stat(path.join(dir, file))).isFile(), `the pack anatomy has ${file}`);
  }
  const graph = parse(await readFile(path.join(dir, 'graph.yml'), 'utf8')) as {
    entry: string;
    nodes: { id: string; kind: string }[];
    edges: { from: string; to: string; outcome?: string; revisit?: true }[];
  };
  assert.equal(graph.entry, 'synthesize');
  assert.deepEqual(
    graph.nodes.map((n) => [n.id, n.kind]),
    [['synthesize', 'act'], ['read-qor', 'act'], ['judge', 'judge'], ['next-period', 'explore'], ['blocked', 'wait']],
    'act, act, judge, explore, and the wait node declared for the tickets that add blockers',
  );
  assert.deepEqual(
    graph.edges.map((e) => [e.from, e.to, e.outcome ?? null, e.revisit ?? null]),
    [
      ['synthesize', 'read-qor', null, null],
      ['read-qor', 'judge', null, null],
      ['judge', 'next-period', 'PASS', null],
      ['judge', 'next-period', 'FAIL', null],
      ['next-period', 'synthesize', null, true],
    ],
    'both of the judge\'s outcomes lead to the explore node, whose one edge out is the loop back to the synthesis (#25)',
  );
  const contract = parse(await readFile(path.join(dir, 'contract.yml'), 'utf8')) as {
    inputs: { name: string }[];
    outputs: { name: string; path: string; reader?: string }[];
    rules: string[];
    tools: { id: string; argv: string[] }[];
    strategy: Record<string, unknown>;
    words: Record<string, unknown>;
  };
  assert.deepEqual(contract.inputs.map((i) => i.name), ['flowRoot', 'design', 'workspaceRoot']);
  // What a run of this pack is set to is the pack's own, declared here with everything about it in
  // one place (#58): the kind, the unit, the bounds and the value a campaign starts at.
  assert.deepEqual(
    contract.strategy,
    { periodNs: { type: 'number', unit: 'ns', min: 0.5, max: 10, default: 2.3 } },
    'the one knob this pack declares, whole',
  );
  assert.deepEqual(contract.words.periodNs, { label: 'clock period', unit: 'ns' }, 'and the words a person reads it under');
  assert.deepEqual(contract.rules, ['setup-wns-all-nonnegative', 'clock-period-at-most']);
  assert.equal(contract.outputs[0]?.path, 'flow/results/${design}/syn/report/qor.rpt');
  assert.equal(contract.outputs[0]?.reader, 'dc-qor-report');
  // The tool's command line is the one a person can run by hand, and its first word is what the
  // Permit decides on.
  assert.deepEqual(contract.tools[0]?.argv, [
    'make', '-C', '${WORKSPACE}/flow', 'DESIGN=${DESIGN}', 'synth',
    'CLOCK_PERIOD_NS=${PERIOD_NS}', 'FORCE_SYNTH=1', 'EDA_CONTAINER_NAME=hima-${CAMPAIGN}',
  ]);
  const script = await readFile(path.join(dir, 'tools/synth.sh'), 'utf8');
  assert.match(script, /exec make -C "\$WORKSPACE\/flow"/, 'the script runs the command line the contract declares');
  assert.match(script, /EDA_CONTAINER_NAME="hima-\$CAMPAIGN"/, 'never the site\'s own container name: that would write the site\'s results');

  // The explore node names its chooser by id and binds what the chooser declares, exactly as the
  // judge node names its rules by id (D38); and it says when its Loop has stopped learning, in that
  // chooser's own vocabulary (D43). Nothing about the push rule itself is in this pack.
  const graphNodes = parse(await readFile(path.join(dir, 'graph.yml'), 'utf8')) as {
    nodes: { id: string; kind: string; parameters: Record<string, unknown> }[];
  };
  const explore = graphNodes.nodes.find((n) => n.kind === 'explore');
  assert.deepEqual(explore?.parameters, {
    chooser: 'over-constraining-push',
    bind: { stepNs: 0.05 },
    converge: { read: 'period', band: 0.05, generations: 1, generationLimit: 6 },
  });
});

test('the legacy timing-push chooser is a YAML file beside the judge rules, and states its rule as data', async () => {
  // D38: a pack author who wants a different push rule edits a file next to `rules/`, not
  // TypeScript. That the file is there and readable as data is the whole point, so it is asserted.
  const at = path.join(repoRoot, 'packages/harness/choosers/timing-push.yml');
  assert.ok((await stat(at)).isFile(), 'choosers ship as YAML beside the bundle, as rules do');
  const chooser = parse(await readFile(at, 'utf8')) as {
    id: string;
    version: string;
    parameter?: { name: string; unit: string };
    reads: Record<string, { type: string; unit: string }>;
    decide: { when: Record<string, string>; goalMet?: true; next?: unknown }[];
  };
  assert.equal(chooser.id, 'timing-push');
  assert.equal(chooser.version, '1');
  assert.deepEqual(chooser.parameter, { name: 'guardBandNs', unit: 'ns' }, 'the one number the pack binds');
  assert.deepEqual(chooser.reads, {
    period: { type: 'clock_period', unit: 'ns' },
    slack: { type: 'setup_wns', unit: 'ns' },
  });
  assert.deepEqual(
    chooser.decide,
    [
      { when: { constraint: 'PASS', goal: 'PASS' }, goalMet: true },
      { when: { constraint: 'PASS' }, next: { periodNs: { sum: ['period', { neg: 'slack' }, 'guardBandNs'] } } },
      { when: { constraint: 'FAIL' }, next: { periodNs: { sum: ['period', { abs: 'slack' }, 'guardBandNs'] } } },
    ],
    'push on a met constraint, back off by the violation on a failed one, and stop when the goal is met too — each setting the knob the pack declares, by its name (#58)',
  );
});

// ---------------------------------------------------------------------------------------------
// The check: can this Site host this pack?
// ---------------------------------------------------------------------------------------------

test('the check on a site that binds every input reports the inputs, the tool, the rules and the reader, with no errors', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, flowRoot, dispose } = local;
  try {
    const checked = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site local`);
    // What a person sees, in the suite's own output: this is the demo of the ticket.
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, /^pack opene902-timing-probe@2 on site local: fit\b/, checked.text);
    assert.match(checked.text, new RegExp(`flowRoot = ${flowRoot.replaceAll('/', '\\/')}$`, 'm'), checked.text);
    assert.match(checked.text, /^ {2}design = opene902$/m, checked.text);
    assert.match(checked.text, new RegExp(`workspaceRoot = ${h.workspace.replaceAll('/', '\\/')}$`, 'm'), checked.text);
    assert.match(checked.text, /^ {2}synth \(tools\/synth\.sh\): "make" is an allowed wrapper of site local$/m, checked.text);
    // The reference pack carries none of its own rules, choosers or readers, so every id it names
    // resolved in the second place looked — which the check says of each, since #57.
    assert.match(checked.text, /^ {2}setup-wns-all-nonnegative@1: found in the bundle$/m, checked.text);
    assert.match(checked.text, /^ {2}clock-period-at-most@1: found in the bundle$/m, checked.text);
    assert.match(checked.text, /^ {2}dc-qor-report@1 reads qorReport: found in the bundle$/m, checked.text);
    assert.doesNotMatch(checked.text, /^errors:/m, `a fit pack reports no errors: ${checked.text}`);
    // The check asks the Site's files, never the Site itself: nothing about a pack's fitness needs a
    // connection, and a check that opened one could not be run before a site was reachable.
    assert.deepEqual(remoteCommands(), [], 'the check ran no command on the site');
  } finally {
    await dispose();
  }
});

test('a site that binds only some of the pack\'s inputs fails the check, naming the input it did not bind', async (t) => {
  const local = await localPackHome(t, { bindings: () => ({ design: 'opene902' }) });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const checked = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site local`);
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /^pack opene902-timing-probe@2 on site local: unfit\b/, checked.text);
    assert.match(checked.text, /input "flowRoot" is not bound by site local/, checked.text);
    assert.match(checked.text, /input "workspaceRoot" is not bound by site local/, checked.text);
    assert.doesNotMatch(checked.text, /input "design" is not bound/, `the one input it did bind is not an error: ${checked.text}`);
  } finally {
    await dispose();
  }
});

test('a pack whose tool runs a command the site does not allow fails the check, naming the command', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // The shipped pack, varied in one place: its tool now reaches for a command the site owner's
    // permit says nothing about. Everything else about the pack is the file the repository ships.
    const varied = await writePackVariant(packsDirOf(h), 'reaches-for-curl', [
      ['  wrappers:\n    - make', '  wrappers:\n    - curl'],
      ['    argv:\n      - make', '    argv:\n      - curl'],
    ]);
    assert.match(varied, /- curl/, 'the shipped contract is the one being varied');
    const checked = await himaCommand(host, h.workspace, '/hima pack check reaches-for-curl --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /^pack reaches-for-curl@2 on site local: unfit\b/, checked.text);
    assert.match(checked.text, /"curl" is not an allowed wrapper of site local/, checked.text);
  } finally {
    await dispose();
  }
});

test('a pack referencing a rule that does not exist fails the check, naming the rule', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    await writePackVariant(packsDirOf(h), 'unknown-rule', [['  - clock-period-at-most', '  - no-such-rule']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check unknown-rule --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /no-such-rule/, checked.text);
    assert.match(checked.text, /unknown rule/, checked.text);
  } finally {
    await dispose();
  }
});

test('a pack naming a reader that does not exist fails the check, naming the reader', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    await writePackVariant(packsDirOf(h), 'unknown-reader', [['    reader: dc-qor-report', '    reader: no-such-reader']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check unknown-reader --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /no-such-reader/, checked.text);
    assert.match(checked.text, /unknown reader/, checked.text);
  } finally {
    await dispose();
  }
});

test('a pack naming a chooser that does not exist fails the check, naming the chooser', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // A chooser is data referenced by id, exactly as a rule is (D38), so an id this harness ships no
    // file for is caught by the same check — before a Campaign exists, not after a licence-minute.
    await writePackVariant(packsDirOf(h), 'unknown-chooser', [], [['      chooser: over-constraining-push', '      chooser: no-such-chooser']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check unknown-chooser --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /no-such-chooser/, checked.text);
    assert.match(checked.text, /unknown chooser/, checked.text);
  } finally {
    await dispose();
  }
});

test('a pack binding a negative value to the chooser\'s parameter fails the check, naming the parameter', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // A negative guard band inverts what the guard band is for: a PASS would push past the edge the
    // tool just reported instead of leaving margin on the table.
    await writePackVariant(packsDirOf(h), 'negative-guard-band', [], [['        stepNs: 0.05', '        stepNs: -0.1']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check negative-guard-band --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /stepNs/, checked.text);
    assert.match(checked.text, /-0\.1/, checked.text);
  } finally {
    await dispose();
  }
});

test('a pack whose explore node binds nothing for the chooser\'s parameter fails the check, naming the parameter', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    await writePackVariant(packsDirOf(h), 'unbound-guard-band', [], [['      bind:\n        stepNs: 0.05', '      bind: {}']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check unbound-guard-band --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /stepNs/, checked.text);
    assert.match(checked.text, /binds no value/, checked.text);
  } finally {
    await dispose();
  }
});

test('a pack whose act node takes an argument from a strategy knob its contract does not declare is refused when the pack is loaded, naming the knob', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // A Goal parameter's names come from the Run, so nothing about them can be settled by reading
    // two files (`fabric.test.ts` drives that one: the node blocks and says which argument it could
    // not bind). A Strategy knob is the other way round since #58: the contract declares every one
    // of them, so a node reading a knob no contract declares is a pack contradicting itself, and it
    // is refused where every other such contradiction is — when the pack is loaded, before a Site is
    // asked anything and before a licence-minute is spent on a command line missing a value.
    await writePackVariant(packsDirOf(h), 'reads-an-undeclared-knob', [], [[
      'PERIOD_NS: { from: strategy, name: periodNs }',
      'PERIOD_NS: { from: strategy, name: noSuchKnob }',
    ]]);
    const refused = await himaCommand(host, h.workspace, '/hima pack check reads-an-undeclared-knob --site local');
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(
      refused.text,
      /node "synthesize" takes argument "PERIOD_NS" from strategy knob "noSuchKnob", which contract\.yml does not declare; it declares "periodNs"/,
      `the refusal names the node, the argument, the knob it asked for and the knobs there are: ${refused.text}`,
    );
    // Said as an answer rather than thrown, and carrying the ladder beside it (#63): a pack that
    // will not load is a folder that has not reached `compiled`, and the answer says which rung it
    // stands on. This variant of the shipped pack was written by hand and has no intent record, so
    // it stands below the first rung — and the loader's sentence above is the whole of what is
    // wrong with it.
    assert.match(refused.text, /^stage: none; next: intent — INTENT\.md, written by \/hima-grill$/m, refused.text);

    // The shipped pack, unvaried, is the control: the refusal above is about the one thing that was
    // varied and not about a pack that could never have loaded.
    const fits = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site local`);
    assert.equal(fits.kind, 'success', fits.text);
  } finally {
    await dispose();
  }
});

test('a pack whose act node binds one of the names the harness binds itself is refused when the pack is loaded, naming the node and the name', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // `WORKSPACE`, `FLOW_ROOT`, `DESIGN` and `CAMPAIGN` are the Run's own workspace and the Site's
    // bindings: the harness computes each of them from a path it already decided, and a tool's
    // `argv` references them by those names. A node argument spelled the same way is the pack
    // handing the fabric a *different* value under a name the fabric is the author of — a
    // `WORKSPACE` of the pack's choosing substituted into a command line every record of that Job
    // then describes as having run in the Campaign's workspace. It is refused where every other pack
    // contradicting itself is, when the pack is loaded, and before any Site is asked anything.
    await writePackVariant(packsDirOf(h), 'binds-the-harnesss-own', [], [[
      'PERIOD_NS: { from: strategy, name: periodNs }',
      'PERIOD_NS: { from: strategy, name: periodNs }\n        WORKSPACE: /tmp/somewhere-else',
    ]]);
    const refused = await himaCommand(host, h.workspace, '/hima pack check binds-the-harnesss-own --site local');
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(
      refused.text,
      /node "synthesize" binds "WORKSPACE", which the harness binds itself for a tool: WORKSPACE, FLOW_ROOT, DESIGN and CAMPAIGN/,
      `the refusal names the node, the name it bound and the names that are the harness's: ${refused.text}`,
    );

    // The shipped pack, unvaried, is the control: it binds `PERIOD_NS` at that same node and loads.
    const fits = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site local`);
    assert.equal(fits.kind, 'success', fits.text);
  } finally {
    await dispose();
  }
});

test('a pack the packs directory does not hold is an error naming what was looked for, not an empty answer', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const checked = await himaCommand(host, h.workspace, '/hima pack check no-such-pack --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /unknown pack "no-such-pack"/, checked.text);
  } finally {
    await dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// Pack-local data (#57): a pack folder carries its own rules, choosers, readers and knowledge
// ---------------------------------------------------------------------------------------------

/**
 * The bundle's own goal rule again, at a version of its own, for a pack to carry in its `rules/`.
 *
 * The same predicate, so the pack it is dropped into still runs; a different version, because that
 * is what proves which of the two files was read — an origin the check merely *says* could be said
 * of a rule loaded from either place, and `@2` could only have come from here.
 */
const packLocalRule = `id: clock-period-at-most
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

/** The bundle's push rule again at a version of its own, for a pack to carry in its `choosers/`,
 *  for the reason above: the clauses are the bundle's, and `@2` is only in the pack folder. */
const packLocalChooser = `id: timing-push
version: '2'
title: Push the clock period against the measured setup margin, in the pack's own copy of the chooser
parameter:
  name: guardBandNs
  unit: ns
reads:
  period: { type: clock_period, unit: ns }
  slack: { type: setup_wns, unit: ns }
decide:
  - when: { constraint: PASS, goal: PASS }
    goalMet: true
  - when: { constraint: PASS }
    next:
      periodNs: { sum: [period, { neg: slack }, guardBandNs] }
  - when: { constraint: FAIL }
    next:
      periodNs: { sum: [period, { abs: slack }, guardBandNs] }
`;

/** One reader declared by a pack rather than by the bundle's registry, in the shape a record's own
 *  reader reference has. It cannot run before #61, which is what the check has to say. */
const packLocalReaderScript = `#!/bin/sh
# The pack's own reader: read the number out of the report and write the one value it declares.
set -eu
printf '{ "values": [ { "type": "clock_period", "unit": "ns", "value": 2.2 } ] }\\n' > "$2"
`;

/**
 * A reader declaration of the pack's own (#61): a script in the pack's tools folder, the command
 * line that runs it, and what it emits. Spelled as a function so each variant below varies the one
 * thing it is about and nothing else.
 */
const packLocalReader = (vary: { file?: string; emits?: string } = {}): string => `id: dc-qor-report
version: '9'
file: ${vary.file ?? 'tools/read-qor.sh'}
argv: [sh, '\${READER}', '\${REPORT}', '\${OUT}']
reportKind: dc-qor-report
emits: [${vary.emits ?? 'clock_period'}]
`;

/** The shipped contract's wrapper block, and the same block with the reader's own wrapper in it. */
const shippedWrappers = 'environment:\n  wrappers:\n    - make';
const wrappersWithSh: readonly [string, string] = [shippedWrappers, `${shippedWrappers}\n    - sh`];

/** The knowledge file a Model moment would read, and what the contract says it is for. */
const packLocalKnowledgeFile = 'push-method.md';
const packLocalKnowledgePurpose = 'why this pack pushes the clock period the way it does';
const packLocalKnowledge = `# Why this pack pushes the way it does\n\nThe method, in the words a person wrote it in.\n`;

/** The `knowledge:` block put in front of the shipped contract's `rules:` list, so the variant
 *  declares one knowledge file and changes nothing else. */
const knowledgeBlock = ['knowledge:', `  - file: ${packLocalKnowledgeFile}`, `    purpose: ${packLocalKnowledgePurpose}`, '', 'rules:'].join('\n');

test('a pack carrying its own rule, chooser and knowledge resolves each ahead of the bundle\'s, and the check says where every id it resolved came from', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // The shipped pack with two of its ids shadowed by files of its own, and one knowledge file
    // declared. Everything else about it — the other rule, the reader, the tools — is the pack the
    // repository ships, so what the check reports about those is the bundle answering.
    await writePackVariant(packsDirOf(h), 'carries-its-own', [['rules:', knowledgeBlock]], graphForLegacyTimingPush, timingProbePackId, {
      'rules/clock-period-at-most.yml': packLocalRule,
      'choosers/timing-push.yml': packLocalChooser,
      [`knowledge/${packLocalKnowledgeFile}`]: packLocalKnowledge,
    });
    const checked = await himaCommand(host, h.workspace, '/hima pack check carries-its-own --site local');
    // What a person sees, in the suite's own output: this is the demo of the ticket.
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, /^ {2}clock-period-at-most@2: found in the pack$/m, `the pack's own rule won, which its version says: ${checked.text}`);
    assert.match(checked.text, /^ {2}setup-wns-all-nonnegative@1: found in the bundle$/m, `and the rule it does not carry came from the bundle: ${checked.text}`);
    assert.match(checked.text, /^ {2}timing-push@2 chooses at next-period: found in the pack$/m, `the pack's own chooser won: ${checked.text}`);
    assert.match(checked.text, /^ {2}dc-qor-report@1 reads qorReport: found in the bundle$/m, `and the reader it declares none of is the registry's: ${checked.text}`);
    assert.match(
      checked.text,
      new RegExp(`^ {2}${packLocalKnowledgeFile.replace('.', '\\.')} \\(${packLocalKnowledgePurpose}\\): found in the pack$`, 'm'),
      `the knowledge it carries is listed with what it is for: ${checked.text}`,
    );
  } finally {
    await dispose();
  }
});

test('a rule and a chooser present in neither the pack nor the bundle are refused at the check, in words naming both places looked', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    await writePackVariant(packsDir, 'nowhere-at-all', [['  - clock-period-at-most', '  - no-such-rule']], [['      chooser: over-constraining-push', '      chooser: no-such-chooser']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check nowhere-at-all --site local');
    assert.equal(checked.kind, 'error', checked.text);
    for (const [what, id] of [['rule', 'no-such-rule'], ['chooser', 'no-such-chooser']] as const) {
      const inThePack = path.join(packsDir, 'nowhere-at-all', `${what}s`, `${id}.yml`);
      const inTheBundle = path.join(repoRoot, 'packages/harness', `${what}s`, `${id}.yml`);
      assert.ok(checked.text.includes(inThePack), `the refusal names the pack's own ${what}s folder: ${checked.text}`);
      assert.ok(checked.text.includes(inTheBundle), `and the bundle's, so a person knows both places were looked in: ${checked.text}`);
      assert.match(checked.text, new RegExp(`unknown ${what} "${id}"`), checked.text);
    }
  } finally {
    await dispose();
  }
});

test('the three ways a pack reader does not hang together are each refused by name: a reader with no script, a script with no semantics, and a semantics entry no reader produces', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // 1. A declaration naming a script the pack folder does not hold. A reader is a script since
    //    #61, so a declaration whose file is not there is a reader nothing could ever run — said
    //    before a workspace exists rather than at the observe node, after a generation of synthesis.
    await writePackVariant(packsDir, 'reader-with-no-script', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader({ file: 'tools/not-written-yet.sh' }),
      'semantics.yml': 'values:\n  clock_period: { unit: ns }\n',
    });
    const noScript = await himaCommand(host, h.workspace, '/hima pack check reader-with-no-script --site local');
    for (const line of noScript.text.split('\n')) t.diagnostic(line);
    assert.equal(noScript.kind, 'error', noScript.text);
    assert.ok(
      noScript.text.includes(path.join(packsDir, 'reader-with-no-script', 'tools', 'not-written-yet.sh')),
      `the refusal names the script the declaration promised: ${noScript.text}`,
    );
    assert.match(noScript.text, /reader "dc-qor-report", named by output "qorReport"/, noScript.text);

    // 2. A script that is there, emitting a value type no semantics file declares — neither the
    //    pack's own nor the bundle's. Nothing could say what such a number means, so no rule could
    //    ever compare it to anything.
    await writePackVariant(packsDir, 'script-with-no-semantics', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader({ emits: 'candidate_count' }),
      'tools/read-qor.sh': packLocalReaderScript,
    });
    const noSemantics = await himaCommand(host, h.workspace, '/hima pack check script-with-no-semantics --site local');
    for (const line of noSemantics.text.split('\n')) t.diagnostic(line);
    assert.equal(noSemantics.kind, 'error', noSemantics.text);
    assert.match(noSemantics.text, /declares it emits "candidate_count", which no semantics file declares/, noSemantics.text);
    assert.ok(
      noSemantics.text.includes(path.join(packsDir, 'script-with-no-semantics', 'semantics.yml')),
      `and the file to add it to: ${noSemantics.text}`,
    );

    // 3. A semantics file declaring a value type none of the pack's own readers emits: a vocabulary
    //    no Campaign of this pack will ever speak.
    await writePackVariant(packsDir, 'semantics-nobody-emits', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader(),
      'tools/read-qor.sh': packLocalReaderScript,
      'semantics.yml': 'values:\n  clock_period: { unit: ns }\n  candidate_count: { unit: count }\n',
    });
    const unemitted = await himaCommand(host, h.workspace, '/hima pack check semantics-nobody-emits --site local');
    for (const line of unemitted.text.split('\n')) t.diagnostic(line);
    assert.equal(unemitted.kind, 'error', unemitted.text);
    assert.match(
      unemitted.text,
      /semantics\.yml: declares the value type "candidate_count", which none of this pack's own readers emits/,
      unemitted.text,
    );
    assert.doesNotMatch(unemitted.text, /"clock_period", which none/, `and says nothing about the type its reader does emit: ${unemitted.text}`);
  } finally {
    await dispose();
  }
});

test('a pack reader that hangs together is fit, and the check says its declaration answered the id rather than the bundle\'s registry', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    await writePackVariant(packsDirOf(h), 'reader-of-its-own', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader(),
      'tools/read-qor.sh': packLocalReaderScript,
      'semantics.yml': 'values:\n  clock_period: { unit: ns }\n',
    });
    const checked = await himaCommand(host, h.workspace, '/hima pack check reader-of-its-own --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, /^ {2}dc-qor-report@9 reads qorReport: found in the pack$/m, `the pack's own declaration won, at its own version: ${checked.text}`);
  } finally {
    await dispose();
  }
});

test('a reader declaration that would reach outside the pack folder or smuggle a shell expansion onto its command line is refused: a file above the folder, a symlink standing in for the script, and an argv word holding a $', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // `file` is held to a shape before anything is joined to a path, so `..` never reaches the
    // filesystem at all: a declaration reaching above the pack folder would be a reader running bytes
    // nobody installed with the pack, reported as the pack's own.
    await writePackVariant(packsDir, 'reader-file-escapes', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader({ file: '../../elsewhere.sh' }),
    });
    const escapes = await himaCommand(host, h.workspace, '/hima pack check reader-file-escapes --site local');
    assert.equal(escapes.kind, 'error', escapes.text);
    assert.match(escapes.text, /the file "\.\.\/\.\.\/elsewhere\.sh" is not one: a reader's script is a file under the pack's own tools\//, escapes.text);

    // And the shape alone is not containment: a name with nothing wrong with it can be a symlink to
    // a script anywhere on the machine, which is exactly the file a pack folder is supposed to hold
    // entirely on its own. The entry itself must be the plain file — and since #64's one reading of
    // the folder, the answer comes from the reading rather than from the reader section: a folder
    // holding a link is not a folder of plain files, so nothing about it is checked, hashed, sealed
    // or run, and the refusal names the path.
    await writePackVariant(packsDir, 'reader-file-is-a-link', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader(),
      'semantics.yml': 'values:\n  clock_period: { unit: ns }\n',
    });
    const elsewhere = path.join(h.workspace, 'somebody-elses-reader.sh');
    await writeFile(elsewhere, packLocalReaderScript);
    await symlink(elsewhere, path.join(packsDir, 'reader-file-is-a-link', 'tools', 'read-qor.sh'));
    const link = await himaCommand(host, h.workspace, '/hima pack check reader-file-is-a-link --site local');
    for (const line of link.text.split('\n')) t.diagnostic(line);
    assert.equal(link.kind, 'error', link.text);
    assert.match(link.text, /tools\/read-qor\.sh is not a plain file \(a symlink, a socket or the like\), and a pack folder is plain files/, link.text);

    // An argv word is a literal or one whole placeholder, and a literal carries no `$` at all — so
    // nothing a pack wrote can be expanded by anything, whatever a wrapper does with it.
    await writePackVariant(packsDir, 'reader-argv-expands', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader().replace("argv: [sh, '${READER}', '${REPORT}', '${OUT}']", "argv: [sh, '${READER}', '$HOME/escape', '${OUT}']"),
      'tools/read-qor.sh': packLocalReaderScript,
    });
    const expands = await himaCommand(host, h.workspace, '/hima pack check reader-argv-expands --site local');
    assert.equal(expands.kind, 'error', expands.text);
    assert.match(expands.text, /the word "\$HOME\/escape" holds a "\$", and a literal word of a reader's argv holds none/, expands.text);

    // A placeholder the harness does not compute is refused by name rather than reaching the
    // substitution and failing there as an unbound name, which would be the same refusal a whole
    // layer too late — at an observe node, after a generation of synthesis.
    await writePackVariant(packsDir, 'reader-argv-unknown', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader().replace("'${OUT}'", "'${SOMETHING}'"),
      'tools/read-qor.sh': packLocalReaderScript,
    });
    const unknown = await himaCommand(host, h.workspace, '/hima pack check reader-argv-unknown --site local');
    assert.equal(unknown.kind, 'error', unknown.text);
    assert.match(unknown.text, /references \$\{SOMETHING\}, and a reader's argv may reference only \$\{READER\}, \$\{REPORT\}, \$\{OUT\}, \$\{WORKSPACE\}/, unknown.text);
  } finally {
    await dispose();
  }
});

test('a reader script the declaration puts outside the pack\'s tools folder is refused naming the file, and so is a tools folder that is a link out of the pack', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // A reader **is a script in the pack's tools folder**, which is the one place a pack keeps what
    // it runs and the one place a person reviewing a pack looks for it. A declaration pointing at a
    // file elsewhere under the pack folder — beside the declaration itself, in `knowledge/`, in the
    // folder's root — would be a pack running bytes from wherever it liked and calling them a tool.
    await writePackVariant(packsDir, 'reader-outside-tools', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader({ file: 'readers/read-qor.sh' }),
      'readers/read-qor.sh': packLocalReaderScript,
      'semantics.yml': 'values:\n  clock_period: { unit: ns }\n',
    });
    const outside = await himaCommand(host, h.workspace, '/hima pack check reader-outside-tools --site local');
    for (const line of outside.text.split('\n')) t.diagnostic(line);
    assert.equal(outside.kind, 'error', outside.text);
    assert.match(outside.text, /a reader's script is a file under the pack's own tools\//, outside.text);
    assert.ok(outside.text.includes('readers/read-qor.sh'), `naming the file the declaration put there: ${outside.text}`);

    // And the shape is not containment, exactly as it is not for the file itself: a `tools` that is
    // a link to somewhere else on the machine passes every name check there is, and the script it
    // holds is not the pack's. The one reading of the folder (#64) is what says so, naming the
    // directory: a folder whose `tools` is a link is not a folder of plain files, and nothing about
    // it — the reader section included — is worth answering until it is.
    await writePackVariant(packsDir, 'reader-tools-is-a-link', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader(),
      'semantics.yml': 'values:\n  clock_period: { unit: ns }\n',
    });
    const elsewhere = path.join(h.workspace, 'somebody-elses-tools');
    await mkdir(elsewhere, { recursive: true });
    await writeFile(path.join(elsewhere, 'read-qor.sh'), packLocalReaderScript);
    // The pack's own tool script goes with it, so the only thing wrong with this pack is where its
    // tools folder points: a pack missing the file its contract names is refused at load, and would
    // never reach the reader section at all.
    const toolsAt = path.join(packsDir, 'reader-tools-is-a-link', 'tools');
    await writeFile(path.join(elsewhere, 'synth.sh'), await readFile(path.join(toolsAt, 'synth.sh'), 'utf8'));
    await rm(toolsAt, { recursive: true, force: true });
    await symlink(elsewhere, toolsAt);
    const linked = await himaCommand(host, h.workspace, '/hima pack check reader-tools-is-a-link --site local');
    for (const line of linked.text.split('\n')) t.diagnostic(line);
    assert.equal(linked.kind, 'error', linked.text);
    assert.match(linked.text, /\/tools is not a plain file \(a symlink, a socket or the like\), and a pack folder is plain files/, linked.text);
  } finally {
    await dispose();
  }
});

test('a reader whose argv begins with a placeholder rather than a wrapper is refused at load: the word pack check holds against the permit is the word the launch runs', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // `argv[0]` is what the Permit decides on, and the check and the launch must be deciding on the
    // same word. A declaration beginning `${READER}` would be checked against `environment.wrappers`
    // as the literal `${READER}` — which a contract could declare and a Permit could allow — and then
    // launched as the absolute path of a shipped script, which no Permit allows. A pack that checked
    // fit and could not launch is the one answer a check exists to prevent.
    await writePackVariant(packsDirOf(h), 'reader-argv-head-expands', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader().replace("argv: [sh, '${READER}'", "argv: ['${READER}', '${READER}'"),
      'tools/read-qor.sh': packLocalReaderScript,
      'semantics.yml': 'values:\n  clock_period: { unit: ns }\n',
    });
    const head = await himaCommand(host, h.workspace, '/hima pack check reader-argv-head-expands --site local');
    for (const line of head.text.split('\n')) t.diagnostic(line);
    assert.equal(head.kind, 'error', head.text);
    assert.match(head.text, /the first word of a reader's argv is the wrapper itself/, head.text);
  } finally {
    await dispose();
  }
});

test('a semantics file and a reader declaration that are not YAML at all are each an error naming the file, and the reader\'s names the reader and the output it was looked up for', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // A file a person hand-wrote and mistyped. The YAML parser's own message says the line and the
    // column and nothing about which of a pack's dozen files it was reading, so a syntax error that
    // escaped unwrapped would reach a person as `Flow map must end with a } at line 2` — true, and
    // no help at all in a pack folder holding a contract, a graph, rules, choosers and readers.
    await writePackVariant(packsDir, 'semantics-not-yaml', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': packLocalReader(),
      'tools/read-qor.sh': packLocalReaderScript,
      'semantics.yml': 'values:\n  clock_period: { unit: ns\n',
    });
    const badSemantics = await himaCommand(host, h.workspace, '/hima pack check semantics-not-yaml --site local');
    for (const line of badSemantics.text.split('\n')) t.diagnostic(line);
    assert.equal(badSemantics.kind, 'error', badSemantics.text);
    assert.ok(
      badSemantics.text.includes(path.join(packsDir, 'semantics-not-yaml', 'semantics.yml')),
      `the refusal names the file that will not parse: ${badSemantics.text}`,
    );
    assert.match(badSemantics.text, /is not YAML/, badSemantics.text);

    // And the same for a reader declaration, which is looked up *for* an output: a person reading
    // the check is looking for which of their readers to open, so the sentence says which one and
    // which output named it as well as which file.
    await writePackVariant(packsDir, 'reader-not-yaml', [wrappersWithSh], [], timingProbePackId, {
      'readers/dc-qor-report.yml': 'id: dc-qor-report\nargv: [sh, \nemits: [clock_period]\n',
      'tools/read-qor.sh': packLocalReaderScript,
      'semantics.yml': 'values:\n  clock_period: { unit: ns }\n',
    });
    const badReader = await himaCommand(host, h.workspace, '/hima pack check reader-not-yaml --site local');
    for (const line of badReader.text.split('\n')) t.diagnostic(line);
    assert.equal(badReader.kind, 'error', badReader.text);
    assert.ok(
      badReader.text.includes(path.join(packsDir, 'reader-not-yaml', 'readers', 'dc-qor-report.yml')),
      `the refusal names the declaration that will not parse: ${badReader.text}`,
    );
    assert.match(badReader.text, /reader "dc-qor-report", named by output "qorReport"/, badReader.text);
    assert.match(badReader.text, /is not YAML/, badReader.text);
  } finally {
    await dispose();
  }
});

test('a rule needing a value type no semantics file declares, and a chooser reading one in a unit the declaration does not bind, are both refused naming the type and the units', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // A rule over a value type nobody declares. Until #61 the enum in the bundle made this
    // unwritable; now a pack brings its own vocabulary, so a rule may name a type that is in no
    // file at all — and such a rule can only ever go UNDETERMINED, once per generation, for ever.
    await writePackVariant(packsDir, 'rule-on-nothing', [], [], timingProbePackId, {
      'rules/clock-period-at-most.yml': packLocalRule.replace(/clock_period/g, 'candidate_count'),
    });
    const undeclared = await himaCommand(host, h.workspace, '/hima pack check rule-on-nothing --site local');
    for (const line of undeclared.text.split('\n')) t.diagnostic(line);
    assert.equal(undeclared.kind, 'error', undeclared.text);
    assert.match(undeclared.text, /rule "clock-period-at-most" needs the value type "candidate_count", which no semantics file declares/, undeclared.text);

    // And a chooser reading a declared type in a unit that type is not measured in: arithmetic on a
    // number that is not what the chooser thinks it is, which reaches a person as a next Strategy
    // and not as a fault.
    await writePackVariant(packsDir, 'chooser-wrong-unit', [], graphForLegacyTimingPush, timingProbePackId, {
      'choosers/timing-push.yml': packLocalChooser.replace('period: { type: clock_period, unit: ns }', 'period: { type: clock_period, unit: count }'),
    });
    const wrongUnit = await himaCommand(host, h.workspace, '/hima pack check chooser-wrong-unit --site local');
    for (const line of wrongUnit.text.split('\n')) t.diagnostic(line);
    assert.equal(wrongUnit.kind, 'error', wrongUnit.text);
    assert.match(
      wrongUnit.text,
      /reads "period" \(clock_period\) in "count", and the semantics declare that type is measured in "ns"/,
      wrongUnit.text,
    );
  } finally {
    await dispose();
  }
});

test('every value type the bundled readers declare they emit is declared in the bundle\'s own semantics.yml, in the unit those readers read it in', async () => {
  // The one place the bundle's readers and the bundle's vocabulary are held to each other: a reader
  // whose `emits` named a type this file does not declare would refuse its own reading at run time,
  // in the validator's words, on a customer's Site.
  const declared = readSemanticsFile(shippedSemanticsFile);
  assert.ok(declared, `the bundle ships ${shippedSemanticsFile}`);
  for (const reader of bundledReaders) {
    for (const type of reader.emits) {
      const entry: SemanticDeclaration | undefined = declared.values[type];
      assert.ok(entry, `reader ${reader.id} emits "${type}", which the bundle's semantics declare`);
      // And in the unit and under the qualifiers those readers actually read it in — held against the
      // table `observe-readers.test.ts` and `dc-reader.test.ts` hold every value of a **real**
      // opene902 report against (`support/readings.ts`). Membership alone would pass a file that
      // declared a slack in picoseconds, which is a reading every rule of every pack would then be
      // compared against in the wrong unit, and nothing else here would ever say so.
      const read = bundledReaderValues[type];
      assert.ok(read, `"${type}" is a value type the suite states what the bundled readers read it in`);
      assert.equal(entry.unit, read.unit, `the bundle declares "${type}" in the unit its readers read it in`);
      assert.deepEqual(entry.mode, read.mode, `and the analysis passes a value of "${type}" may carry`);
      assert.deepEqual(entry.scope, read.scope, `and the path groups a value of "${type}" may carry`);
    }
  }
  // And nothing is declared that no bundled reader produces: this file is the default library's
  // vocabulary, and an entry nothing emits is the same dead declaration a pack is refused for.
  const emitted = new Set(bundledReaders.flatMap((r) => r.emits));
  assert.deepEqual(
    Object.keys(declared.values).filter((type) => !emitted.has(type)),
    [],
    `every declared type is emitted by one of the bundled readers: ${JSON.stringify(Object.keys(declared.values))}`,
  );
  // And the table itself says nothing about a type that is not in this file, so a reader removed from
  // the bundle cannot leave a unit asserted against nothing.
  assert.deepEqual(
    Object.keys(bundledReaderValues).filter((type) => !Object.hasOwn(declared.values, type)),
    [],
    `the suite states the reading of exactly the types the bundle declares: ${JSON.stringify(Object.keys(bundledReaderValues))}`,
  );
});

test('a knowledge file the contract names and the pack folder does not hold leaves the pack unfit, naming the folder looked in and that the bundle ships none', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // The `knowledge:` block, and no file under `knowledge/` to go with it.
    await writePackVariant(packsDir, 'promises-knowledge', [['rules:', knowledgeBlock]]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check promises-knowledge --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.ok(
      checked.text.includes(path.join(packsDir, 'promises-knowledge', 'knowledge', packLocalKnowledgeFile)),
      `the refusal names the file it looked for: ${checked.text}`,
    );
    assert.match(checked.text, /the bundle ships no knowledge/, `and says there is no second place to look: ${checked.text}`);
  } finally {
    await dispose();
  }
});

/**
 * A rule only the drill-down variant's Loop names, and nothing in its contract does.
 *
 * The predicate is deliberately dull — a period is at most a number no synthesis would ever reach —
 * because what this rule is for is being *named in one place only*: a rule a Loop applies and the
 * contract's summary list leaves out is still a rule the Campaign will run, and a check that only
 * read the outer graph would pass a pack that fails at its first drill-down.
 */
const loopOnlyRule = `id: loop-only-rule
version: '1'
title: The clock period the loop just read is a period at all
requires:
  - type: clock_period
subject:
  type: clock_period
predicate:
  op: lte
  threshold: 99
  unit: ns
`;

/** The drill-down variant's Loop judge node, with one more rule appended to the two it applies —
 *  named there and in no other file of the pack. */
async function nameALoopOnlyRule(packDir: string): Promise<void> {
  const at = path.join(packDir, 'graph.yml');
  const text = await readFile(at, 'utf8');
  const applies = '            - clock-period-at-most\n';
  assert.ok(text.includes(applies), 'the drill-down variant\'s loop is where its judge node applies its rules');
  await writeFile(at, text.replace(applies, `${applies}            - loop-only-rule\n`));
}

test('a rule a drill-down Loop names and the contract does not list is resolved through the pack like any other, and a miss there is refused in the same words', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // A pack whose judge node lives inside a Loop and nowhere else, applying a rule the pack carries
    // in its own `rules/`. What is checked before a Campaign starts has to be every rule the Campaign
    // would apply, wherever in the pack it is named: a Loop's rules are not a second class.
    await installDrillDown(packsDir, 'loop-rule-of-its-own', 3);
    await nameALoopOnlyRule(path.join(packsDir, 'loop-rule-of-its-own'));
    await writePackFiles(path.join(packsDir, 'loop-rule-of-its-own'), { 'rules/loop-only-rule.yml': loopOnlyRule });
    const checked = await himaCommand(host, h.workspace, '/hima pack check loop-rule-of-its-own --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, /^ {2}loop-only-rule@1: found in the pack$/m, `the Loop's own rule is resolved and its origin reported: ${checked.text}`);

    // The same pack again with no file to answer that id: refused at the check, in the words every
    // other miss is refused in, rather than at the Loop's first judge node an hour into a Campaign.
    await installDrillDown(packsDir, 'loop-rule-nowhere', 3);
    await nameALoopOnlyRule(path.join(packsDir, 'loop-rule-nowhere'));
    const missed = await himaCommand(host, h.workspace, '/hima pack check loop-rule-nowhere --site local');
    assert.equal(missed.kind, 'error', missed.text);
    assert.match(missed.text, /unknown rule "loop-only-rule"/, missed.text);
    assert.ok(
      missed.text.includes(path.join(packsDir, 'loop-rule-nowhere', 'rules', 'loop-only-rule.yml')),
      `naming the pack's own rules folder: ${missed.text}`,
    );
    assert.ok(
      missed.text.includes(path.join(repoRoot, 'packages/harness', 'rules', 'loop-only-rule.yml')),
      `and the bundle's: ${missed.text}`,
    );
  } finally {
    await dispose();
  }
});

test('a rule file the pack folder holds and this machine cannot read is an error naming the path, never a quiet fall back to the bundle', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  const unreadable = path.join(packsDir, 'unreadable-rule', 'rules', 'clock-period-at-most.yml');
  try {
    await writePackVariant(packsDir, 'unreadable-rule', [], [], timingProbePackId, { 'rules/clock-period-at-most.yml': packLocalRule });
    // A file that is there and will not open is not a file that is absent. The pack said which rule
    // its Campaign runs on; a check that answered "found in the bundle" here would be reporting a
    // different rule than the one the Campaign would have applied if it could.
    await chmod(unreadable, 0o000);
    const checked = await himaCommand(host, h.workspace, '/hima pack check unreadable-rule --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.ok(checked.text.includes(unreadable), `the error names the file it could not read: ${checked.text}`);
    assert.doesNotMatch(checked.text, /clock-period-at-most@1: found in the bundle/, `and resolved nothing behind the pack's back: ${checked.text}`);
  } finally {
    // Put the permissions back before the home is removed, or the removal cannot read the directory.
    await chmod(unreadable, 0o644).catch(() => undefined);
    await dispose();
  }
});

test('a pack whose output names a reader outside its own readers/ is refused when the pack is loaded, rather than resolving a file beyond the pack folder', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // A reader id names a file under the pack's own `readers/` since #57, so it is held to the same
    // shape a rule id and a chooser id are. Unheld, `../` in one of them is a path out of the pack
    // folder that the check would then report as pack-origin — a file nobody installed, answering
    // for the pack.
    await writePackVariant(packsDirOf(h), 'reader-outside', [['    reader: dc-qor-report', '    reader: ../../../outside']]);
    const refused = await himaCommand(host, h.workspace, '/hima pack check reader-outside --site local');
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(
      refused.text,
      /a reader id is lowercase letters, digits and dashes/,
      `the refusal says what a reader id may be, before anything is joined to a path: ${refused.text}`,
    );
  } finally {
    await dispose();
  }
});

test('a reader-declaration path that is ENOTDIR is an error naming the path, never a quiet fall back to the bundle', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // `readers` itself a plain file rather than a directory: the pack's own declaration cannot be
    // read at `readers/dc-qor-report.yml` because the path passes through a file where a directory
    // was expected — Node calls that ENOTDIR, and it is a fault this machine hit, not a pack that
    // declared nothing. A check that preflighted this with `existsSync` sees only "not there" and
    // moves on to the registry, reporting the *bundle's* reader for a pack that shadowed it with a
    // file the check never opened.
    await writePackVariant(packsDir, 'reader-dir-is-a-file', [], [], timingProbePackId, { readers: 'not a directory\n' });
    const declaredAt = path.join(packsDir, 'reader-dir-is-a-file', 'readers', 'dc-qor-report.yml');
    const checked = await himaCommand(host, h.workspace, '/hima pack check reader-dir-is-a-file --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.ok(checked.text.includes(declaredAt), `the error names the reader-declaration path it could not open: ${checked.text}`);
    assert.doesNotMatch(
      checked.text,
      /dc-qor-report@1 reads qorReport: found in the bundle/,
      `and did not fall back to the bundle behind the pack's back: ${checked.text}`,
    );
  } finally {
    await dispose();
  }
});

test('a chooser that resolved and then failed its binding is reported with both where it came from and what is wrong with it', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // The pack's own copy of the chooser — so the origin line has something to say that the bundle's
    // would not — and a guard band that inverts what a guard band is for. Both facts are the check's
    // to report: which file answered the id is not cancelled by the binding being wrong, and a person
    // deciding which of two files to edit needs to be told which one was read.
    await writePackVariant(packsDirOf(h), 'own-chooser-bad-bind', [], [...graphForLegacyTimingPush, ['        guardBandNs: 0.05', '        guardBandNs: -0.1']], timingProbePackId, {
      'choosers/timing-push.yml': packLocalChooser,
    });
    const checked = await himaCommand(host, h.workspace, '/hima pack check own-chooser-bad-bind --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(
      checked.text,
      /^ {2}timing-push@2 chooses at next-period: found in the pack, and node "next-period" binds -0\.1 to chooser parameter "guardBandNs"/m,
      `the chooser line says both where the file came from and what is wrong: ${checked.text}`,
    );
  } finally {
    await dispose();
  }
});

test('a directory named like a knowledge file is not a knowledge file: the check says so rather than counting it as resolved', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    await writePackVariant(packsDir, 'knowledge-is-a-directory', [['rules:', knowledgeBlock]]);
    // Nothing can read a directory as Markdown, so a pack whose `knowledge/` holds one where a file
    // was promised is a pack whose Model moments would open without the thing they were composed to
    // read — which is the very case this check exists to catch, and "it is there" is not the question.
    await mkdir(path.join(packsDir, 'knowledge-is-a-directory', 'knowledge', packLocalKnowledgeFile), { recursive: true });
    const checked = await himaCommand(host, h.workspace, '/hima pack check knowledge-is-a-directory --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /is not a plain file/, `the refusal says what is wrong with it: ${checked.text}`);
    assert.doesNotMatch(
      checked.text,
      new RegExp(`${packLocalKnowledgeFile.replace('.', '\\.')} \\(${packLocalKnowledgePurpose}\\): found in the pack$`, 'm'),
      `and does not count it as resolved: ${checked.text}`,
    );
  } finally {
    await dispose();
  }
});

test('a symlink standing where a knowledge file goes is not a knowledge file: the check refuses it rather than reading pack-local through a link to outside the pack', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    await writePackVariant(packsDir, 'knowledge-is-a-symlink', [['rules:', knowledgeBlock]]);
    // A symlink to a real file elsewhere on this machine "is there" and, followed, "is a file" —
    // exactly what a check built on `statSync` reports, and exactly the loophole `lstatSync` closes:
    // the *entry itself*, not whatever it points at, has to be the plain file the contract promised.
    // Domain knowledge is what a HimaPack's own folder carries (CONTEXT.md); a link out of it is not
    // that, however real the file on the other end is.
    const outside = path.join(h.home, 'outside-knowledge.md');
    await writeFile(outside, '# Not part of this pack\n');
    const knowledgeDir = path.join(packsDir, 'knowledge-is-a-symlink', 'knowledge');
    await mkdir(knowledgeDir, { recursive: true });
    await symlink(outside, path.join(knowledgeDir, packLocalKnowledgeFile));
    const checked = await himaCommand(host, h.workspace, '/hima pack check knowledge-is-a-symlink --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /is not a plain file/, `a symlink is refused the way a directory is: ${checked.text}`);
    assert.doesNotMatch(
      checked.text,
      new RegExp(`${packLocalKnowledgeFile.replace('.', '\\.')} \\(${packLocalKnowledgePurpose}\\): found in the pack$`, 'm'),
      `and is not counted as resolved: ${checked.text}`,
    );
  } finally {
    await dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// Preparation: a Campaign gets a workspace with the flow copied into it.
// ---------------------------------------------------------------------------------------------

test('preparing a campaign on the local site creates its workspace, copies the flow into it, and records what it prepared', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, flowRoot, dispose } = local;
  const campaign = `hima-test-${randomUUID()}`;
  try {
    clearRemoteCommands();
    const prepared = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(prepared.kind, 'success', prepared.text);
    const workspace = path.join(await realpath(h.workspace), campaign);
    assert.match(prepared.text, new RegExp(`^prepared ${workspace.replaceAll('/', '\\/')} `), prepared.text);

    // The flow copy is where the anatomy says it is, and it holds the six pieces the contract names.
    for (const piece of ['Makefile', 'flows', 'manifests', 'tools', 'build/opene902', 'sources/opene902']) {
      assert.ok(await isThere(path.join(workspace, 'flow', piece)), `the flow copy holds ${piece}`);
    }
    assert.ok((await stat(path.join(workspace, 'flow', 'Makefile'))).isFile(), 'the makefile is a file, copied, not a directory');
    assert.ok((await stat(path.join(workspace, 'flow', 'sources/opene902'))).isDirectory(), 'the design\'s sources came across as a tree');

    // `workspace.json` says what the workspace is, including the one thing nothing else records: the
    // container name a later cleanup would need.
    const file = JSON.parse(await readFile(path.join(workspace, 'workspace.json'), 'utf8'));
    assert.equal(file.campaign, campaign);
    assert.deepEqual(file.pack, { id: timingProbePackId, version: '2', digest: packDigestOf(path.join(packsDirOf(h), timingProbePackId)) });
    assert.equal(file.site, 'local');
    assert.equal(file.design, 'opene902');
    assert.equal(file.flowRoot, flowRoot);
    assert.equal(file.workspace, workspace);
    assert.equal(file.containerName, `hima-${campaign}`, 'the campaign\'s own container, never the site\'s');
    assert.deepEqual(file.copied, ['Makefile', 'flows', 'manifests', 'tools', 'build/opene902', 'sources/opene902']);
    assert.match(file.preparedAt, /^\d{4}-\d{2}-\d{2}T/);

    const runId = prepared.runId!;
    assert.equal(host.ctx.hima.ledger.run(runId)?.campaignId, campaign, 'the run belongs to the campaign it prepared for');
    const records = workspaceRecords(host, runId);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.event, 'prepared');
    assert.equal(records[0]!.writer, 'executor', 'the executor records what it did on the site');
    assert.equal(records[0]!.workspace, workspace);
    assert.equal(records[0]!.containerName, `hima-${campaign}`);
    assert.equal(records[0]!.flowRoot, flowRoot);
    assert.deepEqual(records[0]!.copied, file.copied, 'the record and the file agree on what was copied');

    // Every command that reached the channel was workspace plumbing, and every path it named was
    // inside the workspace — except the flow being read, which is the copy's source.
    const sent = remoteCommands();
    assert.ok(sent.length > 0, 'preparation ran commands');
    for (const { argv, wire } of sent) {
      assert.ok(['cat', 'mkdir', 'cp', 'tee'].includes(argv[0]!), `not a preparation verb: ${JSON.stringify(argv)}`);
      assert.equal(wire, argv.map(quote).join(' '), `the wire is not every argv word independently quoted: ${JSON.stringify({ argv, wire })}`);
    }
    for (const { argv } of sent.filter((c) => c.argv[0] === 'mkdir' || c.argv[0] === 'tee')) {
      assert.ok(argv.at(-1)!.startsWith(workspace), `a write outside the workspace: ${JSON.stringify(argv)}`);
    }
    // Both ends of a copy are the paths the two decisions resolved, so the source is the flow root as
    // this machine really holds it — the permit resolves before it allows, symlinks and all.
    const realFlowRoot = await realpath(flowRoot);
    for (const { argv } of sent.filter((c) => c.argv[0] === 'cp')) {
      assert.ok(argv.at(-2)!.startsWith(realFlowRoot), `a copy from somewhere other than the bound flow root: ${JSON.stringify(argv)}`);
      assert.ok(argv.at(-1)!.startsWith(`${workspace}/flow`), `a copy to somewhere other than the flow copy: ${JSON.stringify(argv)}`);
    }
  } finally {
    await dispose();
  }
});

test('preparing the same campaign twice copies nothing the second time and says so', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const campaign = `hima-test-${randomUUID()}`;
  try {
    const first = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(first.kind, 'success', first.text);
    const workspace = path.join(await realpath(h.workspace), campaign);
    // Something a generation would have produced. A second preparation that copied the flow again
    // over the top of it would destroy work nobody asked it to.
    const marker = path.join(workspace, 'flow', 'results-of-a-generation.txt');
    await writeFile(marker, 'a generation left this here\n');
    const preparedAt = JSON.parse(await readFile(path.join(workspace, 'workspace.json'), 'utf8')).preparedAt;

    clearRemoteCommands();
    const again = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(again.kind, 'success', again.text);
    assert.match(again.text, /^already prepared: /, again.text);
    assert.match(again.text, /nothing was copied/, again.text);
    assert.equal(await readFile(marker, 'utf8'), 'a generation left this here\n', 'the workspace was left exactly as it was');
    assert.equal(
      JSON.parse(await readFile(path.join(workspace, 'workspace.json'), 'utf8')).preparedAt,
      preparedAt,
      'the workspace still says when it was really prepared',
    );
    assert.deepEqual(
      remoteCommands().filter((c) => c.argv[0] !== 'cat'),
      [],
      'nothing but the one read that found the workspace already there was run',
    );
    const records = workspaceRecords(host, again.runId!);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.event, 'reused', 'a run that found its workspace says which one it used');
    assert.equal(records[0]!.preparedAt, preparedAt, 'and when that workspace was really prepared, not now');
  } finally {
    await dispose();
  }
});

test('a workspace that is there but carries no workspace.json is not prepared over the top of', async (t) => {
  // What a preparation that died halfway leaves: the directory, and none of the file that says what
  // is in it. Copying into it would nest each piece of the flow inside a directory of its own name,
  // and nothing in this harness removes a path on a Site, so the answer is to say so and stop.
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const campaign = `hima-test-${randomUUID()}`;
  try {
    await mkdir(path.join(h.workspace, campaign, 'flow'), { recursive: true });
    clearRemoteCommands();
    const answer = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(answer.kind, 'error', answer.text);
    assert.match(answer.text, /half-prepared/, answer.text);
    assert.deepEqual(
      remoteCommands().filter((c) => ['mkdir', 'cp', 'tee'].includes(c.argv[0]!)),
      [],
      'nothing was created and nothing was copied',
    );
    assert.ok(!(await isThere(path.join(h.workspace, campaign, 'flow', 'Makefile'))), 'the flow was not copied in');
  } finally {
    await dispose();
  }
});

test('a workspace prepared for another design is not reused for this one: it says whose it is and prepares nothing', async (t) => {
  // A workspace is one Campaign's copy of one pack's flow, bound by one Site. The Site owner rebinds
  // `design:`, or a second pack is prepared under the same campaign id, and the directory is still
  // there — but the flow copied for the one is not the flow the other's tools run in. Answering
  // "already prepared" would hand #13 a workspace prepared for something else to run a generation in.
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, flowRoot, dispose } = local;
  const campaign = `hima-test-${randomUUID()}`;
  try {
    const first = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(first.kind, 'success', first.text);
    const workspace = path.join(await realpath(h.workspace), campaign);

    // The one thing changed about the Site: what it binds for `design`. The permit's roots and the
    // flow root are what they were, so nothing but the binding can account for the answer below.
    await writeLocalSite(h, {
      allowedReadRoots: [h.workspace, flowRoot],
      allowedWriteRoots: [h.workspace],
      bindings: { flowRoot, design: 'opene901', workspaceRoot: h.workspace },
    });

    clearRemoteCommands();
    const again = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(again.kind, 'error', again.text);
    assert.match(again.text, /that workspace belongs to/, again.text);
    assert.match(again.text, /design opene902/, `the answer names what the workspace really is for: ${again.text}`);
    assert.match(again.text, /asked for design opene901/, `and what this preparation asked for: ${again.text}`);
    assert.deepEqual(recordsOf(host, again.runId!), [], 'a workspace that belongs to another preparation is recorded as nobody\'s');
    assert.deepEqual(workspaceRecords(host, again.runId!), [], 'no second workspace record');
    for (const { argv } of remoteCommands()) {
      assert.ok(readOnlyProbes.has(argv[0]!), `more than a read was run to find out whose the workspace is: ${JSON.stringify(argv)}`);
    }
    // And the workspace is exactly as the first preparation left it.
    const file = JSON.parse(await readFile(path.join(workspace, 'workspace.json'), 'utf8'));
    assert.equal(file.design, 'opene902', 'the workspace still says what it was really prepared for');
  } finally {
    await dispose();
  }
});

test('a workspace prepared from a shorter copy list than the pack now declares is not reused: it names the piece that is missing and copies nothing', async (t) => {
  // This is 5bb2903 read back. That commit added the flow's `tools/` to the contract's copy list,
  // because the Design Zoo's prepare target runs a script out of it; a workspace prepared before it
  // holds a flow copy without `tools/`. Reusing that workspace would run the very failure the commit
  // fixed, silently, behind "already prepared: nothing was copied" — so what was copied is compared
  // like the other five things a workspace records about itself.
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, flowRoot, dispose } = local;
  const campaign = `hima-test-${randomUUID()}`;
  try {
    const first = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(first.kind, 'success', first.text);
    const workspace = path.join(await realpath(h.workspace), campaign);

    // The one thing changed: the pack's copy list gains a piece the flow root really has. Same pack
    // id, same site, same design, same flow root — nothing but the copy list can account for the
    // answer below.
    await mkdir(path.join(flowRoot, 'scripts'), { recursive: true });
    await writeFile(path.join(flowRoot, 'scripts', 'prepare_inputs.sh'), '# a piece the flow gained\n');
    const contractAt = path.join(packsDirOf(h), timingProbePackId, 'contract.yml');
    const contract = await readFile(contractAt, 'utf8');
    assert.ok(contract.includes('    - Makefile\n'), 'the shipped contract still states the copy list this test grows');
    await writeFile(contractAt, contract.replace('    - Makefile\n', '    - Makefile\n    - scripts\n'));

    clearRemoteCommands();
    const again = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(again.kind, 'error', again.text);
    assert.match(again.text, /missing scripts/, `the answer names the piece the flow copy does not carry: ${again.text}`);
    assert.deepEqual(recordsOf(host, again.runId!), [], 'a workspace prepared from another copy list is recorded as nobody\'s');
    assert.deepEqual(workspaceRecords(host, again.runId!), [], 'no second workspace record');
    for (const { argv } of remoteCommands()) {
      assert.ok(readOnlyProbes.has(argv[0]!), `more than a read was run to find out what the workspace carries: ${JSON.stringify(argv)}`);
    }
    assert.ok(!(await isThere(path.join(workspace, 'flow', 'scripts'))), 'and nothing was copied into the workspace');
  } finally {
    await dispose();
  }
});

test('a dangling symlink where the workspace goes is refused: a write would follow it wherever it points', async (t) => {
  // The tail below the deepest resolvable ancestor is not empty space. A symlink to something that is
  // not there exists, fails to resolve, and `cp -R` writes straight through it — at the link's target,
  // which is exactly the write outside the permit's roots the decision exists to stop.
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const campaign = `hima-test-${randomUUID()}`;
  const pointsAt = path.join(h.home, 'outside-the-write-root');
  try {
    await symlink(pointsAt, path.join(h.workspace, campaign));
    clearRemoteCommands();
    const refused = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /present but not resolvable/, refused.text);
    const records = recordsOf(host, refused.runId!);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.type, 'refusal');
    assert.equal(records[0]!.writer, 'shell', 'the shell refuses on the permit');
    assert.deepEqual(workspaceRecords(host, refused.runId!), [], 'nothing was prepared');
    assert.deepEqual(
      remoteCommands().filter((c) => ['mkdir', 'cp', 'tee'].includes(c.argv[0]!)),
      [],
      'nothing was created and nothing was copied',
    );
    assert.ok(!(await isThere(pointsAt)), 'the link\'s target was not written through');
  } finally {
    await dispose();
  }
});

test('a workspace.json that cannot be read as one is an answer, not a crash', async (t) => {
  // What a preparation killed during the `tee` leaves: a file that is there and is not the record it
  // was going to be. That is the half-prepared workspace the guidance already exists for, and a
  // person must be told it rather than handed a stack trace.
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    for (const [what, content] of [['not-json', 'workspace.jso'], ['wrong-shape', '{"format":1,"campaign":"c"}']] as const) {
      const campaign = `hima-test-${what}-${randomUUID()}`;
      await mkdir(path.join(h.workspace, campaign), { recursive: true });
      await writeFile(path.join(h.workspace, campaign, 'workspace.json'), `${content}\n`);
      clearRemoteCommands();
      const answer = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign ${campaign}`);
      assert.equal(answer.kind, 'error', answer.text);
      assert.match(answer.text, /half-prepared/, answer.text);
      assert.match(answer.text, /move or remove it yourself/, answer.text);
      assert.deepEqual(workspaceRecords(host, answer.runId!), [], `nothing was recorded for the ${what} workspace`);
      assert.deepEqual(
        remoteCommands().filter((c) => ['mkdir', 'cp', 'tee'].includes(c.argv[0]!)),
        [],
        `nothing was created and nothing was copied over the ${what} workspace`,
      );
    }
  } finally {
    await dispose();
  }
});

test('a campaign whose workspace root is outside the permit\'s write roots is refused before anything is created', async (t) => {
  // `h.home` exists and resolves; it is simply not under the one write root the permit allows.
  const local = await localPackHome(t, { bindings: (h, flowRoot) => ({ flowRoot, design: 'opene902', workspaceRoot: h.home }) });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    clearRemoteCommands();
    const refused = await himaCommand(host, h.workspace, `/hima pack prepare ${timingProbePackId} --site local --campaign hima-test-refused`);
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /outside the permitted write roots/, refused.text);
    const records = recordsOf(host, refused.runId!);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.type, 'refusal');
    assert.equal(records[0]!.writer, 'shell', 'the shell refuses on the permit');
    assert.deepEqual(workspaceRecords(host, refused.runId!), [], 'nothing was prepared');
    assert.deepEqual(remoteCommands(), [], 'the refusal came before any command was run at all');
  } finally {
    await dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The channel's third allowlist: the verbs that write a workspace.
// ---------------------------------------------------------------------------------------------

test('the channel admits exactly the verbs workspace preparation runs, and they are nobody else\'s', () => {
  // The rule step 1 set for the read-only probes and #10 kept for the job plumbing: an allowlist
  // wider than the channel's own use is permission granted on a customer's Site ahead of any caller
  // needing it. These three are what preparation runs — a directory, a copy, and the small JSON that
  // says what was prepared — and `rm` is not among them, because nothing here removes anything.
  assert.deepEqual([...workspacePlumbing].sort(), ['cp', 'mkdir', 'tee'], "the channel's workspace list is exactly the verbs preparation runs");
  assert.ok(!workspacePlumbing.has('rm'), 'nothing in this harness removes a path on a Site');
  for (const verb of workspacePlumbing) {
    assert.ok(!readOnlyProbes.has(verb), `${verb} writes; it must not also be listed as a read-only probe`);
    assert.ok(!jobPlumbing.has(verb), `${verb} belongs to workspace preparation, not to the job plumbing`);
  }
});

// ---------------------------------------------------------------------------------------------
// The stage: how far up the pack authoring pipeline a folder has come (#63).
// ---------------------------------------------------------------------------------------------

/** A record of the pipeline with every section it must hold, each saying something. */
const recordHolding = (sections: readonly string[], say = 'something this section says'): string =>
  sections.map((section) => `## ${section}\n\n${say}\n`).join('\n');

/** A record with one of its sections taken out, which is what a half-written one looks like. */
const recordWithout = (sections: readonly string[], missing: string): string =>
  recordHolding(sections.filter((section) => section !== missing));

test('the shipped pack has never been through the authoring pipeline, and the check says so without holding it against it', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const checked = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site local`);
    assert.equal(checked.kind, 'success', checked.text);
    // Hand-written, and as fit as any pack the pipeline authors: the ladder reports, it does not judge.
    assert.match(checked.text, /^pack opene902-timing-probe@2 on site local: fit\b/, checked.text);
    assert.match(checked.text, /^stage: none; next: intent — INTENT\.md, written by \/hima-grill$/m, checked.text);
  } finally {
    await dispose();
  }
});

test('a pack folder whose intent record is missing a section stays below the first rung, and the check names the section', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    await writePackVariant(packsDir, 'half-grilled-probe', [], []);
    // A perfectly good spec beside a record that does not validate. The ladder is cumulative, so the
    // folder is at `none` and not at `specified`: the record is what the spec was written from, and a
    // ladder that skipped the broken rung would call a folder specified against an intent nobody can
    // read — which is exactly the case the spec stage is told to refuse rather than paper over.
    await writePackFiles(path.join(packsDir, 'half-grilled-probe'), {
      'INTENT.md': recordWithout(HIMA_INTENT_SECTIONS, 'Ambiguities resolved'),
      'SPEC.md': recordHolding(HIMA_SPEC_SECTIONS),
    });

    const checked = await himaCommand(host, h.workspace, '/hima pack check half-grilled-probe --site local');
    assert.match(checked.text, /^stage: none; next: intent — INTENT\.md, written by \/hima-grill; INTENT\.md is there and does not validate: no "Ambiguities resolved" section$/m, checked.text);
    assert.doesNotMatch(checked.text, /stage: specified/, `the spec beside it does not carry the folder past the rung it failed: ${checked.text}`);
  } finally {
    await dispose();
  }
});

test('a pack folder holding both records and a contract and graph that load stands at compiled, and the check says the test stage is next', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    await writePackVariant(packsDir, 'compiled-probe', [], []);
    // The fabric record goes in with them (#64): the `compiled` rung is both halves — a pack that
    // loads, and a stage answerable for having written it — so a folder holding two YAML files
    // somebody copied in is a pack nothing has compiled.
    await writePackFiles(path.join(packsDir, 'compiled-probe'), {
      'INTENT.md': recordHolding(HIMA_INTENT_SECTIONS),
      'SPEC.md': recordHolding(HIMA_SPEC_SECTIONS),
      'FABRIC.md': recordHolding(HIMA_FABRIC_SECTIONS),
    });

    const checked = await himaCommand(host, h.workspace, '/hima pack check compiled-probe --site local');
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, /^stage: compiled \(INTENT\.md, SPEC\.md, contract\.yml, graph\.yml, FABRIC\.md validate\); next: tested — TEST\.md, written by \/hima-test$/m, checked.text);
  } finally {
    await dispose();
  }
});

test('a folder the pipeline has only grilled is checked as the stage it is, not as a pack nobody installed', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const dir = path.join(packsDirOf(h), 'grilled-probe');
    await mkdir(dir, { recursive: true });
    await writePackFiles(dir, { 'INTENT.md': recordHolding(HIMA_INTENT_SECTIONS) });

    const checked = await himaCommand(host, h.workspace, '/hima pack check grilled-probe --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.equal(checked.text, [
      'pack grilled-probe on site local: unfit — not compiled',
      'stage: intent (INTENT.md validate); next: specified — SPEC.md, written by /hima-spec',
    ].join('\n'), checked.text);
    // And a name nobody installed is still a name nobody installed: the ladder answers for folders
    // that are there, and says nothing about one that is not.
    const absent = await himaCommand(host, h.workspace, '/hima pack check never-installed-probe --site local');
    assert.equal(absent.kind, 'error', absent.text);
    assert.match(absent.text, /unknown pack "never-installed-probe"/, absent.text);
  } finally {
    await dispose();
  }
});

test('a record holding a heading that is not one of its sections does not validate, and the check names the first deviation', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    const dir = path.join(packsDir, 'extra-heading-probe');
    await mkdir(dir, { recursive: true });
    // Exactly the five sections, each saying something, and one heading of the author's own after
    // them. "Exactly these sections, in this order, and no other heading" is what both skill bodies
    // say, so a record that holds another heading is a record the stage did not write as instructed
    // — and the next stage has to be able to tell.
    await writePackFiles(dir, { 'INTENT.md': `${recordHolding(HIMA_INTENT_SECTIONS)}\n## Notes\n\nsomething else entirely\n` });

    const checked = await himaCommand(host, h.workspace, '/hima pack check extra-heading-probe --site local');
    assert.match(
      checked.text,
      /^stage: none; next: intent — INTENT\.md, written by \/hima-grill; INTENT\.md is there and does not validate: has "## Notes" after "## Knowledge applied", which is not a section of the intent record$/m,
      checked.text,
    );
  } finally {
    await dispose();
  }
});

test('a record whose sections are in another order, or hold one of them twice, does not validate either', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    // Reordered: every section there, every one saying something, and two of them swapped. A record
    // read section by section would call this one fine; the sections of a record are a sequence, and
    // the stage that reads it next reads them in the order the body declares.
    const reordered = [...HIMA_INTENT_SECTIONS];
    [reordered[2], reordered[3]] = [reordered[3]!, reordered[2]!];
    const at = path.join(packsDir, 'reordered-probe');
    await mkdir(at, { recursive: true });
    await writePackFiles(at, { 'INTENT.md': recordHolding(reordered) });
    const checkedOrder = await himaCommand(host, h.workspace, '/hima pack check reordered-probe --site local');
    assert.match(
      checkedOrder.text,
      /INTENT\.md is there and does not validate: has "## Ambiguities resolved" where "## Answers" belongs/,
      checkedOrder.text,
    );

    // Twice: a stage that wrote the record in two goes and appended rather than rewrote.
    const twice = path.join(packsDir, 'duplicated-probe');
    await mkdir(twice, { recursive: true });
    await writePackFiles(twice, { 'INTENT.md': `${recordHolding(HIMA_INTENT_SECTIONS)}\n## Business\n\nand again\n` });
    const checkedTwice = await himaCommand(host, h.workspace, '/hima pack check duplicated-probe --site local');
    assert.match(
      checkedTwice.text,
      /INTENT\.md is there and does not validate: holds "## Business" twice/,
      checkedTwice.text,
    );
  } finally {
    await dispose();
  }
});

test('a folder whose contract and graph parse but do not hang together is not compiled, and the check answers the ladder beside the loader\'s own words', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    // Both files parse against their schemas; the pack does not load, because the contract names a
    // tool file the folder does not hold. `compiled` has to mean what `loadPack` means, or a folder
    // could stand at a rung the thing that runs packs rejects.
    await writePackVariant(packsDir, 'half-compiled-probe', [['file: tools/synth.sh', 'file: tools/absent.sh']], []);
    await writePackFiles(path.join(packsDir, 'half-compiled-probe'), {
      'INTENT.md': recordHolding(HIMA_INTENT_SECTIONS),
      'SPEC.md': recordHolding(HIMA_SPEC_SECTIONS),
    });

    const checked = await himaCommand(host, h.workspace, '/hima pack check half-compiled-probe --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /^stage: specified \(INTENT\.md, SPEC\.md validate\); next: compiled — contract\.yml, graph\.yml and FABRIC\.md, written by \/hima-fabric; contract\.yml is there and does not load: /m, checked.text);
    assert.match(checked.text, /tools\/absent\.sh/, `and the loader's own words say what is wrong with it: ${checked.text}`);
  } finally {
    await dispose();
  }
});

test('the rungs above compiled are cumulative too, a released pack says there is nothing after it, and a test record this ledger cannot vouch for carries no folder past compiled', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    const authored = {
      'INTENT.md': recordHolding(HIMA_INTENT_SECTIONS),
      'SPEC.md': recordHolding(HIMA_SPEC_SECTIONS),
      'FABRIC.md': recordHolding(HIMA_FABRIC_SECTIONS),
    };
    /** A test record with every section and the one line the rung above it rests on. */
    const testRecord = (run: string): string =>
      HIMA_TEST_SECTIONS.map((section) => `## ${section}\n\n${section === 'Run' ? `run: ${run}` : 'something this section says'}\n`).join('\n');
    // A run id of the right shape that no ledger holds: the ladder is about files, and whether the
    // Run behind them is real is the host's own question, asked two cases below.
    const madeUp = `run-${randomUUID()}`;

    // Tested, as the *ladder* reads it: the test record beside a folder that already compiles.
    await writePackVariant(packsDir, 'tested-probe', [], []);
    await writePackFiles(path.join(packsDir, 'tested-probe'), { ...authored, 'TEST.md': testRecord(madeUp) });
    assert.equal(packStageOf(packsDir, 'tested-probe')!.stage, 'tested',
      'the ladder is a question about files, and these files are a tested folder');

    // And as the *host* reads it, which is not the same question (#64). A test record is evidence,
    // and the evidence is a Run in this ledger: a folder naming one nobody holds has not been tested
    // here, so the check answers the rung it really stands on and says why.
    const tested = await himaCommand(host, h.workspace, '/hima pack check tested-probe --site local');
    assert.equal(tested.kind, 'error', tested.text);
    assert.match(
      tested.text,
      new RegExp(`^stage: compiled \\(INTENT\\.md, SPEC\\.md, contract\\.yml, graph\\.yml, FABRIC\\.md validate\\); next: tested — TEST\\.md, written by /hima-test; test record names run ${madeUp}, which this ledger does not hold$`, 'm'),
      tested.text,
    );
    assert.match(tested.text, new RegExp(`^ {2}- test record names run ${madeUp}, which this ledger does not hold$`, 'm'),
      `and it is one of the errors that make the pack unfit: ${tested.text}`);

    // Released: the top of the ladder, where there is no next rung to name. The seal is written with
    // the harness's own hashes over the folder as it then stands, which is what `/hima pack release`
    // writes — and a released folder is checked against that seal and not against this machine's
    // ledger, because the ledger that holds a pack's test run is its author's and a pack is installed
    // wherever somebody installs it.
    await writePackVariant(packsDir, 'released-probe', [], []);
    const releasedDir = path.join(packsDir, 'released-probe');
    await writePackFiles(releasedDir, { ...authored, 'TEST.md': testRecord(madeUp) });
    await writePackFiles(releasedDir, { 'VERSION.yml': versionFileFor(releasedDir, { pack: 'released-probe', version: '2', run: madeUp }) });
    const released = await himaCommand(host, h.workspace, '/hima pack check released-probe --site local');
    assert.equal(released.kind, 'success', released.text);
    assert.match(released.text, /^stage: released \(INTENT\.md, SPEC\.md, contract\.yml, graph\.yml, FABRIC\.md, TEST\.md, VERSION\.yml validate\); nothing after it: this is the top of the ladder$/m, released.text);

    // A seal that names a version the contract does not: the one thing about a release nothing else
    // would catch, because every hash in it is right.
    await writePackVariant(packsDir, 'misversioned-probe', [], []);
    const misversioned = path.join(packsDir, 'misversioned-probe');
    await writePackFiles(misversioned, { ...authored, 'TEST.md': testRecord(madeUp) });
    await writePackFiles(misversioned, { 'VERSION.yml': versionFileFor(misversioned, { pack: 'misversioned-probe', version: '3', run: madeUp }) });
    // The ladder first, because this is a question about files alone: the seal is there, every hash
    // in it is right, and it names a version this contract does not — so the folder is tested and not
    // released, and the rung says which file to look at.
    const ladder = packStageOf(packsDir, 'misversioned-probe')!;
    assert.equal(ladder.stage, 'tested', JSON.stringify(ladder));
    assert.equal(ladder.next, 'released', JSON.stringify(ladder));
    assert.equal(ladder.issue, 'VERSION.yml is there and seals version 3, and contract.yml declares version 2', JSON.stringify(ladder));
    // And the same fault among the things that make the pack unfit, because a campaign must not run a
    // folder whose seal does not describe it.
    const wrongVersion = await himaCommand(host, h.workspace, '/hima pack check misversioned-probe --site local');
    assert.equal(wrongVersion.kind, 'error', wrongVersion.text);
    assert.match(wrongVersion.text, /^ {2}- VERSION\.yml is there and seals version 3, and contract\.yml declares version 2$/m, wrongVersion.text);

    // And cumulative above compiled as well as below it: a version file beside no test record is a
    // folder that has not been tested, whatever else is in it.
    await writePackVariant(packsDir, 'released-untested-probe', [], []);
    await writePackFiles(path.join(packsDir, 'released-untested-probe'), { ...authored, 'VERSION.yml': 'version: 1\n' });
    const skipped = await himaCommand(host, h.workspace, '/hima pack check released-untested-probe --site local');
    assert.match(skipped.text, /^stage: compiled \(INTENT\.md, SPEC\.md, contract\.yml, graph\.yml, FABRIC\.md validate\); next: tested — TEST\.md, written by \/hima-test$/m, skipped.text);
  } finally {
    await dispose();
  }
});

test('packStageOf answers absence only for a folder that is not there, and throws for an id that is not one and for a file standing where a pack folder should', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    // Not there: the one answer that is an absence.
    assert.equal(packStageOf(packsDir, 'never-installed-probe'), undefined);
    // Not a pack id at all: `loadPack`'s own refusal, in its own words, rather than a quiet
    // "no such folder" for a string no folder could ever be called.
    assert.throws(() => packStageOf(packsDir, 'Not A Pack Id'), (err: Error) => {
      assert.match(err.message, /invalid pack id "Not A Pack Id"/, err.message);
      assert.equal(err.constructor.name, 'PackNotFoundError', err.constructor.name);
      return true;
    });
    // There and not a directory: something is at that path, and answering "nothing installed" for it
    // would send a person to author a pack folder they cannot create.
    await writeFile(path.join(packsDir, 'a-file-probe'), 'not a pack folder at all\n');
    assert.throws(() => packStageOf(packsDir, 'a-file-probe'), (err: Error) => {
      assert.match(err.message, /a-file-probe/, err.message);
      return true;
    });
  } finally {
    await dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The three rungs #64 made real: what a fabric record, a test record and a version file must be for
// a folder to stand on them. The stages that write them are `pipeline-stages.test.ts`; what is here
// is the rungs' own words, on the cases those stages do not reach.
// ---------------------------------------------------------------------------------------------

test('a fabric record missing a section leaves the folder at specified, and the check names the section', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    await writePackVariant(packsDir, 'half-fabricked-probe', [], []);
    await writePackFiles(path.join(packsDir, 'half-fabricked-probe'), {
      'INTENT.md': recordHolding(HIMA_INTENT_SECTIONS),
      'SPEC.md': recordHolding(HIMA_SPEC_SECTIONS),
      'FABRIC.md': recordWithout(HIMA_FABRIC_SECTIONS, 'Gaps'),
    });

    const checked = await himaCommand(host, h.workspace, '/hima pack check half-fabricked-probe --site local');
    assert.match(
      checked.text,
      /^stage: specified \(INTENT\.md, SPEC\.md validate\); next: compiled — contract\.yml, graph\.yml and FABRIC\.md, written by \/hima-fabric; FABRIC\.md is there and does not validate: no "Gaps" section$/m,
      checked.text,
    );
  } finally {
    await dispose();
  }
});

test('a test record missing a section, or holding no run line, leaves the folder at compiled and the check says which', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    const compiled = {
      'INTENT.md': recordHolding(HIMA_INTENT_SECTIONS),
      'SPEC.md': recordHolding(HIMA_SPEC_SECTIONS),
      'FABRIC.md': recordHolding(HIMA_FABRIC_SECTIONS),
    };

    await writePackVariant(packsDir, 'half-tested-probe', [], []);
    await writePackFiles(path.join(packsDir, 'half-tested-probe'), { ...compiled, 'TEST.md': recordWithout(HIMA_TEST_SECTIONS, 'Refusals') });
    const missing = await himaCommand(host, h.workspace, '/hima pack check half-tested-probe --site local');
    assert.match(
      missing.text,
      /^stage: compiled \(INTENT\.md, SPEC\.md, contract\.yml, graph\.yml, FABRIC\.md validate\); next: tested — TEST\.md, written by \/hima-test; TEST\.md is there and does not validate: no "Refusals" section$/m,
      missing.text,
    );

    // Every section there, each saying something, and the one line the record is *about* — which
    // Run this pack was tested by — nowhere in it. A test record that names no Run is a claim with
    // no evidence behind it, and the rung above it is what rests on that evidence.
    await writePackVariant(packsDir, 'unrun-probe', [], []);
    await writePackFiles(path.join(packsDir, 'unrun-probe'), { ...compiled, 'TEST.md': recordHolding(HIMA_TEST_SECTIONS) });
    const unrun = await himaCommand(host, h.workspace, '/hima pack check unrun-probe --site local');
    assert.match(
      unrun.text,
      /^stage: compiled \([^)]+\); next: tested — TEST\.md, written by \/hima-test; TEST\.md is there and does not validate: its "Run" section holds no "run: <run id>" line$/m,
      unrun.text,
    );
  } finally {
    await dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The one walk (#64, fix pass 1): the folder held as plain files, by name and by kind, before
// anything about it is hashed. What is here is what the stages themselves never produce — a link
// where a seal should be, a link where a pack folder should be, a name no pack file can have — and
// which every face has to refuse in the same words all the same.
// ---------------------------------------------------------------------------------------------

/** The three records a folder needs to stand at `tested` on the ladder, the test record naming `run`. */
const authoredThrough = (run: string): Record<string, string> => ({
  'INTENT.md': recordHolding(HIMA_INTENT_SECTIONS),
  'SPEC.md': recordHolding(HIMA_SPEC_SECTIONS),
  'FABRIC.md': recordHolding(HIMA_FABRIC_SECTIONS),
  'TEST.md': HIMA_TEST_SECTIONS.map((section) => `## ${section}\n\n${section === 'Run' ? `run: ${run}` : 'something this section says'}\n`).join('\n'),
});

test('a VERSION.yml that is a link is refused naming it rather than read through, by the check and by the release, and the file it points at is untouched', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    const madeUp = `run-${randomUUID()}`;
    await writePackVariant(packsDir, 'linked-seal-probe', [], []);
    const dir = path.join(packsDir, 'linked-seal-probe');
    await writePackFiles(dir, authoredThrough(madeUp));
    // A perfectly valid seal for this folder — lying outside it, where nobody reviewing the folder
    // ever saw it. Read through the link, the check would call this folder released on somebody
    // else's bytes and the release would write over a file that is not in this pack at all.
    const outside = path.join(h.home, 'somebody-elses-seal.yml');
    const sealText = versionFileFor(dir, { pack: 'linked-seal-probe', version: '2', run: madeUp });
    await writeFile(outside, sealText);
    await symlink(outside, path.join(dir, 'VERSION.yml'));

    // Since #64's one reading of the folder, the refusal is the reading's and comes before any
    // question about the folder is asked: a folder whose seal is a link is not a folder of plain
    // files, so the check does not say which rung it stands on, the release writes nothing, and no
    // reader of it is ever pointed out of the folder.
    const checked = await himaCommand(host, h.workspace, '/hima pack check linked-seal-probe --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /VERSION\.yml is not a plain file \(a symlink, a socket or the like\), and a pack folder is plain files/, checked.text);

    const released = await himaCommand(host, h.workspace, '/hima pack release linked-seal-probe');
    assert.equal(released.kind, 'error', released.text);
    assert.match(released.text, /VERSION\.yml is not a plain file/, released.text);
    assert.equal(await readFile(outside, 'utf8'), sealText, 'and the file the link points at was not written over');
  } finally {
    await dispose();
  }
});

test('a pack folder that is a link out of the packs directory is refused naming it, by the ladder, by the check and by a run', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    // A real, loadable pack — outside the packs directory, where nothing installed it. Followed, its
    // contract, graph, rules and scripts would be checked and run as though somebody had.
    await writePackVariant(packsDir, 'linked-pack-probe', [], []);
    const elsewhere = path.join(h.home, 'not-installed-here');
    await mkdir(elsewhere, { recursive: true });
    const moved = path.join(elsewhere, 'linked-pack-probe');
    await rename(path.join(packsDir, 'linked-pack-probe'), moved);
    await symlink(moved, path.join(packsDir, 'linked-pack-probe'));

    assert.throws(() => packStageOf(packsDir, 'linked-pack-probe'), (err: Error) => {
      assert.match(err.message, /linked-pack-probe is not a directory: a pack folder is a plain directory under the packs directory/, err.message);
      return true;
    });
    const checked = await himaCommand(host, h.workspace, '/hima pack check linked-pack-probe --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /linked-pack-probe is not a directory: a pack folder is a plain directory under the packs directory/, checked.text);
    const ran = await himaCommand(host, h.workspace, '/hima run linked-pack-probe --site local --goal target_period_ns=2');
    assert.equal(ran.kind, 'error', ran.text);
    assert.match(ran.text, /linked-pack-probe is not a directory: a pack folder is a plain directory under the packs directory/, ran.text);
    assert.equal(ran.runId, undefined, 'and no Run was opened at all');
  } finally {
    await dispose();
  }
});

test('a hidden entry is not a file of a pack: the seal ignores it and a released folder stays released, while a name no pack file can have is refused before anything is hashed', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    const madeUp = `run-${randomUUID()}`;

    // A Mac writes `.DS_Store` into any folder somebody opens. It is not a file of the pack — nothing
    // in a pack can declare one, because `packFilePath` refuses a hidden segment — so a folder that
    // holds one must still hash, still seal and still stand released.
    await writePackVariant(packsDir, 'hidden-entry-probe', [], []);
    const hiddenDir = path.join(packsDir, 'hidden-entry-probe');
    await writePackFiles(hiddenDir, authoredThrough(madeUp));
    await writeFile(path.join(hiddenDir, '.DS_Store'), 'what the Finder left behind\n');
    await mkdir(path.join(hiddenDir, '.git'), { recursive: true });
    await writeFile(path.join(hiddenDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writePackFiles(hiddenDir, { 'VERSION.yml': versionFileFor(hiddenDir, { pack: 'hidden-entry-probe', version: '2', run: madeUp }) });
    const sealed = packVersionFile.parse(parse(await readFile(path.join(hiddenDir, 'VERSION.yml'), 'utf8')));
    assert.ok(!Object.keys(sealed.files).some((at) => at.startsWith('.')), `the seal lists no hidden entry: ${Object.keys(sealed.files).join(', ')}`);
    const stage = packStageOf(packsDir, 'hidden-entry-probe')!;
    assert.equal(stage.stage, 'released', JSON.stringify(stage));

    // A name a pack file cannot have — a quote, which a seal's YAML key would have to carry — is
    // refused where it is found, and not after a seal naming it has been written.
    await writePackVariant(packsDir, 'quoted-name-probe', [], []);
    const quotedDir = path.join(packsDir, 'quoted-name-probe');
    await writePackFiles(quotedDir, authoredThrough(madeUp));
    await writeFile(path.join(quotedDir, 'a "quoted" name.txt'), 'nothing a pack can declare\n');
    const refused = await himaCommand(host, h.workspace, '/hima pack release quoted-name-probe');
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /a "quoted" name\.txt is not a name a pack file can have/, refused.text);
    assert.ok(!existsSync(path.join(quotedDir, 'VERSION.yml')), 'and no seal was left behind for a folder that could not be sealed');

    // And the same name in a folder that *is* released: the check names the file rather than saying
    // the folder matches a seal it could not enumerate.
    await writePackVariant(packsDir, 'quoted-released-probe', [], []);
    const quotedReleased = path.join(packsDir, 'quoted-released-probe');
    await writePackFiles(quotedReleased, authoredThrough(madeUp));
    await writePackFiles(quotedReleased, { 'VERSION.yml': versionFileFor(quotedReleased, { pack: 'quoted-released-probe', version: '2', run: madeUp }) });
    await writeFile(path.join(quotedReleased, 'a "quoted" name.txt'), 'arrived after the seal\n');
    const named = await himaCommand(host, h.workspace, '/hima pack check quoted-released-probe --site local');
    assert.equal(named.kind, 'error', named.text);
    assert.match(named.text, /a "quoted" name\.txt is not a name a pack file can have/, named.text);
  } finally {
    await dispose();
  }
});

test('a hidden entry that is not a plain file is refused naming it: the digest, the release and a campaign all stop at a link nobody reviewing the folder can see', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    const madeUp = `run-${randomUUID()}`;
    await writePackVariant(packsDir, 'hidden-link-probe', [], []);
    const dir = path.join(packsDir, 'hidden-link-probe');
    await writePackFiles(dir, authoredThrough(madeUp));
    // A hidden name is left *out* of a pack's files, which is exactly why what stands under one has
    // to be asked about first: a folder holding a link out of itself is not a folder of plain files,
    // and a walk that skipped the name before it looked would call it one.
    const outside = path.join(h.home, 'not-a-file-of-this-pack.txt');
    await writeFile(outside, 'bytes nobody reviewing this pack folder ever saw\n');
    await symlink(outside, path.join(dir, '.linked'));

    const checked = await himaCommand(host, h.workspace, '/hima pack check hidden-link-probe --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /\.linked is not a plain file/, checked.text);
    const released = await himaCommand(host, h.workspace, '/hima pack release hidden-link-probe');
    assert.equal(released.kind, 'error', released.text);
    assert.match(released.text, /\.linked is not a plain file/, released.text);
    assert.ok(!existsSync(path.join(dir, 'VERSION.yml')), 'and nothing was sealed');
    const ran = await himaCommand(host, h.workspace, '/hima run hidden-link-probe --site local --goal target_period_ns=2');
    assert.equal(ran.kind, 'error', ran.text);
    assert.match(ran.text, /\.linked is not a plain file/, ran.text);
    assert.equal(ran.runId, undefined, 'and no Run was opened at all');

    // A dangling one is the same answer, and it is the one that could not be caught any later: every
    // other read of a pack folder is entitled to take `ENOENT` for "not there".
    await rm(path.join(dir, '.linked'));
    await symlink(path.join(h.home, 'nothing-is-here.txt'), path.join(dir, '.dangling'));
    const dangling = await himaCommand(host, h.workspace, '/hima pack check hidden-link-probe --site local');
    assert.equal(dangling.kind, 'error', dangling.text);
    assert.match(dangling.text, /\.dangling is not a plain file/,
      `a hidden link to nothing is refused naming it, not read as an absence: ${dangling.text}`);
  } finally {
    await dispose();
  }
});

test('a link under a hidden directory is refused naming it: a namespace nobody may declare is not a namespace nobody has to look at', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    const madeUp = `run-${randomUUID()}`;
    await writePackVariant(packsDir, 'hidden-subtree-probe', [], []);
    const dir = path.join(packsDir, 'hidden-subtree-probe');
    await writePackFiles(dir, authoredThrough(madeUp));
    // A hidden *directory* is left out of a pack's files exactly as a hidden file is — and that is
    // precisely why what stands underneath one has to be inspected. A walk that stopped at the
    // directory's own name would let `.state/` hold a link to anywhere on the machine while the
    // folder went on hashing, sealing and running as a folder of plain files.
    const outside = path.join(h.home, 'bytes-nobody-reviewing-this-pack-ever-saw.txt');
    await writeFile(outside, 'not a file of this pack\n');
    await mkdir(path.join(dir, '.state'), { recursive: true });
    await symlink(outside, path.join(dir, '.state', 'outside-link'));

    const checked = await himaCommand(host, h.workspace, '/hima pack check hidden-subtree-probe --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /\.state\/outside-link is not a plain file/, checked.text);
    const released = await himaCommand(host, h.workspace, '/hima pack release hidden-subtree-probe');
    assert.equal(released.kind, 'error', released.text);
    assert.match(released.text, /\.state\/outside-link is not a plain file/, released.text);
    assert.ok(!existsSync(path.join(dir, 'VERSION.yml')), 'and nothing was sealed');
    const ran = await himaCommand(host, h.workspace, '/hima run hidden-subtree-probe --site local --goal target_period_ns=2');
    assert.equal(ran.kind, 'error', ran.text);
    assert.match(ran.text, /\.state\/outside-link is not a plain file/, ran.text);
    assert.equal(ran.runId, undefined, 'and no Run was opened at all');

    // An ordinary file under that same hidden directory is not a fault and is not a file of the
    // pack: inspecting a hidden subtree is not the same as hashing one. The folder goes on hashing,
    // sealing and standing released, and the seal lists nothing under a hidden name.
    await rm(path.join(dir, '.state', 'outside-link'));
    await writeFile(path.join(dir, '.state', 'ordinary'), 'what some tool left behind\n');
    await writePackFiles(dir, { 'VERSION.yml': versionFileFor(dir, { pack: 'hidden-subtree-probe', version: '2', run: madeUp }) });
    const seal = packVersionFile.parse(parse(await readFile(path.join(dir, 'VERSION.yml'), 'utf8')));
    assert.ok(!Object.keys(seal.files).some((at) => at.startsWith('.')),
      `the seal lists nothing under a hidden name: ${Object.keys(seal.files).join(', ')}`);
    const fine = await himaCommand(host, h.workspace, '/hima pack check hidden-subtree-probe --site local');
    assert.doesNotMatch(fine.text, /\.state/, `and nothing about the hidden subtree is said any more: ${fine.text}`);
    assert.match(fine.text, /^stage: released \(/m, fine.text);
  } finally {
    await dispose();
  }
});

test('the one reading of a pack folder refuses a path whose second look is a different inode, and accepts the one whose two looks are the same file', async (t) => {
  // **Asserted at the module's seam, and here is why it is the one case that cannot be at the
  // host's.** Every other rule of the reading is about an arrangement of the filesystem a test can
  // set up and then ask the host about — a link, a socket, a name no pack file can have. This one is
  // about a *swap between two synchronous calls of this process*, and no second call of this process
  // can happen between them. What a test can hold is the comparison itself, over two real stats of
  // two real files: a file replaced by another ordinary file opens, `fstat`s as a plain file, and is
  // told apart from the inode the walk accepted by `dev` and `ino` alone.
  const h = await createHimaHome();
  try {
    const one = path.join(h.home, 'one.txt');
    const other = path.join(h.home, 'other.txt');
    await writeFile(one, 'the file the walk inspected\n');
    await writeFile(other, 'the file that took its name\n');
    const inspected = await stat(one);
    const replacement = await stat(other);
    assert.notEqual(`${String(inspected.dev)}:${String(inspected.ino)}`, `${String(replacement.dev)}:${String(replacement.ino)}`,
      'the two files really are two inodes, which is what makes the comparison mean anything');

    assert.throws(() => heldToOneInode(one, inspected, replacement), (err: Error) => {
      assert.match(err.message, new RegExp(`^${one.replaceAll('/', '\\/')} is not the file this walk inspected`), err.message);
      assert.match(err.message, /the folder changed while it was being read, and a pack is the bytes one reading of it found/, err.message);
      return true;
    }, 'a second look that finds another inode is refused naming the path, not read as the file that was checked');

    assert.doesNotThrow(() => heldToOneInode(one, inspected, inspected),
      'and two looks at one file are one file: the rule refuses a change, never an ordinary read');
  } finally {
    await h.dispose();
  }
});

/** This pack's own copy of the bundle's goal rule, at a version no bundled file carries, so that
 *  which file answered is visible in the check's own words rather than inferred. */
const OWN_GOAL_RULE = `# The pack's own copy of the goal rule (#57), at a version the bundle's file does not carry.
id: clock-period-at-most
version: '9'
title: This pack's own clock period rule
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

test('the check answers out of the one reading the pack was parsed from: a pack-local rule taken off the disk after the load is still the rule the check reports, and the bundle is still read where it lies', async () => {
  // **Asserted at the module's seam, and here is why.** What this is about is the window between
  // `startRun`'s one reading of the folder and the check it makes from that reading — two
  // synchronous calls of this process, with nothing a second call of this process can do in
  // between. Driving it through the host would mean racing that window from outside, which is not
  // deterministic and would make a passing suite say nothing. So the two instants are staged
  // instead: the reading is taken by `loadPack`, the folder is then changed on the disk, and the
  // check is asked afterwards. A check that reported the disk's answer would be reporting a folder
  // the Run it belongs to was never parsed from.
  const h = await createHimaHome();
  try {
    await installPack(h);
    const site = await writeLocalSite(h);
    const packsDir = packsDirOf(h);
    const id = 'reading-bound-check';
    await writePackVariant(packsDir, id, [], [], timingProbePackId, { 'rules/clock-period-at-most.yml': OWN_GOAL_RULE });

    // One reading, and the pack parsed out of it. Everything below is about that reading.
    const pack = loadPack(packsDir, id);
    // And now the folder is not what it was: the pack's own rule is gone, so a check that went back
    // to the disk would resolve the same id to the bundle's file, at the bundle's version.
    await rm(path.join(packsDir, id, 'rules', 'clock-period-at-most.yml'));
    assert.ok(!existsSync(path.join(packsDir, id, 'rules', 'clock-period-at-most.yml')),
      'the pack-local rule really is off the disk, which is what makes the two answers differ');

    const check = checkPack(pack, loadSite(site.sitesDir, site.name));
    const own = check.rules.find((r) => r.ref === 'clock-period-at-most');
    assert.ok(own, `the check resolves the rule the contract names: ${JSON.stringify(check.rules)}`);
    assert.equal(own.resolved, 'clock-period-at-most@9',
      'the check reports the rule the reading holds, not the one the disk now answers with');
    assert.equal(own.origin, 'pack',
      'and says it came from the pack, which is what the reading says and what the disk no longer does');

    // The bundle is not the folder and no reading of it exists, so it is read where it lies, as now.
    const shipped = check.rules.find((r) => r.ref === 'setup-wns-all-nonnegative');
    assert.ok(shipped, `the check resolves the pack's other rule too: ${JSON.stringify(check.rules)}`);
    assert.equal(shipped.origin, 'bundle', 'an id the pack does not carry is still answered by the bundle, by path');
    assert.equal(shipped.error, undefined, shipped.error);
  } finally {
    await h.dispose();
  }
});

test('a directory standing where a pack-local data file goes is refused naming the path, never read as a pack that declares none: the semantics file and a rule file', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  const packsDir = packsDirOf(h);
  try {
    // Off the disk this is `EISDIR`, which fails closed already. Out of the one reading of the folder
    // (#64) the same path is simply not among the folder's *files*, so a check that read absence off
    // that would hold the whole Campaign to the bundle's vocabulary while the pack's own path said
    // something nobody could read — the very fall-back a shadowing pack must never get.
    await writePackVariant(packsDir, 'semantics-is-a-directory', [], [], timingProbePackId, {
      'semantics.yml/inside.txt': 'a directory stands where the file goes\n',
    });
    const semantics = await himaCommand(host, h.workspace, '/hima pack check semantics-is-a-directory --site local');
    for (const line of semantics.text.split('\n')) t.diagnostic(line);
    assert.equal(semantics.kind, 'error', semantics.text);
    assert.ok(semantics.text.includes(path.join(packsDir, 'semantics-is-a-directory', 'semantics.yml')),
      `the refusal names the path it could not read: ${semantics.text}`);
    assert.match(semantics.text, /a directory stands there/, semantics.text);

    // And the same for a rule the pack shadows the bundle's id with: a directory at
    // `rules/<id>.yml` is not "this pack brings no rule of that id", it is a folder nothing can
    // resolve — and answering the bundle's file there would run a Campaign on a rule nobody chose.
    await writePackVariant(packsDir, 'rule-is-a-directory', [], [], timingProbePackId, {
      'rules/clock-period-at-most.yml/inside.txt': 'a directory stands where the rule goes\n',
    });
    const rule = await himaCommand(host, h.workspace, '/hima pack check rule-is-a-directory --site local');
    for (const line of rule.text.split('\n')) t.diagnostic(line);
    assert.equal(rule.kind, 'error', rule.text);
    assert.ok(rule.text.includes(path.join(packsDir, 'rule-is-a-directory', 'rules', 'clock-period-at-most.yml')),
      `naming the rule file it could not read: ${rule.text}`);
    assert.doesNotMatch(rule.text, /clock-period-at-most@1: found in the bundle/,
      `and it did not answer with the bundle's rule behind the pack's back: ${rule.text}`);
  } finally {
    await dispose();
  }
});

test('a regular file standing where a pack folder would be is named by the check and by a run, never quietly left off the list the start form is built from', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    // A name that is a perfectly good pack id, with an ordinary file under it. A list that answered
    // "then there is no pack of that name" would leave a person looking at a start form their pack
    // is missing from, with nothing anywhere saying why.
    await writeFile(path.join(packsDir, 'misplaced-probe'), 'a note somebody dropped beside the installed packs\n');
    const checked = await himaCommand(host, h.workspace, '/hima pack check misplaced-probe --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /misplaced-probe is not a directory: a pack folder is a plain directory under the packs directory/, checked.text);
    // And the same answer from the face that would otherwise start a Campaign of it: a name a person
    // can type is a name every face has to answer the same way.
    const ran = await himaCommand(host, h.workspace, '/hima run misplaced-probe --site local --goal target_period_ns=2');
    assert.equal(ran.kind, 'error', ran.text);
    assert.match(ran.text, /misplaced-probe is not a directory: a pack folder is a plain directory under the packs directory/, ran.text);
    assert.equal(ran.runId, undefined, 'and no Run was opened at all');
  } finally {
    await dispose();
  }
});

test('a test record whose Ending holds two status lines is refused naming the section: a campaign ends once, and a record may not say it ended twice', async (t) => {
  const local = await localPackHome(t, { sleepSeconds: 1 });
  if (!local) return;
  const { h, host, dispose } = local;
  const started: string[] = [];
  try {
    const packsDir = packsDirOf(h);
    await writePackVariant(packsDir, 'two-endings-probe', [], []);
    const dir = path.join(packsDir, 'two-endings-probe');
    await writePackFiles(dir, {
      'INTENT.md': recordHolding(HIMA_INTENT_SECTIONS),
      'SPEC.md': recordHolding(HIMA_SPEC_SECTIONS),
      'FABRIC.md': recordHolding(HIMA_FABRIC_SECTIONS),
    });
    // A real test Run of this folder, because the three bound lines are held against the Run's own
    // records and a record naming a Run this ledger does not hold never reaches them.
    const ran = await himaCommand(host, h.workspace, '/hima run two-endings-probe --site local --goal target_period_ns=2.3 --set periodNs=2.2 --test --generations 1', 90_000);
    assert.equal(ran.kind, 'success', ran.text);
    const runId = ran.runId;
    assert.ok(runId, `the test run was started and named: ${ran.text}`);
    started.push(...recordsOf(host, runId).flatMap((r) => (r.type === 'job' && r.event === 'launched' ? [r.job.session] : [])));
    const row = host.ctx.hima.ledger.run(runId)!;
    const recordWith = (ending: string): string => {
      const bound: Readonly<Record<string, string>> = { Run: `run: ${runId}`, Ending: ending, Code: 'none', Refusals: 'none' };
      return HIMA_TEST_SECTIONS.map((section) => `## ${section}\n\n${bound[section] ?? 'what this run recorded'}\n`).join('\n');
    };

    await writePackFiles(dir, { 'TEST.md': recordWith(`status: ${String(row.status)}`) });
    const tested = await himaCommand(host, h.workspace, '/hima pack check two-endings-probe --site local');
    assert.match(tested.text, /^stage: tested \(/m, tested.text);

    // The same record with a second `status:` line under it, naming another ending: the first still
    // agrees with the ledger, so a check that compared only the line it found first would seal a
    // record that states two different endings of one campaign.
    const otherEnding = row.status === 'ended-converged' ? 'ended-goal-met' : 'ended-converged';
    assert.notEqual(otherEnding, row.status, 'the second line names an ending this run did not reach');
    await writePackFiles(dir, { 'TEST.md': recordWith(`status: ${String(row.status)}\nstatus: ${otherEnding}`) });
    const twice = await himaCommand(host, h.workspace, '/hima pack check two-endings-probe --site local');
    assert.equal(twice.kind, 'error', twice.text);
    assert.match(twice.text, /test record's Ending holds two status lines, and a campaign ends once/, twice.text);
    assert.match(twice.text, /^stage: compiled \(/m, `and the folder stands at the rung it really is on: ${twice.text}`);
  } finally {
    killSessions(started);
    await dispose();
  }
});

test('a test record naming two runs is a record naming none, and the rung says so', async (t) => {
  const local = await localPackHome(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    await writePackVariant(packsDir, 'two-runs-probe', [], []);
    const dir = path.join(packsDir, 'two-runs-probe');
    const two = `## Run\n\nrun: run-${randomUUID()}\nrun: run-${randomUUID()}\n`;
    await writePackFiles(dir, {
      ...authoredThrough(`run-${randomUUID()}`),
      'TEST.md': HIMA_TEST_SECTIONS.map((section) => (section === 'Run' ? two : `## ${section}\n\nsomething this section says\n`)).join('\n'),
    });
    const checked = await himaCommand(host, h.workspace, '/hima pack check two-runs-probe --site local');
    assert.match(
      checked.text,
      /^stage: compiled \([^)]+\); next: tested — TEST\.md, written by \/hima-test; TEST\.md is there and does not validate: its "Run" section names two runs, and a pack is tested by one$/m,
      checked.text,
    );
  } finally {
    await dispose();
  }
});
