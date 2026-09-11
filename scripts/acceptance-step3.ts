// Step-3 acceptance run (issue #31): one real multi-generation Campaign of the opene902 timing probe
// on a Site, started from the workbench window through the desktop shell's driver mode, and
// recorded. Writes <out>/<date>-step3-acceptance.{md,json} beside a screenshot of the ended card,
// and exits non-zero when any check failed.
//
// The step-2 twin (`acceptance-step2.ts`) ran one generation, driven through a booted host's chat
// and web faces. This one runs the Campaign: several generations, each one synthesizing at the
// period the last one's chooser picked, until the Goal is met or the exploration has converged —
// and it starts that Campaign the way an engineer does. The seam is the window (D42, ADR-0004): the
// same Electron main process a person runs, started with `--driver`, which prepares nothing this
// script has not prepared, launches the real dsh host, exchanges the token in its own window's
// session, and then answers requests on its standard input. The form is filled, `start` is clicked,
// and what is watched is the card the window renders.
//
// Four things carry the safety of pointing this at a customer's machine, three of them step 2's:
//
//   - Nothing is assumed. Every claim in the record is a check with its predicate written out and
//     its outcome taken from what was observed; a check that could not be evaluated is a failure,
//     never a pass. A failed check writes the record and exits non-zero.
//   - The Site is probed read-only first, and the launch is gated on what the probe found: the
//     Site's own last result, which the target period is derived from, whether both of the Site's
//     roots resolve, and whether anything is already running there — the site owner's rule is one
//     large DC or Innovus job at a time.
//   - The Campaign is driven through the product and nothing else: the window's own start form, the
//     window's own card, and the routes the window reads, with the session the shell established.
//     What this script reaches for directly is data, not drive: `loadSite`/`loadPack` to know where
//     the Site's own flow root and Loop bounds are, and `channelFor` for the probes that have no
//     face — `realpath`, the tmux question, and reading the Campaign's report back off the Site —
//     which the channel itself confines to its own read-only verbs.
//   - The Campaign has a Budget, and the record says what it spent against what it was allowed.
//
// One thing about the audit, because it is two processes here where step 2's was one. HimaChannel's
// audit of every command sent to a Site is per process, and the process that drives this Campaign is
// the dsh host inside the desktop shell, not this one. So the record's audit is drained from both:
// this script's own, in process, and the host's over `POST /hima/api/audit/drain` — every two seconds
// while the Campaign runs and after every phase, so that neither audit's rolling window can evict a
// launch line before it is read. Each entry says which process sent it and in which phase.
//
// The Campaign workspace, its container and its report are left on the Site, as evidence. Nothing in
// this harness removes a path on a Site; removal is the Site owner's call, and the record says so.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { bootDriver, type BootedDriver } from '../test/contract/support/driver.ts';
import { createHimaHome, repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { api as himaApi } from '../test/contract/support/hima-api.ts';
import { requireOpene902Fixture } from '../test/contract/support/opene902-fixtures.ts';
import { installPack, timingProbePackId } from '../test/contract/support/pack.ts';
import { installReferenceSite, writeLocalSite } from '../test/contract/support/site.ts';
import { writeStandinFlow } from '../test/contract/support/standin-flow.ts';
import {
  boundInputs,
  channelFor,
  clearRemoteCommands,
  containerNameFor,
  defaultRetryAllowance,
  EXPERIENCE_DIR,
  EXPERIENCE_SCHEMA,
  flowDirName,
  hasEnded,
  loadPack,
  loadSite,
  outputPath,
  quote,
  remoteCommands,
  remoteCommandWindow,
  remoteCommandWindowFilled,
  roundNs,
  versionLine,
  type AuditView,
  type Channel,
  type DecisionRecord,
  type ExperienceAnswer,
  type GenerationView,
  type JobRecord,
  type LedgerRecord,
  type ObservationRecord,
  type Pack,
  type PackNode,
  type RunStatus,
  type RunView,
  type SemanticValue,
  type Site,
  type VerdictRecord,
  type WorkspaceRecord,
} from '@hima/harness';

// ---------------------------------------------------------------------------------------------
// What this run was asked for.
// ---------------------------------------------------------------------------------------------

const usage = [
  'usage: node scripts/acceptance-step3.ts [--site <name>] [--target <ns>] [--time-box <minutes>] [--generations <n>] [--out <dir>]',
  '  --site         linglong, the committed reference site, or local, the stand-in flow this repository generates. Default linglong.',
  "  --target       the clock period the campaign is asked to close at, in ns. Default: the period the site's own qor report states, minus 0.2.",
  "  --time-box     the Campaign's budget in minutes, for the whole Loop and not one generation. Default 30.",
  "  --generations  how many generations the Loop may open. Default: the pack's own converge.generationLimit.",
  '  --out          the directory the record and the card screenshot are written into. Default docs/validation/ in this repository.',
].join('\n');

/** How much tighter than the Site's last result the first generation is asked to close, in ns. */
const defaultStepNs = 0.2;
/**
 * The band a clock period has to be in for this script to ask a Site for it, in ns. Step 2's band,
 * for step 2's reason: a period is a number a person types, `.207` for `2.07` is one keystroke away,
 * every guard downstream would let it through, and the Site would spend a licence and a 32-core
 * machine grinding at an unsatisfiable constraint until the time box killed it. A Campaign makes
 * that worse rather than better — it would grind at it once per generation — so both the `--target`
 * option and the period derived from the Site's own last result have to land inside
 * `minTargetNs ≤ target ≤ maxTargetMultiple × last`.
 */
const minTargetNs = 0.5;
const maxTargetMultiple = 2;
/** The Budget this Campaign runs under when the caller names none, in minutes. */
const defaultTimeBoxMinutes = 30;
/**
 * How much longer than its own time box the Campaign may take to show an ending in the window before
 * this script gives up on it.
 *
 * The Budget bounds the Campaign, not the 56 MB flow copy that precedes its first Job, and not the
 * time the fabric takes to notice a spent meter and write the ending; the window then has to render
 * it. Generous, because the cost of the two mistakes is not symmetric: waiting too long costs this
 * script minutes, and giving up too early would abandon a Campaign that is still running on the Site
 * — and abandoning one is not stopping one.
 */
const watchHeadroomMs = 20 * 60_000;
/**
 * How long the window is given, after the click, to show either a campaign's card or the form's own
 * refusal.
 *
 * The route the form posts to answers when the Run reaches `running`, and a Run reaches `running`
 * only once its Campaign workspace has been prepared — on the reference Site a 56 MB copy of the
 * flow over ssh. So this bounds a file copy and not a synthesis, and it is generous for the same
 * reason step 2's command headroom is: the Budget bounds the Campaign, never the preparation that
 * precedes it. Nothing is *waited* out by this number in the case it exists for — a refusal reaches
 * the page's own `start-error` region and is read within a quarter of a second — it bounds only the
 * case where the window shows neither, which is a page that will not answer at all.
 */
const startGraceMs = 20 * 60_000;
/** How often the window is asked whether the campaign has started, and how often that is said aloud
 *  while it has not: a long silence during the flow copy is a run nobody can tell from a hung one. */
const startPollMs = 1_000;
const startSaidEveryMs = 30_000;
/** How long each turn of the watch waits for the window to show an ending before it says where the
 *  Campaign stands and waits again. Progress on the console, not a bound: the bound is the sum. */
const watchSliceMs = 30_000;
/** How often both audits are drained while the Campaign runs. How big a window each of them is is
 *  `remoteCommandWindow`, the bundle's own number, so this script cannot state a window nobody had. */
const drainEveryMs = 2_000;
/**
 * The window the ended card is photographed through. 1200 wide, so the content column is shown at
 * its full width; 900 tall, which is what the whole verdict band, the convergence plot and the
 * generation ledger are laid out to fit inside. The same size `scripts/workbench-screenshot.ts`
 * photographs the card at, so the picture in a record is the picture in the design's own evidence.
 */
const WINDOW = { width: 1200, height: 900 } as const;
/** The words every ended status is said in on the card's verdict band — `ended — goal met`,
 *  `ended — converged`, and their two siblings. What the window is watched for. */
const ENDED_ON_THE_CARD = 'ended — ';
/** The two rules the shipped pack's judge node applies, in the order it lists them. */
const setupRuleId = 'setup-wns-all-nonnegative';
const goalRuleId = 'clock-period-at-most';
/** The options this script's own site names. */
const knownOptions = ['--site', '--target', '--time-box', '--generations', '--out'];

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
const generationsOverride = numeric('--generations', option('--generations'));
if (generationsOverride !== undefined && !Number.isInteger(generationsOverride)) {
  fail(`invalid --generations "${String(generationsOverride)}"; expected a whole number of generations, one or more\n${usage}`);
}
// Resolved here, once. This process writes the two documents, but the *shell* writes the card's
// picture, and its working directory is the isolated home's workspace — a relative `--out`
// would put the picture somewhere nobody named and the record would point at nothing.
const outDir = path.resolve(option('--out') ?? path.join(repoRoot, 'docs/validation'));

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

/** One command HimaChannel asked the Site to run: which process sent it, in which phase of this
 *  script, and what the Site received. `host` is the dsh host inside the desktop shell — the process
 *  that drives the Campaign; `script` is this one, which sends only read-only probes. */
interface AuditEntry { readonly phase: string; readonly from: 'host' | 'script'; readonly argv: readonly string[]; readonly wire: string }
const audit: AuditEntry[] = [];
/** Whether either process's rolling window has been full since a drain — whether either list has
 *  lost a command before it was read. Either one is fatal to `every-remote-command-recorded`. */
const auditWindowFilled = { script: false, host: false };
/** Why the host's audit could not be drained, if it ever could not. An audit with a hole in it is
 *  not an audit, so this fails the check rather than being swallowed. */
let auditDrainError = '';
/**
 * Where the host that is driving the Campaign answers its routes, or undefined when there is none to
 * ask: before the first shell has booted, and between the first shell quitting and the second
 * answering. Set and cleared beside the boots themselves, so a drain never asks a host that is on
 * its way out — and the phase before a quit is drained first, because a host's audit dies with it.
 */
let auditHost: { readonly url: string; readonly cookie: string } | undefined;

/**
 * Take everything both processes have recorded since the last drain, and clear both.
 *
 * Two audits, because there are two processes and HimaChannel's audit is per process: this script's
 * own, which holds its read-only probes, and — over `POST /hima/api/audit/drain` — the host's, which
 * holds everything the Campaign asked the Site to do. Each entry keeps which side it came from, so
 * the record can list them apart and the checks can ask different things of each.
 *
 * Each audit is a bounded rolling window (`remoteCommandWindow` entries) and draining is exact where
 * merging snapshots would not be — the window carries no sequence numbers, so two samples of a
 * repeating poll cannot be aligned with certainty. Each side reads and clears in one step with
 * nothing awaited between, so no command can be recorded into the gap.
 */
async function drainNow(phase: string): Promise<void> {
  const mine = remoteCommands();
  const filled = remoteCommandWindowFilled();
  clearRemoteCommands();
  if (filled) auditWindowFilled.script = true;
  for (const c of mine) audit.push({ phase, from: 'script', argv: c.argv, wire: c.wire });

  if (auditHost === undefined) return;
  try {
    const answered = await himaApi({ url: auditHost.url }, auditHost.cookie, '/hima/api/audit/drain', { method: 'POST' });
    const text = await answered.text();
    if (answered.status !== 200) throw new Error(`POST /hima/api/audit/drain answered ${String(answered.status)}: ${text}`);
    const taken = JSON.parse(text) as AuditView;
    if (taken.windowFilled) auditWindowFilled.host = true;
    for (const c of taken.commands) audit.push({ phase, from: 'host', argv: c.argv, wire: c.wire });
  } catch (err) {
    auditDrainError = `${auditDrainError ? `${auditDrainError}; ` : ''}(${phase}) ${(err as Error).message}`;
  }
}

/**
 * One side's commands, in the order they were sent.
 *
 * A function over the audit rather than two arrays, because the record is written on every path out
 * — including the gate's, which refuses before the checks section is reached — and a `const` in that
 * section would be a record that cannot be written for a run that was refused, which is a run with
 * no evidence.
 */
const sentBy = (from: 'host' | 'script'): readonly AuditEntry[] => audit.filter((c) => c.from === from);

/**
 * Every drain, one after another: the timer's and the phase boundaries' alike.
 *
 * Draining the host is a request, so two of them can be in flight at once — and two POSTs to a drain
 * route would split one phase's commands between two answers, each of which clears what the other
 * was about to read. They still all arrive, but which phase a command is recorded under would then
 * depend on the network. Chained, they cannot overlap and the order of the record is the order the
 * commands were sent in.
 */
let draining: Promise<void> = Promise.resolve();
const drain = (phase: string): Promise<void> => {
  draining = draining.then(() => drainNow(phase));
  return draining;
};

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
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** `3 generations`, `1 generation`: a count and the noun it counts, so a record reads as a sentence
 *  and not as a form. */
const counted = (n: number, noun: string): string => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

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

/**
 * The name all three of this run's files share, decided once, before anything is written.
 *
 * `<date>-step3-acceptance` is the name a record wants: one acceptance run of one date. A second run
 * on the same date gets `<date>-step3-acceptance-<HHMMSS>` instead — a re-run that failed must not
 * be able to overwrite the record of one that passed, and a record is evidence, so this script never
 * replaces one it finds. Decided here rather than at the end, unlike step 2's, because the record
 * names a screenshot that is taken while the run is still going: the picture and the two documents
 * are one record and must carry one name.
 */
const recordBase = ((): { readonly base: string; readonly taken: boolean } => {
  const plain = `${date}-step3-acceptance`;
  const taken = existsSync(path.join(outDir, `${plain}.md`)) || existsSync(path.join(outDir, `${plain}.json`));
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  return { base: taken ? `${plain}-${stamp}` : plain, taken };
})();
/** Where the ended card's picture goes, named in the record beside the two documents. */
const cardShotAt = path.join(outDir, `${recordBase.base}-card.png`);

const record: Record<string, unknown> = {
  date,
  issue: 31,
  script: 'scripts/acceptance-step3.ts',
  versions: { harness: versionLine(), node: process.version },
  commit,
  commitDirty,
};

/** Write the record in both shapes and leave with the exit code the checks earned. */
function finish(): never {
  record.checks = checks;
  record.remoteCommands = audit.map((c) => ({ phase: c.phase, from: c.from, wire: c.wire }));
  record.auditWindowFilled = { ...auditWindowFilled };
  record.auditDrainError = auditDrainError || undefined;
  const failed = checks.filter((c) => c.outcome === 'fail');
  record.outcome = failed.length === 0 ? 'every check passed' : `${failed.length} of ${checks.length} checks failed`;
  mkdirSync(outDir, { recursive: true });
  record.recordFiles = {
    markdown: `${recordBase.base}.md`,
    json: `${recordBase.base}.json`,
    cardScreenshot: `${recordBase.base}-card.png`,
    dateAlreadyHadARecord: recordBase.taken,
  };
  const jsonAt = path.join(outDir, `${recordBase.base}.json`);
  const markdownAt = path.join(outDir, `${recordBase.base}.md`);
  writeFileSync(jsonAt, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(markdownAt, markdown());
  console.log(
    failed.length === 0
      ? 'STEP-3 ACCEPTANCE: every check passed'
      : `STEP-3 ACCEPTANCE FAILED:\n- ${failed.map((c) => `${c.id}: ${c.observed}`).join('\n- ')}`,
  );
  if (recordBase.taken) console.log(`a record for ${date} was already there; this one was written beside it, not over it`);
  console.log(`record: ${markdownAt}`);
  console.log(`record: ${jsonAt}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------
// Setting the Site up in an isolated home.
// ---------------------------------------------------------------------------------------------

/** A skip is not available to a script: what a driver test skips on, this reports as the reason it
 *  could do nothing at all. */
const noSkip = {
  skip: (reason?: string) => {
    throw new Error(`this run needs what a driver test needs, and this machine has not got it: ${reason ?? 'no reason given'}`);
  },
} as unknown as TestContext;

/** One driver answer, or the reason it was refused, said with what was asked for. */
function ok<T>(what: string, answer: ({ readonly ok: true } & T) | { readonly ok: false; readonly error: string }): T {
  if (!answer.ok) throw new Error(`${what}: ${answer.error}`);
  return answer;
}

/**
 * What the local stand-in's own last result is seeded to say, in ns.
 *
 * The stand-in closes at 2.20 ns, and this script's own arithmetic asks for `last − 0.2`. Seeding
 * the last result at exactly what the flow closes at makes the first generation ask for 2.00 —
 * tighter than this flow will ever close — so the Campaign misses and keeps exploring. That is what
 * makes the local dry run able to exercise a multi-generation Loop rather than merely reach one: a
 * target of `2.47 − 0.2`, which is what step 2's script seeds, is met at the first generation and
 * proves nothing about a Loop.
 *
 * With method version 2, starting at 2.00 ns proposes 2.15 after the violation and
 * repeats 2.15, so the local dry run converges with setup still failing. The recorded
 * verdicts must remain FAIL; this is not evidence that the unreachable Goal was met.
 * Real reference-site behavior needs its own current validation.
 */
const standinLastResultNs = 2.2;
/** The clock period the pinned opene902 qor fixture states, which the seed above replaces. */
const fixtureLastResultNs = 2.27;

/**
 * The isolated home this run uses, with the Site bound and the shipped pack installed.
 *
 * `linglong` is the site file and permit this repository commits, installed the way a customer's CAD
 * would. `local` is the stand-in the contract suite runs against: the generated flow, a site file
 * binding it, and — seeded here, and only here — a "last result" qor report in the flow root, which
 * is what the reference Site's own Design Zoo already has and what the read-only probe reads the
 * target period from.
 *
 * The home is made here rather than by `bootDriver`, which would seed a stand-in flow on every boot
 * and remove the home on the way out. Both boots below join *this* home (`bootDriver`'s `existing`),
 * so the second shell reads back what the first one wrote and neither of them disposes the evidence.
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
  const states = `Critical Path Clk Period:      ${String(fixtureLastResultNs)}`;
  const seeded = text.replace(states, `Critical Path Clk Period:      ${String(standinLastResultNs)}`);
  if (seeded === text) throw new Error(`the pinned qor fixture at ${fixture} states no ${String(fixtureLastResultNs)} ns clock period to seed a last result from`);
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

/** What an Explore node declares convergence to be. Taken off the pack's own node type rather than
 *  named again here, so a pack schema that gains a knob gains it in this script's arithmetic too. */
type ExploreConverge = NonNullable<Extract<PackNode, { kind: 'explore' }>['parameters']['converge']>;

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
 * licence — and a Campaign would do it once per generation. A pane is busy when
 *
 *   - its session is one of this harness's own (`hima-` prefix); or
 *   - its command half names the Site's own flow root — a job in the Design Zoo is the site owner's
 *     job whatever binary is in the foreground; or
 *   - its command half names one of the tools above; or
 *   - its command half holds `make` and `synth` together, which is exactly how the flow's own
 *     README says to start a synthesis here.
 */
function busyBecause(line: string, siteFlowRoot: string): string {
  const command = paneCommands(line);
  if (paneSession(line).startsWith('hima-')) return "its session is one of this harness's own (hima- prefix)";
  if (siteFlowRoot !== '' && command.includes(siteFlowRoot)) return `its command names the site's own flow root ${siteFlowRoot}`;
  const tool = largeJobTools.find((t) => command.includes(t));
  if (tool !== undefined) return `its command names ${tool}`;
  if (command.includes('make') && command.includes('synth')) return 'its command runs make with a synth target';
  return '';
}

/**
 * Ask tmux what is running on the Site.
 *
 * Asked through HimaChannel, which admits `tmux` as job plumbing and refuses every verb that is not
 * its own — so this probe cannot become anything but a question, on either kind of Site, and it is
 * recorded at the wire like every other command this process sends. tmux exits 1 when there is no
 * server at all, which is the quietest answer there is; any other non-zero exit is a probe that
 * failed, and is reported as such rather than as an empty list.
 */
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

/** One observe of the Site's own last result, and the observation it recorded. */
interface LastResult {
  readonly command: string;
  readonly runId?: string;
  readonly observation?: RunView['observations'][number];
  readonly error?: string;
}

/**
 * Read the Site's own last result, read-only, over the observe route with the shell's own session.
 *
 * The same operation `/hima observe` performs, asked the way the window asks it: the route the
 * window's own session reaches, behind the same fence as everything else here. It appends a Probe
 * campaign Run of its own to the ledger — a Run HimaFabric never started, which is how the run list
 * tells it from the Campaign below — and nothing on the Site but the read.
 */
async function readLastResult(
  read: (target: string, init?: RequestInit) => Promise<{ status: number; text: string }>,
  at: string,
  what: string,
): Promise<LastResult> {
  const command = `POST /hima/api/observe { site: ${siteName}, path: ${at}, reader: dc-qor-report }`;
  try {
    const answered = await read('/hima/api/observe', {
      method: 'POST',
      body: JSON.stringify({ site: siteName, path: at, reader: 'dc-qor-report' }),
      headers: { 'content-type': 'application/json' },
    });
    if (answered.status !== 200) return { command, error: `${what}: the route answered ${String(answered.status)}: ${answered.text}` };
    const view = JSON.parse(answered.text) as RunView;
    const observation = view.observations[view.observations.length - 1];
    if (!observation) return { command, runId: view.run.id, error: `${what}: the route succeeded but recorded no observation` };
    return { command, runId: view.run.id, observation };
  } catch (err) {
    return { command, error: `${what}: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------------------------
// Everything the record is written from. Declared here because the record is written on every path
// out of this script, the read-only probe refusing to clear the Site included.
// ---------------------------------------------------------------------------------------------

/**
 * The shell this run drives, while it is up.
 *
 * Declared here, before anything can throw, because a throw past the boot must not leave a window
 * and a dsh host behind: an orphaned host goes on holding whatever Job it launched on the Site, and
 * nothing this script started may outlive it unasked. The two handlers below are the whole of that
 * promise — they stop the shell the way it stops itself and then leave with the code an unhandled
 * fault deserves.
 */
let shell: BootedDriver | undefined;
const stopTheShell = async (): Promise<void> => {
  const stopping = shell;
  shell = undefined;
  if (stopping) await stopping.dispose().catch(() => undefined);
};
for (const fault of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(fault, (err: unknown) => {
    console.error(`the step-3 acceptance run failed: ${String(err)}`);
    void stopTheShell().finally(() => process.exit(2));
  });
}

/**
 * What is typed into the window's own start form, control by control. Filled in once the read-only
 * probe has the target; empty until then, because the record is written on the probe's own path out
 * too and a record that could not be written is a run with no evidence at all.
 */
let form: Readonly<Record<string, string>> = {};
/** What the form was filled with, read back out of the document control by control. */
const formHeld: Record<string, string> = {};
let startError = '';
/** How the Campaign was watched, turn by turn, for the record and for the console. */
const watch: string[] = [];
let watchError = '';
let runId: string | undefined;
let view: RunView | undefined;
let records: readonly LedgerRecord[] = [];
let workspace: string | undefined;
let containerName: string | undefined;
let experienceAnswer: ExperienceAnswer | undefined;
let experienceError = '';
/** Both report files as the Site itself holds them, read back through the channel's `cat`. */
let reportOnSite: { readonly markdown?: { sha256: string; bytes: number }; readonly json?: { sha256: string; bytes: number }; readonly error: string } = { error: '' };
let shownReport: { readonly text: string; readonly state: Readonly<Record<string, string>> } | undefined;
let shownReportError = '';
let cardShot: { readonly path: string; readonly width: number; readonly height: number; readonly bytes: number } | undefined;
let cardShotError = '';
let afterProbe: LastResult | undefined;
let afterPeriodNs: number | undefined;
let restartError = '';
let viewBefore = '';
let viewAfter = '';
let recordsBefore = '';
let recordsAfter = '';
let experienceBefore = '';
let experienceAfter = '';
let reportAfterOnSite: { readonly markdown?: { sha256: string; bytes: number }; readonly json?: { sha256: string; bytes: number }; readonly error: string } = { error: '' };
/** One row of the record's generations table per Generation the Loop opened. */
const generations: Generation[] = [];
/** Every Job the Campaign launched, and every workspace record it wrote, once they are read. */
let launchedJobs: readonly JobRecord[] = [];
let workspaceRecords: readonly WorkspaceRecord[] = [];
/** The first heading of the report's own Markdown, as the file on the Site opens with it. */
let reportHeading = '';

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
const stepNs = explore?.parameters.bind.stepNs;
const converge: ExploreConverge | undefined = explore?.parameters.converge;
const generationLimit = generationsOverride ?? converge?.generationLimit;
if (generationLimit === undefined) {
  fail(`pack ${pack.id} declares no converge.generationLimit for this script to default --generations to; give one\n${usage}`);
}
const retryAllowance = defaultRetryAllowance;
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
record.pack = { id: pack.id, version: pack.contract.version, stepNs, converge };
record.home = h.home;

if (site.kind === 'ssh' && site.ssh) {
  try {
    execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', site.ssh.destination, 'true'], { stdio: 'ignore' });
  } catch {
    fail(`site ${site.name} is unreachable at ${site.ssh.destination} (LAN only); acceptance not run`);
  }
}

console.log(`step-3 acceptance on site ${site.name}; home ${h.home}`);
mkdirSync(outDir, { recursive: true });

// The seam. One shell, joining the home prepared above: it makes nothing, seeds nothing, and — being
// a boot that joined rather than made — removes nothing on the way out.
shell = await bootDriver(noSkip, { existing: h, window: WINDOW });
if (!shell) throw new Error('the desktop shell did not boot in driver mode');
const first = shell;
const hostAnswer = ok('host', await first.host());
const cookie = await first.cookie();
clearRemoteCommands();
// From here on there is a second process asking this Site things — the host inside the shell, which
// is the one that will drive the Campaign — and its audit is drained with this script's own. Drained
// once now, before the probe: this home holds no Run, so a host coming up on it reconciles nothing
// and asks the Site for nothing, and that is a claim, so it is put on the record under its own phase
// rather than assumed.
auditHost = { url: hostAnswer.url, cookie };
await drain('the boot');

/** One request to the host over the routes, with the session the shell established. */
const read = async (target: string, init: RequestInit = {}): Promise<{ status: number; text: string }> => {
  const answered = await himaApi({ url: hostAnswer.url }, cookie, target, init);
  return { status: answered.status, text: await answered.text() };
};
/** One JSON read of a route that must have answered 200. */
const readJson = async <T>(target: string, what: string): Promise<T> => {
  const answered = await read(target);
  if (answered.status !== 200) throw new Error(`GET ${target} answered ${String(answered.status)} ${what}: ${answered.text}`);
  return JSON.parse(answered.text) as T;
};

// ---- Read-only probe: the Site's last result, where its workspaces go, and what is running ----

const before = await readLastResult(read, lastResultAt, "the site's last result could not be read");
await drain('read-only probe');
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
    await first.dispose();
    fail(
      `the clock period this campaign would ask the site for, ${targetNs} ns (${targetFrom}), is outside the band this script will ask for: ${bandInWords}`
        + ` — with the site's last result at ${show(lastPeriodNs)} ns, that band is ${minTargetNs} ns to ${show(bandTopNs)} ns.`
        + ' Nothing was launched and no record was written: the site was read read-only and nothing else.',
    );
  }
}

check(
  'last-result-read',
  "The site's own last result was read, read-only, before anything else was done to the site.",
  `\`POST /hima/api/observe\` with \`{ site: ${siteName}, path: ${lastResultAt}, reader: dc-qor-report }\`, over the routes with the session the shell established, answers 200 and its observation states a \`clock_period\`. The desktop shell was booted before this probe and the window opened on a home holding no Run at all, so a host coming up here reconciles nothing and asks the site for nothing; the probe is still the first thing this run asks of the site, and the launch is still gated on it.`,
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
    ? `The campaign's first generation was asked for a clock period derived from the site's own last result: last − ${defaultStepNs} ns. Tighter than last follows from that derivation; this check does not confirm it independently.`
    : "The campaign's first generation was asked for a clock period tighter than the site's last result.",
  (targetOverrideNs === undefined
    ? `The site's last result states a clock period, and the target asked for is \`last − ${defaultStepNs}\` rounded to 3 decimals — the derivation, stated.`
    : '`--target` was given, so the target is that number, and it is checked here to be < last.')
    + ` The target is also inside the sanity band — ${bandInWords}, and a plain decimal — which is enforced before the launch: a period outside it exits 2 with no record and nothing asked of the site beyond this probe. Later generations ask for whatever the chooser picked, which is what a Loop is; those periods are checked one by one below.`,
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
await drain('read-only probe');

// The roots are what every later check measures against — the workspace every generation must be
// inside, the flow root every copy must come from — and an unresolved one turns each of those into a
// failure discovered *after* several real synthesis runs. So it is a gate, not a check to read
// afterwards.
const rootsResolved = check(
  'site-roots-resolved',
  "Both roots this site names resolved on the site itself before anything was launched: where campaign workspaces go, and where the site's own flow is.",
  '`realpath` of the site\'s `workspaceRoot` and of its `flowRoot`, asked through HimaChannel, each answered a path. Every later check measures against these two, so a root that does not resolve stops the launch here rather than failing checks after a campaign has already run.',
  workspaceRootOnSite !== '' && flowRootOnSite !== '',
  `workspaceRoot ${workspaceRoot} → ${workspaceRootOnSite || 'unresolved'}; flowRoot ${flowRoot} → ${flowRootOnSite || 'unresolved'}`
    + (resolvedWorkspaceRoot.error || resolvedFlowRoot.error
      ? `; ${[resolvedWorkspaceRoot.error, resolvedFlowRoot.error].filter(Boolean).join('; ')}`
      : ''),
);

const siteIsQuiet = check(
  'one-job-at-a-time',
  "Every tmux session and every tmux pane on the site was listed and read, and none of them carries a job of this harness or a large EDA job of the site's own.",
  'tmux on the site lists no session whose name begins with `hima-`, and no pane that any of four patterns reads as busy: its session name begins with `hima-`; or its command half — `pane_current_command` and `pane_start_command` together, which is where the tool, the design and the target are — names the site\'s own resolved flow root, or names one of `'
    + `${largeJobTools.join('`, `')}\`, or holds \`make\` and \`synth\` together. Those are the shapes a large job is launched in here: the flow runs Design Compiler through \`make\` and a container, so \`dc_shell\` is never the string on the pane, and matching on it alone would clear a site that is busy. A probe that could not be made is a failure, never a quiet site. Asked once, before the launch: a Campaign holds the site for several generations, and this says the site was free when it took it, not that nobody arrived afterwards — the Site's own job cap is what bounds that, and the Budget's meters are what say what this Campaign held.`,
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
record.request = { targetPeriodNs: targetNs, targetFrom, timeBoxMinutes, generationLimit, retryAllowance };

// The launch needs four facts, not three: the site quiet, both roots resolved, a target, and the
// site's last result actually read — without the last result the target band has no ceiling and the
// premise "tighter than the site's last result" was never established, so a `--target` alone must
// not launch.
if (!siteIsQuiet || !rootsResolved || targetNs === undefined || lastPeriodNs === undefined) {
  console.error('nothing was launched: the read-only probe did not clear the site for a campaign');
  await first.dispose();
  finish();
}

// ---- The Campaign, started from the window ----

// What the form is typed with, in the order the page asks for it.
form = {
  'start-pack': pack.id,
  'start-site': siteName,
  'start-target': String(targetNs),
  'start-knob-periodNs': String(targetNs),
  'start-time-box': String(timeBoxMinutes),
  'start-retries': String(retryAllowance),
  'start-generations': String(generationLimit),
};

console.log(`starting from the window: ${JSON.stringify(form)}`);
ok('open the workbench', await first.open('/hima/'));
for (const [control, value] of Object.entries(form)) {
  formHeld[control] = ok(`fill ${control}`, await first.fill(control, value)).value;
}
// The audits are drained from the click onwards, in the background, every `drainEveryMs`.
//
// Not from the ending of the start poll below, as this phase's boundary drain would suggest: the
// workspace preparation and the Job's launch are sent by the host while the form is still posting,
// and a Job that is waited on costs the host two commands a look. A Campaign long enough would evict
// its own launch line from a `remoteCommandWindow`-entry window before this script ever read it,
// which is the one line the audit exists to hold. The phase moves with the script; the guard skips a
// tick that arrives while the last drain is still in flight, because draining the host is a request
// and a queue of them is not more evidence than the one already on its way.
let samplerPhase = 'the start';
let samplerBusy = false;
const sampler = setInterval(() => {
  if (samplerBusy) return;
  samplerBusy = true;
  void drain(samplerPhase).finally(() => { samplerBusy = false; });
}, drainEveryMs);

ok('click start', await first.click('start'));

// Did it start? The page posts the form and, on an answer that names a Run, takes the window to
// that Run's card; on a refusal it leaves the words in its own `start-error` region and the form
// where it stands. So the card's own region appearing is what says a Campaign began, and a refusal
// is read where the page put it — without this, a form the route would not accept would be waited
// out for the whole time box and the headroom, which is most of an hour of nothing happening.
const clickedAt = Date.now();
let saidAt = clickedAt;
for (;;) {
  if ((await first.read('run-status')).ok) break;
  const refusal = await first.read('start-error');
  if (refusal.ok && refusal.text.trim() !== '') { startError = refusal.text.trim(); break; }
  if (Date.now() - clickedAt >= startGraceMs) {
    startError = `the window neither opened a campaign's card nor showed a refusal within ${String(startGraceMs / 60_000)} minutes of the click`;
    break;
  }
  if (Date.now() - saidAt >= startSaidEveryMs) {
    saidAt = Date.now();
    const waiting = `${((saidAt - clickedAt) / 1000).toFixed(0)} s since the click, and the form is still posting: the campaign's workspace is being prepared on the site`;
    watch.push(`${new Date().toISOString()} starting — ${waiting}`);
    console.log(`  ${waiting}`);
  }
  await new Promise((r) => setTimeout(r, startPollMs));
}
if (startError !== '') console.error(`the start was refused: ${startError}`);
await drain('the start');
samplerPhase = 'the campaign';

// The Campaign is watched through the window: the verdict band, waited on until it says one of the
// four endings. The sampler above goes on draining both audits while it does.
const watchDeadline = Date.now() + timeBoxMinutes * 60_000 + watchHeadroomMs;
let endedOnTheCard: { readonly text: string; readonly state: Readonly<Record<string, string>> } | undefined;
try {
  while (startError === '') {
    const left = watchDeadline - Date.now();
    if (left <= 0) {
      watchError = `the window never showed an ending: ${timeBoxMinutes} minutes of time box plus ${watchHeadroomMs / 60_000} minutes of headroom went by. The campaign was left alone — abandoning a Run is not stopping one — and what the site is doing is the site owner's to see.`;
      break;
    }
    const waited = await first.wait('run-status', ENDED_ON_THE_CARD, Math.min(watchSliceMs, left));
    if (waited.ok) { endedOnTheCard = { text: waited.text, state: waited.state }; break; }
    // Not yet. Where does the Campaign stand? A Run waiting for a person will not end on its own,
    // and waiting out the whole box on one would be a wait for something that cannot happen.
    const standing = await first.read('run-status');
    const status = standing.ok ? standing.state.status : undefined;
    const line = standing.ok ? (standing.text.split('\n')[0] ?? '').trim() : standing.error;
    watch.push(`${new Date().toISOString()} ${show(status)} — ${line}`);
    console.log(`  ${show(status)} — ${line}`);
    if (status === 'waiting') {
      watchError = 'the campaign is waiting for a person: a Hard blocker stopped it, and it will not end on its own. Nothing here clears a blocker.';
      break;
    }
    if (status !== undefined && hasEnded(status as RunStatus)) { endedOnTheCard = { text: standing.ok ? standing.text : '', state: standing.ok ? standing.state : {} }; break; }
  }
} catch (err) {
  watchError = `the window could not be watched: ${(err as Error).message}`;
} finally {
  clearInterval(sampler);
  await drain('the campaign');
}

// The Run's id, off the page's own run list, where a person reads it too.
//
// The list marks each row with its Run's status under the Run's own id, and only a Run HimaFabric
// started has one — the observe probe above left a Probe campaign Run on that list, which carries
// none. So the Campaign is the row that carries a status, and reading the ids out of the list's
// *text* instead would as happily hand back the probe's. Exactly one such row is expected, because
// this home is this run's own and this run started one Campaign in it; two would mean the id is a
// guess, and a guess is not evidence.
try {
  ok('open the run list', await first.open('/hima/'));
  const listed = ok('read the run list', await first.read('runs'));
  const started = Object.keys(listed.state).filter((k) => k.startsWith('run-'));
  if (started.length === 0) throw new Error(`the run list names no campaign HimaFabric started: ${listed.text}`);
  if (started.length > 1) throw new Error(`the run list names ${String(started.length)} campaigns and this script started one: ${started.join(', ')}`);
  runId = started[0];
} catch (err) {
  watchError = `${watchError ? `${watchError}; ` : ''}${(err as Error).message}`;
}
await drain('reading the run back');

record.campaign = {
  form,
  formHeld,
  startError: startError || undefined,
  watch,
  watchError: watchError || undefined,
  runId,
  endedOnTheCard: endedOnTheCard?.state.status,
};

// ---- What the Campaign left, read over the routes with the shell's own session ----

if (runId !== undefined) {
  try {
    view = await readJson<RunView>(`/hima/api/runs/${encodeURIComponent(runId)}`, 'over the first shell');
    records = (await readJson<{ records: LedgerRecord[] }>(`/hima/api/runs/${encodeURIComponent(runId)}/records`, 'over the first shell')).records;
    viewBefore = canonical(view);
    recordsBefore = canonical(records);
  } catch (err) {
    watchError = `${watchError ? `${watchError}; ` : ''}${(err as Error).message}`;
  }
}

const campaignId = view?.run.campaignId;
workspaceRecords = records.filter((r): r is WorkspaceRecord => r.type === 'workspace');
workspace = workspaceRecords[workspaceRecords.length - 1]?.workspace;
containerName = workspaceRecords[workspaceRecords.length - 1]?.containerName;

// The ended card, photographed, and the report the window shows on it. Both are what a person sees,
// so both are read on the card page and not on the list.
if (runId !== undefined) {
  try {
    ok('open the card', await first.open(`/hima/?run=${encodeURIComponent(runId)}`));
    const shown = await first.wait('run-status', ENDED_ON_THE_CARD, watchSliceMs);
    if (shown.ok) endedOnTheCard = { text: shown.text, state: shown.state };
    cardShot = ok('screenshot the ended card', await first.screenshot(cardShotAt));
    console.log(`card: ${cardShot.path}  ${String(cardShot.width)}×${String(cardShot.height)}  ${String(cardShot.bytes)} bytes`);
  } catch (err) {
    cardShotError = (err as Error).message;
  }
  const report = await first.read('run-experience');
  if (report.ok) shownReport = { text: report.text, state: report.state };
  else shownReportError = report.error;

  try {
    const answered = await read(`/hima/api/runs/${encodeURIComponent(runId)}/experience`);
    if (answered.status !== 200) experienceError = `GET .../experience answered ${String(answered.status)}: ${answered.text}`;
    else experienceAnswer = JSON.parse(answered.text) as ExperienceAnswer;
  } catch (err) {
    experienceError = (err as Error).message;
  }
  experienceBefore = canonical(view?.experience);
}
await drain('reading the report back');

/**
 * Both report files as the Site itself holds them, hashed here.
 *
 * Read through HimaChannel's `cat`, which is one of its two read-only probes: this is the same
 * question the experience route asks, asked from this process so that what the record states about
 * the files is this script's own reading of them and not a second copy of the route's answer.
 */
async function readReportOffTheSite(): Promise<typeof reportOnSite> {
  const files = view?.experience;
  if (!files) return { error: 'the run carries no experience record, so there are no files to read' };
  try {
    const channel = channelFor(site);
    const md = await channel.readFile(files.markdown.path);
    const js = await channel.readFile(files.json.path);
    return {
      markdown: { sha256: sha256(md), bytes: md.byteLength },
      json: { sha256: sha256(js), bytes: js.byteLength },
      error: '',
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
reportOnSite = await readReportOffTheSite();
await drain('reading the report off the site');

// The one report the target was derived from, read again. Read after the Campaign and before the
// restart, so what it is held against is the same file read by the same route at both ends.
afterProbe = await readLastResult(read, lastResultAt, "the site's last result could not be re-read");
afterPeriodNs = afterProbe.observation ? numberOf(afterProbe.observation.values, 'clock_period') : undefined;
await drain('read-back');

// ---- The restart: this shell quits, another joins the same home ----

if (runId === undefined) {
  restartError = 'no campaign was read back, so there was nothing to restart onto. The second shell was not booted.';
} else {
  let second: BootedDriver | undefined;
  try {
    // A host's audit dies with the host, so the first one is drained before it is told to quit — and
    // nothing asks it afterwards, which is what clearing this is for: a drain of a shell on its way
    // out would be recorded as a failure to drain rather than as the nothing it is.
    await drain('before the restart');
    auditHost = undefined;
    ok('quit the first shell', await first.quit());
    await first.exit();
    shell = undefined;
    second = await bootDriver(noSkip, { existing: h, window: WINDOW });
    if (!second) throw new Error('the second shell did not boot');
    shell = second;
    const later = ok('host', await second.host());
    const laterCookie = await second.cookie();
    // The second host is now the one this Site could be asked things by, so it is the one drained.
    auditHost = { url: later.url, cookie: laterCookie };
    const readLater = async <T>(target: string, what: string): Promise<T> => {
      const answered = await himaApi({ url: later.url }, laterCookie, target);
      const text = await answered.text();
      if (answered.status !== 200) throw new Error(`GET ${target} answered ${String(answered.status)} ${what}: ${text}`);
      return JSON.parse(text) as T;
    };
    const againView = await readLater<RunView>(`/hima/api/runs/${encodeURIComponent(runId)}`, 'after the restart');
    const againRecords = (await readLater<{ records: LedgerRecord[] }>(`/hima/api/runs/${encodeURIComponent(runId)}/records`, 'after the restart')).records;
    viewAfter = canonical(againView);
    recordsAfter = canonical(againRecords);
    experienceAfter = canonical(againView.experience);
  } catch (err) {
    restartError = `${restartError ? `${restartError}; ` : ''}${(err as Error).message}`;
  }
}
reportAfterOnSite = runId === undefined ? { error: 'no campaign to read a report of' } : await readReportOffTheSite();
await drain('the restart');

// ---------------------------------------------------------------------------------------------
// What the Campaign did, checked.
// ---------------------------------------------------------------------------------------------

const rows: readonly GenerationView[] = view?.generations ?? [];
const rowOf = (n: number): GenerationView | undefined => rows.find((g) => g.generation === n);
/** Every record of one Generation of the *outer* Loop: the shipped pack drills nowhere and forks
 *  nowhere, so a record carrying either is a record of a shape this check was not written for. */
const ofGeneration = (n: number): readonly LedgerRecord[] =>
  records.filter((r) => r.generation === n && r.loopId === undefined);
launchedJobs = records.filter((r): r is JobRecord => r.type === 'job' && r.event === 'launched');

check(
  'started-from-the-window',
  "The campaign was started by filling the window's own start form and clicking start, and what was typed into it is the Run's goal, its first Strategy and its Budget.",
  `Each of the seven controls the workbench marks — \`${Object.keys(form).join('`, `')}\` — was filled through the page and read back holding what it was given; \`start\` was clicked; and the Run the host started carries \`goal.target_period_ns\` = the target typed, a first Strategy of the period typed (which is generation one's asked period on the card's own ledger), a time box of the minutes typed, the retry allowance typed and the generation limit typed. Nothing here posts to a route to start anything: what starts the Campaign is the page's own form.`,
  Object.entries(form).every(([control, value]) => formHeld[control] === value)
    && startError === ''
    && view !== undefined
    && view.run.goal?.target_period_ns === targetNs
    && rowOf(1)?.strategy.periodNs === targetNs
    && view.run.budget?.timeBoxMs === timeBoxMinutes * 60_000
    && view.run.budget.retryAllowance === retryAllowance
    && view.run.budget.generationLimit === generationLimit,
  view === undefined
    ? `no run view was read: ${watchError || 'nothing said why'}`
    : `the form held ${JSON.stringify(formHeld)}${startError ? `; the form was refused: ${startError}` : ''}`
      + `; the run's goal ${JSON.stringify(view.run.goal)}, first strategy ${JSON.stringify(rowOf(1)?.strategy)}, budget ${JSON.stringify(view.run.budget)}`,
);

check(
  'at-least-three-generations',
  'The campaign ran several generations of its Loop, not one: three at least.',
  'The run row says which generation it ended in, and the card\'s own ledger has one row per generation the Loop opened. Both are at least three, and they agree — three is what makes this a Campaign and not the single generation step 2 proved (D40): a first strategy, at least one the chooser picked from what was measured, and at least one more measured against the one before it, which is the least a convergence rule can be decided over.',
  view !== undefined && (view.run.generation ?? 0) >= 3 && rows.length >= 3 && rows.length === view.run.generation,
  view === undefined ? 'no run view was read' : `the run row says generation ${show(view.run.generation)}; the ledger has ${rows.length} row(s): ${rows.map((r) => `g${String(r.generation)} ${show(Number(r.strategy.periodNs))}→${show(r.observedPeriodNs)}`).join(', ')}`,
);

/** One knob of a generation's Strategy as a number, or nothing where the row carries a word: this
 *  script's subject is the shipped pack, whose one knob is a period (#58). */
const numberKnob = (value: number | string | undefined): number | undefined => (typeof value === 'number' ? value : undefined);

const status = view?.run.status;
const endingDecision = records.findLast((r): r is DecisionRecord => r.type === 'decision');
const convergedBy = endingDecision && 'converged' in endingDecision.chosen ? endingDecision.chosen.converged : undefined;
check(
  'ended-goal-met-or-converged',
  'The campaign ended for the one of two reasons step 3 is declared done by: the Goal was met, or the exploration converged — the window said so, and the record says which, and by what rule when it converged.',
  'The card the window rendered showed an ended status, waited for on its own `run-status` region, and that status is the one the Run carries: what ended this Campaign was watched where a person would watch it, not only read off a route afterwards. The status is `ended-goal-met` or `ended-converged`. On `ended-converged` the last decision on the ledger carries the whole rule the pack declared — which read, what band, over how many generations, and the measured values compared — and those match the pack\'s own `converge` block, so the ending is re-derivable from this record alone. The other three endings a Run can reach are not this: `ended-goal-not-met` is a graph out of edges, `ended-budget-exhausted` is a meter running out before the exploration had its answer, and `cancelled` is a person.',
  watchError === ''
    && endedOnTheCard !== undefined
    && endedOnTheCard.state.status === status
    && (status === 'ended-goal-met' || status === 'ended-converged')
    && (status === 'ended-goal-met'
      || (convergedBy !== undefined
        && converge !== undefined
        && convergedBy.read === converge.read
        && convergedBy.band === converge.band
        && convergedBy.generations === converge.generations
        && convergedBy.values.length === converge.generations + 1
        && convergedBy.values.slice(1).every((v, i) => roundNs(Math.abs(v - convergedBy.values[i]!)) < converge.band))),
  status === undefined
    ? `no status was read${watchError ? `: ${watchError}` : ''}`
    : `the card showed ${show(endedOnTheCard?.state.status)}${watchError ? ` — ${watchError}` : ''}; the run carries ${status}${convergedBy
        ? `: ${convergedBy.read} moved by less than ${String(convergedBy.band)} over ${String(convergedBy.generations)} generation(s), at ${convergedBy.values.join(' then ')}`
          + `; the pack declares ${JSON.stringify(converge)}`
        : ''}`
      + `${status === 'ended-budget-exhausted' ? `, ended by ${show(view?.run.meters?.endedBy)}` : ''}`,
);

// ---- Every generation, one by one ----

/**
 * The chooser's three clauses and the pack's convergence rule, re-derived here from the two verdicts
 * and the measured numbers, so what is on the ledger is compared with what `over-constraining-push` and the
 * pack declare rather than with a guess.
 *
 * This is the one place in this script that restates in TypeScript something the harness ships as
 * data (D38), and it is deliberate: an independent check is worth nothing if it is the same code
 * evaluating the same file, so the clauses are read off `choosers/over-constraining-push.yml` and the pack's
 * `converge:` by a person and written out here by hand. It is a check of the numbers the harness
 * produced, never a second implementation for the harness to use — nothing outside this script
 * imports it. The order is the chooser's own: the goal-met clause first, then convergence, then the
 * clause that computes a next period. The rounding is the one thing taken from the bundle
 * (`roundNs`): "three decimals" is a convention the two sides must share to be comparable at all.
 */
function chooserWouldChoose(
  constraint: string,
  goal: string,
  periodNs: number,
  slackNs: number,
  earlier: readonly number[],
): { readonly chosen: unknown; readonly how: string } | undefined {
  if (stepNs === undefined) return undefined;
  if (constraint === 'PASS' && goal === 'PASS') {
    return { chosen: { goalMet: true }, how: 'the constraint and the goal both passed, so there is no next strategy' };
  }
  if (constraint !== 'PASS' && constraint !== 'FAIL') return undefined;
  if (converge !== undefined) {
    const compared = [...earlier, periodNs].slice(-(converge.generations + 1));
    if (compared.length === converge.generations + 1) {
      // Rounded, as the harness rounds it and as the decision record states it: at exactly one
      // band apart the raw doubles fall on either side of the comparison depending on which two
      // periods they are, and a check that disagreed with the record there would be checking a
      // different rule from the one the pack declared.
      const moves = compared.slice(1).map((v, i) => roundNs(Math.abs(v - compared[i]!)));
      if (moves.every((m) => m < converge.band)) {
        return {
          chosen: { converged: { read: converge.read, band: converge.band, generations: converge.generations, values: compared } },
          how: `the ${converge.read} of the last ${String(converge.generations + 1)} generations, ${compared.join(' then ')}, moved by ${moves.map((m) => String(m)).join(', ')} — every one below the band of ${String(converge.band)}`,
        };
      }
    }
  }
  return constraint === 'PASS'
    ? {
        chosen: { strategy: { periodNs: roundNs(periodNs - stepNs) } },
        how: `period − step = ${periodNs} − ${stepNs}`,
      }
    : {
        chosen: { strategy: { periodNs: roundNs(periodNs + Math.abs(slackNs) - stepNs) } },
        how: `period + |slack| − step = ${periodNs} + ${Math.abs(slackNs)} − ${stepNs}`,
      };
}

/** What one generation of the Loop was asked for, what it measured, what was concluded and decided. */
interface Generation {
  readonly n: number;
  readonly askedNs?: number;
  readonly observation?: ObservationRecord;
  readonly observedPeriodNs?: number;
  readonly observedSlackNs?: number;
  readonly setupVerdict?: VerdictRecord;
  readonly goalVerdict?: VerdictRecord;
  readonly decision?: DecisionRecord;
  readonly expected?: { readonly chosen: unknown; readonly how: string };
  readonly wallMs?: number;
}

// A generation that was never read is still a generation this record must account for, so a Campaign
// that produced none is checked as one that produced nothing rather than skipped: five failures that
// say what was missing, in the place the reader looks for them.
const generationNumbers = rows.length > 0 ? rows.map((r) => r.generation) : [1];
for (const n of generationNumbers) {
  const mine = ofGeneration(n);
  const setupVerdict = mine.findLast((r): r is VerdictRecord => r.type === 'verdict' && r.ruleId === setupRuleId);
  const goalVerdict = mine.findLast((r): r is VerdictRecord => r.type === 'verdict' && r.ruleId === goalRuleId);
  // The observation the verdicts actually cite, so that a retried `read-qor` cannot have these
  // checks measuring one attempt while the verdicts and the decision are written from another; the
  // generation's latest when they cite none.
  const cited = [setupVerdict, goalVerdict].flatMap((v) => v?.cites ?? []);
  const observations = mine.filter((r): r is ObservationRecord => r.type === 'observation');
  const observation = observations.findLast((o) => cited.includes(o.id)) ?? observations[observations.length - 1];
  const observedPeriodNs = observation ? numberOf(observation.values, 'clock_period') : undefined;
  const observedSlackNs = observation ? numberOf(observation.values, 'setup_wns') : undefined;
  const decision = mine.findLast((r): r is DecisionRecord => r.type === 'decision');
  const earlier = generationNumbers
    .filter((k) => k < n)
    .flatMap((k) => {
      const value = generations.find((g) => g.n === k)?.observedPeriodNs;
      return value === undefined ? [] : [value];
    });
  const expected = setupVerdict && goalVerdict && observedPeriodNs !== undefined && observedSlackNs !== undefined
    ? chooserWouldChoose(setupVerdict.outcome, goalVerdict.outcome, observedPeriodNs, observedSlackNs, earlier)
    : undefined;
  generations.push({
    n,
    askedNs: numberKnob(rowOf(n)?.strategy.periodNs),
    observation,
    observedPeriodNs,
    observedSlackNs,
    setupVerdict,
    goalVerdict,
    decision,
    expected,
    wallMs: rowOf(n)?.wallMs,
  });
}

for (const g of generations) {
  const at = `g${String(g.n)}`;
  check(
    `${at}-observed-period-is-the-asked`,
    `Generation ${g.n}'s own report states the clock period that generation was asked for.`,
    'The observation this generation read out of the Campaign workspace — the one its verdicts cite, or its latest when they cite none — states a `clock_period` equal to the Strategy this generation was asked for.'
      + (g.n === 1
        ? ' Generation one was opened by no decision: what it asked for is the run row\'s `firstStrategy`, written once when the Run was opened, which is the period the start form was filled with.'
        : ` Generation ${String(g.n)} asked for whatever generation ${String(g.n - 1)}'s decision chose, which is checked as its own claim below.`)
      + ' That period is the one the report\'s *clock* path group states: a Design Compiler qor report also has built-in groups (`**default**` and its kind) that state a period of their own and often hold the worst slack, and a period read from one of those would be no period the design was synthesized at.',
    g.observedPeriodNs !== undefined && g.askedNs !== undefined && g.observedPeriodNs === g.askedNs,
    g.observation === undefined
      ? `generation ${String(g.n)} recorded no observation`
      : `asked ${show(g.askedNs)} ns; ${g.observation.path} states ${show(g.observedPeriodNs)} ns`,
  );

  check(
    `${at}-setup-verdict-follows-the-measurement`,
    `Generation ${g.n}'s setup rule verdict follows from the slack that generation measured, and cites the observation it was read from.`,
    `The \`${setupRuleId}\` verdict of this generation is PASS exactly when its observation's \`setup_wns\` is at least 0, and it cites that observation.`,
    g.setupVerdict !== undefined
      && g.observedSlackNs !== undefined
      && g.observation !== undefined
      && g.setupVerdict.outcome === (g.observedSlackNs >= 0 ? 'PASS' : 'FAIL')
      && g.setupVerdict.cites.includes(g.observation.id),
    g.setupVerdict === undefined
      ? `generation ${String(g.n)} recorded no setup verdict`
      : `setup_wns ${show(g.observedSlackNs)} ns, verdict ${g.setupVerdict.outcome}, cites ${g.setupVerdict.cites.join(', ')}`,
  );

  check(
    `${at}-goal-verdict-follows-the-measurement`,
    `Generation ${g.n}'s goal rule verdict follows from the period that generation measured and the Run's own goal, and cites the observation.`,
    `The \`${goalRuleId}\` verdict of this generation is bound to the Run's \`target_period_ns\`, is PASS exactly when its observation's \`clock_period\` is at most that target, and cites that observation. The target is the Campaign's and does not move between generations — a Loop explores toward one Goal, and a new goal is a new Campaign (D3).`,
    g.goalVerdict !== undefined
      && g.observedPeriodNs !== undefined
      && g.observation !== undefined
      && g.goalVerdict.boundParameters?.target_period_ns === targetNs
      && g.goalVerdict.outcome === (g.observedPeriodNs <= targetNs ? 'PASS' : 'FAIL')
      && g.goalVerdict.cites.includes(g.observation.id),
    g.goalVerdict === undefined
      ? `generation ${String(g.n)} recorded no goal verdict`
      : `clock_period ${show(g.observedPeriodNs)} ns against ${JSON.stringify(g.goalVerdict.boundParameters)}, verdict ${g.goalVerdict.outcome}, cites ${g.goalVerdict.cites.join(', ')}`,
  );

  const citesWanted = g.setupVerdict && g.goalVerdict && g.observation
    ? [g.setupVerdict.id, g.goalVerdict.id, g.observation.id]
    : undefined;
  check(
    `${at}-decision-follows-the-chooser`,
    `Generation ${g.n}'s decision is the one \`over-constraining-push\` and the pack's convergence rule declare for these two verdicts and these measured values, and it cites both verdicts and the observation.`,
    'One decision, by chooser `over-constraining-push`, taken in the chooser\'s own order: `{goalMet: true}` when the constraint and the goal both passed; else `{converged: {read, band, generations, values}}` when the pack\'s `converge` block has enough generations to compare and each of the last `generations` moves of the measured period is strictly below the band; else `{strategy: {periodNs: period − step}}` when the constraint passed and the goal did not, and `{strategy: {periodNs: period + |slack| − step}}` when the constraint failed, each rounded to 3 decimals — with `period` and `slack` read from this generation\'s observation, `step` the exploration step the pack binds, and the earlier generations\' measured periods taken from this same record. Its `rationale` is those numbers, and its `cites` are the setup verdict, the goal verdict and the observation, in that order.',
    g.decision !== undefined
      && g.expected !== undefined
      && citesWanted !== undefined
      && g.decision.chooser === 'over-constraining-push'
      && canonical(g.decision.chosen) === canonical(g.expected.chosen)
      && canonical(g.decision.cites) === canonical(citesWanted)
      && g.decision.rationale.period === g.observedPeriodNs
      && g.decision.rationale.slack === g.observedSlackNs
      && g.decision.rationale.stepNs === stepNs,
    g.decision === undefined
      ? `generation ${String(g.n)} recorded no decision`
      : `${g.decision.chooser} chose ${JSON.stringify(g.decision.chosen)}; the chooser's and the pack's own clauses give ${
          g.expected ? `${JSON.stringify(g.expected.chosen)} (${g.expected.how})` : 'nothing derivable from these verdicts'
        }; rationale ${JSON.stringify(g.decision.rationale)}; cites ${g.decision.cites.join(', ')}`,
  );

  const next = generations.find((x) => x.n === g.n + 1);
  const chose = g.decision && 'strategy' in g.decision.chosen ? g.decision.chosen.strategy.periodNs : undefined;
  const endedAtTheLimit = status === 'ended-budget-exhausted' && view?.run.meters?.endedBy === 'generation-limit';
  check(
    `${at}-next-period-follows-the-decision`,
    next
      ? `Generation ${g.n + 1} asked the flow for exactly the period generation ${g.n}'s decision chose.`
      : `Generation ${g.n} was the last, and the record says why no generation followed it.`,
    'Following a revisit edge is one write of the run row — the target node, the next generation and the Strategy the decision chose, together — so a generation that follows a decision asks for that decision\'s period and no other number. Where a generation follows, its asked period equals the previous decision\'s `chosen.strategy.periodNs`. Where none follows, the last decision chose no next Strategy at all (the Goal was met, or the exploration converged) — or it chose one and the Budget\'s generation limit refused to open the generation that would have tried it, which is an ending the decision stays on record for.',
    next
      ? chose !== undefined && next.askedNs === chose
      : g.decision !== undefined && (chose === undefined || endedAtTheLimit),
    next
      ? `generation ${String(g.n)} chose ${show(chose)} ns; generation ${String(next.n)} asked for ${show(next.askedNs)} ns`
      : g.decision === undefined
        ? `generation ${String(g.n)} recorded no decision, so nothing says why the campaign stopped here`
        : `generation ${String(g.n)} chose ${JSON.stringify(g.decision.chosen)} and no generation followed it; the run ended ${show(status)}${endedAtTheLimit ? ` at the generation limit of ${show(view?.run.budget?.generationLimit)}` : ''}`,
  );
}

// ---- What the Campaign left on the Site ----

const expectedWorkspace = workspaceRootOnSite && campaignId ? paths.join(workspaceRootOnSite, campaignId) : undefined;
const makeInFlow = workspace ? [quote('make'), quote('-C'), quote(`${workspace}/${flowDirName}`)].join(' ') : '';
const jobsPerGeneration = generationNumbers.map((n) => launchedJobs.filter((j) => j.generation === n).length);
const everyJobInTheWorkspace = launchedJobs.length > 0
  && workspace !== undefined
  && launchedJobs.every((j) => j.job.workspace === workspace
    && j.job.wire.includes(makeInFlow)
    && j.job.wire.includes(quote(`EDA_CONTAINER_NAME=${containerName ?? ''}`)));

check(
  'every-generation-in-one-workspace',
  "Every generation's synthesis Job ran inside the one Campaign workspace, through `make` in tmux, under a container of this Campaign's own and never the site's.",
  'Every `workspace` record of this Run names the same workspace, and that workspace is `<workspaceRoot>/<campaignId>` with `<workspaceRoot>` as the site itself resolves it; its `containerName` is `hima-<campaignId>`; every generation launched at least one Job; and every Job the Run launched has that path as its own `workspace`, runs `make -C <workspace>/flow` on its command line, and carries `EDA_CONTAINER_NAME=` that same container name. One workspace across the whole Loop is what makes a Campaign a Campaign rather than several runs that share a goal: the flow is copied once, and each generation synthesizes in the copy the last one left.',
  workspace !== undefined
    && expectedWorkspace !== undefined
    && workspace === expectedWorkspace
    && campaignId !== undefined
    && containerName === containerNameFor(campaignId)
    && workspaceRecords.every((r) => r.workspace === workspace && r.containerName === containerName)
    && jobsPerGeneration.every((count) => count >= 1)
    && everyJobInTheWorkspace,
  workspace === undefined
    ? `no workspace record: ${records.length} record(s) read`
    : `workspace ${workspace} (expected ${show(expectedWorkspace)}), container ${show(containerName)} (expected ${show(campaignId && containerNameFor(campaignId))})`
      + `; ${String(workspaceRecords.length)} workspace record(s), all naming it: ${workspaceRecords.every((r) => r.workspace === workspace) ? 'yes' : 'NO'}`
      + `; jobs per generation: ${jobsPerGeneration.map((c, i) => `g${String(generationNumbers[i] ?? i + 1)}=${String(c)}`).join(', ')}`
      + `; every job in the workspace under that container: ${everyJobInTheWorkspace ? 'yes' : 'no'}`
      + `; wires: ${launchedJobs.map((j) => j.job.wire).join(' | ')}`,
);

const under = (p: string, root: string): boolean => root !== '' && (p === root || p.startsWith(`${root}${paths.sep}`));
/** Every path this Campaign is on record as having been given to write, and where it landed. */
const written: { where: string; what: string }[] = [];
if (workspace !== undefined) written.push({ where: workspace, what: 'the campaign workspace the preparation made' });
for (const j of launchedJobs) {
  written.push({ where: j.job.workspace, what: `the working directory of job ${j.job.session}` });
  written.push({ where: `${j.job.workspace}/${j.job.session}.log`, what: `the log of job ${j.job.session}` });
  written.push({ where: `${j.job.workspace}/${j.job.session}.exit`, what: `the exit status of job ${j.job.session}` });
}
if (view?.experience) {
  written.push({ where: view.experience.markdown.path, what: "the report's markdown" });
  written.push({ where: view.experience.json.path, what: "the report's json" });
}
const strayWrites = written.filter((w) => workspace === undefined || !under(w.where, workspace));
const jobFilesOnTheWire = launchedJobs.every((j) =>
  j.job.wire.includes(quote(`${j.job.workspace}/${j.job.session}.log`)) && j.job.wire.includes(quote(`${j.job.workspace}/${j.job.session}.exit`)));
const campaignObservations = records.filter((r): r is ObservationRecord => r.type === 'observation');
const strayReads = campaignObservations.filter((o) => workspace === undefined || !under(o.path, workspace));

// The other half of this check, and step 2's own: not where the ledger says the campaign wrote, but
// what the campaign's own process *asked the site to run* — every write verb of it, off the host's
// audit, with the path each was given.
const writeVerbs = (c: AuditEntry): boolean => c.argv[0] === 'mkdir' || c.argv[0] === 'cp' || c.argv[0] === 'tee';
const isLaunch = (c: AuditEntry): boolean => c.argv[0] === 'tmux' && c.argv[1] === 'new-session';
/** What a write verb was given to write: the last word of the command, as every one of the three
 *  spells it (`mkdir -p <dir>`, `cp -R -- <src> <dst>`, `tee <file>`). */
const writeTarget = (c: AuditEntry): string => c.argv[c.argv.length - 1] ?? '';
/** Where a launch was told to run: tmux's own `-c`, which the Permit decided before the launch. */
const launchDir = (c: AuditEntry): string => (c.argv.indexOf('-c') > 0 ? c.argv[c.argv.indexOf('-c') + 1] ?? '' : '');
const hostSent = sentBy('host');
const scriptSent = sentBy('script');
const hostWrites = hostSent.filter(writeVerbs);
const strayHostWrites = hostWrites.filter((c) => workspace === undefined || !under(writeTarget(c), workspace));
const strayCopySources = hostSent
  .filter((c) => c.argv[0] === 'cp')
  .map((c) => c.argv[c.argv.length - 2] ?? '')
  .filter((s) => !under(s, flowRootOnSite));
const strayLaunchDirs = hostSent.filter(isLaunch).map(launchDir).filter((d) => workspace === undefined || !under(d, workspace));
const thisProcessWrote = scriptSent.filter((c) => writeVerbs(c) || isLaunch(c));

check(
  'nothing-written-outside-the-workspace',
  'Every write the campaign asked the site to make landed inside its own workspace, every path the ledger records as written is inside it too, every report the campaign read came out of it, and this script itself asked the site to write nothing at all.',
  'Two readings of the same thing, and both have to hold. **What was sent**: every `mkdir`, `cp` and `tee` the campaign\'s own host asked the site to run — drained from that host\'s audit over `POST /hima/api/audit/drain` — has its write target, the last word of the command, inside `<workspaceRoot>/<campaignId>`; every `cp` reads from inside the site\'s own flow root, as the site resolves it; and every `tmux new-session` names the Campaign workspace as its working directory (`-c`), which is what puts the Job\'s own `make -C <workspace>/flow` there. HimaChannel runs no other verb that writes. **What was left**: the Campaign workspace, every Job\'s working directory, every Job\'s log and exit file — named on the Job\'s own command line, as the site received it — and both files of the report are inside that same directory, and every observation this Run recorded was read from inside it. And this script\'s own process ran no write verb and no launch at all, its audit holding read-only probes and nothing else. '
    + 'What `make` and the tools it starts write once a Job is running is not covered by either reading: that is inside the Job, where this harness sees only the log and the exit status, and it is the flow\'s own doing — bounded by where the flow copy is (D19).',
  workspace !== undefined
    && written.length > 0
    && strayWrites.length === 0
    && strayReads.length === 0
    && launchedJobs.length > 0
    && jobFilesOnTheWire
    && hostWrites.length > 0
    && strayHostWrites.length === 0
    && strayCopySources.length === 0
    && strayLaunchDirs.length === 0
    && thisProcessWrote.length === 0,
  `${hostWrites.length} write command(s) sent (${hostWrites.map((c) => c.argv[0]).join(', ')})`
    + `; write targets outside ${show(workspace)}: ${strayHostWrites.length === 0 ? 'none' : strayHostWrites.map(writeTarget).join(', ')}`
    + `; copy sources outside ${show(flowRootOnSite || flowRoot)}: ${strayCopySources.length === 0 ? 'none' : strayCopySources.join(', ')}`
    + `; launches outside the workspace: ${strayLaunchDirs.length === 0 ? 'none' : strayLaunchDirs.join(', ')}`
    + `; ${written.length} recorded write target(s), outside it: ${strayWrites.length === 0 ? 'none' : strayWrites.map((w) => `${w.where} (${w.what})`).join(', ')}`
    + `; ${campaignObservations.length} observation(s) read, outside it: ${strayReads.length === 0 ? 'none' : strayReads.map((o) => o.path).join(', ')}`
    + `; each job's log and exit file named on its own wire: ${jobFilesOnTheWire ? 'yes' : 'no'}`
    + `; commands this script sent that write: ${thisProcessWrote.length === 0 ? 'none' : thisProcessWrote.map((c) => c.wire).join(', ')}`,
);

check(
  'site-flow-root-untouched',
  "The one report the target was derived from is unchanged in content and length. Only that file: the rest of the site's own flow root is never read here, so nothing is claimed about it.",
  `The same report, \`${lastResultAt}\`, read read-only before the campaign and after it over the same route, has the same sha256, the same byte count and the same stated clock period. That is this one file in the site's own flow root, not the flow root: no other file under it is read, and a rewrite that reproduced these same bytes would not be caught. (HimaChannel's read-only probes are \`cat\` and \`realpath\`; there is no \`stat\` on that list, and adding one would be a verb granted on a customer's site for this script's sake, so content and length are what this is said by.)`,
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

// ---- The Campaign's technical report ----

const files = view?.experience;
const expectedReportDir = workspace === undefined ? undefined : `${workspace}${paths.sep}${EXPERIENCE_DIR}`;
const reportWhereItBelongs = files !== undefined
  && expectedReportDir !== undefined
  && runId !== undefined
  && files.markdown.path === paths.join(expectedReportDir, `${runId}.md`)
  && files.json.path === paths.join(expectedReportDir, `${runId}.json`);

check(
  'report-on-the-site-beside-the-results',
  "The campaign's technical report is on the site under the campaign workspace, beside the results, and both files are exactly what the ledger says they are.",
  `Both files are at \`<workspace>/${EXPERIENCE_DIR}/<runId>.md\` and \`.json\`; each was read back off the site through HimaChannel's \`cat\` — a read-only probe — and hashes to the \`sha256\` the Run's \`experience\` record states, at the byte count it states; and \`GET /hima/api/runs/<id>/experience\`, which reads them back the same way from the host and verifies both hashes itself, answers 200 with that same record and a report whose schema is \`${EXPERIENCE_SCHEMA}\`. The record is the claim that the files are there (D44), so a record without the files, or files that no longer hash to it, is a failure here.`,
  reportWhereItBelongs
    && reportOnSite.error === ''
    && reportOnSite.markdown?.sha256 === files?.markdown.sha256
    && reportOnSite.markdown.bytes === files?.markdown.bytes
    && reportOnSite.json?.sha256 === files?.json.sha256
    && reportOnSite.json.bytes === files?.json.bytes
    && experienceError === ''
    && experienceAnswer !== undefined
    && experienceAnswer.experience.markdown.sha256 === files?.markdown.sha256
    && experienceAnswer.experience.json.sha256 === files?.json.sha256
    && experienceAnswer.report.schema === EXPERIENCE_SCHEMA,
  files === undefined
    ? 'the run carries no experience record'
    : `${files.markdown.path} sha256 ${files.markdown.sha256} (${String(files.markdown.bytes)} bytes); ${files.json.path} sha256 ${files.json.sha256} (${String(files.json.bytes)} bytes)`
      + `; where the record says: ${reportWhereItBelongs ? 'yes' : 'NO'}`
      + `; read off the site: ${reportOnSite.error || `markdown ${show(reportOnSite.markdown?.sha256)} (${show(reportOnSite.markdown?.bytes)} bytes), json ${show(reportOnSite.json?.sha256)} (${show(reportOnSite.json?.bytes)} bytes)`}`
      + `; the experience route: ${experienceError || `schema ${show(experienceAnswer?.report.schema)}, ${String(experienceAnswer?.markdown.length ?? 0)} characters of markdown`}`,
);

reportHeading = experienceAnswer?.markdown.split('\n')[0]?.replace(/^#\s*/, '') ?? '';
check(
  'window-shows-the-report',
  'The window shows the campaign\'s report on the ended card, what it shows is the report that is on the site, and the card is a picture beside this record.',
  'The card\'s `run-experience` region is there on the ended Run; its `-sha256` state is the Markdown file\'s own hash and its `-written-at` the instant both files state as their own; and its rendered text carries the report\'s first heading, as the file on the site opens with it. What the page renders is composed from the same run view the record was written from (D44), so this is the document on the site and not a second account of it. The same window then painted the ended card into the PNG named beside this record, which is what makes the claim something a reader can look at rather than only read: a picture that was not taken is a claim this record does not get to make.',
  shownReportError === ''
    && cardShotError === ''
    && cardShot !== undefined
    && cardShot.bytes > 0
    && shownReport !== undefined
    && files !== undefined
    && shownReport.state.sha256 === files.markdown.sha256
    && shownReport.state['written-at'] === files.writtenAt
    && reportHeading !== ''
    && shownReport.text.includes(reportHeading),
  shownReportError !== ''
    ? `the card shows no report: ${shownReportError}`
    : `-sha256 ${show(shownReport?.state.sha256)} (the file's is ${show(files?.markdown.sha256)}), -written-at ${show(shownReport?.state['written-at'])} (the record's is ${show(files?.writtenAt)})`
      + `; the report's first heading "${reportHeading}" is in what the window rendered: ${shownReport !== undefined && reportHeading !== '' && shownReport.text.includes(reportHeading) ? 'yes' : 'no'}`
      + `; the ended card was photographed to ${cardShotError === '' && cardShot ? `${cardShot.path} (${String(cardShot.width)}×${String(cardShot.height)}, ${String(cardShot.bytes)} bytes)` : `NOTHING: ${cardShotError}`}`,
);

check(
  'report-reproduces-the-card',
  "The report a program reads holds the very numbers the card showed: the campaign's generations, row for row.",
  'The `generations` of the JSON file on the site are, element for element, the `generations` of the run view the window rendered the card from — each row\'s asked and observed period, its slack, its verdicts, its decision in the card\'s own words, its wall time and its state. A report whose numbers differ from the card\'s is a report of a different Campaign, however plausible its arithmetic.',
  experienceAnswer !== undefined
    && view !== undefined
    && rows.length > 0
    && canonical(experienceAnswer.report.generations) === canonical(view.generations),
  experienceAnswer === undefined
    ? `the report could not be read: ${experienceError || 'no reason given'}`
    : `${experienceAnswer.report.generations.length} row(s) in the file, ${rows.length} on the card; identical: ${
        view !== undefined && canonical(experienceAnswer.report.generations) === canonical(view.generations) ? 'yes' : 'NO'
      }`,
);

check(
  'restart-reads-back-unchanged',
  'After the window was quit and another shell booted on the same home, the whole campaign reads back unchanged, and its report is re-served rather than written again.',
  'The first shell was told to quit and its process ended; a second shell was booted on the same home, which is a second dsh host over the same HimaLedger. `GET /hima/api/runs/<id>` and `GET .../records` answer over it exactly what they answered over the first — the run row, every generation, every record. The `experience` record is the same record, with the same `writtenAt` and the same two hashes, so no second report was written; and both files, read off the site again through `cat`, still hash to it. '
    + '(What is *not* said here is that the files\' modification times are unchanged: `stat` is not one of HimaChannel\'s two read-only probes, and adding one would be a verb granted on a customer\'s site for this script\'s sake. What stands in its place is stronger about the thing that matters — one `experience` record, one `writtenAt`, and the same bytes on the site — and weaker about nothing but the timestamp.)',
  restartError === ''
    && viewBefore !== ''
    && viewBefore === viewAfter
    && recordsBefore === recordsAfter
    && experienceBefore !== ''
    && experienceBefore === experienceAfter
    && reportAfterOnSite.error === ''
    && reportAfterOnSite.markdown?.sha256 === files?.markdown.sha256
    && reportAfterOnSite.json?.sha256 === files?.json.sha256,
  restartError !== ''
    ? restartError
    : `run view ${viewBefore === viewAfter ? 'identical' : 'DIFFERED'}, ${records.length} records ${recordsBefore === recordsAfter ? 'identical' : 'DIFFERED'}`
      + `, experience record ${experienceBefore === experienceAfter ? 'identical' : 'DIFFERED'}`
      + `; the files after the restart: ${reportAfterOnSite.error || `markdown ${show(reportAfterOnSite.markdown?.sha256)}, json ${show(reportAfterOnSite.json?.sha256)}`}`,
);

const myProbes = scriptSent.filter((c) => c.argv[0] === 'tmux' || c.argv[0] === 'cat' || c.argv[0] === 'realpath');
const hostLaunches = hostSent.filter(isLaunch);
/** Every generation's launch, on the wire the site received it on — not off the ledger, which is the
 *  campaign's own account of itself, but off the audit of what its process actually sent. A ledger
 *  row whose command line was never sent is exactly what an audit is kept to catch. */
const everyGenerationSent = generationNumbers.every((n) =>
  launchedJobs.some((j) => j.generation === n && hostLaunches.some((c) => c.argv.includes(j.job.session))));
const reportWrites = files === undefined
  ? []
  : hostSent.filter((c) => c.argv[0] === 'tee' && (writeTarget(c) === files.markdown.path || writeTarget(c) === files.json.path));
check(
  'every-remote-command-recorded',
  'The record lists every command this campaign asked the site to run, as HimaChannel\'s own audits saw them being sent: the host\'s, which drove the campaign, and this script\'s own probes beside them.',
  `Two audits, because there are two processes and HimaChannel's audit is per process: the dsh host inside the desktop shell drives the campaign, and this script only probes. Both are drained here — this one in process, the host's over \`POST /hima/api/audit/drain\`, behind the same session fence every other route is — every ${String(drainEveryMs / 1000)} seconds from the click onwards and at every phase boundary, so that neither ${String(remoteCommandWindow)}-entry window could evict a command before it was read; each says so itself, and a window that filled fails this check rather than being written down as a complete list. Every drain answered, and the host's audit holds what a campaign is made of: the \`mkdir\` and \`cp\` of the workspace, one \`tmux new-session\` carrying each generation's whole \`make\` command line as the site received it — matched here against the session the ledger recorded for that generation, so a Job on the ledger whose launch was never sent would fail this — and the two \`tee\`s that wrote the report. `
    + 'This script\'s own audit holds its read-only probes: the tmux question, `realpath` of the two roots, and the `cat` of each report file on an ssh site. Two commands are outside both lists by design: the reachability probe `ssh … true` sent before anything else, which runs nothing on the site, and whatever a second host would have sent between the first shell being told to quit and the second answering — a window in which no Run was running and nothing asked the site anything. What a Job\'s own `make` runs once it is going is not a command this harness sent and is not here; that is the flow\'s, inside the Job.',
  auditDrainError === ''
    && !auditWindowFilled.script
    && !auditWindowFilled.host
    && myProbes.length > 0
    && hostSent.length > 0
    && launchedJobs.length > 0
    && everyGenerationSent
    && reportWrites.length === 2
    && hostWrites.some((c) => c.argv[0] === 'mkdir'),
  (auditDrainError === '' ? '' : `the host's audit could not be drained: ${auditDrainError}; `)
    + `${hostSent.length} command(s) sent by the host that drove the campaign, ${scriptSent.length} by this script (${myProbes.length} read-only probe(s))`
    + `; the window filled between drains — host: ${auditWindowFilled.host ? 'YES — commands may have been evicted' : 'no'}, script: ${auditWindowFilled.script ? 'YES — commands may have been evicted' : 'no'}`
    + `; ${hostLaunches.length} launch(es) on the wire, one at least per generation: ${everyGenerationSent ? 'yes' : 'no'}`
    + `; the report's two files written by \`tee\`: ${reportWrites.length === 2 ? 'yes' : `NO — ${String(reportWrites.length)} of 2`}`,
);

const meters = view?.run.meters;
const budget = view?.run.budget;
const licencesDeclared = Object.keys(budget?.licences ?? {});
const licencesSpent = Object.keys(meters?.licenceMs ?? {});
const undeclaredLicences = licencesSpent.filter((l) => !licencesDeclared.includes(l));
const endedByExpected = status === 'ended-goal-met' || status === 'ended-goal-not-met' || status === 'ended-converged'
  ? meters?.endedBy === undefined
  : meters?.endedBy !== undefined;
check(
  'meters-within-budget',
  'The campaign stayed inside every bound it was started under, and its meters account for what it spent.',
  "The Run's own meters against the Budget copied onto it at start: the elapsed time is at most the time box; the generation it ended in is at most the generation limit; there is one per-generation duration for each generation it opened, and they sum to no more than the elapsed time; every licence it spent time on is one the Site declared seats of; and `endedBy` names a meter or a person exactly when the graph did not end it — absent on goal met, on converged and on a graph out of edges, present on a spent Budget and on a cancel.",
  meters !== undefined
    && budget !== undefined
    && meters.elapsedMs <= budget.timeBoxMs
    && (view?.run.generation ?? 0) <= budget.generationLimit
    && (meters.generationMs?.length ?? 0) === (view?.run.generation ?? 0)
    && (meters.generationMs ?? []).reduce((a, b) => a + b, 0) <= meters.elapsedMs
    && undeclaredLicences.length === 0
    && endedByExpected,
  meters === undefined || budget === undefined
    ? 'no meters or no budget were read'
    : `elapsed ${String(meters.elapsedMs)} ms of a time box of ${String(budget.timeBoxMs)} ms; generation ${show(view?.run.generation)} of at most ${String(budget.generationLimit)}`
      + `; per generation ${JSON.stringify(meters.generationMs ?? [])} ms; jobs launched ${String(meters.jobsLaunched)}, attempts ${String(meters.attempts)}`
      + `; licences declared ${JSON.stringify(budget.licences)}, spent ${JSON.stringify(meters.licenceMs ?? {})}${undeclaredLicences.length === 0 ? '' : ` — UNDECLARED: ${undeclaredLicences.join(', ')}`}`
      + `; ended by ${show(meters.endedBy)}, which for a ${show(status)} ending is ${endedByExpected ? 'what it should be' : 'NOT what it should be'}`,
);

record.run = view
  ? {
      id: view.run.id,
      campaignId: view.run.campaignId,
      siteId: view.run.siteId,
      packId: view.run.packId,
      packVersion: view.run.packVersion,
      status: view.run.status,
      currentNode: view.run.currentNode,
      generation: view.run.generation,
      goal: view.run.goal,
      strategy: view.run.strategy,
      budget: view.run.budget,
      meters: view.run.meters,
    }
  : undefined;
record.generations = generations.map((g) => ({
  generation: g.n,
  askedPeriodNs: g.askedNs,
  observedPeriodNs: g.observedPeriodNs,
  observedSlackNs: g.observedSlackNs,
  setupVerdict: g.setupVerdict?.outcome,
  goalVerdict: g.goalVerdict?.outcome,
  decision: g.decision?.chosen,
  expectedChoice: g.expected?.chosen,
  expectedChoiceHow: g.expected?.how,
  wallMs: g.wallMs,
}));
record.runView = view;
record.records = records;
record.experience = view?.experience;
record.experienceOnSite = reportOnSite;
record.experienceRoute = experienceAnswer === undefined
  ? { error: experienceError || undefined }
  : { schema: experienceAnswer.report.schema, writtenAt: experienceAnswer.experience.writtenAt, markdownCharacters: experienceAnswer.markdown.length };
record.window = {
  cardScreenshot: cardShot,
  cardScreenshotError: cardShotError || undefined,
  endedCard: endedOnTheCard,
  reportShown: shownReport?.state,
  reportShownError: shownReportError || undefined,
};
record.restart = {
  runViewUnchanged: viewBefore !== '' && viewBefore === viewAfter,
  recordsUnchanged: recordsBefore !== '' && recordsBefore === recordsAfter,
  experienceUnchanged: experienceBefore !== '' && experienceBefore === experienceAfter,
  reportOnSiteAfter: reportAfterOnSite,
  error: restartError || undefined,
};
record.campaignCommands = launchedJobs.map((j) => ({ generation: j.generation, session: j.job.session, wire: j.job.wire }));
record.workspaceLeftInPlace = {
  path: workspace,
  containerName,
  report: view?.experience === undefined ? undefined : { markdown: view.experience.markdown.path, json: view.experience.json.path },
  note: "Left in place as evidence, the report beside the results. Nothing in this harness removes a path on a Site; removing this workspace, the container of that name and the report inside it is the site owner's call.",
};
record.afterProbe = {
  command: afterProbe?.command,
  runId: afterProbe?.runId,
  contentSha256: afterProbe?.observation?.contentSha256,
  bytes: afterProbe?.observation?.bytes,
  clockPeriodNs: afterPeriodNs,
  error: afterProbe?.error,
};

await stopTheShell();

// ---------------------------------------------------------------------------------------------
// The record as a person reads it.
// ---------------------------------------------------------------------------------------------

/** One generation's row of the record's own generations table. */
function generationRow(g: Generation): string {
  const verdicts = [g.setupVerdict && `${g.setupVerdict.outcome} ${setupRuleId}`, g.goalVerdict && `${g.goalVerdict.outcome} ${goalRuleId}`]
    .filter(Boolean)
    .join(', ');
  const chosen = g.decision === undefined
    ? 'none'
    : 'goalMet' in g.decision.chosen
      ? 'goal met'
      : 'converged' in g.decision.chosen
        ? `converged on ${g.decision.chosen.converged.read} at ${g.decision.chosen.converged.values.join(' then ')}`
        : `next strategy: periodNs ${String(g.decision.chosen.strategy.periodNs)}`;
  const wall = g.wallMs === undefined ? 'unknown' : `${(g.wallMs / 1000).toFixed(1)} s`;
  return `| ${String(g.n)} | ${show(g.askedNs)} → ${show(g.observedPeriodNs)} | ${show(g.observedSlackNs)} | ${verdicts || 'none'} | ${chosen} | ${wall} |`;
}

function markdown(): string {
  const v = view;
  const files = v?.experience;
  const lines: string[] = [
    `# Step-3 acceptance run, ${date}`,
    '',
    `One multi-generation Campaign of the \`${timingProbePackId}\` pack on site \`${site.name}\`${site.ssh ? ` (${site.ssh.destination})` : ''}. ${versionLine()}. Commit \`${commit}\`${commitDirty ? ' (working tree dirty)' : ''}.`,
    '',
    "Started from the window through the driver (D42, ADR-0004): the desktop shell's own Electron main process, started with `--driver` on an isolated home, which launched the real dsh host and exchanged its token in its own window's session. The Campaign was started by filling the workbench page's own start form and clicking `start`, watched on the card the window renders, and read over the routes with the session the shell established — `GET /hima/api/runs/<id>`, `/records` and `/experience` — then over a second shell booted on the same home.",
    '',
    '## What was asked for',
    '',
    `- The site's own last result: \`${lastResultAt}\`, read read-only, states **${show(lastPeriodNs)} ns**.`,
    `- The target the Goal was set to, and the first Strategy's period: **${show(targetNs)} ns** — ${targetFrom}.`,
    `- The Budget: a time box of ${timeBoxMinutes} minutes for the whole Campaign, a retry allowance of ${retryAllowance} per node per generation, and at most ${generationLimit} generations${generationsOverride === undefined ? " — the pack's own `converge.generationLimit`" : ' — given by `--generations`'}. The site declares ${site.capacity.parallelJobs} parallel job(s).`,
    `- The pack's convergence rule: ${converge === undefined ? 'none declared' : `\`${converge.read}\` moving by less than ${String(converge.band)} over ${counted(converge.generations, 'successive generation')}`}, and its exploration step is ${show(stepNs)} ns.`,
    '',
    'The window\'s own start form, filled control by control:',
    '',
    '```',
    ...Object.entries(form).map(([control, value]) => `${control} = ${value}`),
    'click start',
    '```',
    '',
    '## What ran',
    '',
    v
      ? `Run \`${v.run.id}\` of campaign \`${v.run.campaignId}\`, status **${show(v.run.status)}**, at node \`${show(v.run.currentNode)}\`, in generation ${show(v.run.generation)}. Goal ${JSON.stringify(v.run.goal)}, strategy ${JSON.stringify(v.run.strategy)}, budget ${JSON.stringify(v.run.budget)}, meters ${JSON.stringify(v.run.meters)}.`
      : `No run view was read.${watchError ? ` ${watchError}` : ''}`,
    '',
    ...(v
      ? [
          `- Nodes: ${v.nodes.map((n) => `\`${n.nodeId}\` (${n.kind}) ${n.state}, attempt ${n.attempt}`).join('; ')}`,
          `- Jobs: ${v.jobs.map((j) => `${j.event}${j.exitCode === undefined ? '' : ` exit ${j.exitCode}`} in \`${j.job.session}\``).join('; ')}`,
          `- Blockers: ${v.blockers.length === 0 ? 'none' : v.blockers.map((b) => `\`${b.nodeId}\` after ${String(b.attempts)} attempt(s): ${b.reason}`).join('; ')}`,
          `- Cancels: ${v.cancels.length === 0 ? 'none' : String(v.cancels.length)}`,
          '',
        ]
      : ['']),
    '### While it ran, as the window showed it',
    '',
    '```',
    ...(watch.length === 0 ? ['the window showed an ending before the first turn of the watch'] : watch),
    ...(watchError ? [watchError] : []),
    '```',
    '',
    '## The generations',
    '',
    '| generation | period (asked → observed) | slack | verdicts | decision | wall time |',
    '| --- | --- | --- | --- | --- | --- |',
    ...generations.map(generationRow),
    '',
    ...generations.flatMap((g) => (g.expected ? [`- The chooser's and the pack's own clauses for generation ${String(g.n)}: ${g.expected.how} → ${JSON.stringify(g.expected.chosen)}`] : [])),
    '',
    '## The report',
    '',
    ...(files
      ? [
          `- Markdown: \`${files.markdown.path}\`, sha256 \`${files.markdown.sha256}\` (${String(files.markdown.bytes)} bytes)`,
          `- JSON: \`${files.json.path}\`, sha256 \`${files.json.sha256}\` (${String(files.json.bytes)} bytes), schema \`${show(experienceAnswer?.report.schema)}\``,
          `- Written at ${files.writtenAt}, and re-served unchanged after the restart.`,
          `- Its first heading: ${reportHeading === '' ? 'the file could not be read' : `**${reportHeading}**`}`,
          `- Read back off the site through HimaChannel's \`cat\`: ${reportOnSite.error || `markdown ${show(reportOnSite.markdown?.sha256)}, json ${show(reportOnSite.json?.sha256)} — both what the ledger states`}`,
        ]
      : ['The campaign carries no `experience` record: no report was written, or none could be read.']),
    '',
    '## The window',
    '',
    cardShot
      ? `The ended card, photographed through the same window the Campaign was started from: [\`${path.basename(cardShot.path)}\`](${path.basename(cardShot.path)}) — ${cardShot.width}×${cardShot.height}, ${cardShot.bytes} bytes.`
      : `The ended card could not be photographed: ${cardShotError || 'no reason given'}`,
    '',
    shownReport
      ? `The card's own \`run-experience\` section carries the report, marked with the Markdown file's sha256 \`${show(shownReport.state.sha256)}\` and the instant both files state as their own, ${show(shownReport.state['written-at'])}.`
      : `The card showed no report: ${shownReportError || 'no reason given'}`,
    '',
    '## The campaign workspace, left on the site',
    '',
    `- Workspace: \`${show(workspace)}\``,
    `- Container: \`${show(containerName)}\``,
    `- Report: ${files ? `\`${files.markdown.path}\` and \`${files.json.path}\`` : 'none'}`,
    '',
    "Left in place as evidence, the report beside the results. Nothing in this harness removes a path on a Site; removing this workspace, the container of that name and the report inside it is the site owner's call.",
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
    restartError
      ? `The campaign could NOT be read back after a restart: ${restartError}`
      : viewBefore !== '' && viewBefore === viewAfter && recordsBefore === recordsAfter && experienceBefore === experienceAfter
        ? "After quitting the window and booting a second shell on the same home, the run view, every one of the Run's records and its `experience` record read back unchanged, and both report files still hash to what that record states."
        : "The run view, the Run's records or its report DIFFERED after the restart.",
    '',
    '## The read-only probe of the site',
    '',
    `- Before the campaign: \`${before.command}\` → ${show(lastPeriodNs)} ns, sha256 \`${show(before.observation?.contentSha256)}\``,
    afterProbe ? `- After it: \`${afterProbe.command}\` → ${show(afterPeriodNs)} ns, sha256 \`${show(afterProbe.observation?.contentSha256)}\`` : '- After it: the report was not re-read, because nothing was launched',
    `- Campaign workspaces go under \`${workspaceRootOnSite || `${workspaceRoot} (unresolved: ${resolvedWorkspaceRoot.error})`}\`, and the site's own flow is at \`${flowRootOnSite || `${flowRoot} (unresolved: ${resolvedFlowRoot.error})`}\`, as the site itself resolves them.`,
    `- One job at a time: ${
      quiet.asked
        ? `${quiet.detail}; read as busy: ${quiet.busyPanes.length === 0 ? `none of ${quiet.panes.length} pane(s)` : quiet.busyPanes.map((p) => `\`${p.line}\` — ${p.because}`).join('; ')}`
        : `the probe could not be made: ${quiet.detail}`
    }`,
    '',
    `## Every command this harness asked site \`${site.name}\` to run`,
    '',
    `Two audits, because two processes asked, and HimaChannel's audit is per process. The Campaign was driven by the dsh host inside the desktop shell, and its audit was drained over \`POST /hima/api/audit/drain\` every ${String(drainEveryMs / 1000)} seconds and at every phase boundary; this script's own process sent the read-only probes, and its audit was drained in the same step. Each command is here as the Site received it, once every word was quoted. On an ssh Site every read is a \`cat\` or a \`realpath\`; a local Site is reached without ssh, where reading a file and resolving a path spawn nothing and so are not commands at all.`,
    ...(auditDrainError === '' ? [] : ['', `**A drain did not answer, so this list is not complete:** ${auditDrainError}`]),
    '',
    '### What the host that drove the campaign sent',
    '',
    ...(sentBy('host').length === 0 ? ['None.'] : sentBy('host').map((c) => `- (${c.phase}) \`${c.wire}\``)),
    '',
    "### What this script's own process sent",
    '',
    ...(sentBy('script').length === 0 ? ['None.'] : sentBy('script').map((c) => `- (${c.phase}) \`${c.wire}\``)),
    '',
    '### The same launches, as the ledger holds them',
    '',
    'One row per Job the Run recorded, matched by session against the launches above: the campaign\'s own account of what it ran, beside the audit of what its process sent.',
    '',
    ...(launchedJobs.length === 0
      ? ['No Job was launched.']
      : launchedJobs.map((j) => `- (generation ${show(j.generation)}) in \`${j.job.session}\`, working directory \`${j.job.workspace}\`: \`${j.job.wire}\``)),
    '',
    ...(workspace === undefined
      ? []
      : [
          `The same campaign's workspace commands made \`${workspace}\` and copied ${counted(workspaceRecords[workspaceRecords.length - 1]?.copied.length ?? 0, 'piece')} of the site's own flow into it, and its report commands wrote ${files ? `\`${files.markdown.path}\` and \`${files.json.path}\`` : 'nothing'}. Each is named by the ledger record that claims it, above.`,
          '',
        ]),
  ];
  return `${lines.join('\n')}\n`;
}

finish();
