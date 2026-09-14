// Contract-test support: boot the harness through the desktop shell's driver mode, and drive it.
//
// The one seam for every step-3 test is the desktop shell in driver mode (D42, ADR-0004): the same
// Electron main process a person runs, started with `--driver`, which prepares the home, launches the
// real dsh host, exchanges the token in its own window's session, and then answers JSON-line requests
// on its standard input with JSON-line answers on its standard output. What a test asserts on is
// what the window renders and what the routes answer with the session the shell established — never
// a module internal, never a page reached by a path the shell does not use, never a browser
// automation framework.
//
// `bootDriver` is the only way a driver test starts, and it skips with the reason where Electron
// cannot open a window: a headless login, a launchd session with no window server, a machine with no
// display, an install with no binary. A skip is reported, never silently passed over.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline';
import type { TestContext } from 'node:test';
import { createEmptyHome, createHimaHome, recordTestBoot, repoRoot, type HimaHome } from './dsh-home.ts';
import { installPack, timingProbePackId } from './pack.ts';
import { writeLocalSite } from './site.ts';
import { writeStandinFlow, type StandinFlow } from './standin-flow.ts';

const desktopDir = path.join(repoRoot, 'packages/desktop');
const mainEntry = path.join(desktopDir, 'lib/main.js');

/** How long the shell has to prepare the home, boot the host, load the page and answer `host`. */
const bootTimeoutMs = 150_000;

/** How long `quit` is given to end the shell before it is stopped by pid. */
const quitGraceMs = 15_000;

/** How long SIGTERM is given before SIGKILL follows it. */
const termGraceMs = 5_000;

/** The Electron executable this workspace installed, or why there is none. */
export function electronBinary(): { readonly at: string } | { readonly missing: string } {
  try {
    // Required outside Electron, the package answers with the path of the binary it fetched.
    const at = createRequire(path.join(desktopDir, 'package.json'))('electron') as unknown;
    if (typeof at !== 'string' || at === '') return { missing: 'the electron package reported no binary path' };
    return { at };
  } catch (err) {
    return { missing: `the electron binary is not installed: ${(err as Error).message}` };
  }
}

/**
 * Why this machine cannot open a window right now, or undefined when it can.
 *
 * The macOS question is which launchd session this process is in: only `Aqua` has a window server, so
 * a run over ssh or from a background agent is told so rather than failing as if the shell were
 * broken.
 */
export function whyNoWindow(): string | undefined {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return 'no X or Wayland display is available to this process';
  }
  if (process.platform === 'darwin') {
    const asked = spawnSync('launchctl', ['managername'], { encoding: 'utf8', timeout: 10_000 });
    const session = asked.stdout?.trim();
    if (asked.status === 0 && session !== undefined && session !== '' && session !== 'Aqua') {
      return `this process is in the "${session}" launchd session, which has no window server`;
    }
  }
  return undefined;
}

/** One answer line, as the driver writes it: the request's id, then ok, then the op's own fields. */
export type DriverAnswer<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };

/** A raw answer line, id and all, for a test of the protocol itself. */
export interface AnswerLine { readonly id: string | number | null; readonly ok: boolean; readonly error?: string; readonly [key: string]: unknown }

export interface HostAnswer {
  readonly url: string;
  readonly origin: string;
  readonly session: { readonly cookieName: string; readonly cookieValue: string };
}
export interface OpenAnswer { readonly url: string; readonly status: number; readonly title: string }
export interface RegionAnswer { readonly text: string; readonly state: Readonly<Record<string, string>> }
/** Where the click was sent, and what the page took it on: the note names the marked control the
 *  event actually landed inside, which is not always the one it was aimed at (#43). */
export interface ClickAnswer { readonly x: number; readonly y: number; readonly note: string }
/** What the filled control holds afterwards, read back out of the document. */
export interface FillAnswer { readonly value: string }
export interface ScreenshotAnswer { readonly path: string; readonly width: number; readonly height: number; readonly bytes: number }

