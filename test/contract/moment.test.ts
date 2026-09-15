// @hima-seam tools direct
// Ticket #59: the Model moment — the one generic element of this harness a model takes part in.
//
// Three properties, all at the step-3 seam: the desktop shell in driver mode (D42, ADR-0004), with
// the model replaced by dsh's own keyless replay adapter over a committed transcript. Nothing here
// needs an API key and nothing here may have one.
//
// **A moment happens, and the ledger says so.** A Run is driven to a node on the local Site, a
// moment is opened on that node through the fenced route, the replayed turn runs, and the Run's
// records carry the pair that brackets it — opened and closed — naming the preset it was composed
// from, the session and model it ran in, the node, the attempt and the Generation.
//
// **A moment can reach nothing.** The session's tool list is dsh's own answer about that session's
// scope, carried on the `opened` record and on the route's answer, and it is empty: no shell, no
// filesystem, no web, no skills, and none of Hima's own four tools. That is what makes a moment
// isolated rather than merely small.
//
// **A moment survives its host going away, as a record.** The first host's model call hangs; the
// window is taken away mid-turn; the next host reconciles from the ledger alone and writes the one
// close that moment is missing, `interrupted`. Then the same node takes another moment, which
// completes — so the Run reads open, closed-interrupted, open, closed-completed, each pair sharing
// its session.
//
// **No key ever lands in the home.** A run of the whole thing with a made-up key in the launching
// environment, followed by a read of every byte under the home the harness wrote: `$DSH_HOME`, the
// window's user-data directory and the workspace. The key's doors into this product are dsh's — the
// launching environment, dsh's credentials file, an env file — and this harness opens none of them.
//
// **A moment has no shell and no host filesystem, whoever opens one.** D48's own invariant, asserted
// where it is enforced: `openMoment` refuses a request carrying one of the tool names the pack
// authoring guard governs, before a session exists to register it into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { bootDriver, type BootedDriver } from './support/driver.ts';
import { localHome } from './support/fabric.ts';
import { api } from './support/hima-api.ts';
import { scanForSecret, writeMomentFixture } from './support/moments.ts';
import { timingProbePackId } from './support/pack.ts';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { HIMA_MOMENT_PRESET, SHELL_TOOL, openMoment as openMomentDirectly, type HimaErrorBody, type MomentAnswer, type RecordsView, type RunView, type SessionRecord } from '@hima/harness';

/** The model the profile selects, which the stand-in's catalog answers for (D9). */
const MODEL = 'deepseek-flash';

/** What the committed one-turn transcript makes the model say. */
const ANSWER = 'READY';

/** The tools a moment must not be able to reach, by the names dsh registers them under. */
const FORBIDDEN = ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'skill', 'web_search', 'web_fetch', 'hima_observe', 'hima_run', 'hima_resume', 'hima_cancel'];

/** How long a test waits for something inside the window to become true. */
const waitTimeoutMs = 90_000;

/**
 * Start one generation of the shipped pack on the local Site, the way the workbench starts one.
 *
 * The Strategy is stated knob by knob in the pack's own names (#58), and stated rather than left to
 * the pack's declared default, because these tests were written against a Run set to 2.0 ns and a
 * moment's subject is the model session and not what the flow synthesized at: a Strategy this file
 * does not say is one a later edit of the pack's contract could move under it.
 */
const startRun = (host: { url: string }, cookie: string): Promise<Response> =>
  api(host, cookie, '/hima/api/runs', {
    method: 'POST',
    body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
    headers: { 'content-type': 'application/json' },
  });

/** Open a moment on the Run's current node through the fenced route. */
const openMoment = (host: { url: string }, cookie: string, runId: string, instructions: string): Promise<Response> =>
  api(host, cookie, `/hima/api/runs/${runId}/moment`, {
    method: 'POST',
    body: JSON.stringify({ instructions }),
    headers: { 'content-type': 'application/json' },
  });

/**
 * One answer of the namespace, read once.
 *
 * A `Response` body can be consumed exactly once, so an assertion whose message reads the body has
 * already spent it by the time the assertion passes. Every read here goes through this: the text is
 * taken first, the status is asserted against it, and the JSON is parsed from the text that was
 * read — so a failure says what the route actually answered and a pass leaves the body alone.
 */
async function answer<T>(answered: Response, status: number, what: string): Promise<T> {
  const text = await answered.text();
  assert.equal(answered.status, status, `${what}: ${String(answered.status)} ${text}`);
  return JSON.parse(text) as T;
}

