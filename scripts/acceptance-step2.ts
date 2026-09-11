// Step-2 acceptance run (issue #17): one real generation of the opene902 timing probe on a Site,
// driven through a booted host's own faces, and recorded. Writes
// <out>/<date>-step2-acceptance.{md,json} and exits non-zero when any check failed.
//
// The step-1 twin (`acceptance-step1.ts`) read reports the Site already had. This one makes one:
// synthesis runs on the Site, in a Campaign workspace of its own, at a clock period tighter than the
// Site's own last result — so everything here is written to be safe to point at a customer's
// machine. Three things carry that:
//
//   - Nothing is assumed. Every claim in the record is a check with its predicate written out and
//     its outcome taken from what was observed; a check that could not be evaluated is a failure,
//     never a pass. A failed check writes the record and exits non-zero.
//   - The Site is probed read-only first, and the launch is gated on what the probe found: the
//     Site's own last result, which the target period is derived from, and whether anything is
//     already running there — the site owner's rule is one large DC or Innovus job at a time.
//   - The generation is driven through the host's faces alone — `/hima run`, `/hima status`, and the
//     run view over the real web profile — never by calling into the bundle's modules. What this
//     script does reach for directly is data, not drive: `loadSite`/`loadPack` to know where the
//     Site's own flow root is, and `channelFor` for the two read-only probes that have no face,
//     which the channel itself confines to its own verbs.
//
// The Campaign workspace is left on the Site, as evidence. Nothing in this harness removes a path on
// a Site; removal is the Site owner's call, and the record says so.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { createHimaHome, repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from '../test/contract/support/boot-inprocess.ts';
import { bootHimaHost, type BootedHost } from '../test/contract/support/boot-host.ts';
import { himaCommand } from '../test/contract/support/command.ts';
import { installReferenceSite, writeLocalSite } from '../test/contract/support/site.ts';
import { installPack, timingProbePackId } from '../test/contract/support/pack.ts';
import { writeStandinFlow } from '../test/contract/support/standin-flow.ts';
import { requireOpene902Fixture } from '../test/contract/support/opene902-fixtures.ts';
import { api as himaApi, openSession } from '../test/contract/support/hima-api.ts';
import {
  boundInputs,
  channelFor,
  clearRemoteCommands,
  containerNameFor,
  flowDirName,
  hasEnded,
  loadPack,
  loadSite,
  outputPath,
  quote,
  remoteCommands,
  roundNs,
  versionLine,
  type Channel,
  type LedgerRecord,
  type ObservationRecord,
  type Pack,
  type PackNode,
  type RunStatus,
  type RunView,
  type SemanticValue,
  type Site,
  type WorkspaceRecord,
} from '@hima/harness';

// ---------------------------------------------------------------------------------------------
// What this run was asked for.
// ---------------------------------------------------------------------------------------------

const usage = [
  'usage: node scripts/acceptance-step2.ts [--site <name>] [--target <ns>] [--time-box <minutes>] [--out <dir>]',
  '  --site       linglong, the committed reference site, or local, the stand-in flow this repository generates. Default linglong.',
  "  --target     the clock period to synthesize at, in ns. Default: the period the site's own qor report states, minus 0.2.",
  "  --time-box   the Run's budget in minutes. Default 20.",
  '  --out        the directory the record is written into. Default docs/validation/ in this repository.',
].join('\n');

/** How much tighter than the Site's last result this generation is asked to close, in ns. */
const defaultStepNs = 0.2;
/**
 * The band a clock period has to be in for this script to ask a Site for it, in ns.
 *
 * A period is a number a person types, and `.207` for `2.07` is one keystroke away. Every guard
 * downstream of here would let that through — the harness asks only for a positive number, and a
 * tenth of the last result is certainly "tighter than last" — and the Site would spend a licence and
 * a 32-core machine grinding at an unsatisfiable constraint until the time box killed it. So both the
 * `--target` option and the period derived from the Site's own last result have to land inside
 * `minTargetNs ≤ target ≤ maxTargetMultiple × last`: no digital design closes below half a
 * nanosecond, and nothing this script is for asks for a period looser than twice what the Site has
 * already achieved.
 */
const minTargetNs = 0.5;
const maxTargetMultiple = 2;
/** The Budget this generation runs under when the caller names none, in minutes. */
const defaultTimeBoxMinutes = 20;
/** How much longer than its own time box the `/hima run` command may take before this script gives
 *  up on it: the Budget bounds the wait for the Job, not the 56 MB flow copy that precedes it. */
const commandHeadroomMs = 20 * 60_000;
/** The channel's audit is a rolling window of this many commands; it is drained as it fills. */
const auditWindow = 500;
/** The one option this script's own site names. */
const knownOptions = ['--site', '--target', '--time-box', '--out'];

const argv = process.argv.slice(2);

function fail(why: string): never {
  console.error(why);
  process.exit(2);
}

/** One `--flag value` pair, or undefined when the flag was not given. A flag with no value is an
 *  error rather than "not given", as every command face in this harness treats one. */
function option(name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} was given no value\n${usage}`);
  return value;
}

function numeric(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) fail(`invalid ${name} "${raw}"; expected a number greater than zero\n${usage}`);
  return value;
}

for (const word of argv) {
  if (word.startsWith('--') && !knownOptions.includes(word)) fail(`unknown option "${word}"\n${usage}`);
}

const siteName = option('--site') ?? 'linglong';
if (siteName !== 'linglong' && siteName !== 'local') {
  fail(`unknown site "${siteName}": this script knows the committed reference site "linglong" and the stand-in site "local"\n${usage}`);
}
const targetOverrideNs = numeric('--target', option('--target'));
const timeBoxMinutes = numeric('--time-box', option('--time-box')) ?? defaultTimeBoxMinutes;
const outDir = option('--out') ?? path.join(repoRoot, 'docs/validation');

/**
 * Whether a period reaches `make` as the number it is: a plain decimal, with no exponent.
 *
 * `String(1e-7)` is `"1e-7"`, and `CLOCK_PERIOD_NS=1e-7` is what the flow would then be handed —
 * every check in this script would still match it, because they compare against the same `String()`.
 * A period whose own spelling has left decimal notation is refused rather than sent.
 */
const plainDecimal = (n: number): boolean => /^\d+(\.\d+)?$/.test(String(n));
/** The band in words, for the two places that refuse a period outside it. */
const bandInWords = `${minTargetNs} ns ≤ target ≤ ${maxTargetMultiple} × the site's own last result`;

// The half of the band that needs no knowledge of the Site is applied here, before anything is
// booted or asked: a period below the floor, or one that is not a plain decimal, is refused on the
// spot. The other half (`≤ 2 × last`) needs the Site's last result and is applied the moment the
// read-only probe has it, still before anything is launched.
if (targetOverrideNs !== undefined) {
  if (!plainDecimal(targetOverrideNs)) {
    fail(`--target ${targetOverrideNs} would reach the flow as CLOCK_PERIOD_NS=${String(targetOverrideNs)}, which is not a plain decimal period; ${bandInWords}\n${usage}`);
  }
  if (targetOverrideNs < minTargetNs) {
    fail(`--target ${targetOverrideNs} ns is outside the band this script will ask a site for: ${bandInWords}. The site's own last result is read by the probe, which was not run: nothing was booted, asked or launched, and no record was written.\n${usage}`);
  }
}

// ---------------------------------------------------------------------------------------------
// The record, and the checks that make it up.
// ---------------------------------------------------------------------------------------------

/** One thing this run claims, the predicate it claims it by, and what was actually seen. */
interface Check {
  readonly id: string;
  readonly what: string;
  /** Exactly what had to hold. Written out so a reader can re-derive the outcome from `observed`. */
  readonly predicate: string;
  readonly observed: string;
  readonly outcome: 'pass' | 'fail';
}

const checks: Check[] = [];
function check(id: string, what: string, predicate: string, ok: boolean, observed: string): boolean {
  checks.push({ id, what, predicate, observed, outcome: ok ? 'pass' : 'fail' });
  return ok;
}

