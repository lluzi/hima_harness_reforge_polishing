// HimaChannel: how the harness reaches a Site. Local is this machine. SSH is the owner's own OpenSSH
// client, keys, and agent — Hima stores no credential — kept warm by one control connection per Site
// that re-establishes itself the moment it is gone. The channel runs its own small vocabulary on a
// Site and refuses anything else rather than trusting its caller: the read-only probes it reads
// reports with, and the plumbing that puts a Job in a tmux session and asks what became of it. What
// the Job itself may be is the Permit's decision (`shell.ts`), never this list's.
import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { Site, SshTarget } from './sites.js';
import type { PathResolver } from './shell.js';
import { SiteUnreadableError } from './errors.js';

/** What running one command on a Site produced. A non-zero exit is an answer, not a fault: the job
 *  operations ask questions whose "no" is a non-zero code (`tmux has-session` on a session that
 *  ended, `test -f` on an exit file not written yet), so the channel reports the outcome and its
 *  caller decides what it means. The channel throws only when the command could not be attempted or
 *  did not come back at all, so `code` is always a number a caller can reason about — and it throws
 *  that as `SiteUnreadableError`, because a command that could not be run is a Site that did not
 *  answer and nothing may be concluded from it (#18). */
export interface ExecResult {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/** What a command may be given beyond its argv. Only standard input: everything else a command needs
 *  is a word of its own argv, where the audit can see it. */
export interface ExecOptions {
  /** Bytes to feed the command on standard input, for the one verb that takes its content that way
   *  (`tee`). Deliberately not on the wire: the wire is the command, not its payload. */
  readonly stdin?: Uint8Array;
}

export interface Channel extends PathResolver {
  /** Which Site this channel reaches, as the Site's own file names it. On the surface because a
   *  fault the caller must act on is about a *machine* and not about the command that hit it: the
   *  job operations put it into the "cannot tell" they raise when a Site stops answering (#18), and
   *  a person reading that answer needs to know which Site to go and look at. */
  readonly siteName: string;