/** The driver's ops, typed: each answers exactly what the shell answered, refusals included. */
export interface DriverClient {
  host(): Promise<DriverAnswer<HostAnswer>>;
  open(target: string): Promise<DriverAnswer<OpenAnswer>>;
  read(region: string): Promise<DriverAnswer<RegionAnswer>>;
  wait(region: string, text: string, timeoutMs?: number): Promise<DriverAnswer<RegionAnswer>>;
  click(control: string): Promise<DriverAnswer<ClickAnswer>>;
  /** Type a value into a marked input, or choose it in a marked `<select>`; a number is spelled out
   *  here so a test filling a period reads as one. */
  fill(control: string, value: string | number): Promise<DriverAnswer<FillAnswer>>;
  screenshot(target: string): Promise<DriverAnswer<ScreenshotAnswer>>;
  quit(): Promise<DriverAnswer<Record<never, never>>>;
  /** One request of any shape, for a test of the protocol's own refusals. */
  request(body: Readonly<Record<string, unknown>>): Promise<AnswerLine>;
  /** One raw line, not necessarily JSON; answered with `id: null` by the driver. */
  raw(line: string): Promise<AnswerLine>;
  /** Everything the shell wrote on stderr so far: its own `hima-desktop:` lines and the host's. */
  stderr(): string;
  /** Every stdout line that was not a JSON answer. In driver mode there must be none. */
  unexpectedStdout(): readonly string[];
  /** Resolves with the shell's exit code once it has ended, however it ended. */
  exit(): Promise<number | null>;
  /** The cookie header for a route call with the shell's own session. */
  cookie(): Promise<string>;
}

export interface BootDriverOptions {
  /** Test-only Chromium debugging port, used to reorder real HTTP responses at the window boundary. */
  readonly remoteDebuggingPort?: number;
  /**
   * `empty`: a home with nothing in it, so the shell has to make the profile (the window's own test).
   * `hima`: the profile installed, the shipped pack, the stand-in flow and the local site written by
   * the suite's own supports, so a Run can be started at once.
   *
   * Absent only when `existing` names a home this boot is joining rather than making.
   */
  readonly home?: 'empty' | 'hima';
  /**
   * A home an earlier boot made, to boot a second shell on: what a test of a Run that outlives its
   * host needs (#25). This boot makes nothing and seeds nothing — the pack, the flow, the site and
   * the HimaLedger are already there — and disposes nothing, because the home is the earlier boot's
   * to put back.
   *
   * Here rather than in a test's own spawn, because the seam is the shell in driver mode and a
   * second host reached any other way would be a second seam.
   */
  readonly existing?: HimaHome;
  /** Passed to the shell as `--site local`: the shell seeds the local site itself. */
  readonly seed?: 'local';
  readonly sleepSeconds?: number;
  readonly failures?: number;
  /** How many attempts fail first per `RESULT_TAG`, for a fork whose second tool writes its own
   *  report and spends its own failures (#29). */
  readonly failuresByTag?: Readonly<Record<string, number>>;
  /** What the stand-in flow closes at, in ns: a generation's setup slack is `min(0, period − this)`. */
  readonly achievableNs?: number;
  /**
   * Open the window in this colour scheme (`--theme`), whatever this machine is set to. The
   * workbench page follows `prefers-color-scheme`, which in Electron answers `nativeTheme`, so this
   * is the only way to ask a driven window for a palette: what `scripts/workbench-screenshot.ts`
   * photographs both of the page's palettes through. Absent, the window follows the machine.
   */
  readonly theme?: 'light' | 'dark';
  /**
   * The size the window opens at. Written into the window-state file the shell remembers a person's
   * last size in, before the shell is spawned — the same mechanism and no new flag, so a driven
   * window is sized the way a person's window is.
   */
  readonly window?: { readonly width: number; readonly height: number };
  /**
   * The model a driven host answers with (#59): dsh's keyless replay adapter over one of the
   * committed scenarios, in place of the DeepSeek one. Absent, the host keeps the product's own
   * model route — which, with no key in its environment, answers every turn with a refusal.
   *
   * Passed to the shell as `--replay`/`--replay-override`, which are driver-mode flags: a window a
   * person opens cannot be told to fake its model. `writeMomentFixture` is what makes the two paths.
   */
  readonly model?: {
    readonly replay: {
      readonly file: string;
      readonly override?: string;
      /**
       * Recorded child-session logs, in the order the adapter binds them (#62): the host's second
       * model session takes the first of these, its third the second, and so on. A scenario with
       * more than one moment in one host process needs them, because a sidecar replaces the primary
       * session's script alone; `writeMomentScenario` is what makes them.
       */
      readonly children?: readonly string[];
    };
  };
  /**
   * Environment the shell — and so the host inside it — is launched with, over the home's own.
   *
   * One test needs this and its subject is the reason it exists: a key reaches this product through
   * the launching environment and through no door of the harness's, so proving the harness writes no
   * key takes a run with a key in that environment and a scan of everything it wrote afterwards.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * The local Site's declared parallel job count and licence seats, for a test whose subject is two
   * Runs wanting the Site at once (#27). Left out, the site's own defaults stand: one job slot and
   * one seat of the licence the shipped pack's synthesis holds — which is a Site where the job cap
   * and the licence run out together, and so a Site no test can tell the two apart on.
   */
  readonly parallelJobs?: number;
  readonly licences?: Readonly<Record<string, number>>;
}