/** One command HimaChannel asked the Site to run, and the phase of this script it belonged to. */
interface AuditEntry { readonly phase: string; readonly argv: readonly string[]; readonly wire: string }
const audit: AuditEntry[] = [];
let auditWindowFilled = false;

/**
 * Take everything the channel has recorded since the last drain, and clear it.
 *
 * The channel's audit is a bounded rolling window (500 entries): a generation long enough to fill it
 * would evict the `tmux new-session` line that is the whole point of keeping one. Draining is exact
 * where merging snapshots would not be — the window carries no sequence numbers, so two samples of a
 * repeating `test -f` / `tmux has-session` poll cannot be aligned with certainty. The read and the
 * clear happen in one synchronous step, so no command can be recorded between them.
 */
function drain(phase: string): void {
  const taken = remoteCommands();
  clearRemoteCommands();
  if (taken.length >= auditWindow) auditWindowFilled = true;
  for (const c of taken) audit.push({ phase, argv: c.argv, wire: c.wire });
}

/** Sorted-key JSON, so two readings of one Run compare by content and not by key order. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
const numberOf = (values: readonly SemanticValue[], type: string): number | undefined => {
  const found = values.find((v) => v.type === type);
  return found && found.value !== null ? found.value : undefined;
};
const show = (v: unknown): string => (v === undefined ? 'none' : typeof v === 'string' ? v : JSON.stringify(v));

function gitSays(args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const date = new Date().toLocaleDateString('en-CA'); // local calendar date, YYYY-MM-DD
const commit = gitSays(['rev-parse', 'HEAD']);
const commitDirty = gitSays(['status', '--porcelain']) !== '';
const record: Record<string, unknown> = {
  date,
  issue: 17,
  script: 'scripts/acceptance-step2.ts',
  versions: { harness: versionLine(), node: process.version },
  commit,
  commitDirty,
};

/**
 * Write the record in both shapes and leave with the exit code the checks earned.
 *
 * `<date>-step2-acceptance.{md,json}` is the name a record wants: one acceptance run of one date.
 * A second run on the same date gets `<date>-step2-acceptance-<HHMMSS>` instead — a re-run that
 * failed must not be able to overwrite the record of one that passed, and a record is evidence, so
 * the script never replaces one it finds. Both names are printed, so the caller reads what was
 * written rather than assuming the plain one.
 */