  /** Read a file's bytes at an absolute path on the site. */
  readFile(absPath: string): Promise<Uint8Array>;
  /**
   * Run one of the channel's own commands on the site and report what it answered. Refuses, without
   * running anything, a verb that is not the channel's own.
   *
   * There is no working-directory argument on purpose: a Job's working directory is tmux's `-c`,
   * decided by the Permit before the launch, and every plumbing command names an absolute path. A
   * `cwd` here would have to become a `cd` on the ssh wire, putting a verb in the audit that the
   * channel does not admit and that no caller asked for.
   */
  exec(argv: readonly string[], options?: ExecOptions): Promise<ExecResult>;
}

/** The read-only probes: `cat` to read a file and `realpath` to resolve one. A Permit says where the
 *  agent may look; this says that looking is all these two can do. Kept to what is actually run
 *  rather than to what would be harmless — every extra verb here is permission granted on a
 *  customer's Site ahead of any caller needing it. */
export const readOnlyProbes: ReadonlySet<string> = new Set(['cat', 'realpath', 'uname', 'getconf', 'which']);

/** The job plumbing: what the job operations themselves run on a Site to put a command in a detached
 *  tmux session and find out what became of it — `tmux` for the session, `test` and `cat` for the
 *  exit file the launch writes, `tail` for bounded log bytes, and `wc` for its durable byte cursor. Distinct from the Permit's wrapper list on
 *  purpose: these are Hima's own verbs, audited at the wire like everything else, while the wrappers
 *  are what the *user's* command may be. `cat` is on both lists because both use it.
 *
 *  Nothing here creates or removes anything on a Site. A verb admitted ahead of a caller is
 *  permission granted on a customer's machine that nobody has yet asked for, and `mkdir` and `rm`
 *  admitted with unbounded arguments would be permission to make and unmake paths anywhere the login
 *  can reach — the Permit's write roots govern where a *Job* runs, not what this list may touch.
 *  Creating a workspace is `workspacePlumbing` below, behind a write-root decision of its own. */
export const jobPlumbing: ReadonlySet<string> = new Set(['tmux', 'test', 'cat', 'tail', 'wc']);

/**
 * The workspace plumbing: what preparing a Campaign workspace runs on a Site. `mkdir` for the
 * workspace and the directories the flow copy lands in, `cp` for the flow itself, and `tee` for the
 * small `workspace.json` that records what was prepared — the one verb that writes a file from
 * standard input without a shell redirection, which the channel has no way to send and no wish to.
 *
 * These three write, which the other two lists deliberately do not, and that is why every one of
 * them is asked of `decideWrite` (`shell.ts`) before it is sent: the target must resolve inside one
 * of the Permit's write roots or nothing is run and the shell records the refusal. The Permit's
 * write roots govern this list exactly as they govern where a Job may run.
 *
 * `rm` is not here. Nothing in this harness removes a path on a Site — not a stale workspace, not a
 * failed copy — and a verb admitted ahead of a caller is permission granted on a customer's machine
 * that nobody has yet asked for. Cleanup stays the Site owner's, which is what the Permit's
 * `forbidden: deletions` says out loud.
 *
 * This list is disjoint from the Permit's `allowedWrappers`, as the other two are, and for the same
 * reason: the Permit says what a *user's* command may be and never what Hima's internals are. The
 * two are governed differently and cannot stand in for one another — a verb here runs with the
 * arguments this file's callers choose, every one of them decided against the write roots first,
 * while a wrapper runs with whatever arguments a Job's launch names and only its *workspace* is
 * decided. Listing `cp` as a wrapper because preparation copies would therefore grant a Job an
 * unconstrained `cp -R` to anywhere the login can reach, which is the opposite of what agreeing to
 * preparation means. `ssh.test.ts` holds all three lists against the reference Permit's wrappers.
 */
export const workspacePlumbing: ReadonlySet<string> = new Set(['mkdir', 'cp', 'tee']);

/**
 * A deliberately closed set of questions used while learning enough about a new Site to make a
 * draft profile.  This is data rather than a caller-supplied command language: callers can choose
 * whether to run discovery, but cannot add a shell fragment, path, tool, or option to it.
 *
 * Tool discovery uses `which`, not an invocation of an EDA binary.  A version that needs a licence
 * or starts a vendor runtime is not a harmless first-contact probe; the resulting unknown is handed
 * to the Site owner rather than hidden by a speculative batch invocation.
 */
export const siteDiscoveryProbes: readonly (readonly string[])[] = [
  ['uname', '-s'], ['uname', '-r'], ['uname', '-m'],
  ['cat', '--', '/etc/os-release'],
  ['tmux', '-V'],
  ['getconf', '_NPROCESSORS_ONLN'], ['getconf', 'PAGE_SIZE'],
  ['cat', '--', '/proc/meminfo'],
  ['which', 'tmux'], ['which', 'make'],
];

export interface SiteDiscoveryFact {
  readonly probe: readonly string[];
  readonly code: number;
  readonly stdout: string;
  readonly stderr?: string;
}

/** Run only the fixed Site discovery questions and retain unsuccessful answers as facts, not errors. */
export async function discoverSiteFacts(on: Channel, toolCommands: readonly string[] = []): Promise<readonly SiteDiscoveryFact[]> {
  const facts: SiteDiscoveryFact[] = [];
  const commands = [...new Set(toolCommands)];
  if (commands.length > 32 || commands.some((command) => !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(command))) {
    throw new Error('Site tool discovery accepts at most 32 plain executable names supplied by a Pack');
  }
  for (const probe of [...siteDiscoveryProbes, ...commands.map((command) => ['which', command] as const)]) {
    const result = await on.exec(probe);
    // Bound both diagnostics and output: a broken login banner or a surprising pseudo-file must not
    // turn a small profile into an unbounded copy of remote state.
    const stdout = Buffer.from(result.stdout).toString('utf8').slice(0, 16_384);
    const stderr = result.stderr.trim().slice(0, 4_096);
    facts.push({ probe: [...probe], code: result.code, stdout, ...(stderr ? { stderr } : {}) });
  }
  return facts;
}

/** Everything a HimaChannel may run on a Site, and the whole of it. */
const channelVerbs: ReadonlySet<string> = new Set([...readOnlyProbes, ...jobPlumbing, ...workspacePlumbing]);

const listed = (verbs: ReadonlySet<string>): string => [...verbs].sort().join(', ');

/** What went wrong, with what the far end said about it when it said anything. */
const said = (how: string, stderr: string): string => (stderr.trim() ? `${how}: ${stderr.trim()}` : how);

/** Refuse anything that is not the channel's own verb, before it is sent or spawned. */
function admit(verb: string, siteName: string): void {
  if (channelVerbs.has(verb)) return;
  throw new Error(
    `refusing to run "${verb}" on site ${siteName}: HimaChannel runs only its own verbs — the read-only probes (${listed(readOnlyProbes)}), the job plumbing (${listed(jobPlumbing)}), and the workspace plumbing (${listed(workspacePlumbing)})`,
  );
}

/** One command the channel asked a Site to run: the argv it decided on, and the exact string ssh
 *  received on the wire once every word was quoted. The audit keeps both, not just the argv, because
 *  the intent (argv) is not the evidence (wire) — an assertion on argv alone would still pass if the
 *  quoting step were deleted entirely. A local Site has no ssh and no shell in between: the argv is
 *  spawned as it stands, and `wire` is that argv rendered the one way, so the audit reads the same
 *  on both channels. */
export interface RemoteCommand {
  readonly argv: readonly string[];
  readonly wire: string;
}

// The evidence behind the channel's promise: every command a channel has asked a Site to run in this
// process, oldest first, whether or not the connection carried it — the read-only probes and the job
// plumbing alike, each recorded before it is sent. Bounded, so a long-lived host cannot grow it
// without limit.
/** How many commands the audit holds before the oldest is evicted. On the bundle's surface because
 *  a caller that drains the audit has to be able to say how big the window it drained was, and a
 *  number written out again in a record or a script is one that goes stale the day this one is
 *  tuned — the record would then state a window nobody had. */
export const remoteCommandWindow = 500;
let audit: RemoteCommand[] = [];
let auditWindowFilled = false;

/** Every command HimaChannel has asked a Site to run in this process, oldest first. */
export function remoteCommands(): readonly RemoteCommand[] {
  return audit.map((c) => ({ argv: [...c.argv], wire: c.wire }));
}

/**
 * Whether the window has been full since the last clear — whether a command may already have been
 * evicted from it, unread.
 *
 * A drained list nobody can size is a list nobody can trust: "every command" over a rolling window
 * is a claim about what the window held, and this is how a caller learns that the window is no
 * longer the whole story. Said `true` from the moment the audit *reaches* the limit rather than when
 * it passes it, which is one command early on purpose: at that point the next command evicts one,
 * and a caller draining now has no way to know whether it already did.
 */
export function remoteCommandWindowFilled(): boolean {
  return auditWindowFilled;
}

export function clearRemoteCommands(): void {
  audit = [];
  auditWindowFilled = false;
}

function recordRemoteCommand(argv: readonly string[], wire: string): void {
  audit.push({ argv: [...argv], wire });
  if (audit.length >= remoteCommandWindow) auditWindowFilled = true;
  if (audit.length > remoteCommandWindow) audit.splice(0, audit.length - remoteCommandWindow);
}

/** ssh hands the words after the destination to the remote login shell, so each one is quoted here.
 *  Exported as a test-only hook: the read-only contract test holds the wire this produces against the
 *  argv it was given, and observes it deliver an odd path (a space, a single quote) to the real site
 *  as one literal argument. */
export const quote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

/** This machine, reached without ssh: the local Site of the pre-push suite, and of anyone running
 *  the harness where their reports and jobs already are. */
export class LocalChannel implements Channel {
  /** No command of the channel's own should take this long, here as over ssh. */
  static readonly commandTimeoutMs = 60_000;