export interface BootedDriver extends DriverClient {
  readonly home: HimaHome;
  /** The stand-in flow the suite wrote, for a `hima` home. */
  readonly flow: StandinFlow | undefined;
  /** `quit`, then a kill by pid only if quit did not end the shell within the grace, then the home removed. */
  dispose(): Promise<void>;
}

/**
 * Boot the harness through the shell's driver mode on an isolated home.
 *
 * @param t - the test, so a machine that cannot open a window skips it with the reason.
 * @param options - which home to make (or which to join), and whether the shell seeds the local site
 *                  itself.
 * @returns the typed client, or undefined after `t.skip`.
 */
export async function bootDriver(t: TestContext, options: BootDriverOptions): Promise<BootedDriver | undefined> {
  const electron = electronBinary();
  if ('missing' in electron) { t.skip(electron.missing); return undefined; }
  const headless = whyNoWindow();
  if (headless !== undefined) { t.skip(`Electron cannot open a window here: ${headless}`); return undefined; }

  const joined = options.existing;
  if (joined === undefined && options.home === undefined) {
    throw new Error('bootDriver needs a home to make, or an existing one to join');
  }
  const home = joined ?? (options.home === 'empty' ? await createEmptyHome() : await createHimaHome());
  let flow: StandinFlow | undefined;
  if (joined === undefined && options.home === 'hima') {
    // Every way out of the seeding disposes the home: a missing fixture is a skip, a fixture that is
    // there but wrong is a throw, and neither may leave a directory behind under `os.tmpdir()`.
    try {
      flow = await writeStandinFlow(t, home, { sleepSeconds: options.sleepSeconds, failures: options.failures, failuresByTag: options.failuresByTag, achievableNs: options.achievableNs });
      if (!flow) { await home.dispose(); return undefined; }
      await installPack(home);
      await writeLocalSite(home, {
        allowedReadRoots: [home.workspace, flow.root],
        allowedWriteRoots: [home.workspace],
        bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: home.workspace },
        ...(options.parallelJobs === undefined ? {} : { parallelJobs: options.parallelJobs }),
        ...(options.licences === undefined ? {} : { licences: { ...options.licences } }),
      });
    } catch (err) {
      await home.dispose();
      throw err;
    }
  }

  // The window's own data directory, and the size it is to open at, before the shell reads either.
  const userData = path.join(home.home, 'electron-user-data');
  if (options.window !== undefined) {
    mkdirSync(userData, { recursive: true });
    writeFileSync(path.join(userData, 'window-state.json'), `${JSON.stringify(options.window)}\n`);
  }

  recordTestBoot('electron');
  const child = spawn(electron.at, [
    ...(options.remoteDebuggingPort === undefined ? [] : [`--remote-debugging-port=${options.remoteDebuggingPort}`]),
    mainEntry,
    '--driver',
    ...(options.seed === undefined ? [] : ['--site', options.seed]),
    ...(options.theme === undefined ? [] : ['--theme', options.theme]),
    ...(options.model === undefined ? [] : ['--replay', options.model.replay.file]),
    ...(options.model?.replay.override === undefined ? [] : ['--replay-override', options.model.replay.override]),
    ...(options.model?.replay.children ?? []).flatMap((child) => ['--replay-child', child]),
  ], {
    cwd: home.workspace,
    // `HIMA_NODE` is this test's own Node, which is the Node 24 dsh needs; the shell would otherwise
    // fall back to whatever `node` the PATH of a windowed app resolves, which is not this suite's
    // business to depend on. `HIMA_USER_DATA` keeps the window state, the generated pages and the
    // persistent cookie jar inside this throwaway home, so a suite run leaves nothing at all in the
    // developer's own application-data directory.
    env: {
      ...home.env,
      HIMA_NODE: process.execPath,
      HIMA_WORKSPACE: home.workspace,
      HIMA_USER_DATA: userData,
      // Desktop evidence belongs on the dedicated Catsights display unless an
      // operator explicitly selects another display for a controlled test.
      HIMA_DRIVER_DISPLAY: process.env.HIMA_DRIVER_DISPLAY ?? 'Catsights',
      BROWSER: 'none',
      ...options.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = attach(child);

  try {
    const first = await Promise.race([
      client.host(),
      client.exit().then((code) => { throw new Error(`the shell ended with ${String(code)} before it answered host\n${client.stderr()}`); }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`the shell answered nothing to host within ${String(bootTimeoutMs)} ms\n${client.stderr()}`)), bootTimeoutMs).unref()),
    ]);
    if (!first.ok) throw new Error(`the shell refused host: ${first.error}\n${client.stderr()}`);
  } catch (err) {
    await stopShell(child, client.exit());
    if (joined === undefined) await home.dispose();
    throw err;
  }

  return {
    ...client,
    home,
    flow,
    dispose: async () => {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          await Promise.race([
            client.quit().then(() => client.exit()),
            new Promise<void>((resolve) => setTimeout(resolve, quitGraceMs).unref()),
          ]);
          await stopShell(child, client.exit());
        }
      } finally {
        // A home this boot joined belongs to the boot that made it, and goes back with that one.
        if (joined === undefined) await home.dispose();
      }
    },
  };
}

