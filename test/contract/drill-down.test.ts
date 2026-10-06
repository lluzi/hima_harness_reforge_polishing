// Ticket #28: drill-down. An Explore node opens its own small Loop — a graph of its own declared
// beside the pack's, with its own convergence and its own generation counter — the fabric runs it to
// its own ending, records it as a pair of `loop` records with every record inside it nested under the
// loop id, and the outer graph continues on the edge that outcome labels.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam every
// step-3 test boots through: the Run is started over the routes with the session the shell
// established, and the ending is read off the workbench page the window renders. What is asserted is
// what a person sees and what the ledger holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';
import { himaCommand } from './support/command.ts';
import { killSessions, localFabric } from './support/fabric.ts';
import { api } from './support/hima-api.ts';
import { drillDownGraph, installDrillDown, packsDirOf, writePackVariant } from './support/pack.ts';
import { LEDGER_ORDER } from '@hima/harness';

test('the served HimaGuide bundle carries the nested loop\'s rows, as the workbench page does', async (t) => {
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

    // The card has two mounts and one drill-down. Only spellings a minified React bundle cannot
    // satisfy by accident are asked for: the region's own name, and two words no other section of
    // the card says. ASCII only, because esbuild escapes every non-ASCII character in a literal —
    // the em dash of "closed \u2014 converged" is not in the served bundle as itself.
    assert.ok(source.includes('run-loops'), 'the chat\'s card marks the loops region the way the page does');
    assert.ok(source.includes('opened at '), 'and says where a nested loop was opened');
    assert.ok(source.includes('still open'), 'and what it says of one nothing has closed');
    assert.ok(source.includes(LEDGER_ORDER), 'and says what the order of its rows is, as the page does under its plot');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The words a chat command says, which is the one thing the in-process host is still the seam for
// (D42): a command's answer is text a person reads, and no window renders it.
// ---------------------------------------------------------------------------------------------

test('/hima pack check refuses a drill-down that cannot be executed', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 1, failures: 1 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const packsDir = packsDirOf(h);
    await installDrillDown(packsDir, 'drill-down', 6);

    // An explore node that names a chooser and opens a loop: two different things for one node to be,
    // refused when the pack is loaded — which is how every other way a pack can contradict itself is
    // refused, and which a person meets as the load's own message, answered by the check with the
    // rung the folder stands on beside it (#63).
    await writePackVariant(packsDir, 'chooses-and-opens', []);
    await writeFile(
      path.join(packsDir, 'chooses-and-opens', 'graph.yml'),
      drillDownGraph('chooses-and-opens', 6).replace('      opens: push\n', '      opens: push\n      chooser: timing-push\n'),
    );
    const refusedChoosesAndOpens = await himaCommand(host, h.workspace, '/hima pack check chooses-and-opens --site local');
    assert.equal(refusedChoosesAndOpens.kind, 'error', refusedChoosesAndOpens.text);
    assert.match(refusedChoosesAndOpens.text, /gives explore node "probe" both chooser "timing-push" and `opens: push`: an explore node either applies a chooser and decides, or opens a loop and drills down, and states exactly one of the two/,
      `the refusal names the node and what an explore node may be: ${refusedChoosesAndOpens.text}`);

    // A loop whose own explore node opens a loop: drill-down goes one level in step 3, and a pack
    // that asks for two is refused where the file can still be read.
    await writePackVariant(packsDir, 'opens-twice', []);
    await writeFile(
      path.join(packsDir, 'opens-twice', 'graph.yml'),
      drillDownGraph('opens-twice', 6).replace('          chooser: over-constraining-push\n', '          opens: push\n'),
    );
    const refusedOpensTwice = await himaCommand(host, h.workspace, '/hima pack check opens-twice --site local');
    assert.equal(refusedOpensTwice.kind, 'error', refusedOpensTwice.text);
    assert.match(refusedOpensTwice.text, /has explore node "next-period" of loop "push" open loop "push": a loop's explore node applies a chooser, because drill-down goes one level and no further/,
      `the refusal names the node, its loop, and why there is no second level: ${refusedOpensTwice.text}`);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('/hima pack check refuses a drill-down whose edges the engine could never take, and a graph that says twice where its runs wait', async (t) => {
  const local = await localFabric(t, {});
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    /** The drill-down graph with one thing about it changed, installed under its own id. */
    const variant = async (id: string, change: (graph: string) => string): Promise<void> => {
      await writePackVariant(packsDir, id, []);
      await writeFile(path.join(packsDir, id, 'graph.yml'), change(drillDownGraph(id, 6)));
    };

    // An edge out of the opening explore node with no outcome on it. It loads as a route a person
    // would read in the file — probe leads to final-read — and the engine, which leaves that node
    // only on the edge its loop's outcome labels, would never take it: the loop would close and the
    // Run would end as though the node drew no edge at all.
    await variant('unlabelled-outcome', (g) => g.replace('  - { from: probe, to: final-read, outcome: converged }\n', '  - { from: probe, to: final-read }\n'));
    const refusedUnlabelledOutcome = await himaCommand(host, h.workspace, '/hima pack check unlabelled-outcome --site local');
    assert.equal(refusedUnlabelledOutcome.kind, 'error', refusedUnlabelledOutcome.text);
    assert.match(refusedUnlabelledOutcome.text, /draws an edge in its graph from explore node "probe" to "final-read" with no outcome on it: that node opens a loop and is left on the edge its loop closed with, so every edge out of it carries one of "goal-met", "converged", "generation-limit"/,
      `the refusal names the node, the edge, and the three outcomes an opening node's edges carry: ${refusedUnlabelledOutcome.text}`);

    // A revisit edge out of the opening explore node. That node revisits nothing itself — the loop
    // it opens carries its own revisit edge — so a `revisit: true` here is a way back the file shows
    // and the engine never takes.
    await variant('probe-revisits', (g) => g.replace('  - { from: probe, to: final-read, outcome: converged }', '  - { from: probe, to: final-read, outcome: converged, revisit: true }'));
    const refusedProbeRevisits = await himaCommand(host, h.workspace, '/hima pack check probe-revisits --site local');
    assert.equal(refusedProbeRevisits.kind, 'error', refusedProbeRevisits.text);
    assert.match(refusedProbeRevisits.text, /gives explore node "probe" in its graph a revisit edge to "final-read": an explore node that opens a loop revisits nothing itself/,
      `the refusal names the node, where its revisit edge leads, and why an opening node revisits nothing: ${refusedProbeRevisits.text}`);

    // Two edges out of one node labelled the same. The engine takes the first that matches, so which
    // of them a converged loop leads along would be the order the lines happen to be written in.
    await variant('two-converged', (g) => g.replace('  - { from: probe, to: blocked, outcome: generation-limit }', '  - { from: probe, to: blocked, outcome: converged }'));
    const refusedTwoConverged = await himaCommand(host, h.workspace, '/hima pack check two-converged --site local');
    assert.equal(refusedTwoConverged.kind, 'error', refusedTwoConverged.text);
    assert.match(refusedTwoConverged.text, /draws two edges in its graph out of "probe" labelled "converged", to "final-read" and to "blocked": one outcome leads one way/,
      `the refusal names the node, the label, and both places it leads: ${refusedTwoConverged.text}`);

    // Two wait nodes in one graph. Nothing draws an edge to a wait node — the engine routes a Hard
    // blocker there — so a graph declaring two says nothing about which one a person is sent to.
    await variant('two-wait-nodes', (g) => g.replace('\nedges:\n  - { from: probe', '\n  - id: also-blocked\n    kind: wait\n    parameters:\n      blocker: hard-blocker\n\nedges:\n  - { from: probe'));
    const refusedTwoWaitNodes = await himaCommand(host, h.workspace, '/hima pack check two-wait-nodes --site local');
    assert.equal(refusedTwoWaitNodes.kind, 'error', refusedTwoWaitNodes.text);
    assert.match(refusedTwoWaitNodes.text, /declares 2 wait nodes in its graph, "blocked" and "also-blocked": a graph declares at most one/,
      `the refusal names both wait nodes: ${refusedTwoWaitNodes.text}`);
  } finally {
    await dispose();
  }
});