  constructor(readonly siteName = 'local') {}

  // Reading a file on this machine is not a command and spawns nothing, so it leaves no entry in the
  // audit: the audit records the commands the channel asked a Site to run, and this is not one.
  readFile(absPath: string): Promise<Uint8Array> {
    return readFile(absPath);
  }

  realpath(absPath: string): Promise<string> {
    return realpath(absPath);
  }

  /** `lstat` rather than `stat`: a symlink whose target is missing is something that is there, and a
   *  write to it would land at the target. `ENOENT` is the one answer that means nothing is there;
   *  every other error is raised, because a question that could not be asked must not read as "no".
   *  Spawns nothing, so — like `readFile` and `realpath` here — it leaves no entry in the audit. */
  async absent(absPath: string): Promise<boolean> {
    try {
      await lstat(absPath);
      return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw new Error(`cannot tell whether ${absPath} is there on site ${this.siteName}: ${(err as Error).message}`);
    }
  }

  /** Spawn one of the channel's own verbs on this machine, with no shell between the two: the argv
   *  is what the command receives, so nothing here needs quoting. The audit still renders it the one
   *  way `quote` renders an ssh wire, so one assertion reads both channels. */
  async exec(argv: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
    const [verb, ...args] = argv;
    admit(verb ?? '', this.siteName);
    recordRemoteCommand(argv, argv.map(quote).join(' '));
    // Ticket #18: a command that could not be run, and one that never came back with a status, are
    // both a Site that did not answer — not a fault in what was asked. Read as anything else they
    // reach the job operations as a plain fault, and a fault while a Job is open is written as a
    // `blocked` node with that Job still running unattended on the Site, which is the one outcome
    // this rule exists to remove. A hang is the ordinary way an ssh Site stops answering, and it is
    // this branch that a hang arrives at. An exit code, any exit code, stays an answer.
    const exit = await this.spawn(verb!, args, options.stdin).catch((err: Error) => {
      throw new SiteUnreadableError(this.siteName, `cannot run ${verb} on site ${this.siteName}: the command could not be started: ${err.message}`);
    });
    if (exit.code === null) {
      const how = exit.timedOut ? `it timed out after ${LocalChannel.commandTimeoutMs} ms` : `it was killed by ${exit.signal}`;
      throw new SiteUnreadableError(this.siteName, `cannot run ${verb} on site ${this.siteName}: ${how}`);
    }
    return { code: exit.code, stdout: exit.stdout, stderr: exit.stderr };
  }

