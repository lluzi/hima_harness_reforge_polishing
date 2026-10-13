// The live tool view a Campaign pane frames: the Site's own GUI (today MAGE's xpra HTML5 display),
// reached through the Site's existing warm SSH ControlMaster. One reason to change: how the Host
// opens, watches and tears down the local forward that makes a Site's tool display reachable from
// this machine, and the URL it publishes for the frame.
//
// Modeled on `libinsight-viewer.ts`: a Host-owned lifecycle with the same status union
// (`unavailable|stopped|starting|ready|failed`) and the same serial-per-subject start/stop with a
// generation counter. The difference is the target. LibInsight is a local process this Host launches;
// a tool view is a port on a Site. For an `ssh` Site the Host spawns one long-lived
// `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote>` that rides the Site's warm master (`sshBaseArgs`),
// so the frame dials `localhost:<local>` on this machine and never the Site. For a `local` Site the
// port is already on this machine, so there is no process at all — only the readiness probe. The
// frame URL is `localhost`, never `127.0.0.1`: the Host's session cookie belongs to `127.0.0.1`
// whatever the port, so a frame there would hand it to the tool on every request.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { controlPathFor, sshBaseArgs, sshDestinationOf, sshTargetOf } from './channel.js';
import { loadSite, type Site, type ToolViewKind } from './sites.js';

export type ToolViewStatus =
  | { readonly state: 'unavailable'; readonly site: string; readonly reason: string }
  | { readonly state: 'stopped'; readonly site: string; readonly kind: ToolViewKind; readonly label: string }
  | { readonly state: 'starting'; readonly site: string; readonly kind: ToolViewKind; readonly label: string }
  | { readonly state: 'ready'; readonly site: string; readonly kind: ToolViewKind; readonly label: string; readonly url: string; readonly local: boolean }
  | { readonly state: 'failed'; readonly site: string; readonly kind: ToolViewKind; readonly label: string; readonly reason: string; readonly log: string };

export interface ToolViewOptions {
  /** Where `loadSite` reads a Site's declaration from. */
  readonly sitesDir: string;
  /** `<home>/tool-view.json` remembers the local forward port per Site, so the frame origin — and
   *  thus whatever the xpra HTML5 client keeps in that origin's browser storage — stays stable. */
  readonly home: string;
  /** Injectable for tests (the local/desktop groups forbid a real `ssh` spawn). */
  readonly spawn?: typeof nodeSpawn;
  /** How long the forward may take to answer its first page. Default 15 s. */
  readonly readyTimeoutMs?: number;
  /** How readiness is decided; default a plain HTTP GET that answers 2xx/3xx. */
  readonly probe?: (url: string) => Promise<boolean>;
}

export interface ToolView {
  status(site: string): Promise<ToolViewStatus>;
  open(site: string, request?: { readonly restart?: boolean }): Promise<ToolViewStatus>;
  /** Stop one Site's forward, or — with no argument — every forward (Host shutdown). */
  stop(site?: string): Promise<void>;
}

/** The frame URL for a tool view published on `localPort` of this machine. Pure and unit-tested: the
 *  xpra HTML5 client reads every option from the query string, and these are the ones this slice
 *  fixes — a keyboard but no floating menu, and sound, clipboard, printing and file transfer all off,
 *  so a view that becomes interactive cannot move data off the Site by those paths. `localhost`, never
 *  `127.0.0.1`, for the cookie reason above. */
export function toolViewUrl(kind: ToolViewKind, localPort: number): string {
  switch (kind) {
    case 'xpra-html5':
      return `http://localhost:${localPort}/?keyboard=true&floating_menu=false&autohide=true&sound=false&clipboard=false&printing=false&file_transfer=false&sharing=true&steal=false&reconnect=true&remote_logging=false&keyboard_layout=us`;
  }
}

/** A port nobody holds right now; the forward binds it a moment later and a lost race is one retry.
 *  The remembered port is tried first so the frame origin stays stable across Host restarts. */
function freePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => preferred === undefined ? reject(error) : freePort().then(resolve, reject));
    server.listen(preferred ?? 0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no loopback port')));
    });
  });
}