/** This Run's `session` records, oldest first, as the records route lists them. */
async function sessionRecordsOf(host: { url: string }, cookie: string, runId: string): Promise<SessionRecord[]> {
  const body = await answer<RecordsView>(await api(host, cookie, `/hima/api/runs/${runId}/records?type=session`), 200, 'the records route answered');
  return body.records.filter((r): r is SessionRecord => r.type === 'session');
}

/** Every source file under a directory whose text holds one string. */
async function grepUnder(dir: string, needle: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const at = path.join(entry.parentPath, entry.name);
    if ((await readFile(at, 'utf8')).includes(needle)) found.push(at);
  }
  return found;
}

/** Poll until something is true, or fail saying what never happened. */
async function until(what: string, ready: () => boolean | Promise<boolean>, timeoutMs = waitTimeoutMs): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await ready()) return;
    if (Date.now() >= deadline) throw new Error(`waited ${String(timeoutMs)} ms and ${what} never happened`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

test('through the shell with a key in the launching environment: a moment runs and the key reaches no file under the home the harness wrote', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const fixture = await writeMomentFixture(home.h, 'one-turn');
  // Made up here and nowhere else: this suite has no DeepSeek key, needs none, and would be the
  // wrong place for one. What the scan below looks for is this exact string.
  const key = `hima-fake-${randomUUID()}`;
  let d: BootedDriver | undefined;
  try {
    d = await bootDriver(t, {
      existing: home.h,
      model: { replay: { file: fixture.file, override: fixture.override } },
      env: { DEEPSEEK_API_KEY: key },
    });
    if (!d) return;
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    const runId = (await answer<RunView>(await startRun(host, cookie), 200, 'the run started')).run.id;
    const moment = await answer<MomentAnswer>(await openMoment(host, cookie, runId, `Answer with exactly the word ${ANSWER}.`), 200, 'the moment route answered');
    assert.equal(moment.text, ANSWER, 'the moment ran under that environment');

    // Everything is flushed once the window and its host are gone; only then is the home read.
    const stopped = await d.quit();
    assert.ok(stopped.ok, JSON.stringify(stopped));
    await d.exit();

    const scan = await scanForSecret([home.h.home, home.h.workspace, path.join(home.h.home, 'electron-user-data')], key);
    assert.ok(scan.files.length > 50, `the scan read the home rather than nothing: ${String(scan.files.length)} files`);
    assert.ok(scan.files.some((f) => f.path.includes('sessions')), `including the session logs the moment wrote: ${String(scan.files.length)} files`);
    // Asked before the claim it qualifies: "no file holds the key" is a statement about bytes, and a
    // file the scan could not open is a hole in it exactly the size of that file.
    assert.deepEqual(scan.unreadable, [], `every file it found, it read: ${JSON.stringify(scan.unreadable)}`);
    assert.deepEqual(scan.holding, [], `no file under the home holds the key: ${JSON.stringify(scan.holding)}`);

    // The one credential-shaped file a hima home ends up with is dsh's own store, which the web app
    // mints the window's browser-session grant into at mode 600 — one of the three doors a key may
    // come through, and not a door this harness opens. It carries no model route and no key.
    const envFiles = scan.credentialFiles.filter((at) => path.basename(at) === '.env');
    assert.deepEqual(envFiles, [], `the harness wrote no env file: ${JSON.stringify(envFiles)}`);
    for (const at of scan.credentialFiles) {
      const held = await readFile(at, 'utf8');
      assert.ok(!held.includes('deepseek'), `dsh's credentials store holds no model route: ${at} ${held}`);
      assert.ok(held.includes('client-connection/browser-session'), `it holds the browser session dsh put there and nothing else: ${at} ${held}`);
    }

    // And the harness cannot have written one: nothing in either package names either file. Asserted
    // over the sources rather than inferred from one run, because "none written by this product" is a
    // claim about the product and not about the home this test happened to make.
    for (const at of ['packages/harness/src', 'packages/desktop/src']) {
      for (const name of ['.credentials.yaml', '.credentials.yml', 'DEEPSEEK_API_KEY']) {
        const found = await grepUnder(path.join(repoRoot, at), name);
        assert.deepEqual(found, [], `no file under ${at} writes or reads ${name}: ${JSON.stringify(found)}`);
      }
    }
  } finally {
    if (d) await d.dispose();
    await home.h.dispose();
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