  private spawn(verb: string, args: readonly string[], stdin?: Uint8Array): Promise<LocalExit> {
    return new Promise((resolve, reject) => {
      const child = spawn(verb, [...args], { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      if (stdin !== undefined) {
        // A payload larger than the pipe buffer is written after the command has started, so a
        // command that exits first leaves nothing reading it and the write fails with EPIPE. An
        // unhandled 'error' on a stream is an uncaught exception, which would take the whole host
        // down over a command that has already answered — and its exit and stderr are that answer,
        // which the caller reads below. So the failed write is heard and left to them.
        child.stdin!.on('error', () => {});
        child.stdin!.end(stdin);
      }
      const out: Buffer[] = [];
      let err = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, LocalChannel.commandTimeoutMs);
      child.stdout!.on('data', (d: Buffer) => out.push(d));
      child.stderr!.on('data', (d: Buffer) => {
        err += d.toString('utf8');
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stdout: Buffer.concat(out), stderr: err, timedOut });
      });
    });
  }
}

interface LocalExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** Splits the `:port` suffix ssh takes as `-p` off a destination. Site files require the
 *  `user@host[:port]` form (`sites.ts`'s `sshTargetPattern` enforces that shape before this ever
 *  runs); this function only separates host from port, it does not itself require a `user@` part. */
