// @hima-seam cli direct
// Starting the hima profile as a child process, and knowing when it is ready to be loaded.
//
// One module, two callers: the desktop shell's main process (`main.ts`) and the contract suite's
// `bootHimaHost` (`test/contract/support/boot-host.ts`). They are the same act — spawn the dsh CLI on
// the hima profile at a port nobody else holds, read the tokened URL it prints, and wait until it
// answers — and they were two implementations of it for exactly as long as it took the second one to
// be written. A window that boots the host differently from the way every contract test boots it is a
// window nothing tests.
//
// The dsh seam here is the CLI itself: `node <dsh>/lib/bin.js --profile hima ...`, the documented
// entry point, invoked exactly as a person invokes it. Nothing is imported from a dsh package — the
// entry's path is the caller's to resolve — so this module keeps no compile-time coupling at all, and
// what it knows about dsh is stated below as facts about its command line and its output.
//
// Borrowed, under MIT with attribution in ../THIRD-PARTY-NOTICES.md, from `dataelement/dsh-desktop`
// @ c8c33c4 (see docs/research/2026-09-09-dsh-desktop-shells.md §5): the argument builder
// (`harness-runtime.ts` L184–200), the launch-token parser (L160–182), the readiness predicate and
// its polling window (L306–320, L799–826), and the graceful stop (L510–521). Their reasons are
// restated below where they bind our design; the code is our own.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

/** The loopback address the host is told to bind. Never `0.0.0.0`: the dsh CLI refuses that outright,
 *  and a workbench that listened on a customer's LAN would be a second thing for CAD to defend. */
export const HOST_ADDRESS = '127.0.0.1';

/**
 * The dsh command line for one hima host.
 *
 * `--no-open` is not optional and not a convenience: without it the web app hands the same loopback
 * URL to the default browser on every launch, which is the browser tab the owner's decision (D39)
 * says HimaGuide is never delivered as. `--host` and `--port` are both explicit so the URL the caller
 * builds is the URL the host binds, rather than one inferred from a default that may change.
 *
 * The profile is named by the caller and has no default here: which profile the workbench is, is
 * `hima-home.ts`'s fact — that is the module that puts it in a home — and one name in one place is
 * how the home that gets prepared stays the home that gets booted.
 *
 * @param options - the profile to boot and the port to bind.
 * @returns the argument vector, after the dsh entry path.
 */
export function buildHostArguments(options: { readonly profile: string; readonly port: number }): string[] {
  return ['--profile', options.profile, '--host', HOST_ADDRESS, '--port', String(options.port), '--no-open'];
}

/**
 * The tokened URL in one line of the host's output, or nothing when that line carries none.
 *
 * Since dsh 0.1.2-alpha.1 the Host authenticates before dispatch: `dsh-web-app` prints one root URL
 * carrying a per-process token, and only `GET /?token=…` exchanges it for the signed, authority-bound
 * session cookie — API paths and `Authorization` headers do not accept it. So this line is where
 * every consumer of a freshly booted host has to start, the window and the contract suite alike.
 *
 * A candidate is taken only when it parses as a URL *and* carries a token, rather than "the first
 * `dsh web:` line": the browser handoff prints a second such line, and the address may carry a
 * ` (LAN: …)` suffix. Matching on what we actually need is what makes those two harmless.
 *
 * @param line - one line of the host's stdout or stderr.
 * @returns the URL and its token, or undefined.
 */
export function extractLaunchUrl(line: string): { readonly url: string; readonly token: string } | undefined {
  const match = /\bdsh web:\s*(\S+)/u.exec(line);
  if (!match?.[1]) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(match[1]);
  } catch {
    return undefined;
  }
  const token = parsed.searchParams.get('token');
  return token === null || token === '' ? undefined : { url: parsed.toString(), token };
}

/**
 * Is this readiness probe's status one a serving host gives?
 *
 * The probe is unauthenticated on purpose — it must never carry or spend the launch token — so 401 is
 * the *expected* answer, not a failure. Anything that is not a server error therefore means the host
 * is up and answering; only a 5xx (or no answer at all) means it is not yet.
 *
 * @param status - the HTTP status the probe got.
 * @returns whether the host is serving.
 */
export const isHostProbeHealthy = (status: number): boolean => status >= 200 && status < 500;

/** A TCP port nothing on this machine holds right now: bound, read, and released. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, HOST_ADDRESS, () => {
      const a = srv.address();
      srv.close(() => (typeof a === 'object' && a ? resolve(a.port) : reject(new Error('no port'))));
    });
  });
}

/**
 * Stop a child the way a host holding a session lock and an append-only writer should be stopped:
 * ask, wait, and only then insist.
 *
 * @param child - the process to stop.
 * @param graceMs - how long SIGTERM is given before SIGKILL.
 * @returns the exit code, or null when the signal ended it.
 */
export function stopChild(child: ChildProcess, graceMs = 4_000): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(child.exitCode); return; }
    const insist = setTimeout(() => child.kill('SIGKILL'), graceMs);
    child.once('close', (code) => { clearTimeout(insist); resolve(code); });
    child.kill('SIGTERM');
  });
}

/** A booted hima host: the child, where it serves, and how to stop it. */
export interface LaunchedHost {
  readonly child: ChildProcess;
  /** The tokened URL the web app printed. Loading it once exchanges the token for a session cookie. */
  readonly url: string;
  /** That URL's origin, which is what every later request and every cookie belongs to. */
  readonly origin: string;
  readonly port: number;
  stdout(): string;
  stderr(): string;
  /** SIGTERM, wait, then SIGKILL; resolves with the exit code. */
  stop(graceMs?: number): Promise<number | null>;
}

