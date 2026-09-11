// Ticket #12: the pack anatomy, the opene902 timing probe, site bindings, and workspace preparation.
// A HimaPack is a folder of plain files; a Site binds the inputs its run contract names; and a
// Campaign gets a workspace of its own with the flow copied into it, so no generation ever writes
// the Site's own results. Everything here is driven through the booted host: the `/hima pack`
// command face in, the HimaLedger and the channel's audit out.
//
// Local Pack checks and preparation only. Real Site cases are in pack.live.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { createHimaHome, repoRoot, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { installPack, packsDirOf, shippedPacksDir, timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import { clearRemoteCommands, jobPlumbing, quote, readOnlyProbes, remoteCommands, workspacePlumbing } from '@hima/harness';
import type { LedgerRecord, WorkspaceRecord } from '@hima/harness';

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
    assert.match(checked.text, /^ {2}setup-wns-all-nonnegative@1: found$/m, checked.text);
    assert.match(checked.text, /^ {2}clock-period-at-most@1: found$/m, checked.text);
    assert.match(checked.text, /^ {2}dc-qor-report@1 reads qorReport: found$/m, checked.text);
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
    // A negative step reverses the exploration: a PASS would loosen the period instead of
    // testing one step tighter. The declaration check must reject that parameter.
    await writePackVariant(packsDirOf(h), 'negative-step', [], [['        stepNs: 0.05', '        stepNs: -0.1']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check negative-step --site local');
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
    await writePackVariant(packsDirOf(h), 'unbound-step', [], [['      bind:\n        stepNs: 0.05', '      bind: {}']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check unbound-step --site local');
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
    await assert.rejects(
      himaCommand(host, h.workspace, '/hima pack check reads-an-undeclared-knob --site local'),
      /node "synthesize" takes argument "PERIOD_NS" from strategy knob "noSuchKnob", which contract\.yml does not declare; it declares "periodNs"/,
      'the refusal names the node, the argument, the knob it asked for and the knobs there are',
    );

    // The shipped pack, unvaried, is the control: the refusal above is about the one thing that was
    // varied and not about a pack that could never have loaded.
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
    assert.deepEqual(file.pack, { id: timingProbePackId, version: '2' });
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