function parseDestination(destination: string): { readonly dest: string; readonly port?: number } {
  const m = /^(.+?)(?::(\d+))?$/.exec(destination);
  if (!m || !m[1]) throw new Error(`not an ssh destination: "${destination}"`);
  return m[2] === undefined ? { dest: m[1] } : { dest: m[1], port: Number(m[2]) };
}

/** One warm connection per master, in the OS temp directory. The key covers everything that shapes
 *  the master: the destination, the jump chain, and how long it is kept warm — ControlPersist belongs
 *  to the master, not to the client asking for it, so two Sites differing only there would otherwise
 *  share a socket and silently inherit whichever master opened first. A control socket path is short
 *  by necessity — macOS caps it near 100 characters — hence the digest rather than the name. */
function controlSocket(target: SshTarget): string {
  const key = createHash('sha256')
    .update([target.destination, target.jumps.join(','), String(target.controlPersistSeconds)].join('|'))
    .digest('hex')
    .slice(0, 16);
  return path.join(os.tmpdir(), `hima-ssh-${key}`);
}

function sshTargetOf(site: Site): SshTarget {
  if (!site.ssh) throw new Error(`site ${site.name} is of kind ssh but names no ssh destination`);
  return site.ssh;
}

/** Where a Site's warm control connection lives. Removing this socket only costs the next operation a
 *  reconnection; the site file, not this path, is the identity of the Site. */
export function controlPathFor(site: Site): string {
  return controlSocket(sshTargetOf(site));
}

interface RemoteExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** A Site reached over SSH, through jump hosts where the site file names them. */
export class SshChannel implements Channel {
  /** No probe on a live Site should take this long; a stalled one must not hold a Run forever. */
  static readonly commandTimeoutMs = 60_000;
  static readonly connectTimeoutSeconds = 10;
  /** What ssh says on stderr when the control path exists but no master is listening on it. */
  static readonly staleControlSocket = /ControlSocket .* already exists/;

  readonly controlPath: string;

  constructor(
    readonly siteName: string,
    private readonly target: SshTarget,
  ) {
    this.controlPath = controlSocket(target);
  }

  async readFile(absPath: string): Promise<Uint8Array> {
    return this.mustSucceed(['cat', '--', absPath], `read ${absPath}`);
  }

  /** Resolve symlinks on the Site. `-e` makes a path that does not exist an error, so a permit
   *  decision on an unresolvable path fails closed the way the local one does. */
  async realpath(absPath: string): Promise<string> {
    const out = await this.mustSucceed(['realpath', '-z', '-e', '--', absPath], `resolve ${absPath}`);
    const resolved = Buffer.from(out).toString('utf8').replace(/\0$/, '');
    if (!resolved) throw new Error(`${absPath} did not resolve to a path on site ${this.siteName}`);
    return resolved;
  }

  /** Nothing at all at this path on the Site, asked as one `test`: `-e` follows a link, so a symlink
   *  to something that is not there answers false to it and `-L` asks the other half. The path is
   *  always absolute — every caller joins a segment onto a path `realpath` returned — so it can never
   *  be read as an option of `test`, and it is quoted on the wire like every other word. Exit 1 means
   *  something is there; anything else is a fault, so an ssh that could not connect (255) can never
   *  read as "nothing there". */
  async absent(absPath: string): Promise<boolean> {
    const r = await this.exec(['test', '!', '-e', absPath, '-a', '!', '-L', absPath]);
    if (r.code === 0) return true;
    if (r.code === 1) return false;
    throw this.failed(`tell whether ${absPath} is there`, said(`test exited ${r.code}`, r.stderr));
  }