/**
 * The Run the window is showing on its list, once there is one.
 *
 * A test that starts a Campaign and does not wait for it has no run id yet — the start route answers
 * only when the Run stops — so it reads the id off the page, which is where a person reads it too.
 *
 * @param d - the booted shell.
 * @param pack - the pack whose Run the list is waited for. The shipped one unless a test varied it:
 *               the list prints the pack each Run is of, so a test driving a variant would otherwise
 *               wait for a row that is never coming (#54).
 * @param timeoutMs - how long to wait for the list to name a Run of that pack.
 * @returns the run id, as the page prints it.
 */
export async function runIdOnTheList(d: BootedDriver, pack: string = timingProbePackId, timeoutMs = 60_000): Promise<string> {
  const opened = await d.open('/hima/');
  assert.ok(opened.ok, JSON.stringify(opened));
  const listed = await d.wait('runs', pack, timeoutMs);
  assert.ok(listed.ok, `wait runs: ${JSON.stringify(listed)}`);
  const id = /run-[0-9a-f-]+/.exec(listed.text)?.[0];
  assert.ok(id, `the list names the Run it is showing: ${listed.text}`);
  return id;
}

/**
 * Stop the shell the way the shell stops itself.
 *
 * SIGTERM first, because the main process's `before-quit` is what stops the dsh host, and the host
 * is what ends the tmux Job it holds: a SIGKILL straight at Electron orphans both. Only a shell
 * that is still there after the grace is killed, and only by this child's own pid.
 *
 * @param child - the shell this support spawned, and no other process.
 * @param exited - its exit, so the grace ends as soon as it is over.
 */
