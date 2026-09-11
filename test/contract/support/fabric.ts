// Contract-test support for the fabric suites: the home a Run is driven in, the ledger reads a test
// asserts over, and the waits that let a test act while a Job is still on the Site.
//
// Here rather than in each test file because #13's, #14's and the Retry suite's copies had already
// begun to differ — three spellings of "poll until this is true", two of "every session this run
// launched" — and a helper that reads the ledger differently in two files is two descriptions of one
// harness. What each file keeps for itself is what is genuinely its own: how long its stand-in
// sleeps, how often it looks, and the record kinds only its own subject is about.
//
// Every one of these reads the ledger or the test's own home. None of them asserts anything about
// the harness beyond `runOf`, which asserts only that the Run it was asked for exists.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createHimaHome, type HimaHome } from './dsh-home.ts';
import { bootInProcess, type InProcessHost } from './boot-inprocess.ts';
import { himaCommand, siteCommandTimeoutMs, type CommandOutcome } from './command.ts';
import { installPack } from './pack.ts';
import { writeLocalSite } from './site.ts';
import { writeStandinFlow, type StandinFlow, type StandinOptions } from './standin-flow.ts';
import type { JobRecord, LedgerRecord, NodeRecord, ResumedRecord, RunRecord } from '@hima/harness';

/**
 * What a test whose subject is one Generation adds to its `/hima run` line (`generations: 1` in a
 * body or a tool call).
 *
 * The shipped pack loops (#25): its Explore node's revisit edge opens the next generation with the
 * period the chooser chose, and a Campaign of it runs until the Goal is met, the periods stop moving
 * or its generation allowance is spent. A suite about one node's attempts, one restart or one of the
 * Site's slots is not about that, and would be asserting over three generations' records instead of
 * one — so it says how many generations it is about, and the Budget holds the Run to it. Such a Run
 * ends `ended-budget-exhausted` with `meters.endedBy: 'generation-limit'`, carrying the strategy it
 * was not allowed to try. What a Loop does is `loop.test.ts`.
 */
export const ONE_GENERATION = '--generations 1';

// ---------------------------------------------------------------------------------------------
// What the ledger holds, as a test reads it.
// ---------------------------------------------------------------------------------------------

export const recordsOf = (host: InProcessHost, runId: string): LedgerRecord[] => host.ctx.hima.ledger.records({ runId });
export const nodeRecords = (host: InProcessHost, runId: string): NodeRecord[] =>
  recordsOf(host, runId).filter((r): r is NodeRecord => r.type === 'node');
export const jobRecords = (host: InProcessHost, runId: string): JobRecord[] =>
  recordsOf(host, runId).filter((r): r is JobRecord => r.type === 'job');
export const resumedRecords = (host: InProcessHost, runId: string): ResumedRecord[] =>
  recordsOf(host, runId).filter((r): r is ResumedRecord => r.type === 'resumed');

/** The run record as the ledger holds it, which is the only place the Run's fabric state lives. */
export function runOf(host: InProcessHost, runId: string): RunRecord {
  const run = host.ctx.hima.ledger.run(runId);
  assert.ok(run, `the ledger holds run ${runId}`);
  return run;
}

/** Every tmux session this Run launched, in the order it launched them: one per attempt that got as
 *  far as a Job. What a test cleans up after itself with, and what "nothing was relaunched" is
 *  counted over. */
export const sessionsOf = (host: InProcessHost, runId: string): string[] =>
  jobRecords(host, runId).filter((r) => r.event === 'launched').map((r) => r.job.session);

/** Which attempt of its node waited on this session. A `launched` record carries no attempt number —
 *  the node record that names its session does — so this is how a launch is numbered. */
export function attemptWaitingOn(host: InProcessHost, runId: string, session: string): number | undefined {
  return nodeRecords(host, runId).find((r) => r.state === 'running' && r.jobSession === session)?.attempt;
}

/** Stop the stand-in Jobs a test started, however it ended. Named sessions only: never a session
 *  this test did not launch. */
export function killSessions(sessions: readonly string[]): void {
  for (const s of sessions) spawnSync('tmux', ['kill-session', '-t', `=${s}`], { timeout: 15_000 });
}

// ---------------------------------------------------------------------------------------------
// Waiting for the Site and for the ledger.
// ---------------------------------------------------------------------------------------------

/**
 * Poll until something is true on the Site or in the ledger, or fail saying what never happened.
 *
 * How long to wait and how often to look are the caller's, because the two suites are waiting for
 * different things: a stand-in that sleeps a second wants a look every few tens of milliseconds, and
 * a Job the Site is holding for twenty seconds does not.
 *
 * The probe may answer asynchronously — a look that stats a file the Site's own launch writes is one
 * — and a probe that answers at once is awaited as the value it already is.
 */