const LOG_LINES = 200;
const LOG_BYTES = 4 * 1024;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** One Site's forward: the child (ssh Sites only), what it published once ready, the last failure, a
 *  start in flight, and the serial chain plus generation that keep two looks from opening two. */
interface Forward {
  child?: ChildProcess;
  running?: { readonly url: string; readonly local: boolean };
  failure?: { readonly reason: string; readonly log: string };
  starting?: Promise<ToolViewStatus>;
  queue: Promise<unknown>;
  generation: number;
}

const defaultProbe = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
    return response.status >= 200 && response.status < 400;
  } catch { return false; }
};

export function createToolView(options: ToolViewOptions): ToolView {
  const spawn = options.spawn ?? nodeSpawn;
  const readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
  const probe = options.probe ?? defaultProbe;
  const portsFile = path.join(options.home, 'tool-view.json');
  const forwards = new Map<string, Forward>();

  const forwardFor = (site: string): Forward => {
    let f = forwards.get(site);
    if (f === undefined) { f = { queue: Promise.resolve(), generation: 0 }; forwards.set(site, f); }
    return f;
  };
  const serial = <T>(f: Forward, work: () => Promise<T>): Promise<T> => { const next = f.queue.then(work, work); f.queue = next.catch(() => undefined); return next; };

  // A Site that no longer loads, or that declares no tool view, is unavailable — never a process.
  const resolve = (site: string): Site | undefined => { try { return loadSite(options.sitesDir, site); } catch { return undefined; } };
  const head = (site: Site): { kind: ToolViewKind; label: string } => ({ kind: site.toolView!.kind, label: site.toolView!.label ?? 'Tool' });
  const unavailable = (site: string, loaded: Site | undefined): ToolViewStatus =>
    ({ state: 'unavailable', site, reason: loaded === undefined ? `No Site named "${site}" is installed here.` : `Site "${site}" declares no tool view.` });

  const ports = (): Promise<Record<string, number>> => readFile(portsFile, 'utf8').then(text => JSON.parse(text) as Record<string, number>).catch(() => ({}));
  const remember = async (site: string, port: number): Promise<void> => {
    const current = await ports();
    await mkdir(path.dirname(portsFile), { recursive: true });
    await writeFile(portsFile, `${JSON.stringify({ ...current, [site]: port }, null, 2)}\n`).catch(() => undefined);
  };

  const ringOf = (lines: readonly string[]): string => {
    const text = lines.join('\n');
    return text.length > LOG_BYTES ? text.slice(text.length - LOG_BYTES) : text;
  };

  const kill = async (proc: ChildProcess): Promise<void> => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()));
    proc.kill('SIGTERM');
    const timer = setTimeout(() => proc.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
  };
  const stopChild = async (f: Forward): Promise<void> => {
    const current = f.child;
    f.child = undefined; f.running = undefined;
    if (current !== undefined) await kill(current);
  };

  const launch = async (site: Site, f: Forward, mine: number): Promise<ToolViewStatus> => {
    const { kind, label } = head(site);
    const name = site.name;
    const superseded = (): ToolViewStatus => ({ state: 'stopped', site: name, kind, label });
    const remote = site.toolView!.port;
    const isLocal = site.kind === 'local';
    let log: string[] = [];
    let exited: string | undefined;
    let proc: ChildProcess | undefined;
    let local: number;

    if (isLocal) {
      // The declared port is already a loopback port on this machine; there is nothing to forward.
      local = remote;
    } else {
      const last = (await ports())[name];
      local = await freePort(Number.isInteger(last) && last! > 1024 && last! < 65536 ? last : undefined);
      if (f.generation !== mine) return superseded();
      const target = sshTargetOf(site);
      // `-N` runs no remote command, only the forward; `ExitOnForwardFailure` makes a bind that the
      // Site refuses an exit rather than a connection that silently carries nothing. The option list
      // is `SshChannel`'s own, so this `ssh` reuses the one warm master rather than opening a second.
      const argv = ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${local}:127.0.0.1:${remote}`,
        ...sshBaseArgs(target, controlPathFor(site)), '--', sshDestinationOf(target)];
      proc = spawn('ssh', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
      f.child = proc;
      // A Host that ends without its own shutdown still takes its forward with it.
      const killOnExit = (): void => { proc!.kill('SIGTERM'); };
      process.once('exit', killOnExit);
      const keep = (chunk: Buffer): void => { log.push(...chunk.toString('utf8').split('\n').filter(line => line.trim() !== '')); if (log.length > LOG_LINES) log = log.slice(-LOG_LINES); };
      proc.stdout?.on('data', keep); proc.stderr?.on('data', keep);
      proc.once('error', error => { exited = error.message; });
      proc.once('exit', (codeValue, signal) => {
        process.off('exit', killOnExit);
        exited ??= `exited with ${signal ?? `code ${String(codeValue)}`}`;
        if (f.child === proc) { f.child = undefined; f.running = undefined; }
      });
      await remember(name, local).catch(() => undefined);
    }

    const url = toolViewUrl(kind, local);
    const probeUrl = `http://127.0.0.1:${local}/`;
    const deadline = Date.now() + readyTimeoutMs;
    while (exited === undefined && Date.now() < deadline) {
      if (f.generation !== mine) { if (proc !== undefined) await kill(proc); return superseded(); }
      if (await probe(probeUrl)) {
        if (f.generation !== mine) { if (proc !== undefined) await kill(proc); return superseded(); }
        f.running = { url, local: isLocal }; f.failure = undefined;
        return { state: 'ready', site: name, kind, label, url, local: isLocal };
      }
      await sleep(250);
    }

    if (proc !== undefined) { if (exited === undefined) await kill(proc); if (f.child === proc) f.child = undefined; }
    const reason = exited !== undefined
      ? `The ${label} tool view on ${name} could not start: ${exited}.`
      : `The ${label} tool view on ${name} did not answer at ${probeUrl} within ${Math.round(readyTimeoutMs / 1000)} s.`;
    f.running = undefined;
    f.failure = { reason, log: ringOf(log) };
    return { state: 'failed', site: name, kind, label, reason, log: ringOf(log) };
  };

  const openNow = async (name: string, request: { readonly restart?: boolean }, mine: number): Promise<ToolViewStatus> => {
    const site = resolve(name);
    if (site?.toolView === undefined) return unavailable(name, site);
    const f = forwardFor(name);
    const { kind, label } = head(site);
    if (f.running !== undefined && request.restart !== true) return { state: 'ready', site: name, kind, label, url: f.running.url, local: f.running.local };
    if (f.generation !== mine) return { state: 'stopped', site: name, kind, label };
    await stopChild(f);
    return launch(site, f, mine);
  };

  const open = (name: string, request: { readonly restart?: boolean } = {}): Promise<ToolViewStatus> => {
    const f = forwardFor(name);
    // A plain look while a start is under way joins it; a restart waits its turn.
    if (f.starting !== undefined && request.restart !== true) return f.starting;
    const mine = f.generation;
    const attempt = serial(f, () => openNow(name, request, mine));
    f.starting = attempt;
    void attempt.finally(() => { if (f.starting === attempt) f.starting = undefined; }).catch(() => undefined);
    return attempt;
  };

  const status = async (name: string): Promise<ToolViewStatus> => {
    const site = resolve(name);
    if (site?.toolView === undefined) return unavailable(name, site);
    const { kind, label } = head(site);
    const f = forwards.get(name);
    if (f?.starting !== undefined) return { state: 'starting', site: name, kind, label };
    if (f?.running !== undefined) return { state: 'ready', site: name, kind, label, url: f.running.url, local: f.running.local };
    if (f?.failure !== undefined) return { state: 'failed', site: name, kind, label, reason: f.failure.reason, log: f.failure.log };
    return { state: 'stopped', site: name, kind, label };
  };

  const stopOne = async (f: Forward): Promise<void> => {
    f.generation += 1;
    const pending = f.queue;
    await stopChild(f);
    await pending;
    await stopChild(f);
    f.failure = undefined;
  };

  const stop = async (name?: string): Promise<void> => {
    if (name !== undefined) { const f = forwards.get(name); if (f !== undefined) await stopOne(f); return; }
    await Promise.all([...forwards.values()].map(stopOne));
  };

  return { status, open, stop };
}