  /** Run one of the channel's own commands on the Site and report what it answered. */
  async exec(argv: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
    const verb = argv[0] ?? '';
    admit(verb, this.siteName);
    const what = `run ${verb}`;
    const wire = argv.map(quote).join(' ');
    let exit = await this.send(argv, wire, what, options.stdin);
    if (SshChannel.staleControlSocket.test(exit.stderr)) {
      // A master killed outright leaves its socket behind with nothing listening on it. ssh says so
      // and connects unmultiplexed, so without removing it every later command pays for its own
      // connection and the warm channel never returns. The removal is unconditional and costs at most
      // one reconnection, which is what the caller was already paying.
      await rm(this.controlPath, { force: true });
      // The command itself is a different matter. ssh said this *after* running it: multiplexing was
      // disabled, not the command. Sending it again would be a second run on the Site — for
      // `tmux new-session` a second launch of the Job, whose duplicate-session error would then be
      // returned as the launch's own failure and hide the Job that is really running from the ledger.
      // Only a read-only probe can be asked twice without asking the Site to do anything twice, so
      // only a read-only probe is resent; for every other verb the first exit is the answer. The
      // retry is single either way: if the second attempt says the same thing, something other than a
      // dead master owns that path and the exit stands.
      if (readOnlyProbes.has(verb)) exit = await this.send(argv, wire, what);
    }
    // A command that came back with a status, whatever it was, is an answer for the caller to read.
    // Never coming back at all — a timeout, ssh killed by a signal — is a Site that did not answer,
    // and is raised as one (#18): a Job may be running on the far end and nothing here saw anything.
    if (exit.code === null) throw this.didNotAnswer(what, this.why(exit));
    return { code: exit.code, stdout: exit.stdout, stderr: exit.stderr };
  }

  /** One command whose only acceptable answer is success: the read path, where a non-zero exit is
   *  the operation failing and the caller wants the one framing, not a status to interpret. */
  private async mustSucceed(argv: readonly string[], what: string): Promise<Uint8Array> {
    const r = await this.exec(argv);
    if (r.code === 0) return r.stdout;
    throw this.failed(what, said(`ssh exited ${r.code}`, r.stderr));
  }

  /** Record the command as asked, then ask it. A retry is a second ask and the audit says so. */
  private async send(argv: readonly string[], wire: string, what: string, stdin?: Uint8Array): Promise<RemoteExit> {
    recordRemoteCommand(argv, wire);
    try {
      return await this.ssh(wire, stdin);
    } catch (err) {
      // The local ssh client could not even be started (`spawn ssh ENOENT`, a missing execute bit).
      // A caller reading this failure needs the same framing as every other: which operation, on
      // which Site, and why — not a bare errno from a promise nobody named. Nothing reached the Site,
      // so nothing about it is known: a Site that did not answer (#18).
      throw this.didNotAnswer(what, `the local ssh client could not be started: ${(err as Error).message}`);
    }
  }

  /** Every failure of this channel, framed the one way: what could not be done, where, and why. */
  private failed(what: string, why: string): Error {
    return new Error(this.framed(what, why));
  }

  /**
   * The failures that are not about what was asked but about whether it ran at all: the command
   * could not be started, or it never came back with a status (#18). Framed exactly as `failed`
   * frames the rest — a person still needs which operation, on which Site, and why — and raised as
   * the class that says nothing may be concluded from it, so the job operations do not turn a Site
   * that stopped answering into a `blocked` node with a live Job behind it.
   *
   * Deliberately not every failure of this channel: a command that came back with an exit code
   * answered, and `mustSucceed`'s non-zero exit and `absent`'s unexpected one are faults in what was
   * asked or in the Site's own state, which their callers already read as such.
   */
  private didNotAnswer(what: string, why: string): SiteUnreadableError {
    return new SiteUnreadableError(this.siteName, this.framed(what, why));
  }

  private framed(what: string, why: string): string {
    return `cannot ${what} on site ${this.siteName} (${this.target.destination}): ${why}`;
  }

  private why(exit: RemoteExit): string {
    const how = exit.timedOut
      ? `ssh timed out after ${SshChannel.commandTimeoutMs} ms`
      : exit.signal
        ? `ssh was killed by ${exit.signal}`
        : `ssh exited ${exit.code}`;
    return said(how, exit.stderr);
  }