export async function waitUntil(what: string, probe: () => boolean | Promise<boolean>, timeoutMs = 60_000, everyMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

// ---------------------------------------------------------------------------------------------
// A local home with the shipped pack, a stand-in flow, and a site that binds it.
// ---------------------------------------------------------------------------------------------

/** What a fabric test's home is made with: the stand-in's own options, and the Site's declared job
 *  cap and licence seats for the tests whose subject is two Runs wanting the Site at once. */
export interface StandinHomeOptions extends StandinOptions {
  readonly parallelJobs?: number;
  readonly licences?: Readonly<Record<string, number>>;
}

export interface LocalHome {
  readonly h: HimaHome;
  readonly flow: StandinFlow;
}

/**
 * A local home with the shipped pack installed, a generated stand-in flow, and a site that binds it
 * — everything a Run needs, and no host. The tests that boot twice, or that boot the host as a real
 * subprocess, take it from here and boot it themselves, because the home outlives every host in
 * those tests.
 *
 * `undefined` when the stand-in's fixture is absent and `HIMA_FIXTURES_OPTIONAL=1` turned that into
 * a skip; the home is disposed before answering, so a skipped test leaves nothing behind.
 */
export async function localHome(t: TestContext, opts: StandinHomeOptions = {}): Promise<LocalHome | undefined> {
  const { parallelJobs, licences, ...standin } = opts;
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, standin);
  if (!flow) { await h.dispose(); return undefined; }
  await installPack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
    ...(parallelJobs === undefined ? {} : { parallelJobs }),
    ...(licences === undefined ? {} : { licences }),
  });
  return { h, flow };
}

export interface LocalFabric extends LocalHome {
  readonly host: InProcessHost;
  dispose(): Promise<void>;
}

/** The same home with an in-process host booted on it, and the one call that puts both back. */
export async function localFabric(t: TestContext, opts: StandinHomeOptions = {}): Promise<LocalFabric | undefined> {
  const home = await localHome(t, opts);
  if (!home) return undefined;
  const host = await bootInProcess(home.h);
  return { ...home, host, dispose: async () => { await host.dispose(); await home.h.dispose(); } };
}

// ---------------------------------------------------------------------------------------------
// Driving a Run while it is still going.
// ---------------------------------------------------------------------------------------------

export interface OpenJob {
  readonly runId: string;
  readonly session: string;
  /** The Campaign workspace as the Site resolved it, which is where the exit file lives. */
  readonly workspace: string;
}

/**
 * The Run a host is driving, once its act node has launched a Job and the node record says which
 * session it is waiting on — which is what a test must wait for before it takes the host away. Read
 * out of the ledger, exactly as a reconciliation would.
 *
 * Both records, not only the launch: they are written one after the other, and a test that took the
 * host away between them would be asserting on a different attempt shape from one run to the next.
 * (The harness handles that shape — the reconciliation numbers the attempt from the node's own
 * records and finds none — but a test must fix which shape it is asserting on.)
 */
export async function launchedJobOf(host: InProcessHost, timeoutMs = 60_000): Promise<OpenJob> {
  let found: OpenJob | undefined;
  await waitUntil('a job was launched and its node record written', () => {
    for (const run of host.ctx.hima.ledger.runs()) {
      const launched = jobRecords(host, run.id).find((r) => r.event === 'launched');
      if (!launched) continue;
      const session = launched.job.session;
      if (!nodeRecords(host, run.id).some((r) => r.state === 'running' && r.jobSession === session)) continue;
      found = { runId: run.id, session, workspace: launched.job.workspace };
      return true;
    }
    return false;
  }, timeoutMs);
  return found!;
}

/**
 * Start a run without waiting for it, so a test can act while its Job sleeps. The command's own
 * promise is kept: a host disposed mid-drive makes the drive's next ledger touch fail, which is how a
 * host that goes away stops driving, and awaiting that settled promise afterwards is what proves the
 * old host is no longer writing before the new one opens the same ledger.
 */
export function startRunInBackground(host: InProcessHost, h: HimaHome, line: string): Promise<CommandOutcome | undefined> {
  return himaCommand(host, h.workspace, line, siteCommandTimeoutMs).catch(() => undefined);
}

/**
 * A command left running while the test acts, with the one thing `startRunInBackground` does not
 * give: whether it has answered yet.
 *
 * `answer()` is undefined for exactly as long as the command is still driving its Run, which is what
 * "the Run was not stranded" is asserted as by the suite that breaks a Site under a live Run — a Run
 * whose drive raised has *answered*, and answered with the row left saying `running` and nothing
 * driving it. A command that threw is an answer too, and says so in its text rather than vanishing,
 * because a test asking "has it given up?" must be able to tell "not yet" from "it blew up".
 */
export interface Pending {
  answer(): CommandOutcome | undefined;
  readonly done: Promise<CommandOutcome>;
}

export function inBackground(host: InProcessHost, h: HimaHome, line: string): Pending {
  let answer: CommandOutcome | undefined;
  const settle = (outcome: CommandOutcome): CommandOutcome => {
    answer = outcome;
    return outcome;
  };
  const done = himaCommand(host, h.workspace, line, siteCommandTimeoutMs).then(
    (o) => settle(o),
    (err: Error) => settle({ kind: 'error', text: `the command threw: ${err.message}`, runId: undefined }),
  );
  return { answer: () => answer, done };
}
