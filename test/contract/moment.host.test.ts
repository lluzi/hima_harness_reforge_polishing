// @hima-seam tools direct
// PLS-20: migrated unchanged assertions to the real Host/local seam.
// Replay is a mechanism stand-in; no Electron, real model or SSH is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { scanForSecret } from './support/moments.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { HIMA_MOMENT_PRESET, SHELL_TOOL, openMoment as openMomentDirectly } from '@hima/harness';


// The scan's own fail-closed property, which no booted run can show: a regular file whose bytes
// cannot be read is reported rather than passed over. Everything this product says about a key
// resting in no file it wrote is said through an empty `holding`, and an empty `holding` means
// nothing if a file the scan could not open simply left the evidence without a trace.
test('the scan reports a regular file it could not read, rather than passing over it', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root reads a file whose mode forbids everyone, so there is no unreadable file to make');
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), 'hima-scan-'));
  // Made up here and nowhere else, exactly as the key test above makes one up.
  const needle = `hima-fake-${randomUUID()}`;
  const readable = path.join(root, 'readable.txt');
  const shut = path.join(root, 'shut.txt');
  await writeFile(readable, 'nothing of interest here\n');
  await writeFile(shut, `${needle}\n`);
  await chmod(shut, 0o000);
  try {
    const scan = await scanForSecret([root], needle);
    assert.deepEqual(scan.files.map((f) => f.path), [readable], `the scan read what it could: ${JSON.stringify(scan.files)}`);
    assert.deepEqual(scan.unreadable.map((f) => f.path), [shut], `and reports what it could not: ${JSON.stringify(scan.unreadable)}`);
    assert.match(scan.unreadable[0]?.error ?? '', /EACCES/, `with the error that stopped it: ${JSON.stringify(scan.unreadable)}`);
    // The file holds the needle, and `holding` is empty: that is the whole point. A caller that asks
    // only whether `holding` is empty is told a run is clean by a scan that never looked, which is
    // why every caller of this now asks `unreadable` as well.
    assert.deepEqual(scan.holding, [], `it claims nothing about bytes it never saw: ${JSON.stringify(scan.holding)}`);
  } finally {
    await chmod(shut, 0o600);
    await rm(root, { recursive: true, force: true });
  }
});


// The same property one level up, where the hole is bigger: a *directory* the scan cannot open hides
// every file beneath it, and a walk that returned quietly from it would report an empty `holding`
// over a subtree nobody looked at. The asymmetry this asserts is the whole of the scan's evidence
// policy — a read that failed is reported, and the one thing passed over is an entry that is not a
// file at all.
test('the scan reports a directory it could not open, and passes over a link pointing at nothing', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root reads a directory whose mode forbids everyone, so there is no unreadable directory to make');
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), 'hima-scan-'));
  const needle = `hima-fake-${randomUUID()}`;
  const readable = path.join(root, 'readable.txt');
  const shutDir = path.join(root, 'shut-dir');
  const hidden = path.join(shutDir, 'hidden.txt');
  const dangling = path.join(root, 'dangling');
  await writeFile(readable, 'nothing of interest here\n');
  await mkdir(shutDir);
  await writeFile(hidden, `${needle}\n`);
  await symlink(path.join(root, 'nothing-is-here'), dangling);
  await chmod(shutDir, 0o000);
  try {
    const scan = await scanForSecret([root], needle);
    assert.deepEqual(scan.files.map((f) => f.path), [readable], `the scan read what it could: ${JSON.stringify(scan.files)}`);
    assert.deepEqual(scan.unreadable.map((f) => f.path), [shutDir], `and reports the directory it could not open: ${JSON.stringify(scan.unreadable)}`);
    assert.match(scan.unreadable[0]?.error ?? '', /EACCES/, `with the error that stopped it: ${JSON.stringify(scan.unreadable)}`);
    // The dangling link is the one thing that may be passed over: it is not a file with bytes in it,
    // so its absence from `files` takes no evidence away, and a home is allowed to hold one.
    assert.ok(!scan.unreadable.some((f) => f.path === dangling), `a link pointing at nothing is not a hole in the evidence: ${JSON.stringify(scan.unreadable)}`);
    assert.deepEqual(scan.holding, [], `it claims nothing about bytes it never saw: ${JSON.stringify(scan.holding)}`);
  } finally {
    await chmod(shutDir, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});


/**
 * A tool shaped exactly like a real shell tool, and named like one.
 *
 * Given to `openMoment` by a caller that has every right to call it — the function is exported, and
 * #62's act node is meant to hand it the pack's own tools. What makes it refusable is its *name*,
 * which is the only thing the refusal reads: it is decided before anything is composed, so a body
 * that could never run is the honest thing to put here.
 */
const shellShaped = defineTool({
  name: SHELL_TOOL,
  description: 'Shaped like a shell tool and named like one, so that a moment refusing it is refusing the name and not the implementation.',
  parameters: { command: { type: 'string', required: true, description: 'Anything at all; this is never reached.' } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { said: { type: 'string', required: true } } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  execute: () => { throw new Error('a moment that refuses this tool by name never composes a session that could run it'); },
});


// D48's own invariant, asserted where a moment is made rather than left to the one route that makes
// one today. `momentOnCurrentNode` passes no tools, so the emptiness the tests above assert is a fact
// about that route; `openMoment` is exported and takes whatever tools a caller hands it, and #62's
// act node will hand it the pack's. A caller reaching for `write`, `edit` or `bash` is reaching past
// what a Model moment is, and the answer has to be the same whichever caller it is — so it is the
// request that is refused, before a session exists for the authoring guard to have an opinion about.
test('a moment refuses a governed tool name by construction: no session is composed and no record is written', async () => {
  const h = await createHimaHome();
  let host: InProcessHost | undefined;
  try {
    host = await bootInProcess(h);
    const ledger = host.ctx.hima.ledger;
    // A real Run on a real ledger, so that the ledger below is one an `opened` record could actually
    // land on: `appendSession` refuses a Run it does not hold, and an assertion that leaned on that
    // would be satisfied by the wrong refusal.
    const runId = (await ledger.createRun({ campaignId: `campaign-${randomUUID()}`, siteId: 'local' })).id;
    await assert.rejects(
      () => openMomentDirectly({ ledger, ctx: host!.ctx }, {
        runId,
        nodeId: 'a-node',
        attempt: 1,
        preset: HIMA_MOMENT_PRESET,
        instructions: 'Answer with one word.',
        tools: [shellShaped],
      }),
      (err: unknown) => {
        const said = err instanceof Error ? err.message : String(err);
        assert.match(said, /a Model moment has no shell and no host filesystem/, `the refusal says what a moment is: ${said}`);
        assert.match(said, /D48/, `and cites the decision it enforces: ${said}`);
        assert.match(said, new RegExp(`"${SHELL_TOOL}"`), `and names the tool it was handed: ${said}`);
        return true;
      },
      'a moment handed a governed tool name is refused',
    );

    // Nothing was composed, so nothing is on the ledger: the refusal is ahead of the `opened` record
    // and ahead of the session that record would name. Asked over every Run this ledger holds as well
    // as the one the request named, so "no session record" means no session record anywhere.
    const sessions = [...ledger.runs().map((r) => r.id), runId]
      .flatMap((id) => ledger.records({ runId: id, type: 'session' }));
    assert.deepEqual(sessions, [], `a refused request opens nothing and records nothing: ${JSON.stringify(sessions)}`);
  } finally {
    if (host) await host.dispose();
    await h.dispose();
  }
});