export interface HostLaunchRequest {
  /** Absolute path to dsh's CLI entry (`@deepseek-ai/dsh/lib/bin.js`), resolved by the caller. */
  readonly dshEntry: string;
  /** The Node to run it with. dsh needs Node 24; whichever executable this names must be one. */
  readonly node: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** The profile to boot. Named by the caller; see `buildHostArguments`. */
  readonly profile: string;
  /** A port to bind. Absent, one nothing holds right now. */
  readonly port?: number;
  /** How long to wait for the host to print its URL and start answering. */
  readonly timeoutMs?: number;
  /**
   * Called with the child the instant it exists, before this function has waited for anything.
   *
   * A boot takes seconds and may take the whole timeout, and whoever asked for the host can be asked
   * to quit inside that window. A caller that only learns about the child when this promise resolves
   * has nothing to stop in the meantime, and an abandoned dsh keeps the home's session lock — so the
   * *next* launch fails for a reason its message cannot explain. The child is published first and
   * waited for second, so there is no moment in which it is running unowned.
   */
  readonly onSpawn?: (child: ChildProcess) => void;
}

/**
 * What a host that never came up says, with everything it printed, so nobody has to go looking.
 *
 * The three fields are declared and assigned rather than written as constructor parameter
 * properties: this module is loaded as TypeScript by the contract suite, and Node's type stripping
 * only erases types — a parameter property is syntax it would have to *emit*, so it refuses the file
 * outright and every test that boots a host fails to load. That rule is no longer this comment's to
 * keep: `erasableSyntaxOnly` is on in `tsconfig.json` here and in `test/tsconfig.json`, so a
 * parameter property, an `enum`, a `namespace` or an `import =` anywhere in either project is a
 * typecheck error the pre-commit hook already runs, rather than six test files failing to load.
 */
export class HostLaunchError extends Error {
  readonly reason: string;
  readonly stdout: string;
  readonly stderr: string;

  constructor(reason: string, stdout: string, stderr: string) {
    super(`${reason}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
    this.name = 'HostLaunchError';
    this.reason = reason;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Start one hima host and resolve once it is serving.
 *
 * Readiness is two facts, not one. The printed URL says the web app got as far as choosing an
 * address; an HTTP answer says it is actually listening on it. Both are needed: `--port <n>` can
 * still fail to bind, and a caller that navigated on the printed line alone would sometimes load
 * nothing. The probe is made against the bare origin with `redirect: 'manual'`, so it neither carries
 * the token nor follows the 303 that would spend it outside the window's own session.
 *
 * @param req - where dsh is, what to run it with, and where it should serve.
 * @returns the running host.
 * @throws HostLaunchError when the host exits early, prints no URL, or never answers in time.
 */
export async function launchHimaHost(req: HostLaunchRequest): Promise<LaunchedHost> {
  const timeoutMs = req.timeoutMs ?? 90_000;
  const reserved = req.port ?? (await freePort());
  const child = spawn(req.node, [req.dshEntry, ...buildHostArguments({ profile: req.profile, port: reserved })], {
    cwd: req.cwd,
    env: req.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Published before anything is awaited, so a caller asked to quit mid-boot has something to stop.
  req.onSpawn?.(child);
  let out = '';
  let err = '';
  // Both streams are scanned: dsh prints its URL on stdout, but a line that lands on stderr is still
  // that line, and a shell that watched only one of them would wait out the whole timeout for a host
  // that was already serving.
  child.stdout!.on('data', (d) => { out += String(d); });
  child.stderr!.on('data', (d) => { err += String(d); });
  const printed = (): { url: string; token: string } | undefined => {
    for (const line of `${out}\n${err}`.split('\n')) {
      const found = extractLaunchUrl(line);
      if (found) return found;
    }
    return undefined;
  };

  const deadline = Date.now() + timeoutMs;
  const started = await until(deadline, printed, () => {
    if (child.exitCode !== null) throw new HostLaunchError(`dsh exited early with ${child.exitCode}`, out, err);
  });
  if (!started) {
    child.kill('SIGKILL');
    throw new HostLaunchError(`dsh never printed its URL within ${timeoutMs} ms`, out, err);
  }
  const address = new URL(started.url);
  const origin = address.origin;
  // The port the host bound, read off the URL it printed, not the one we asked it for. They are the
  // same today; if dsh ever chose another, a caller that had been handed the reservation would be
  // probing a port nothing is listening on while `origin` pointed at the right one.
  const port = address.port === '' ? reserved : Number(address.port);

  const serving = await until(deadline, async () => (await probe(origin)) === true || undefined, () => {
    if (child.exitCode !== null) throw new HostLaunchError(`dsh exited with ${child.exitCode} before it answered`, out, err);
  });
  if (!serving) {
    child.kill('SIGKILL');
    throw new HostLaunchError(`dsh printed ${started.url} but never answered on ${origin}`, out, err);
  }

  return {
    child,
    url: started.url,
    origin,
    port,
    stdout: () => out,
    stderr: () => err,
    stop: (graceMs) => stopChild(child, graceMs),
  };
}

/** One unauthenticated readiness probe. A refusal is an answer: the host is up and fencing us. */
async function probe(origin: string): Promise<boolean> {
  try {
    const res = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(1_000) });
    return isHostProbeHealthy(res.status);
  } catch {
    return false;
  }
}

/** Poll until something is there or the deadline passes, checking after every turn that the child we
 *  are waiting for is still alive — a dead child is answered now, not at the end of the budget. */
async function until<T>(deadline: number, probeOnce: () => T | undefined | Promise<T | undefined>, alive: () => void): Promise<T | undefined> {
  for (;;) {
    alive();
    const found = await probeOnce();
    if (found !== undefined) return found;
    if (Date.now() >= deadline) return undefined;
    await new Promise((r) => setTimeout(r, 100));
  }
}