  /** The argv of the local ssh client. ControlMaster=auto opens a master when the socket is gone and
   *  reuses it when it is there, so a dropped connection costs the next operation nothing but a
   *  reconnection. BatchMode keeps a lost key or an unknown host a failure, never a prompt. */
  private args(remote: string): string[] {
    const { dest, port } = parseDestination(this.target.destination);
    const args = [
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${SshChannel.connectTimeoutSeconds}`,
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${this.controlPath}`,
      '-o', `ControlPersist=${this.target.controlPersistSeconds}`,
    ];
    if (port !== undefined) args.push('-p', String(port));
    if (this.target.jumps.length > 0) args.push('-J', this.target.jumps.join(','));
    // `--` ends ssh's own option parsing, so a destination cannot be read as an ssh option no matter
    // what it contains; `sites.ts` already refuses a destination shaped like one, so this is the
    // second, independent layer. The remote command is the next positional either way.
    args.push('--', dest, remote);
    return args;
  }

  private ssh(remote: string, stdin?: Uint8Array): Promise<RemoteExit> {
    return new Promise((resolve, reject) => {
      // ssh forwards its own standard input to the remote command, so the bytes a `tee` is to write
      // travel the connection rather than the command line — the wire stays the command, and a
      // payload with a quote or a newline in it cannot become part of one.
      const child = spawn('ssh', this.args(remote), { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      if (stdin !== undefined) {
        // As in `LocalChannel.spawn`: an ssh that dies before the payload is written raises EPIPE on
        // this stream, and an unhandled 'error' event is an uncaught exception that would take the
        // host down. ssh's own exit and stderr are the answer, and this promise already carries them.
        child.stdin!.on('error', () => {});
        child.stdin!.end(stdin);
      }
      const out: Buffer[] = [];
      let err = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, SshChannel.commandTimeoutMs);
      child.stdout!.on('data', (d: Buffer) => out.push(d));
      child.stderr!.on('data', (d: Buffer) => {
        err += d.toString('utf8');
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, stdout: Buffer.concat(out), stderr: err, timedOut });
      });
    });
  }
}

/**
 * Run one of the channel's own commands whose only acceptable answer is success, and answer with what
 * it printed.
 *
 * Here rather than in each caller because the sentence a failure throws is the one a person reads off
 * a blocked node — `cannot launch job "synthesize" in /work: tmux exited 1: ...` — and the job
 * plumbing and the workspace plumbing had each built it themselves. Two copies of one sentence are
 * two sentences the moment one of them learns to say what the other does not; and a caller that
 * wants only the exit status simply ignores what is returned, which is cheaper than a second helper
 * that throws away the bytes.
 *
 * A non-zero exit is an answer and not a fault to this channel (`ExecResult`), so this is the wrapper
 * for the commands where it is neither: a `mkdir` that did not make the directory, a `tmux
 * new-session` that started nothing. The question-shaped commands — `tmux has-session`, `test -f` —
 * belong to their own asker, which reads exit 1 as "no".
 *
 * @param on - the Site's channel.
 * @param argv - the command, as the channel's own verbs.
 * @param what - what was being attempted, as the sentence's object: `create /work on site local`.
 * @returns whatever the command printed on standard output, decoded as UTF-8.
 */
export async function mustRun(on: Channel, argv: readonly string[], what: string, options?: ExecOptions): Promise<string> {
  const r = await on.exec(argv, options);
  if (r.code !== 0) {
    const said = r.stderr.trim();
    throw new Error(`cannot ${what}: ${argv[0]} exited ${r.code}${said ? `: ${said}` : ''}`);
  }
  return Buffer.from(r.stdout).toString('utf8');
}

export function channelFor(site: Site): Channel {
  if (site.kind === 'local') return new LocalChannel(site.name);
  return new SshChannel(site.name, sshTargetOf(site));
}
