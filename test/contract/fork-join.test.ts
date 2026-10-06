// Ticket #29: fork and join. Several unlabelled edges out of one node run those act nodes at once,
// each branch with its own Jobs and its own records, and a judge node with several incoming edges
// waits for every branch and judges all their observations (D29).
//
// The Site's parallel job cap decides how many really run at once (D33): a cap of two on the local
// stand-in proves the branches concurrent, and a cap of one proves the same graph runs them one
// after the other with a `waiting-for-slot` record on the second — which is what the reference site,
// whose cap is one, will do.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam every
// step-3 test boots through: the Run is started over the routes with the session the shell
// established, and what is asserted is what the ledger holds and what the routes answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { localFabric } from './support/fabric.ts';
import { himaCommand } from './support/command.ts';
import { timingProbePackVersion, forkGraph, installFork, packsDirOf } from './support/pack.ts';
import { FORK_RULE } from '@hima/harness';

test('the served HimaGuide bundle carries the fork\'s branch rows, as the workbench page does', async (t) => {
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

    // The card has two mounts and one fork. Only spellings a minified React bundle cannot satisfy by
    // accident are asked for: the region's own name, the per-branch marker, and two words no other
    // section of the card says. ASCII only, because esbuild escapes every non-ASCII character in a
    // literal.
    assert.ok(source.includes('run-branches'), 'the chat\'s card marks the branches region the way the page does');
    assert.ok(source.includes('data-hima-branch'), 'and marks each branch\'s row with the branch it is');
    assert.ok(source.includes('waiting for a job slot'), 'and says what a branch queued behind the site is doing');
    assert.ok(source.includes(FORK_RULE), 'and says, at the join, the rule a fork\'s outcome is settled by');
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// What a fork may be, refused where a person can still read the file: the words a chat command says,
// which is the one thing the in-process host is still the seam for (D42).
// ---------------------------------------------------------------------------------------------

/** A pack whose loop's own graph forks: drill-down and fork each go one level in step 3, and neither
 *  is nested in the other. Written whole, because a graph with a loop in it is a different shape. */
const forkInsideALoop = (id: string): string => `# A pack that drills down into a loop that forks: refused when it is loaded.
id: ${id}
version: '${timingProbePackVersion}'
entry: probe

nodes:
  - id: probe
    kind: explore
    parameters:
      opens: push

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
  - { from: probe, to: final-read, outcome: goal-met }
  - { from: probe, to: blocked, outcome: generation-limit }

loops:
  push:
    entry: start
    nodes:
      - id: start
        kind: act
        parameters:
          observes: flowSummary

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

      - id: synth-b
        kind: act
        parameters:
          tool: synth-b
          arguments:
            PERIOD_NS: 2.20

      - id: read-qor-b
        kind: act
        parameters:
          observes: qorReportB

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
          chooser: timing-push
          bind:
            guardBandNs: 0.05
          converge:
            read: period
            band: 0.01
            generations: 1
            generationLimit: 6

    edges:
      - { from: start, to: synthesize }
      - { from: start, to: synth-b }
      - { from: synthesize, to: read-qor }
      - { from: read-qor, to: judge }
      - { from: synth-b, to: read-qor-b }
      - { from: read-qor-b, to: judge }
      - { from: judge, to: next-period, outcome: PASS }
      - { from: judge, to: next-period, outcome: FAIL }
      - { from: next-period, to: start, revisit: true }
`;

test('/hima pack check refuses a fork the engine could never drive: a judge node inside a branch, two joins, an explore node after the join, and a fork inside a loop', async (t) => {
  const local = await localFabric(t, {});
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    /** The forking graph with one thing about it changed, installed under its own id. */
    const variant = async (id: string, change: (graph: string) => string): Promise<void> => {
      await installFork(packsDir, id, 2.2);
      await writeFile(path.join(packsDir, id, 'graph.yml'), change(forkGraph(id, 2.2)));
    };

    // A branch holding a judge node. A fork is judged where its branches converge and nowhere else,
    // so a judge inside one would be judging half a fork on its own.
    await variant('branch-judges', (g) => g.replace(`  - id: read-qor-b
    kind: act
    parameters:
      observes: qorReportB`, `  - id: read-qor-b
    kind: judge
    parameters:
      rules:
        - setup-wns-all-nonnegative
        - clock-period-at-most`));
    const refusedBranchJudges = await himaCommand(host, h.workspace, '/hima pack check branch-judges --site local');
    assert.equal(refusedBranchJudges.kind, 'error', refusedBranchJudges.text);
    assert.match(refusedBranchJudges.text, /has a judge node, "read-qor-b", inside the branch it forks to "synth-b": a branch is act nodes only, because a fork is judged where its branches converge and nowhere else/,
      `the refusal names the node, the branch it is in, and what a branch may hold: ${refusedBranchJudges.text}`);

    // Branches converging into two different nodes. The run waits for every branch at one join, so a
    // fork whose branches end in two places is a run that could never be waited for. Both judge nodes
    // keep two incoming edges — a node with one is a node inside a branch, which is the refusal above
    // — so what this pack gets wrong is the one thing it is about.
    await variant('two-joins', (g) => g
      .replace(`  - id: blocked
    kind: wait`, `  - id: judge-b
    kind: judge
    parameters:
      rules:
        - setup-wns-all-nonnegative
        - clock-period-at-most
      bind:
        target_period_ns: { from: goal, name: target_period_ns }

  - id: read-qor-c
    kind: act
    parameters:
      observes: qorReport

  - id: read-qor-d
    kind: act
    parameters:
      observes: qorReportB

  - id: blocked
    kind: wait`)
      .replace('  - { from: read-qor-b, to: judge }', '  - { from: read-qor-b, to: judge-b }\n  - { from: read-qor-c, to: judge }\n  - { from: read-qor-d, to: judge-b }'));
    const refusedTwoJoins = await himaCommand(host, h.workspace, '/hima pack check two-joins --site local');
    assert.equal(refusedTwoJoins.kind, 'error', refusedTwoJoins.text);
    assert.match(refusedTwoJoins.text, /has the branches of the fork at "start" converge into two different nodes, "judge" and "judge-b": every branch of one fork reaches one join/,
      `the refusal names the fork and both nodes its branches ended at: ${refusedTwoJoins.text}`);

    // An explore node the join leads to. A chooser weighs one reading; a fork leaves one per branch,
    // so a chooser after a join would choose from whichever branch appended last. Two act nodes
    // stand between the join and the explore node, because the rule is about everything the join
    // leads to and not about the node it draws an edge straight to.
    await variant('explores-after-the-join', (g) => g
      .replace(`  - id: blocked
    kind: wait`, `  - id: settle
    kind: act
    parameters:
      observes: qorReport

  - id: next-period
    kind: explore
    parameters:
      chooser: timing-push
      bind:
        guardBandNs: 0.05
      converge:
        read: period
        band: 0.05
        generations: 1
        generationLimit: 6

  - id: blocked
    kind: wait`)
      .replace(`  - { from: read-qor-b, to: judge }`, `  - { from: read-qor-b, to: judge }
  - { from: judge, to: settle, outcome: PASS }
  - { from: settle, to: next-period }
  - { from: next-period, to: start, revisit: true }`));
    const refusedExploresAfterTheJoin = await himaCommand(host, h.workspace, '/hima pack check explores-after-the-join --site local');
    assert.equal(refusedExploresAfterTheJoin.kind, 'error', refusedExploresAfterTheJoin.text);
    assert.match(refusedExploresAfterTheJoin.text, /has explore node "next-period" downstream of "judge", the join of the fork at "start": an explore node weighs one reading of its loop's latest generation, and a fork writes one reading per branch, so a chooser standing after a join would choose from whichever branch happened to append last/,
      `the refusal names the explore node, the join it stands after, and what it would have been deciding on: ${refusedExploresAfterTheJoin.text}`);

    // A fork inside a drill-down loop's graph. Fork and drill-down each go one level in step 3.
    await installFork(packsDir, 'fork-in-loop', 2.2);
    await writeFile(path.join(packsDir, 'fork-in-loop', 'graph.yml'), forkInsideALoop('fork-in-loop'));
    const refusedForkInLoop = await himaCommand(host, h.workspace, '/hima pack check fork-in-loop --site local');
    assert.equal(refusedForkInLoop.kind, 'error', refusedForkInLoop.text);
    assert.match(refusedForkInLoop.text, /forks at "start" in loop "push": a loop's graph holds no fork, because drill-down and fork each go one level in step 3 and neither is nested in the other/,
      `the refusal names the node, its loop, and why neither nests in the other: ${refusedForkInLoop.text}`);
  } finally {
    await dispose();
  }
});