function finish(): never {
  record.checks = checks;
  record.remoteCommands = audit.map((c) => ({ phase: c.phase, wire: c.wire }));
  record.auditWindowFilled = auditWindowFilled;
  const failed = checks.filter((c) => c.outcome === 'fail');
  record.outcome = failed.length === 0 ? 'every check passed' : `${failed.length} of ${checks.length} checks failed`;
  mkdirSync(outDir, { recursive: true });
  const plain = `${date}-step2-acceptance`;
  const taken = existsSync(path.join(outDir, `${plain}.md`)) || existsSync(path.join(outDir, `${plain}.json`));
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  const base = taken ? `${plain}-${stamp}` : plain;
  record.recordFiles = { markdown: `${base}.md`, json: `${base}.json`, dateAlreadyHadARecord: taken };
  const jsonAt = path.join(outDir, `${base}.json`);
  const markdownAt = path.join(outDir, `${base}.md`);
  writeFileSync(jsonAt, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(markdownAt, markdown());
  console.log(
    failed.length === 0
      ? 'STEP-2 ACCEPTANCE: every check passed'
      : `STEP-2 ACCEPTANCE FAILED:\n- ${failed.map((c) => `${c.id}: ${c.observed}`).join('\n- ')}`,
  );
  if (taken) console.log(`a record for ${date} was already there; this one was written beside it, not over it`);
  console.log(`record: ${markdownAt}`);
  console.log(`record: ${jsonAt}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------
// Setting the Site up in an isolated home.
// ---------------------------------------------------------------------------------------------

/** A skip is not available to a script: the fixture the local stand-in needs is required or nothing. */
const noSkip = {
  skip: (reason?: string) => {
    throw new Error(`the local dry run needs the opene902 qor fixture: ${reason ?? 'it could not be resolved'}`);
  },
} as unknown as TestContext;

/**
 * The isolated home this run uses, with the Site bound and the shipped pack installed.
 *
 * `linglong` is the site file and permit this repository commits, installed the way a customer's CAD
 * would. `local` is the stand-in the contract suite runs against: the generated flow, a site file
 * binding it, and — seeded here, and only here — a "last result" qor report in the flow root, which
 * is what the reference Site's own Design Zoo already has and what the read-only probe reads the
 * target period from. The seed states 2.47 ns and this script's own arithmetic then asks for
 * 2.27 ns, which the stand-in reports back as the period it was asked for — which is what makes the
 * local dry run able to exercise the checks rather than merely reach them.
 */
async function setUpHome(): Promise<{ h: HimaHome; sitesDir: string; packsDir: string }> {
  const h = await createHimaHome();
  const installed = await installPack(h);
  if (siteName !== 'local') {
    const reference = await installReferenceSite(h);
    return { h, sitesDir: reference.sitesDir, packsDir: installed.packsDir };
  }
  const flow = await writeStandinFlow(noSkip, h, { sleepSeconds: 3 });
  if (!flow) throw new Error('the stand-in flow could not be generated');
  const fixture = await requireOpene902Fixture(noSkip, 'syn/qor.rpt');
  if (!fixture) throw new Error('the opene902 qor fixture could not be resolved');
  const lastResult = path.join(flow.root, 'results', flow.design, 'syn/report/qor.rpt');
  await mkdir(path.dirname(lastResult), { recursive: true });
  const text = await readFile(fixture, 'utf8');
  const seeded = text.replace('Critical Path Clk Period:      2.27', 'Critical Path Clk Period:      2.47');
  if (seeded === text) throw new Error(`the pinned qor fixture at ${fixture} states no 2.27 ns clock period to seed a last result from`);
  await writeFile(lastResult, seeded);
  const local = await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
  });
  return { h, sitesDir: local.sitesDir, packsDir: installed.packsDir };
}

/** How paths are spelled on this Site: a remote one is POSIX whatever this machine is. */
const pathsOn = (site: Site): path.PlatformPath => (site.kind === 'local' ? path : path.posix);

/**
 * Where the Site's own last result is: the same report the pack's contract names as its output,
 * taken in the Site's own flow root instead of in a Campaign's copy of it. Derived from the contract
 * rather than spelled out here, so a pack that moves its report moves this probe with it.
 */
function lastResultPath(pack: Pack, site: Site, flowRoot: string): string {
  const output = pack.contract.outputs.find((o) => o.name === 'qorReport');
  if (!output) throw new Error(`pack ${pack.id} declares no "qorReport" output to read the site's last result from`);
  const inWorkspace = outputPath(output, boundInputs(pack, site));
  const prefix = `${flowDirName}/`;
  if (!inWorkspace.startsWith(prefix)) throw new Error(`the qor report is at "${inWorkspace}", which is not inside a workspace's ${flowDirName}/`);
  return pathsOn(site).join(flowRoot, inWorkspace.slice(prefix.length));
}

// ---------------------------------------------------------------------------------------------
// The read-only probes of the Site.
// ---------------------------------------------------------------------------------------------

/** One pane the probe read as busy, and the pattern that said so. */
interface BusyPane { readonly line: string; readonly because: string }

/** What tmux on the Site says about work already running there, asked read-only. */
interface SiteQuiet {
  /** Whether the question could be asked at all. A probe that failed never reads as a quiet Site. */
  readonly asked: boolean;
  readonly sessions: readonly string[];
  readonly himaSessions: readonly string[];
  readonly panes: readonly string[];
  readonly busyPanes: readonly BusyPane[];
  readonly detail: string;
}

/**
 * Ask tmux what is running on the Site.
 *
 * Asked through HimaChannel, which admits `tmux` as job plumbing and refuses every verb that is not
 * its own — so this probe cannot become anything but a question, on either kind of Site, and it is
 * recorded at the wire like every other command. `ps` is not a channel verb and is deliberately not
 * added for this: the site owner's rule is that a large job runs in a tmux session, so tmux is where
 * the answer is. What this sees is what tmux sees, and the record says so.
 *
 * tmux exits 1 when there is no server at all, which is the quietest answer there is. Any other
 * non-zero exit is a probe that failed, and is reported as such rather than as an empty list.
 */
/** What separates the fields of one `list-panes` line in the probe's own output. */
const paneSeparator = '|';
/**
 * The command half of one `list-panes` line: both command fields, which is everything after the
 * first separator. Both are needed. `pane_current_command` is the pane's foreground process, which
 * for a Design Compiler run under the site's wrapper is the wrapper, or a shell, or the container
 * runtime — never `dc_shell` itself; `pane_start_command` is the whole command line the pane was
 * started with, which is where the tool's own name is. Splitting at the *first* separator rather
 * than the last means a session name carrying a `|` widens what is searched instead of narrowing it,
 * which is the direction this probe should err in.
 */
const paneCommands = (line: string): string => (line.includes(paneSeparator) ? line.slice(line.indexOf(paneSeparator) + 1) : line);
/** The session half of one line: what precedes the first separator. A line with no separator at all
 *  is read as both halves, which widens what is searched rather than narrowing it. */
const paneSession = (line: string): string => (line.includes(paneSeparator) ? line.slice(0, line.indexOf(paneSeparator)) : line);

/**
 * The tools a large job on a Site like this one runs under, by the name that appears on a command
 * line. `dc_shell` is here for completeness, but it is the one that will *not* appear: the site's own
 * flow launches Design Compiler through `make`, which runs the container runtime, which runs the
 * tool — so the string on the pane is `make`, or `/usr/local/bin/eda`, never `dc_shell` itself.
 */
const largeJobTools = ['dc_shell', 'icc2', 'innovus', 'pt_shell', '/usr/local/bin/eda'];

/**
 * Why one `list-panes` line reads as a job already running on the Site, or `''` when it does not.
 *
 * Four patterns, and every one of them errs toward busy, because the cost of the two mistakes is not
 * symmetric: reading a quiet Site as busy costs a re-run, and reading a busy Site as quiet puts a
 * second Design Compiler on a machine that declares one job slot and a licence server that has one
 * licence. A pane is busy when
 *
 *   - its session is one of this harness's own (`hima-` prefix); or
 *   - its command half names the Site's own flow root — a job in the Design Zoo is the site owner's
 *     job whatever binary is in the foreground; or
 *   - its command half names one of the tools above; or
 *   - its command half holds `make` and `synth` together, which is exactly how the flow's own
 *     README says to start a synthesis here.
 *
 * The command half is both tmux fields joined: `pane_current_command` is the pane's foreground
 * process, which for a run under the site's wrapper is `make`, a shell, or the container runtime,
 * and `pane_start_command` is the whole line the pane was started with, which is where the design,
 * the target and the container name are.
 */
function busyBecause(line: string, siteFlowRoot: string): string {
  const command = paneCommands(line);
  if (paneSession(line).startsWith('hima-')) return 'its session is one of this harness\'s own (hima- prefix)';
  if (siteFlowRoot !== '' && command.includes(siteFlowRoot)) return `its command names the site's own flow root ${siteFlowRoot}`;
  const tool = largeJobTools.find((t) => command.includes(t));
  if (tool !== undefined) return `its command names ${tool}`;
  if (command.includes('make') && command.includes('synth')) return 'its command runs make with a synth target';
  return '';
}

async function askSiteQuiet(channel: Channel, siteFlowRoot: string): Promise<SiteQuiet> {
  const nothing = { sessions: [], himaSessions: [], panes: [], busyPanes: [] };
  const asked = async (args: readonly string[]): Promise<{ ok: boolean; lines: string[]; why: string }> => {
    const r = await channel.exec(args);
    const out = Buffer.from(r.stdout).toString('utf8');
    if (r.code === 0) return { ok: true, lines: out.split('\n').map((l) => l.trim()).filter(Boolean), why: '' };
    if (r.code === 1) return { ok: true, lines: [], why: r.stderr.trim() || 'tmux exited 1' };
    return { ok: false, lines: [], why: `${args.join(' ')} exited ${r.code}: ${r.stderr.trim()}` };
  };
  try {
    const sessions = await asked(['tmux', 'list-sessions', '-F', '#{session_name}']);
    // `|` rather than a tab: tmux's own format expansion turns a tab in the format string into an
    // underscore, which would leave the command welded to the session name and the `dc_shell` half
    // of this probe unable to fire at all.
    const panes = await asked([
      'tmux',
      'list-panes',
      '-a',
      '-F',
      `#{session_name}${paneSeparator}#{pane_current_command}${paneSeparator}#{pane_start_command}`,
    ]);
    if (!sessions.ok || !panes.ok) {
      return { asked: false, ...nothing, detail: [sessions.why, panes.why].filter(Boolean).join('; ') };
    }
    const paneLines = panes.lines;
    const himaSessions = sessions.lines.filter((s) => s.startsWith('hima-'));
    const busyPanes = paneLines
      .map((line) => ({ line, because: busyBecause(line, siteFlowRoot) }))
      .filter((p) => p.because !== '');
    const detail = [
      sessions.lines.length === 0 ? sessions.why || 'no tmux sessions' : `sessions: ${sessions.lines.join(', ')}`,
      paneLines.length === 0 ? 'no tmux panes' : `panes: ${paneLines.join(', ')}`,
    ].join('; ');
    return { asked: true, sessions: sessions.lines, himaSessions, panes: paneLines, busyPanes, detail };
  } catch (err) {
    return { asked: false, ...nothing, detail: (err as Error).message };
  }
}

/** One `/hima observe` of the Site's own last result, and the observation it recorded. */
interface LastResult {
  readonly command: string;
  readonly runId?: string;
  readonly observation?: ObservationRecord;
  readonly error?: string;
}

async function readLastResult(host: InProcessHost, workspaceDir: string, at: string, what: string): Promise<LastResult> {
  const command = `/hima observe ${siteName} ${at} --reader dc-qor-report`;
  const answered = await himaCommand(host, workspaceDir, command, 120_000);
  if (answered.kind !== 'success' || !answered.runId) return { command, error: `${what}: ${answered.text}` };
  const found = host.ctx.hima.ledger.records({ runId: answered.runId, type: 'observation' });
  const observation = found[found.length - 1] as ObservationRecord | undefined;
  if (!observation) return { command, runId: answered.runId, error: `${what}: the command succeeded but recorded no observation` };
  return { command, runId: answered.runId, observation };
}

// ---------------------------------------------------------------------------------------------
// Everything the record is written from. Declared here because the record is written on every path
// out of this script, the read-only probe refusing to clear the Site included.
// ---------------------------------------------------------------------------------------------

let runLine = '';
let runAnswer = '';
let runKind = '';
let runId: string | undefined;
/** Where the Run stands in the ledger, read while the in-process host is still up. */
let runStatus: RunStatus | undefined;
/** Why the two web hosts were not booted, or `''` when they were. */
let webHostsSkipped = '';
let statusText = '';
let afterProbe: LastResult | undefined;
let afterPeriodNs: number | undefined;
let view: RunView | undefined;
let records: readonly LedgerRecord[] = [];
let workspace: string | undefined;
let containerName: string | undefined;
let observation: RunView['observations'][number] | undefined;
let expected: { chosen: unknown; how: string } | undefined;
let restartError = '';
let viewBefore = '';
let viewAfter = '';
let recordsBefore = '';
let recordsAfter = '';

// ---------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------

const { h, sitesDir, packsDir } = await setUpHome();
const site = loadSite(sitesDir, siteName);
const pack = loadPack(packsDir, timingProbePackId);
const bindings = boundInputs(pack, site);
const flowRoot = bindings.flowRoot ?? '';
const workspaceRoot = bindings.workspaceRoot ?? '';
const design = bindings.design ?? '';
const explore = pack.graph.nodes.find((n): n is Extract<PackNode, { kind: 'explore' }> => n.kind === 'explore');
const guardBandNs = explore?.parameters.bind.guardBandNs;
const lastResultAt = lastResultPath(pack, site, flowRoot);
const paths = pathsOn(site);

record.site = {
  name: site.name,
  kind: site.kind,
  file: site.file,
  destination: site.ssh?.destination,
  workspaceRoot,
  flowRoot,
  design,
  parallelJobs: site.capacity.parallelJobs,
  lastResultReport: lastResultAt,
};
record.pack = { id: pack.id, version: pack.contract.version, guardBandNs };
record.home = h.home;

if (site.kind === 'ssh' && site.ssh) {
  try {
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', site.ssh.destination, 'true'], { stdio: 'ignore' });
  } catch {
    fail(`site ${site.name} is unreachable at ${site.ssh.destination} (LAN only); acceptance not run`);
  }
}

console.log(`step-2 acceptance on site ${site.name}; home ${h.home}`);
const host = await bootInProcess(h);
clearRemoteCommands();

// ---- Read-only probe: the Site's last result, where its workspaces go, and what is running ----

const before = await readLastResult(host, h.workspace, lastResultAt, "the site's last result could not be read");
drain('read-only probe');
const lastPeriodNs = before.observation ? numberOf(before.observation.values, 'clock_period') : undefined;
const computedTargetNs = lastPeriodNs === undefined ? undefined : roundNs(lastPeriodNs - defaultStepNs);
const targetNs = targetOverrideNs ?? computedTargetNs;
const targetFrom = targetOverrideNs === undefined
  ? `the site's last result (${show(lastPeriodNs)} ns) minus ${defaultStepNs} ns`
  : 'the --target option';

// The other half of the band. The floor and the spelling were applied before anything was booted;
// the ceiling needs the Site's own last result, which is what the probe above just read. A period
// outside the band is refused here, before the launch and before any check is written down: nothing
// was done to the Site but the read-only probe this message quotes, so there is nothing to record.
if (targetNs !== undefined) {
  const bandTopNs = lastPeriodNs === undefined ? undefined : roundNs(lastPeriodNs * maxTargetMultiple);
  if (!plainDecimal(targetNs) || targetNs < minTargetNs || (bandTopNs !== undefined && targetNs > bandTopNs)) {
    await host.dispose();
    fail(
      `the clock period this run would ask the site for, ${targetNs} ns (${targetFrom}), is outside the band this script will ask for: ${bandInWords}`
        + ` — with the site's last result at ${show(lastPeriodNs)} ns, that band is ${minTargetNs} ns to ${show(bandTopNs)} ns.`
        + ' Nothing was launched and no record was written: the site was read read-only and nothing else.',
    );
  }
}

check(
  'last-result-read',
  "The site's own last result was read, read-only, before anything else was done to the site.",
  `\`/hima observe ${siteName} ${lastResultAt} --reader dc-qor-report\` succeeds and its observation states a \`clock_period\`.`,
  lastPeriodNs !== undefined,
  before.error
    ?? (lastPeriodNs === undefined
      ? `the observation states no clock_period: ${JSON.stringify(before.observation?.values ?? [])}`
      : `${lastPeriodNs} ns, from ${lastResultAt}, sha256 ${show(before.observation?.contentSha256)} (${show(before.observation?.bytes)} bytes)`),
);

// On the default path the target is *derived* as last − step, so "tighter than last" is a property of
// that derivation and not something a comparison here could ever disprove: `targetNs < lastPeriodNs`
// is true by construction, and a check that cannot fail reads as evidence while proving nothing. So
// the default path states the derivation it made, and the inequality is a check only when a person
// gave `--target` and the two numbers are independent.
check(
  'target-tighter-than-last',
  targetOverrideNs === undefined
    ? `The generation was asked for a clock period derived from the site's own last result: last − ${defaultStepNs} ns. Tighter than last follows from that derivation; this check does not confirm it independently.`
    : "The generation was asked for a clock period tighter than the site's last result.",
  (targetOverrideNs === undefined
    ? `The site's last result states a clock period, and the target asked for is \`last − ${defaultStepNs}\` rounded to 3 decimals — the derivation, stated.`
    : '`--target` was given, so the target is that number, and it is checked here to be < last.')
    + ` The target is also inside the sanity band — ${bandInWords}, and a plain decimal — which is enforced before the launch: a period outside it exits 2 with no record and nothing asked of the site beyond this probe.`,
  targetNs !== undefined
    && lastPeriodNs !== undefined
    && (targetOverrideNs === undefined ? targetNs === computedTargetNs : targetNs < lastPeriodNs),
  `last ${show(lastPeriodNs)} ns, target ${show(targetNs)} ns (${targetFrom})`,
);

// The two roots this Site names, as the Site itself resolves them. Every path the channel is given
// is a resolved one — the Permit decides on `realpath` — so a root compared as the site file spells
// it would read a workspace reached through a symlink as a path outside itself. `realpath` is one of
// HimaChannel's two read-only probes, so asking costs the Site a resolution and nothing else.
const resolveOnSite = async (at: string): Promise<{ path: string; error: string }> => {
  try {
    return { path: await channelFor(site).realpath(at), error: '' };
  } catch (err) {
    return { path: '', error: (err as Error).message };
  }
};
const resolvedWorkspaceRoot = await resolveOnSite(workspaceRoot);
const resolvedFlowRoot = await resolveOnSite(flowRoot);
const workspaceRootOnSite = resolvedWorkspaceRoot.path;
const flowRootOnSite = resolvedFlowRoot.path;
const quiet = await askSiteQuiet(channelFor(site), flowRootOnSite);
drain('read-only probe');

// The roots are what every later check measures against — the workspace the Job must be inside, the
// flow root every copy must come from — and an unresolved one turns each of those into a failure
// discovered *after* a real synthesis has run. So it is a gate, not a check to read afterwards.
const rootsResolved = check(
  'site-roots-resolved',
  'Both roots this site names resolved on the site itself before anything was launched: where campaign workspaces go, and where the site\'s own flow is.',
  '`realpath` of the site\'s `workspaceRoot` and of its `flowRoot`, asked through HimaChannel, each answered a path. Every later check measures against these two, so a root that does not resolve stops the launch here rather than failing checks after a synthesis has already run.',
  workspaceRootOnSite !== '' && flowRootOnSite !== '',
  `workspaceRoot ${workspaceRoot} → ${workspaceRootOnSite || 'unresolved'}; flowRoot ${flowRoot} → ${flowRootOnSite || 'unresolved'}`
    + (resolvedWorkspaceRoot.error || resolvedFlowRoot.error
      ? `; ${[resolvedWorkspaceRoot.error, resolvedFlowRoot.error].filter(Boolean).join('; ')}`
      : ''),
);

const siteIsQuiet = check(
  'one-job-at-a-time',
  'Every tmux session and every tmux pane on the site was listed and read, and none of them carries a job of this harness or a large EDA job of the site\'s own.',
  'tmux on the site lists no session whose name begins with `hima-`, and no pane that any of four patterns reads as busy: its session name begins with `hima-`; or its command half — `pane_current_command` and `pane_start_command` together, which is where the tool, the design and the target are — names the site\'s own resolved flow root, or names one of `'
    + `${largeJobTools.join('`, `')}\`, or holds \`make\` and \`synth\` together. Those are the shapes a large job is launched in here: the flow runs Design Compiler through \`make\` and a container, so \`dc_shell\` is never the string on the pane, and matching on it alone would clear a site that is busy. A probe that could not be made is a failure, never a quiet site. What this establishes is what tmux can be asked: a pane matching none of these patterns is read as quiet, and a job started outside tmux is outside this probe's reach — the site owner's rule that a large job runs in a tmux session is what makes tmux the place to ask.`,
  quiet.asked && quiet.himaSessions.length === 0 && quiet.busyPanes.length === 0,
  quiet.asked
    ? `${quiet.detail}; hima- sessions: ${quiet.himaSessions.length === 0 ? 'none' : quiet.himaSessions.join(', ')}`
      + `; panes read as busy: ${quiet.busyPanes.length === 0 ? `none of ${quiet.panes.length}` : quiet.busyPanes.map((p) => `${p.line} (${p.because})`).join('; ')}`
    : `the probe could not be made: ${quiet.detail}`,
);

record.probe = {
  lastResult: {
    command: before.command,
    runId: before.runId,
    path: lastResultAt,
    clockPeriodNs: lastPeriodNs,
    contentSha256: before.observation?.contentSha256,
    bytes: before.observation?.bytes,
    error: before.error,
  },
  workspaceRootOnSite: workspaceRootOnSite || undefined,
  flowRootOnSite: flowRootOnSite || undefined,
  rootsUnresolved: [resolvedWorkspaceRoot.error, resolvedFlowRoot.error].filter(Boolean).join('; ') || undefined,
  quiet,
};
record.request = { targetPeriodNs: targetNs, targetFrom, timeBoxMinutes };

// The launch needs four facts, not three: the site quiet, both roots resolved, a target, and the site's
// last result actually read — without the last result the target band has no ceiling and the premise
// "tighter than the site's last result" was never established, so a `--target` alone must not launch.
if (!siteIsQuiet || !rootsResolved || targetNs === undefined || lastPeriodNs === undefined) {
  console.error('nothing was launched: the read-only probe did not clear the site for a generation');
  await host.dispose();
  finish();
}

// ---- The generation ----

// One generation, which is what step 2's acceptance is about: the shipped pack loops now (#25), and
// a record of "one generation on the reference site" must be of one generation whatever the pack's
// own allowance says. Step 3's acceptance is the Campaign, and is its own script.
runLine = `/hima run ${timingProbePackId} --site ${siteName} --goal target_period_ns=${targetNs} --set periodNs=${targetNs} --time-box ${timeBoxMinutes} --generations 1`;
console.log(`launching: ${runLine}`);
// The audit is drained as the generation runs, so a long one cannot evict its own launch from it.
const sampler = setInterval(() => drain('generation'), 2_000);
try {
  const started = await himaCommand(host, h.workspace, runLine, timeBoxMinutes * 60_000 + commandHeadroomMs);
  runKind = started.kind;
  runAnswer = started.text;
  runId = started.runId;
} catch (err) {
  runKind = 'error';
  runAnswer = `the command did not answer: ${(err as Error).message}`;
} finally {
  clearInterval(sampler);
  drain('generation');
}
for (const line of runAnswer.split('\n')) console.log(`  ${line}`);

// Where the Run stands, read from the ledger this host holds while it is still up. `/hima run`
// answers `success` for every ending, a spent budget and a cancel included — those are real results
// for that face, but they are not a generation that ran to a measured one, and two things here turn
// on the difference: what this check may claim, and whether the web hosts below may be booted at all.
runStatus = runId === undefined ? undefined : host.ctx.hima.ledger.run(runId)?.status;
const runEnded = hasEnded(runStatus);
// A Run allowed one generation and asked for a second ends `ended-budget-exhausted` naming the
// generation limit, with its decision on record: the generation ran and something was measured,
// which is exactly what this check is about. A time box or a cancel is not.
const endedBy = runId === undefined ? undefined : host.ctx.hima.ledger.run(runId)?.meters?.endedBy;
const generationCompleted = runStatus === 'ended-goal-met'
  || runStatus === 'ended-goal-not-met'
  || (runStatus === 'ended-budget-exhausted' && endedBy === 'generation-limit');

check(
  'one-invocation-ran-the-generation',
  'One invocation of `/hima run` executed the whole generation, and the Run reached a measured result.',
  'The command answers `success`, names a run, and that Run ends `ended-goal-met`, `ended-goal-not-met`, or `ended-budget-exhausted` at the generation limit this invocation set to one — the endings that mean the generation ran and something was measured. A spent time box or a cancel is an ending `/hima run` answers as a success, and neither is a generation that completed.',
  runKind === 'success' && runId !== undefined && generationCompleted,
  runId === undefined ? `no run in the answer: ${runAnswer}` : `${runKind}, run ${runId}, status ${show(runStatus)}`,
);

if (runId) {
  const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
  statusText = status.text;
  check(
    'status-reports-the-run',
    '`/hima status` reports the Run this generation produced.',
    `\`/hima status ${runId}\` succeeds and its first line names that run.`,
    status.kind === 'success' && status.text.startsWith(`run ${runId} `),
    status.kind === 'success' ? status.text.split('\n')[0] ?? '' : status.text,
  );
}

afterProbe = await readLastResult(host, h.workspace, lastResultAt, "the site's last result could not be re-read");
afterPeriodNs = afterProbe.observation ? numberOf(afterProbe.observation.values, 'clock_period') : undefined;
drain('read-back');
record.generation = { command: runLine, kind: runKind, answer: runAnswer, runId, runStatus, statusText };

await host.dispose();

// ---- The run view over the real web profile, and the same Run over a second booted host ----

// Booting a host is not a read. A host that comes up on this home reconciles every Run still
// `running` — `jobStatus` against the Site, `tmux has-session`, `test -f`, `cat`, and ledger records
// written for what it finds — from a process whose audit this record cannot see. For a Run that has
// reached a final status that reconciliation does nothing at all, which is why these two boots are
// free; for a Run left running by an abort or a fault they would be real commands to the Site, sent
// behind this record's back and while the Site may still have the Job going. So the boots are gated
// on the ending, and when there is none the run view and the restart are not read and say why.
// A Run there never was is the other reason not to boot them, and it needs saying just as plainly:
// with no run id there is nothing to read back, so the restart below never runs and the record must
// say that rather than compare two readings it never took.
webHostsSkipped = runId === undefined
  ? `\`/hima run\` answered ${runKind} and named no run, so there was nothing to read back. Neither web host was booted and no restart was attempted.`
  : !runEnded
  ? `the Run is ${show(runStatus)}, which is not a final status: booting a host would have it reconcile a still-running Run, sending commands to the site from a process this record's command list cannot see. The run view and the restart were not read.`
  : '';
if (webHostsSkipped !== '') restartError = webHostsSkipped;

if (runId && runEnded) {
  const readRun = async (web: BootedHost, when: string): Promise<{ view: RunView; records: readonly LedgerRecord[] }> => {
    const cookie = await openSession(web);
    const got = async (target: string): Promise<unknown> => {
      const answered = await himaApi(web, cookie, target);
      const text = await answered.text();
      if (answered.status !== 200) throw new Error(`GET ${target} answered ${answered.status} ${when}: ${text}`);
      return JSON.parse(text) as unknown;
    };
    return {
      view: (await got(`/hima/api/runs/${runId!}`)) as RunView,
      records: ((await got(`/hima/api/runs/${runId!}/records`)) as { records: LedgerRecord[] }).records,
    };
  };
  let web: BootedHost | undefined;
  try {
    web = await bootHimaHost(h);
    const first = await readRun(web, 'over the first booted host');
    view = first.view;
    records = first.records;
    viewBefore = canonical(first.view);
    recordsBefore = canonical(first.records);
    const code = await web.stop();
    web = undefined;
    if (code !== 0) restartError = `the web host exited ${String(code)} on SIGTERM`;

    web = await bootHimaHost(h);
    const second = await readRun(web, 'after the restart');
    viewAfter = canonical(second.view);
    recordsAfter = canonical(second.records);
  } catch (err) {
    restartError = `${restartError ? `${restartError}; ` : ''}${(err as Error).message}`;
  } finally {
    if (web) await web.stop().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// What the generation left behind, checked.
// ---------------------------------------------------------------------------------------------

const campaignId = view?.run.campaignId;
const workspaceRecord = records.findLast((r): r is WorkspaceRecord => r.type === 'workspace');
workspace = workspaceRecord?.workspace;
containerName = workspaceRecord?.containerName;
// One generation produces one of each of these, so today the first and the last are the same record.
// They are read as the last, and the observation as the one the verdicts actually cite, so that a
// retried node — a `read-qor` that ran twice, a Job relaunched after a failure — cannot have these
// checks measuring one attempt while the verdicts and the decision they are compared against were
// written from another. The decision is already the Run's latest; these now agree with it.
const launched = view?.jobs.filter((j) => j.event === 'launched') ?? [];
const job = launched[launched.length - 1];
const setupVerdict = view?.verdicts.findLast((v) => v.ruleId === 'setup-wns-all-nonnegative');
const goalVerdict = view?.verdicts.findLast((v) => v.ruleId === 'clock-period-at-most');
const observations = view?.observations ?? [];
const citedByVerdicts = [setupVerdict, goalVerdict].flatMap((v) => v?.cites.map((c) => c.recordId) ?? []);
observation = observations.findLast((o) => citedByVerdicts.includes(o.recordId)) ?? observations[observations.length - 1];
const decision = view?.decision ?? undefined;
const observedPeriodNs = observation ? numberOf(observation.values, 'clock_period') : undefined;
const observedSlackNs = observation ? numberOf(observation.values, 'setup_wns') : undefined;

check(
  'run-view-carries-the-generation',
  'The run view over the real web profile shows the whole path this generation took.',
  `\`GET /hima/api/runs/${runId ?? '<run>'}\` answers 200 with a non-empty \`nodes\`, a non-empty \`jobs\`, a \`decision\`, \`meters\` and \`goal\`; \`GET .../records\` answers that Run's records.`,
  view !== undefined
    && view.nodes.length > 0
    && view.jobs.length > 0
    && view.decision !== null
    && view.run.meters !== undefined
    && view.run.goal !== undefined
    && records.length > 0,
  view === undefined
    ? `the run view could not be read: ${restartError || 'no run to read'}`
    : `${view.nodes.length} nodes, ${view.jobs.length} job events, decision ${view.decision ? 'present' : 'absent'}, meters ${JSON.stringify(view.run.meters)}, goal ${JSON.stringify(view.run.goal)}, ${records.length} records`,
);

const expectedWorkspace = workspaceRootOnSite && campaignId ? paths.join(workspaceRootOnSite, campaignId) : undefined;
const makeInFlow = job && workspace ? [quote('make'), quote('-C'), quote(`${workspace}/${flowDirName}`)].join(' ') : '';

check(
  'job-ran-in-the-campaign-workspace',
  'The synthesis Job ran inside the Campaign workspace, through `make` in tmux.',
  'The Campaign workspace the workspace record names is `<workspaceRoot>/<campaignId>`, with `<workspaceRoot>` as the site itself resolves it; the last Job the Run launched has that path as its own `workspace`; its command line runs `make -C <workspace>/flow` at the clock period requested; and its tmux session was started with `-c <workspace>`.',
  workspace !== undefined
    && expectedWorkspace !== undefined
    && workspace === expectedWorkspace
    && job !== undefined
    && job.job.workspace === workspace
    && job.job.wire.includes(makeInFlow)
    && job.job.wire.includes(quote(`CLOCK_PERIOD_NS=${String(targetNs)}`))
    && audit.some((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session' && c.argv.indexOf('-c') > 0 && c.argv[c.argv.indexOf('-c') + 1] === workspace),
  job === undefined || workspace === undefined
    ? `no launched Job or no workspace record: workspace ${show(workspace)}, job ${job ? job.job.session : 'none'}`
    : `workspace ${workspace} (expected ${show(expectedWorkspace)}), session ${job.job.session}, wire ${job.job.wire}`,
);

check(
  'container-is-the-campaigns-own',
  "The generation ran under a container of this Campaign's own, never the site's.",
  'The workspace record\'s `containerName` is `hima-<campaignId>`, and the Job\'s command line carries `EDA_CONTAINER_NAME=` that same name.',
  campaignId !== undefined
    && containerName === containerNameFor(campaignId)
    && job !== undefined
    && job.job.wire.includes(quote(`EDA_CONTAINER_NAME=${containerNameFor(campaignId)}`)),
  `campaign ${show(campaignId)}, container ${show(containerName)}, on the wire: ${
    job && campaignId && job.job.wire.includes(quote(`EDA_CONTAINER_NAME=${containerNameFor(campaignId)}`)) ? 'yes' : 'no'
  }`,
);

// Every write the channel was asked to make, and where it landed. `mkdir`, `cp` and `tee` are the
// whole of the workspace plumbing, and the write target is the last word of each of them.
const writes = audit.filter((c) => c.argv[0] === 'mkdir' || c.argv[0] === 'cp' || c.argv[0] === 'tee');
const under = (p: string, root: string): boolean => root !== '' && (p === root || p.startsWith(`${root}${paths.sep}`));
const strayWrites = writes.map((c) => c.argv[c.argv.length - 1] ?? '').filter((t) => workspace === undefined || !under(t, workspace));
const strayCopySources = audit
  .filter((c) => c.argv[0] === 'cp')
  .map((c) => c.argv[c.argv.length - 2] ?? '')
  .filter((s) => !under(s, flowRootOnSite));
const strayLaunchDirs = audit
  .filter((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session')
  .map((c) => (c.argv.indexOf('-c') > 0 ? c.argv[c.argv.indexOf('-c') + 1] ?? '' : ''))
  .filter((d) => workspace === undefined || !under(d, workspace));
const jobFilesUnderWorkspace = job !== undefined && workspace !== undefined
  && job.job.wire.includes(quote(`${workspace}/${job.job.session}.log`))
  && job.job.wire.includes(quote(`${workspace}/${job.job.session}.exit`));

check(
  'nothing-written-outside-the-workspace',
  'Every write HimaChannel was asked to make landed inside the Campaign workspace, and every copy source was under the site\'s own flow root.',
  "Every `mkdir`, `cp` and `tee` the channel was asked to run has its write target — the last word of the command — inside the Campaign workspace; every `cp` reads from inside the site's own flow root, as the site resolves it; every tmux launch names the Campaign workspace as its working directory and writes its log and its exit status inside it; and HimaChannel runs no other verb that writes. This is about the commands this harness sent, which are the ones it is answerable for. What `make` and the tools it starts write once the Job is running is not covered by this check: that is inside the Job, where this harness sees only the log and the exit status, and it is the flow's own doing.",
  writes.length > 0
    && strayWrites.length === 0
    && strayCopySources.length === 0
    && strayLaunchDirs.length === 0
    && jobFilesUnderWorkspace,
  `${writes.length} write commands (${writes.map((c) => c.argv[0]).join(', ')})`
    + `; targets outside ${show(workspace)}: ${strayWrites.length === 0 ? 'none' : strayWrites.join(', ')}`
    + `; copy sources outside ${show(flowRootOnSite || flowRoot)}: ${strayCopySources.length === 0 ? 'none' : strayCopySources.join(', ')}`
    + `; tmux launches outside the workspace: ${strayLaunchDirs.length === 0 ? 'none' : strayLaunchDirs.join(', ')}`
    + `; the job's log and exit file inside it: ${jobFilesUnderWorkspace ? 'yes' : 'no'}`,
);

check(
  'site-flow-root-untouched',
  "The one report the target was derived from is unchanged in content and length. Only that file: the rest of the site's own flow root is never read here, so nothing is claimed about it.",
  `The same report, \`${lastResultAt}\`, read read-only before and after the generation, has the same sha256, the same byte count and the same stated clock period. That is this one file in the site's own flow root, not the flow root: no other file under it is read, and a rewrite that reproduced these same bytes would not be caught. (HimaChannel's read-only probes are \`cat\` and \`realpath\`; there is no \`stat\` on that list, and adding one would be a verb granted on a customer's site for this script's sake, so content and length are what this is said by.)`,
  before.observation !== undefined
    && afterProbe?.observation !== undefined
    && before.observation.contentSha256 === afterProbe.observation.contentSha256
    && before.observation.bytes === afterProbe.observation.bytes
    && lastPeriodNs !== undefined
    && lastPeriodNs === afterPeriodNs,
  afterProbe?.error
    ?? `before sha256 ${show(before.observation?.contentSha256)} (${show(before.observation?.bytes)} bytes, ${show(lastPeriodNs)} ns);`
      + ` after sha256 ${show(afterProbe?.observation?.contentSha256)} (${show(afterProbe?.observation?.bytes)} bytes, ${show(afterPeriodNs)} ns)`,
);

check(
  'observed-period-is-the-target',
  "The generation's own report states the clock period that was asked for.",
  'The observation the Run read out of the Campaign workspace — the one the verdicts cite, or the Run\'s latest when they cite none — states a `clock_period` equal to the target period requested.'
    + ' That period is the one the report\'s *clock* path group states: a Design Compiler qor report also has built-in groups (`**default**` and its kind) that state a period of their own and often hold the worst slack, and a period read from one of those would be no period the design was synthesized at. On a report with no clock group, or more than one, the reader states no period at all and this check fails rather than comparing a guess.',
  observedPeriodNs !== undefined && observedPeriodNs === targetNs,
  observation === undefined
    ? 'the run recorded no observation'
    : `requested ${show(targetNs)} ns; ${observation.path} states ${show(observedPeriodNs)} ns`,
);

check(
  'setup-verdict-follows-the-measurement',
  "The setup rule's verdict follows from the measured slack, and cites the observation it was read from.",
  'The `setup-wns-all-nonnegative` verdict is PASS exactly when the observation\'s `setup_wns` is at least 0, and it cites that observation.',
  setupVerdict !== undefined
    && observedSlackNs !== undefined
    && observation !== undefined
    && setupVerdict.outcome === (observedSlackNs >= 0 ? 'PASS' : 'FAIL')
    && setupVerdict.cites.some((c) => c.recordId === observation!.recordId),
  setupVerdict === undefined
    ? 'no setup verdict'
    : `setup_wns ${show(observedSlackNs)} ns, verdict ${setupVerdict.outcome}, cites ${setupVerdict.cites.map((c) => c.recordId).join(', ')}`,
);

check(
  'goal-verdict-follows-the-measurement',
  "The goal rule's verdict follows from the measured period and the Run's own goal, and cites the observation.",
  'The `clock-period-at-most` verdict is bound to the Run\'s `target_period_ns`, is PASS exactly when the observation\'s `clock_period` is at most that target, and cites that observation.',
  goalVerdict !== undefined
    && observedPeriodNs !== undefined
    && observation !== undefined
    && goalVerdict.boundParameters?.target_period_ns === targetNs
    && goalVerdict.outcome === (observedPeriodNs <= targetNs ? 'PASS' : 'FAIL')
    && goalVerdict.cites.some((c) => c.recordId === observation!.recordId),
  goalVerdict === undefined
    ? 'no goal verdict'
    : `clock_period ${show(observedPeriodNs)} ns against ${JSON.stringify(goalVerdict.boundParameters)}, verdict ${goalVerdict.outcome}, cites ${goalVerdict.cites.map((c) => c.recordId).join(', ')}`,
);

// The chooser's three clauses, re-derived here from the two verdicts and the measured numbers, so
// the decision on the ledger is compared with what `timing-push` declares rather than with a guess.
//
// This is the one place in this script that restates in TypeScript something the harness ships as
// data (D38), and it is deliberate: an independent check is worth nothing if it is the same code
// evaluating the same file, so the clauses are read off `choosers/timing-push.yml` by a person and
// written out here by hand. It is a check of the numbers the harness produced, never a second
// implementation for the harness to use — nothing outside this script imports it, and a pack author
// who changes the chooser changes the YAML and this comment's neighbours, not a shipped code path.
// The rounding is the one thing taken from the bundle (`roundNs`): "three decimals" is a convention
// the two sides must share to be comparable at all, not a clause there is anything to check.
if (setupVerdict && goalVerdict && observedPeriodNs !== undefined && observedSlackNs !== undefined && guardBandNs !== undefined) {
  if (setupVerdict.outcome === 'PASS' && goalVerdict.outcome === 'PASS') {
    expected = { chosen: { goalMet: true }, how: 'the constraint and the goal both passed, so there is no next strategy' };
  } else if (setupVerdict.outcome === 'PASS') {
    expected = {
      chosen: { strategy: { periodNs: roundNs(observedPeriodNs - observedSlackNs + guardBandNs) } },
      how: `period − slack + guard = ${observedPeriodNs} − ${observedSlackNs} + ${guardBandNs}`,
    };
  } else if (setupVerdict.outcome === 'FAIL') {
    expected = {
      chosen: { strategy: { periodNs: roundNs(observedPeriodNs + Math.abs(observedSlackNs) + guardBandNs) } },
      how: `period + |slack| + guard = ${observedPeriodNs} + ${Math.abs(observedSlackNs)} + ${guardBandNs}`,
    };
  }
}
const citesWanted = setupVerdict && goalVerdict && observation
  ? [setupVerdict.recordId, goalVerdict.recordId, observation.recordId]
  : undefined;

check(
  'decision-follows-the-chooser',
  'The decision is the one `timing-push` declares for these two verdicts and these measured values, and it cites both verdicts and the observation.',
  'One decision, by chooser `timing-push`, whose `chosen` is `{goalMet: true}` when the constraint and the goal both passed, `{strategy: {periodNs: period − slack + guard, rounded to 3 decimals}}` when the constraint passed and the goal did not, and `{strategy: {periodNs: period + |slack| + guard, rounded to 3 decimals}}` when the constraint failed — with `period` and `slack` read from the observation and `guard` the guard band the pack binds. Its `rationale` is those three numbers, and its `cites` are the setup verdict, the goal verdict and the observation, in that order.',
  decision !== undefined
    && expected !== undefined
    && citesWanted !== undefined
    && decision.chooser === 'timing-push'
    && canonical(decision.chosen) === canonical(expected.chosen)
    && canonical(decision.rationale) === canonical({ period: observedPeriodNs, slack: observedSlackNs, guardBandNs })
    && canonical(decision.cites) === canonical(citesWanted),
  decision === undefined
    ? 'the run recorded no decision'
    : `${decision.chooser} chose ${JSON.stringify(decision.chosen)}; the chooser's own clause gives ${
        expected ? `${JSON.stringify(expected.chosen)} (${expected.how})` : 'nothing derivable from these verdicts'
      }; rationale ${JSON.stringify(decision.rationale)}; cites ${decision.cites.join(', ')}`,
);

check(
  'restart-reads-back-unchanged',
  'After the host was stopped and another booted on the same home, the same Run reads back unchanged.',
  `\`GET /hima/api/runs/${runId ?? '<run>'}\` and \`GET .../records\` answer, over a second booted host, exactly what the first one answered.`,
  restartError === '' && viewBefore !== '' && viewBefore === viewAfter && recordsBefore === recordsAfter,
  restartError !== ''
    ? restartError
    : `run view ${viewBefore === viewAfter ? 'identical' : 'DIFFERED'}, ${records.length} records ${recordsBefore === recordsAfter ? 'identical' : 'DIFFERED'}`,
);

check(
  'every-remote-command-recorded',
  "The record lists every command the in-process host that drove this generation asked the site to run, as HimaChannel's own audit inside this process saw them.",
  "The list is HimaChannel's own audit inside this process, drained into this record every 2 seconds as the generation ran, so nothing was evicted from its 500-entry window; it holds both the workspace preparation and the launch. The audit is per process, so what it covers is the in-process host that drove the generation — which is every command this run sent, because the only other processes this script starts are the two web hosts, and those are booted only for a Run that has already ended, where a booted host reconciles nothing and asks the site for nothing. One command is outside it by design: the reachability probe `ssh … true` sent before anything else, which runs nothing on the site.",
  !auditWindowFilled
    && audit.some((c) => c.argv[0] === 'mkdir')
    && audit.some((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session'),
  `${audit.length} commands recorded; the audit window filled between drains: ${auditWindowFilled ? 'YES — commands may have been evicted' : 'no'}`,
);

record.run = view
  ? {
      id: view.run.id,
      campaignId: view.run.campaignId,
      siteId: view.run.siteId,
      packId: view.run.packId,
      status: view.run.status,
      currentNode: view.run.currentNode,
      goal: view.run.goal,
      strategy: view.run.strategy,
      budget: view.run.budget,
      meters: view.run.meters,
    }
  : undefined;
record.runView = view;
record.records = records;
record.restart = {
  webHostsBooted: runId !== undefined && webHostsSkipped === '',
  webHostsNotBootedBecause: webHostsSkipped || undefined,
  runViewUnchanged: viewBefore !== '' && viewBefore === viewAfter,
  recordsUnchanged: recordsBefore !== '' && recordsBefore === recordsAfter,
  error: restartError || undefined,
};
record.measured = {
  targetPeriodNs: targetNs,
  observedPeriodNs,
  observedSlackNs,
  guardBandNs,
  expectedChoice: expected?.chosen,
  expectedChoiceHow: expected?.how,
};
record.workspaceLeftInPlace = {
  path: workspace,
  containerName,
  note: 'Left in place as evidence. Nothing in this harness removes a path on a Site; removing this workspace, and the container of that name, is the site owner\'s call.',
};
record.afterProbe = {
  command: afterProbe?.command,
  runId: afterProbe?.runId,
  contentSha256: afterProbe?.observation?.contentSha256,
  bytes: afterProbe?.observation?.bytes,
  clockPeriodNs: afterPeriodNs,
  error: afterProbe?.error,
};

// ---------------------------------------------------------------------------------------------
// The record as a person reads it.
// ---------------------------------------------------------------------------------------------

function markdown(): string {
  const v = view;
  const lines: string[] = [
    `# Step-2 acceptance run, ${date}`,
    '',
    `One generation of the \`${timingProbePackId}\` pack on site \`${site.name}\`${site.ssh ? ` (${site.ssh.destination})` : ''}. ${versionLine()}. Commit \`${commit}\`${commitDirty ? ' (working tree dirty)' : ''}.`,
    '',
    'Driven through the booted host\'s own faces: `/hima run` and `/hima status` on a host booted in-process from the hima profile with every entry active, then the run view over the real web profile — `dsh --profile hima`, the tokened URL exchanged for a session cookie, `GET /hima/api/runs/<id>` and `/records` — then those same two routes again over a second booted host.',
    '',
    '## What was asked for',
    '',
    `- The site's own last result: \`${lastResultAt}\`, read read-only, states **${show(lastPeriodNs)} ns**.`,
    `- The target: **${show(targetNs)} ns** — ${targetFrom}.`,
    `- The time box: ${timeBoxMinutes} minutes. The site declares ${site.capacity.parallelJobs} parallel job(s).`,
    '',
    '```',
    runLine || 'nothing was launched: the read-only probe did not clear the site',
    '```',
    '',
    '## What ran',
    '',
    v
      ? `Run \`${v.run.id}\` of campaign \`${v.run.campaignId}\`, status **${show(v.run.status)}**, at node \`${show(v.run.currentNode)}\`. Goal ${JSON.stringify(v.run.goal)}, strategy ${JSON.stringify(v.run.strategy)}, budget ${JSON.stringify(v.run.budget)}, meters ${JSON.stringify(v.run.meters)}.`
      : `No run view was read.${runId ? ` The Run \`${runId}\` stands at **${show(runStatus)}** in the ledger the in-process host wrote.` : ''}${restartError ? ` ${restartError}` : ''}`,
    '',
    ...(v
      ? [
          `- Nodes: ${v.nodes.map((n) => `\`${n.nodeId}\` (${n.kind}) ${n.state}, attempt ${n.attempt}`).join('; ')}`,
          `- Jobs: ${v.jobs.map((j) => `${j.event}${j.exitCode === undefined ? '' : ` exit ${j.exitCode}`} in \`${j.job.session}\``).join('; ')}`,
          `- Observation: \`${show(observation?.path)}\`, sha256 \`${show(observation?.contentSha256)}\` (${show(observation?.bytes)} bytes), reader \`${show(observation?.reader.id)}@${show(observation?.reader.version)}\``,
          ...(observation
            ? observation.values.map(
                (x) => `  - ${x.type}${x.mode ? ` (${x.mode}${x.scope ? `, ${x.scope}` : ''})` : ''}: ${x.value === null ? `unknown — ${show(x.unknownReason)}` : `${x.value} ${x.unit}`}`,
              )
            : []),
          `- Verdicts: ${v.verdicts.map((x) => `${x.ruleId}@${x.ruleVersion} **${x.outcome}**${x.boundParameters ? ` (${Object.entries(x.boundParameters).map(([k, n]) => `${k}=${n}`).join(', ')})` : ''}, cites ${x.cites.map((c) => c.recordId).join(', ')}`).join('; ')}`,
          `- Decision: ${v.decision ? `\`${v.decision.nodeId}\` by \`${v.decision.chooser}\` chose ${JSON.stringify(v.decision.chosen)}, rationale ${JSON.stringify(v.decision.rationale)}, cites ${v.decision.cites.join(', ')}` : 'none'}`,
          ...(expected ? [`- The chooser's own clause for these values: ${expected.how} → ${JSON.stringify(expected.chosen)}`] : []),
          '',
        ]
      : ['']),
    '## `/hima status`',
    '',
    '```',
    statusText || 'not run',
    '```',
    '',
    '## The campaign workspace, left on the site',
    '',
    `- Workspace: \`${show(workspace)}\``,
    `- Container: \`${show(containerName)}\``,
    '',
    'Left in place as evidence. Nothing in this harness removes a path on a Site; removing this workspace, and the container of that name, is the site owner\'s call.',
    '',
    `The isolated harness home this run used, holding the ledger every record here was read from, is \`${h.home}\`. It is left in place for the same reason.`,
    '',
    '## Checks',
    '',
    'Every one of these is stated from what was observed. Nothing here is assumed, and a check that could not be evaluated is a failure.',
    '',
    ...checks.flatMap((c) => [
      `### ${c.outcome === 'pass' ? 'PASS' : 'FAIL'} — ${c.id}`,
      '',
      c.what,
      '',
      `*Predicate:* ${c.predicate}`,
      '',
      `*Observed:* ${c.observed}`,
      '',
    ]),
    '## Restart',
    '',
    webHostsSkipped !== ''
      ? `The two web hosts were not booted: ${webHostsSkipped}`
      : restartError
      ? `The run could NOT be read back after a restart: ${restartError}`
      : viewBefore !== '' && viewBefore === viewAfter && recordsBefore === recordsAfter
        ? "After stopping the web host and booting another on the same home, the run view and every one of the Run's records read back unchanged."
        : "The run view or the Run's records DIFFERED after the restart.",
    '',
    '## The read-only probe of the site',
    '',
    `- \`${before.command}\` → ${show(lastPeriodNs)} ns, sha256 \`${show(before.observation?.contentSha256)}\``,
    afterProbe ? `- \`${afterProbe.command}\` → ${show(afterPeriodNs)} ns, sha256 \`${show(afterProbe.observation?.contentSha256)}\`` : '- the report was not re-read: nothing was launched',
    `- Campaign workspaces go under \`${workspaceRootOnSite || `${workspaceRoot} (unresolved: ${resolvedWorkspaceRoot.error})`}\`, and the site's own flow is at \`${flowRootOnSite || `${flowRoot} (unresolved: ${resolvedFlowRoot.error})`}\`, as the site itself resolves them.`,
    `- One job at a time: ${
      quiet.asked
        ? `${quiet.detail}; read as busy: ${quiet.busyPanes.length === 0 ? `none of ${quiet.panes.length} pane(s)` : quiet.busyPanes.map((p) => `\`${p.line}\` — ${p.because}`).join('; ')}`
        : `the probe could not be made: ${quiet.detail}`
    }`,
    '',
    `## Every command this harness asked site \`${site.name}\` to run`,
    '',
    'Taken from HimaChannel\'s own audit, drained into this record as the run went on. On an ssh Site every read is a `cat` or a `realpath` here; a local Site is reached without ssh, where reading a file and resolving a path spawn nothing and so are not commands at all.',
    '',
    ...(audit.length === 0 ? ['None.'] : audit.map((c) => `- (${c.phase}) \`${c.wire}\``)),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

finish();
