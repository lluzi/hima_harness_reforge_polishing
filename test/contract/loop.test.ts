// Ticket #25: the Loop. HimaFabric revisits the synthesis node with the Strategy the Explore node
// chose, generation after generation, until the Goal is met, the exploration has converged, or the
// Budget's generation limit is reached.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam every
// step-3 test boots through: the Run is started over the routes with the session the shell
// established, and the ending is read off the `run-status` region of the workbench page the window
// renders. What is asserted is what a person sees and what the ledger holds — the run row's
// generation, the records each generation left, and the decision that ended the Campaign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDriver } from './support/driver.ts';
import { himaCommand } from './support/command.ts';
import { killSessions, localFabric } from './support/fabric.ts';
import { api } from './support/hima-api.ts';
import { packsDirOf, writePackVariant } from './support/pack.ts';

// ---------------------------------------------------------------------------------------------
// The words a chat command says, which is the one thing the in-process host is still the seam for
// (D42): a command's answer is text a person reads, and no window renders it.
// ---------------------------------------------------------------------------------------------

test('/hima pack check refuses a Loop that cannot be executed', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    // A pack that converges on a value its chooser never reads: a Loop that could only ever end at
    // the generation limit, said before a Campaign exists rather than after one.
    await writePackVariant(packsDirOf(h), 'converges-on-nothing', [], [['        read: period', '        read: cell_area']]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check converges-on-nothing --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /converges on "cell_area", which chooser "over-constraining-push" does not read/, checked.text);
    assert.match(checked.text, /"period", "slack"/, `and says what it does read: ${checked.text}`);

    // A graph that goes back to an act node without saying so: a loop the engine would run and the
    // file would not show. Refused when the pack is *loaded* — before any question about a Site is
    // asked — which is how every other way a pack can contradict itself is refused, and which a
    // person meets as the load's own message rather than as a check that came back unfit.
    await writePackVariant(packsDirOf(h), 'cycles-without-a-revisit', [], [[
      '  - { from: next-period, to: synthesize, revisit: true }',
      '  - { from: next-period, to: synthesize }',
    ]]);
    const refusedCyclesWithoutARevisit = await himaCommand(host, h.workspace, '/hima pack check cycles-without-a-revisit --site local');
    assert.equal(refusedCyclesWithoutARevisit.kind, 'error', refusedCyclesWithoutARevisit.text);
    assert.match(refusedCyclesWithoutARevisit.text, /graph\.yml cycles through "synthesize" → "read-qor" → "judge" → "next-period" → "synthesize" without a revisit edge/,
      `the refusal names the cycle it walked and what declares a loop: ${refusedCyclesWithoutARevisit.text}`);

    // Two explore nodes, each declaring how many generations a Campaign of this pack may take, and
    // disagreeing: a Run has one Budget, so one of the two numbers would be quietly ignored. Refused
    // where the file can still be read, and for the same reason and in the same way as the cycle.
    await writePackVariant(packsDirOf(h), 'two-generation-limits', [], [[
      '  - id: blocked\n',
      '  - id: second-thoughts\n'
      + '    kind: explore\n'
      + '    parameters:\n'
      + '      chooser: timing-push\n'
      + '      bind:\n'
      + '        guardBandNs: 0.05\n'
      + '      converge:\n'
      + '        read: period\n'
      + '        band: 0.05\n'
      + '        generations: 1\n'
      + '        generationLimit: 3\n'
      + '\n'
      + '  - id: blocked\n',
    ]]);
    const refusedTwoGenerationLimits = await himaCommand(host, h.workspace, '/hima pack check two-generation-limits --site local');
    assert.equal(refusedTwoGenerationLimits.kind, 'error', refusedTwoGenerationLimits.text);
    assert.match(refusedTwoGenerationLimits.text, /graph\.yml declares 2 different generation limits — 6 on explore node "next-period", 3 on explore node "second-thoughts" — where a campaign has one budget/,
      `the refusal names both numbers and the node each came from: ${refusedTwoGenerationLimits.text}`);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('the served HimaGuide bundle carries the generations table, as the workbench page does', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    const index = await api(host, cookie, '/');
    const html = await index.text();
    const boot = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/.exec(html);
    assert.ok(boot, 'the index carries the client-module boot graph');
    const graph = JSON.parse(boot[1]!) as { entries: { id: string; url: string }[] };
    const hima = graph.entries.find((e) => e.id === '@hima/harness');
    assert.ok(hima, `the Hima module is in the boot graph; it holds ${graph.entries.map((e) => e.id).join(', ')}`);
    const source = await (await api(host, cookie, hima.url)).text();

    // The card has two mounts and one table. Only spellings a minified React bundle cannot satisfy
    // by accident are asked for: the region's name and two of the column heads. The heads are
    // matched by their ASCII prefix, because esbuild escapes every non-ASCII character in a string
    // literal — the arrow this column head holds is `→` in the served bundle.
    assert.ok(source.includes('run-generations'), 'the chat\'s card marks the generations table the way the page does');
    assert.ok(source.includes('period (asked'), 'and heads its first quantity column in the same words');
    assert.ok(source.includes('wall time'), 'and says what each generation cost in wall clock');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('/hima pack check refuses a word for a name the pack does not use', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    // A word for a name the pack neither takes from its goal nor sets as a strategy knob: a label
    // that could never reach a person, said before a Campaign exists rather than never.
    await writePackVariant(packsDirOf(h), 'words-for-nothing', [[
      '  periodNs: { label: clock period, unit: ns }',
      '  cellAreaUm2: { label: cell area, unit: um2 }',
    ]]);
    const checked = await himaCommand(host, h.workspace, '/hima pack check words-for-nothing --site local');
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /words: declares "cellAreaUm2", which this pack neither takes from its goal nor sets as a strategy knob/, checked.text);
    assert.match(checked.text, /"target_period_ns", "periodNs"/, `and says which names it does use: ${checked.text}`);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});