async function stopShell(child: ChildProcess, exited: Promise<number | null>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, termGraceMs).unref())]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

/** The wire: one request per line out, one answer per line in, matched by id. */
function attach(child: ChildProcess): DriverClient {
  let err = '';
  const noise: string[] = [];
  const pending = new Map<string | number, (answer: AnswerLine) => void>();
  const unmatched: ((answer: AnswerLine) => void)[] = [];
  let nextId = 1;
  child.stderr!.on('data', (d) => { err += String(d); });
  const exited = new Promise<number | null>((resolve) => { child.once('close', (code) => resolve(code)); });
  readline.createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (line) => {
    let answer: AnswerLine;
    try {
      answer = JSON.parse(line) as AnswerLine;
    } catch {
      noise.push(line);
      return;
    }
    if (typeof answer !== 'object' || answer === null) { noise.push(line); return; }
    if (answer.id !== null && (typeof answer.id === 'string' || typeof answer.id === 'number') && pending.has(answer.id)) {
      const resolve = pending.get(answer.id)!;
      pending.delete(answer.id);
      resolve(answer);
      return;
    }
    const waiting = unmatched.shift();
    if (waiting) waiting(answer);
    else noise.push(line);
  });
  // A shell that ends answers nothing more: every waiter is failed, not left hanging. Both kinds —
  // the requests waiting on their own id, and a `raw()` line waiting on the next answer of any id.
  void exited.then((code) => {
    const gone = `the shell ended with ${String(code)} before it answered\n${err}`;
    for (const [id, resolve] of pending) {
      pending.delete(id);
      resolve({ id, ok: false, error: gone });
    }
    for (const waiting of unmatched.splice(0)) waiting({ id: null, ok: false, error: gone });
  });
  // A shell that ended closed its stdin, and a write that raced that end is an EPIPE — the shell
  // being gone, which the exit above already answers every waiter with. Unhandled, it would be an
  // error event on the stream and so an exception in the test process.
  child.stdin!.on('error', (cause: NodeJS.ErrnoException) => {
    if (cause.code === 'EPIPE' || cause.code === 'ERR_STREAM_DESTROYED') return;
    err += `\ndriver support: writing to the shell failed: ${String(cause)}\n`;
  });

  const send = (line: string): void => {
    if (!child.stdin!.writable) throw new Error('the shell\'s stdin is closed');
    child.stdin!.write(`${line}\n`);
  };
  const request = (body: Readonly<Record<string, unknown>>): Promise<AnswerLine> =>
    new Promise((resolve) => {
      const id = typeof body.id === 'string' || typeof body.id === 'number' ? body.id : nextId++;
      const withId = { id, ...body };
      if (child.exitCode !== null || child.signalCode !== null) { resolve({ id, ok: false, error: `the shell has already ended\n${err}` }); return; }
      pending.set(id, resolve);
      send(JSON.stringify(withId));
    });
  const op = <T>(body: Readonly<Record<string, unknown>>): Promise<DriverAnswer<T>> =>
    request(body).then(({ id: _id, ...rest }) => rest as DriverAnswer<T>);

  const host = (): Promise<DriverAnswer<HostAnswer>> => op<HostAnswer>({ op: 'host' });
  return {
    host,
    open: (target) => op<OpenAnswer>({ op: 'open', path: target }),
    read: (region) => op<RegionAnswer>({ op: 'read', region }),
    wait: (region, text, timeoutMs) => op<RegionAnswer>({ op: 'wait', region, text, ...(timeoutMs === undefined ? {} : { timeoutMs }) }),
    click: (control) => op<ClickAnswer>({ op: 'click', control }),
    fill: (control, value) => op<FillAnswer>({ op: 'fill', control, value: String(value) }),
    screenshot: (target) => op<ScreenshotAnswer>({ op: 'screenshot', path: target }),
    quit: () => op<Record<never, never>>({ op: 'quit' }),
    request,
    raw: (line) => new Promise((resolve) => { unmatched.push(resolve); send(line); }),
    stderr: () => err,
    unexpectedStdout: () => [...noise],
    exit: () => exited,
    cookie: async () => {
      const answer = await host();
      if (!answer.ok) throw new Error(`no session: ${answer.error}`);
      return `${answer.session.cookieName}=${answer.session.cookieValue}`;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Driving the workbench's start form
//
// One spelling each, here, because three files drive the same form: `window.test.ts`,
// `strategy.test.ts` and `scripts/workbench-screenshot.ts`. A helper copied between test files is
// three things that can drift apart while every one of them still passes (step-4 conventions,
// *Tests*).
// ---------------------------------------------------------------------------------------------

/** A run id as the ledger mints it: `run-` and a UUID. What the page's run list shows for each Run. */
const runIdPattern = /run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * Wait for the start form's knob fields to be the ones this pack declares, which the region says.
 *
 * The fields under the pack selection are that pack's own Strategy knobs (#58), re-read from the
 * host when the selection changes, so a knob filled before the replacement is a value the form would
 * throw away — and the Campaign would start at the pack's declared default instead, saying nothing
 * about it.
 *
 * @param d - the booted shell.
 * @param pack - the pack the fields must belong to, which `start-knobs` states.
 * @param timeoutMs - how long the page has to re-read the declaration.
 */
export async function waitForKnobs(d: BootedDriver, pack: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const knobs = await d.read('start-knobs');
    if (knobs.ok && knobs.state.pack === pack) return;
    if (Date.now() >= deadline) throw new Error(`the start form did not re-read the strategy ${pack} declares: ${JSON.stringify(knobs)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Fill the whole start form, with `changes` overriding a field, in the order a person moves down it.
 *
 * The pack is filled first where a caller's `form` names it, for the reason `waitForKnobs` exists:
 * choosing another pack replaces the knob fields below it. So the selection is waited on before
 * anything under it is typed into. Before returning to a caller that will click Start, also wait
 * for the current Pack/Site check: changing Site starts a request even when the knob identity is
 * unchanged, and its reply both enables and repositions the button. A received mouse event on a
 * disabled button is not a submission.
 *
 * @param d - the booted shell.
 * @param form - what every field is filled with, in the order they are filled.
 * @param changes - what to fill differently, by control.
 */
export async function fillForm(
  d: BootedDriver,
  form: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, string>> = {},
): Promise<void> {
  const values = { ...form, ...changes };
  for (const [control, value] of Object.entries(values)) {
    const filled = await d.fill(control, value);
    assert.ok(filled.ok, `fill ${control}: ${JSON.stringify(filled)}`);
    assert.equal(filled.value, value, `the field holds what was typed into it: ${JSON.stringify(filled)}`);
    if (control === 'start-pack') await waitForKnobs(d, value);
  }
  await waitForStartCheck(d, values);
}

/** Wait on the product's current declaration check, including in scripts that retain typed fields
 * individually for their audit. This observes readiness; it does not validate the Pack or Site. */
export async function waitForStartCheck(
  d: BootedDriver,
  values: Readonly<Record<string, string>>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const check = await d.read('start-check');
    const current = check.ok
      && (values['start-pack'] === undefined || check.state.pack === values['start-pack'])
      && (values['start-site'] === undefined || check.state.site === values['start-site']);
    if (current && check.state.status === 'fit') return;
    if ((current && check.state.status !== 'checking') || Date.now() >= deadline) {
      throw new Error(`the filled form is not ready for submission: ${JSON.stringify(check)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The one Run the ledger holds, read off the page's own run list — which is where a person reads it. */
export async function theOneRunId(d: BootedDriver): Promise<string> {
  const listed = await d.open('/hima/');
  assert.ok(listed.ok, JSON.stringify(listed));
  const runs = await d.read('runs');
  assert.ok(runs.ok, JSON.stringify(runs));
  assert.equal(runs.state.count, '1', `exactly one Run was started: ${JSON.stringify(runs)}`);
  const found = runIdPattern.exec(runs.text);
  assert.ok(found, `the run list names the Run: ${runs.text}`);
  return found[0];
}
