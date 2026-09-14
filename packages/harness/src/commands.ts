// @hima-seam commands direct
// The `/hima …` command face: what a person types, and the sentences they read back. One reason to
// change: how this harness is spoken to, and answered, on a command line.
//
// Every handler here is a face onto an operation that already exists — observe, judge, the Job
// operations, the pack check and preparation, the fabric's start, resume and cancel — and none of
// them decides anything the operation does not. What is theirs is the parsing (a flag typed with no
// value must never read as "not given"), what counts as success (a Run that ended is a success
// whichever way it ended; a Run that stopped needing a person is not), and the words. The words are
// here because they are read by a person and not by a caller, and because `/hima run` and `/hima
// status` must describe one Run the one way.
import { createRequire } from 'node:module';
import { legacyAutomaticAllowed } from './runs.js';
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands';
import { hasEnded, type BlockerRecord, type CancelRecord, type CodeRecord, type DecisionRecord, type ExperienceRecord, type JobRecord, type LedgerRecord, type NodeRecord, type ObservationRecord, type ResumedRecord, type RunRecord, type SessionRecord, type VerdictRecord, type WorkspaceRecord } from './ledger.js';
import { cancelSessions, chosenAs, standingWorkshop } from './record-views.js';
import { observe, type ObserveResult } from './observe.js';
import { jobKill, jobStatus, jobTail, launchJob, type JobKillResult, type JobStatusResult, type LaunchResult } from './jobs.js';
import { claimSlot, fullSaid, type FullSlot } from './job-cap.js';
import { loadSite } from './sites.js';
import { checkInstalledPack, runPackWords, type PackCheck, type PackCheckResult, type PackStage } from './packs.js';
import { releasePack } from './release.js';
import type { PackDataOrigin } from './ledger.js';
import { campaignIdIssue, prepareWorkspace, type PrepareResult } from './workspace.js';
import { resumeRun, startRun, type FabricDeps, type ResumeResult, type StartRunResult } from './fabric.js';
import { cancelRun, type CancelResult } from './recovery.js';
import { numericValue, allowsRunArgument, badRunArgument, notWaitingToResume, unresumableReason, type RunArgumentName } from './run-arguments.js';
// Type-only: the shape a pack's words travel in, declared with the rest of the run view.
import type { RunWords } from './remote.js';
import { bannerLines, branchSaid, branchesIn, convergedSaid, experienceFileSaid, meterLines, readerSaid, runPurposeMark, strategySaid, workshopSaid } from './card-labels.js';
import { generationsOf } from './generations.js';
import { counted } from './words.js';
import { PackFolderError, PackNotFoundError, RunFaultError, RunReferenceError, RunStartError, SiteNotFoundError, SiteUnreadableError } from './errors.js';

/** What `/hima` says it is, in the one line a person sees in the host's command list. Here with the
 *  handlers it describes, so a verb added below is a verb named here. */
export const himaCommandDescription =
  'HimaHarness: keep ordinary DeepSeek Harness chat and coding; inspect and prepare a HimaPack and Site for a chip-design Campaign; let the visible Campaign Agent choose and execute authorized nodes while HimaFabric records the graph, budget, jobs, evidence and recovery. Commands: version; observe; judge; job launch|status|tail|kill; pack check|prepare|release; run; resume; status; cancel';

const require = createRequire(import.meta.url);
const bundleVersion: string = require('../package.json').version;
// Every @deepseek-ai/dsh-* package shares one version string; the commands peer is the one we depend on.
const hostVersion: string = require('@deepseek-ai/dsh-commands/package.json').version;

/** One line a person or a test can read: bundle, host, runtime. */
export function versionLine(): string {
  return `HimaHarness ${bundleVersion} on DeepSeek Harness ${hostVersion} (Node ${process.version})`;
}

/** One observe result as a person reads it: what was read or refused, and where it was recorded. */
function describeObserveResult(result: ObserveResult): string {
  const runId = result.run.id;
  if (result.kind === 'observed') {
    const { record } = result;
    return `observed ${record.path} on ${record.siteId}: sha256 ${record.contentSha256} (${record.bytes} bytes), reader ${readerSaid(record.reader)}, record ${record.id} in ${runId}`;
  }
  const { record } = result;
  return `refused ${record.path} on ${record.siteId}: ${record.reason}; recorded as ${record.id} in ${runId}`;
}

/** One verdict as a person reads it: outcome, rule identity and version, what it cited, why if undetermined. */
function describeVerdict(v: VerdictRecord): string {
  const cited = v.cites.length > 0 ? `cites ${v.cites.join(', ')}` : 'cites nothing';
  const bound = v.boundParameters ? Object.entries(v.boundParameters).map(([k, n]) => `${k}=${n}`).join(', ') : undefined;
  const why = v.reason ? `: ${v.reason}` : '';
  return `${v.outcome} ${v.ruleId}@${v.ruleVersion}${bound ? ` (${bound})` : ''}, recorded as ${v.id}, ${cited}${why}`;
}

/**
 * Why a launch was refused by the Site's cap, as a person reads it: which of the Site's slots had no
 * room, what is in them right now, and what to do about it. Which slot it was comes from the claim
 * step itself, in its own words, so this face and the node that waits cannot say different things
 * about one full Site. The Jobs are named — session and Run — because "the site is full" without
 * saying what is filling it leaves a person with nothing to act on but a guess.
 */
function describeAtCap(site: string, full: FullSlot, holding: readonly JobRecord[]): string {
  const held = holding.map((r) => `"${r.job.name}" in tmux session ${r.job.session} of ${r.runId}`).join('; ');
  const what = held === '' ? 'jobs the ledger cannot name' : held;
  return `refused to launch on ${site}: the site ${fullSaid(full)}, held by ${what}; wait for one to end, or stop one with /hima job kill`;
}

/** One launch as a person reads it: what was launched, where, as what, and where it was recorded. */
function describeLaunch(result: LaunchResult): string {
  if (result.kind === 'launched') {
    const { job } = result.record;
    return `launched "${job.name}" on ${result.record.siteId} as tmux session ${job.session} (pid ${job.pid}) in ${job.workspace}: ${job.wire}; recorded as ${result.record.id} in ${result.run.id}`;
  }
  const { record } = result;
  return `refused to launch ${record.path} on ${record.siteId}: ${record.reason}; recorded as ${record.id} in ${result.run.id}`;
}

/** One status as a person reads it. Starts with the state itself, so an eye and a test find it first. */
function describeJobStatus(session: string, result: JobStatusResult): string {
  const where = `${session} in ${result.run.id}`;
  const recorded = result.record ? `; recorded as ${result.record.id}` : '';
  if (result.state.state === 'running') return `running ${where}`;
  if (result.state.state === 'finished') return `finished ${where}: exit ${result.state.exitCode}${recorded}`;
  return result.job
    ? `gone ${where}: no tmux session and no exit file — the job vanished without finishing`
    : `gone ${where}: this run launched no job in that tmux session`;
}

/**
 * One pack check as a person reads it: the verdict first, then what was found under each heading,
 * then — only when there are any — the errors gathered in one place. The verdict leads because that
 * is the question asked; the detail follows because a `fit` answer is worth as much as an unfit one
 * when someone is deciding whether a Site is set up right.
 */
/**
 * What became of one id the pack named, in the words the check reports it in (#57): found, and in
 * which of the two places it was looked for. The origin is said on every resolved line rather than
 * only on the pack's own, because "found" with nothing after it is what this line used to say and a
 * person reading it would not know a second place had been looked in at all.
 */
const foundIn = (origin: PackDataOrigin | undefined): string => `found in the ${origin ?? 'bundle'}`;

/**
 * What one line of the check says about one id: where it was found, what is wrong with it, or — when
 * an id resolved and then failed on something else — **both**.
 *
 * Both, because they are two different facts and the second does not cancel the first. A chooser
 * whose binding is invalid was still read out of one of two files, and a person deciding which file
 * to edit has to be told which one answered; a line that printed only the error would send them to
 * the bundle's copy of a chooser their pack had replaced.
 *
 * @param origin - where the id resolved, or undefined when it never resolved at all.
 * @param error - what is wrong, or undefined when nothing is.
 */
const saidOf = (origin: PackDataOrigin | undefined, error: string | undefined): string => {
  if (error === undefined) return foundIn(origin);
  return origin === undefined ? error : `${foundIn(origin)}, and ${error}`;
};

/**
 * How far up the pack authoring pipeline a folder has come, as one line a person reads (#63).
 *
 * The rung first, with what validated to get there, then what the next rung wants and who writes it
 * — because "where am I" and "what do I do next" are the two questions a pack author has, and the
 * second is the one an answer that stopped at the first would leave them guessing at. A file that is
 * there and wrong is said last and said plainly: the ladder stopped on something, and a person who
 * is not told what would go on writing the file they already wrote.
 *
 * @param stage - what the ladder found.
 * @returns the line, without a trailing newline.
 */
export function packStageSaid(stage: PackStage): string {
  const reached = stage.validated.length === 0 ? stage.stage : `${stage.stage} (${stage.validated.join(', ')} validate)`;
  const next = stage.next === undefined ? 'nothing after it: this is the top of the ladder' : `next: ${stage.next} — ${stage.needs!}`;
  return `stage: ${reached}; ${next}${stage.issue === undefined ? '' : `; ${stage.issue}`}`;
}

export function describePackCheck(check: PackCheck): string {
  const found = [
    `${check.inputs.filter((i) => i.bound !== undefined).length} of ${counted(check.inputs.length, 'input')} bound`,
    counted(check.tools.length, 'tool'),
    ...(check.workshops.length === 0 ? [] : [counted(check.workshops.length, 'workshop')]),
    counted(check.rules.length, 'rule'),
    counted(check.readers.length, 'reader'),
    counted(check.choosers.length, 'chooser'),
    ...(check.knowledge.length === 0 ? [] : [counted(check.knowledge.length, 'knowledge file')]),
    counted(check.licences.length, 'licence'),
  ].join(', ');
  const verdict = check.fit ? `fit — ${found}` : `unfit — ${counted(check.errors.length, 'error')}; ${found}`;
  const lines = [`pack ${check.packId}@${check.packVersion} on site ${check.siteName}: ${verdict}`];
  lines.push(packStageSaid(check.stage));
  lines.push('inputs:');
  for (const i of check.inputs) lines.push(`  ${i.name} = ${i.bound ?? `(not bound) ${i.error}`}`);
  if (check.tools.length > 0) lines.push('tools:');
  for (const t of check.tools) {
    lines.push(`  ${t.id} (${t.file}): ${t.error ?? `"${t.wrapper}" is an allowed wrapper of site ${check.siteName}`}`);
  }
  // The workshops, beside the tools and in the same shape (#62): what a Job of each runs, where the
  // model writes and which file of that directory is launched, and which output it must produce with
  // the reader that turns it into an observation.
  if (check.workshops.length > 0) lines.push('workshops:');
  for (const w of check.workshops) {
    lines.push(`  ${w.id} — ${w.wrapper}, writes ${w.directory}/${w.entry}, produces ${w.produces} (read by ${w.reader})${w.error === undefined ? '' : `: ${w.error}`}`);
  }
  if (check.rules.length > 0) lines.push('rules:');
  for (const r of check.rules) lines.push(`  ${r.resolved ?? r.ref}: ${saidOf(r.origin, r.error)}`);
  if (check.readers.length > 0) lines.push('readers:');
  for (const r of check.readers) lines.push(`  ${r.resolved ?? r.id} reads ${r.output}: ${saidOf(r.origin, r.error)}`);
  // What vocabulary a Run of this pack speaks (#61). The pack's own value types are named — those are
  // the ones a person is about to edit a file for — and the bundle's are counted, because the same
  // eight come from the bundle for every pack and a list nobody reads twice is noise on a report a
  // person reads for the exceptions.
  lines.push('semantics:');
  for (const type of check.semantics.pack) lines.push(`  ${type}: declared by this pack in ${check.semantics.file}`);
  lines.push(`  ${counted(check.semantics.fromBundle, 'value type')} come${check.semantics.fromBundle === 1 ? 's' : ''} from the bundle`);
  if (check.choosers.length > 0) lines.push('choosers:');
  for (const c of check.choosers) lines.push(`  ${c.resolved ?? c.ref} chooses at ${c.node}: ${saidOf(c.origin, c.error)}`);
  if (check.knowledge.length > 0) lines.push('knowledge:');
  for (const k of check.knowledge) lines.push(`  ${k.file} (${k.purpose}): ${saidOf(k.origin, k.error)}`);
  if (check.licences.length > 0) lines.push('licences:');
  for (const l of check.licences) {
    // A workshop says so; a tool is named bare, as this line has always named one (#62).
    lines.push(`  ${l.holder === 'workshop' ? 'workshop ' : ''}${l.tool} holds ${l.held} of "${l.name}": ${l.error ?? `site ${check.siteName} declares ${String(l.declared)}`}`);
  }
  // What this host's ledger says about the Run the folder's test record rests on (#64). One line,
  // and only when a ledger was in hand to ask: `checkPack` opens files, and whether a Campaign really
  // ran these very bytes is a question only the ledger answers.
  if (check.testRecord !== undefined) lines.push(check.testRecord.said ?? check.testRecord.error!);
  if (check.errors.length > 0) {
    lines.push('errors:');
    for (const e of check.errors) lines.push(`  - ${e}`);
  }
  return lines.join('\n');
}

/**
 * One pack check as a person reads it, whatever stage the folder stands at (#64): the whole check for
 * a folder that holds a pack, and the ladder alone for one that does not yet.
 *
 * Both faces that check a pack say it through this, so a pack author who checks their own folder from
 * the fabric stage and then checks it again at a terminal reads one answer about one folder.
 */
export function describePackCheckResult(result: PackCheckResult): string {
  if (result.kind === 'checked') return describePackCheck(result.check);
  return [`pack ${result.pack} on site ${result.siteName}: unfit — ${result.why}`, packStageSaid(result.stage)].join('\n');
}

/** Whether that check says this Site may host this pack. A folder with no pack in it may not, which
 *  is why this is one function rather than a field a caller reads off one arm of the union. */
export const packCheckFit = (result: PackCheckResult): boolean => result.kind === 'checked' && result.check.fit;

/** The ladder as that check found it, whichever arm answered: what a caller wanting the stage as data
 *  reads, so `hima_pack_check` need not take the words apart again. */
export const packCheckStage = (result: PackCheckResult): PackStage =>
  (result.kind === 'checked' ? result.check.stage : result.stage);

/** One preparation as a person reads it: what was prepared or found, where, and what it holds. */
export function describePrepare(result: PrepareResult): string {
  if (result.kind === 'unfit') return describePackCheck(result.check);
  if (result.kind === 'refused') {
    const { record } = result;
    return `refused to prepare ${record.path} on ${record.siteId}: ${record.reason}; recorded as ${record.id} in ${result.run.id}`;
  }
  // The Run is named though it holds no record: it is what the answer belongs to, as in every other
  // form of this face, and it is how a caller asks the ledger what this preparation did — nothing.
  if (result.kind === 'occupied') return `cannot prepare ${result.workspace} for ${result.run.id}: ${result.reason}`;
  const { record, file } = result;
  const what = `campaign ${file.campaign} of pack ${file.pack.id}@${file.pack.version} on ${record.siteId}`;
  const held = `${counted(file.copied.length, 'piece')} of the flow (${file.copied.join(', ')}) in ${file.workspace}/flow, container ${file.containerName}`;
  const where = `recorded as ${record.id} in ${result.run.id}`;
  return result.kind === 'prepared'
    ? `prepared ${file.workspace} for ${what}: copied ${held}; ${where}`
    : `already prepared: ${file.workspace} for ${what}, prepared at ${file.preparedAt} with ${held}; nothing was copied; ${where}`;
}

/**
 * The words this Run's pack declares for its numbers, as a spread: `{ words }` when there are any
 * and `{}` when there are none, so a run row a face reads never carries the key at all rather than
 * carrying it empty — which is how every absent fact is said in this harness.
 */
function wordsOf(deps: FabricDeps, run: RunRecord): { readonly words?: RunWords } {
  try {
    const words = runPackWords(deps.packsDir, run);
    return words === undefined ? {} : { words };
  } catch {
    return {};
  }
}

/**
 * One Run as a person reads it: where it stands, what it is for, what it has spent, the state every
 * node it touched is in, and what it decided. Both `/hima run` and `/hima status` answer with this,
 * so what a Run prints when it ends and what it prints when it is asked about afterwards cannot
 * drift apart — and every line of it comes out of the ledger, which is the only place the state is.
 */
function describeRun(deps: FabricDeps, run: RunRecord): string {
  const records = deps.ledger.records({ runId: run.id });
  // Which generation of its Loop the Run is in, on the line that says where it stands, and against
  // the limit it was started under: a person watching a Campaign wants "how far in, and how far it
  // may go" in one glance and without reading the budget line.
  const generation = run.generation === undefined
    ? ''
    : `, generation ${run.generation}${run.budget === undefined ? '' : ` of at most ${run.budget.generationLimit}`}`;
  // And which drill-down Loop it is inside while it is inside one (#28), with that Loop's own
  // generation: a person watching a Campaign that has drilled down is watching the sub-question, and
  // the node names below are that Loop's nodes.
  const loop = run.loop === undefined ? '' : `, in loop ${run.loop.name} at generation ${run.loop.generation}`;
  // And which fork it is inside while it is inside one (#29), with the branches it is waiting for:
  // a Run standing at a join is not standing still, it is waiting for several nodes at once, and the
  // `current node` line below would otherwise say a judge node while two syntheses run.
  const fork = run.fork === undefined
    ? ''
    : `, in the fork at ${run.fork.from} waiting at ${run.fork.join} for ${counted(Object.keys(run.fork.branches).length, 'branch')}`;
  // What this Run is for, where it is not an ordinary Campaign (#64): a test run of a pack somebody
  // is still authoring is not a result, and a person reading the status of one has to be told before
  // they read anything else on it.
  const purpose = runPurposeMark(run.purpose);
  const marked = purpose === undefined ? '' : `, ${purpose}`;
  const lines = [`run ${run.id} of campaign ${run.campaignId} on site ${run.siteId}: ${run.status ?? 'no fabric state; HimaFabric never started this run'}${marked}${generation}${loop}${fork}`];
  if (run.control) {
    lines.push(`  conversational owner: ${run.control.owner}; epoch ${run.control.epoch}; revision ${run.control.revision}`);
    lines.push(`  new work: ${run.control.paused.length ? `paused (${run.control.paused.join(', ')}); existing Jobs may still run` : 'requires an explicit Agent action'}`);
    for (const execution of Object.values(run.control.executions)) lines.push(`  execution ${execution.id}: ${execution.nodeId}, ${execution.phase}, generation ${execution.generation}, attempt ${execution.attempt}`);
  }
  const workspace = records.findLast((r): r is WorkspaceRecord => r.type === 'workspace')?.workspace;
  if (workspace !== undefined) lines.push(`  workspace: ${workspace}`);
  // What the Campaign is for and what it is set to, in the very words the card says them in
  // (`card-labels.ts`, `bannerLines`) — the pack's own where the pack declares them, the names where
  // it does not (#42). One table and not a second spelling here: a person who reads a Campaign at a
  // terminal and a person who watches it in the window must be reading one sentence about one Goal,
  // and this line and the banner had already drifted to two spellings of one Strategy.
  const banner = bannerLines({ ...run, ...wordsOf(deps, run) });
  if (banner.goal !== undefined) lines.push(`  ${banner.goal}`);
  if (banner.strategy !== undefined) lines.push(`  ${banner.strategy}`);
  if (run.budget) {
    // The Site's licence seats as this Run copied them, named only when the Site declared any: they
    // are the other half of the cap a launch is held to, and a Site that reserves none of anything
    // should not carry a line saying so.
    const seats = Object.entries(run.budget.licences);
    const licences = seats.length === 0 ? '' : `, licences ${seats.map(([name, count]) => `${name} ${count}`).join(', ')}`;
    lines.push(`  budget: time box ${run.budget.timeBoxMs / 60_000} min, retry allowance ${run.budget.retryAllowance}, at most ${counted(run.budget.generationLimit, 'generation')}, job cap ${run.budget.jobCap}${licences}`);
  }
  if (run.currentNode !== undefined) lines.push(`  current node: ${run.currentNode}`);
  // The state each node is in now, in the order the Run first reached them: a Map keeps the position
  // of a key it already holds, so a later transition updates a node's line without moving it. Folded
  // before the meters are printed because the meters are read off it too — which node the Retry
  // allowance is being spent at is the same question this map answers for the lines below.
  const nodes = new Map<string, NodeRecord>();
  for (const record of records) if (record.type === 'node') nodes.set(record.nodeId, record);
  // Every meter against the bound it is held to, in the words the card says them in
  // (`card-labels.ts`, `meterLines`), off the same four things the run view hands that function: a
  // person asking where a Run stands is asking how far through its Budget it is, and the answer must
  // not depend on whether they asked a command or opened the window.
  const meters = meterLines({
    run,
    nodes: [...nodes.values()],
    blockers: records.filter((r): r is BlockerRecord => r.type === 'blocker'),
    jobs: records.filter((r): r is JobRecord => r.type === 'job'),
  });
  if (meters.length > 0) lines.push('  meters:', ...meters.map((said) => `    ${said}`));
  if (nodes.size > 0) lines.push('  nodes:');
  for (const node of nodes.values()) {
    // What the node's own Job holds of the Site, read off that Job's launch: a person reading a Run
    // that is waiting for a slot wants to see, on the same lines, what the Site's seats are in.
    const launch = records.find(
      (r): r is JobRecord => r.type === 'job' && r.event === 'launched' && r.job.session === node.jobSession,
    );
    const holding = launch?.licences === undefined
      ? ''
      : ` holding ${Object.entries(launch.licences).map(([name, seats]) => `${name} ${seats}`).join(', ')}`;
    // The reason last, because it is a sentence and the rest are words: a blocked node is where a Run
    // stops needing a person, and this is the line that person reads first.
    const also = [node.outcome, node.jobSession === undefined ? undefined : `session ${node.jobSession}${holding}`, node.reason].filter((s) => s !== undefined);
    lines.push(`    ${node.nodeId} (${node.kind}): ${node.state}, attempt ${node.attempt}${also.length > 0 ? `, ${also.join(', ')}` : ''}`);
  }
  // Every branch this Run forked into, beside the nodes they are made of: a person reading a forked
  // Campaign is reading which branch is running, which is queued behind the Site's cap, and which one
  // is theirs to clear. The words are the card's own (`branchSaid`), so a command and the window say
  // one thing about one branch.
  const branches = branchesIn({ generations: generationsOf(run, records, wordsOf(deps, run).words) });
  if (branches.length > 0) lines.push('  branches:', ...branches.map((b) => `    ${branchSaid(b)}`));
  // What this Run last read, and **who read it** (#61): one line, in the very words both card mounts
  // say it in (`readerSaid`). A reading is the evidence every verdict of a Campaign cites, and since
  // a reader may be a script in the pack's own folder rather than code in this bundle, its id and
  // version alone no longer identify what produced a number — a pack folder is plain files a person
  // edits, so the file and the hash of the bytes that were shipped and run are the whole of it. The
  // latest, and not all of them: a Campaign of six generations has six readings and a person asking
  // where a Run stands is asking about the one its current verdicts were reached on.
  const reading = records.findLast((r): r is ObservationRecord => r.type === 'observation');
  if (reading) lines.push(`  latest reading: ${reading.path}, read by ${readerSaid(reading.reader)}`);
  // Where the node the Run stands at stands as a workshop, when it is one (#62): the card's own
  // standing line, so a person at a terminal and a person at the window read one sentence about one
  // workshop. The files it wrote are the card's rows and the run view's `code`; a command line says
  // where the workshop is, which is what a person asking where a Run stands is asking.
  // Where the node this Run stands at stands as a workshop, when it is one (#62): the same fold the
  // run view is composed through and over the same records, so a person at a terminal and a person at
  // the window cannot be told two things about one node.
  const workshop = standingWorkshop(run, records);
  if (workshop !== undefined) lines.push(`  ${workshopSaid(workshop)}`);
  // The blocker before the decision, because a Run that is waiting is waiting on this and a person
  // reading it has come to find out what to clear. The log tail is not printed: it is on the record,
  // and `/hima job tail` is how a person reads a log at whatever length they want.
  const blocker = records.findLast((r): r is BlockerRecord => r.type === 'blocker');
  if (blocker) {
    const exit = blocker.lastExitCode === undefined ? '' : `, last exit ${blocker.lastExitCode}`;
    const tail = blocker.logTail === undefined ? '' : `, ${counted(blocker.logTail.split('\n').filter((l) => l !== '').length, 'line')} of log on record ${blocker.id}`;
    lines.push(`  blocker: ${blocker.nodeId} after ${counted(blocker.attempts, 'attempt')}${exit}${tail}: ${blocker.reason}`);
  }
  const resumed = records.findLast((r): r is ResumedRecord => r.type === 'resumed');
  if (resumed) lines.push(`  resumed: ${resumed.nodeId} by ${resumed.who} at ${resumed.at}`);
  // Every request to stop this Run, beside the stop each one was answered with. The two are separate
  // records on purpose — a cancel is a fact and not a wish — and a face that showed only the ending
  // would leave a person no way to see that the asking and the stopping are different things, or that
  // a request was made at all where nothing turned out to need stopping.
  for (const asked of records.filter((r): r is CancelRecord => r.type === 'cancel')) {
    // Every session the request found open, and the stop observed of each: a cancel stops every Job
    // a Run has open and one inside a fork has one per branch, so a line naming one of two would
    // leave a person believing the Site was clear of a Campaign that still had a synthesis on it.
    const sessions = cancelSessions(asked);
    const at = [asked.nodeId === undefined ? undefined : `node ${asked.nodeId}`, sessions.length === 0 ? undefined : `${sessions.length === 1 ? 'session' : 'sessions'} ${sessions.join(', ')}`]
      .filter((s) => s !== undefined)
      .join(', ');
    // What the request found, said as of the moment it was read rather than as a claim about the Run.
    // This line is composed on demand, long after — often beside the very node record the loop that
    // owned the crossed launch wrote — so "the run has no job" would contradict the line above it,
    // while "none was open when the request was read" is what the record actually says and stays true.
    const stopped = sessions.length === 0
      ? 'no job of this run was open when the request was read'
      : sessions.map((session) => {
        const stop = records.find((r) => r.type === 'job' && r.event === 'killed' && r.job.session === session);
        return `${session} ${stop ? `stopped, recorded as ${stop.id}` : 'has no recorded stop'}`;
      }).join('; ');
    lines.push(`  cancel: asked at ${asked.at}${at === '' ? '' : `, ${at}`}; ${stopped}`);
  }
  const decision = records.findLast((r): r is DecisionRecord => r.type === 'decision');
  if (decision) {
    const chosen = chosenAs(decision);
    const chose = chosen.kind === 'goal-met'
      ? 'goal met'
      : chosen.kind === 'converged'
        ? convergedSaid(chosen.converged)
        // The whole Strategy it chose, in the pack's own words — the card's very sentence (#58), so
        // a person reading a Campaign at a terminal and one watching it in the window read one
        // decision said one way.
        : strategySaid(chosen.strategy, wordsOf(deps, run).words?.strategy);
    const from = Object.entries(decision.rationale).map(([name, value]) => `${name} ${value}`).join(', ');
    lines.push(`  decision: ${decision.nodeId} chose ${chose} by ${decision.chooser}, citing ${decision.cites.join(', ')}, from ${from}`);
  }
  // Last, and only on a Run that has one: the Campaign's technical report, where a person reading a
  // finished Campaign at a terminal goes next (#30). The paths and the hashes and nothing else — the
  // report itself is two files on the Site and a section of the window's card, and a command that
  // printed a whole document would bury the Run it was asked about.
  const experience = records.findLast((r): r is ExperienceRecord => r.type === 'experience');
  if (experience) {
    lines.push(
      `  experience: written at ${experience.writtenAt}`,
      `    ${experienceFileSaid('markdown', experience.markdown)}`,
      `    ${experienceFileSaid('json', experience.json)}`,
    );
  }
  return lines.join('\n');
}

/**
 * One cancel as a person reads it: what was stopped, then the Run as `/hima status` shows it — the
 * cancel's whole point being that the Run is over and a person wants to see how it ended.
 */
function describeCancel(deps: FabricDeps, result: CancelResult): string {
  const runId = result.run.id;
  if (result.kind === 'not-started') {
    return `run ${runId} has no fabric state: HimaFabric never started it, so there is nothing to cancel`;
  }
  if (result.kind === 'ended') {
    return [`run ${runId} already ended as ${result.run.status}; nothing was stopped and nothing was recorded`, describeRun(deps, result.run)].join('\n');
  }
  if (result.kind === 'not-stopped') {
    return [`run ${runId} was NOT cancelled: its job was ${result.reason}`, describeRun(deps, result.run)].join('\n');
  }
  // Said of the moment the request was read, not of the Run for all time: a cancel that crossed a
  // launch it could not see is answered here while the loop that made that launch is still stopping
  // the Job, and this sentence has to be as true a minute later as it was when it was composed.
  const stopped = result.stopped
    ? `stopped its job "${result.stopped.job.name}" in tmux session ${result.stopped.job.session}, recorded as ${result.stopped.id}`
    : 'no job of this run was open when the request was read';
  return [`cancelled run ${runId}: ${stopped}`, describeRun(deps, result.run)].join('\n');
}

/** One kill as a person reads it: what was stopped, or why nothing was. */
function describeJobKill(session: string, result: JobKillResult): string {
  const where = `${session} in ${result.run.id}`;
  if (!result.outcome.wasRunning) return `${where} was already gone; nothing to stop`;
  if (!result.outcome.gone) return `${where} was asked to stop but its session is still there`;
  return `stopped ${where}; recorded as ${result.record?.id}`;
}

/** A comma-separated flag list, `--rules a,b`, as ids. */
const ruleList = (value: string): string[] => value.split(',').map((s) => s.trim()).filter(Boolean);

const flagValue = (flags: readonly string[], name: string): string | undefined => {
  const at = flags.indexOf(name);
  return at >= 0 ? flags[at + 1] : undefined;
};

/** True when `name` was typed at all, whether or not it carries a usable value; distinguishes "absent" from "empty". */
const flagPresent = (flags: readonly string[], name: string): boolean => flags.includes(name);

/**
 * Every `<flag> <name>=<value>` pair in a flag list, repeatable, parsed and validated: a value error
 * names the bad pair, never silently dropping or defaulting it. Two flags are shaped this way — the
 * `--param` a rule's threshold is bound with, and the `--goal` a Run is started toward — and they
 * are parsed by the one function so a caller cannot get one right and the other wrong.
 */
function parseNamedNumbers(flags: readonly string[], flag: string): { params: Record<string, number> } | { error: string } {
  const params: Record<string, number> = Object.create(null);
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] !== flag) continue;
    const raw = flags[i + 1];
    const eq = raw?.indexOf('=') ?? -1;
    if (raw === undefined || eq <= 0) return { error: `invalid ${flag} "${raw ?? ''}"; expected ${flag} <name>=<value>` };
    const name = raw.slice(0, eq);
    if (Object.hasOwn(params, name)) return { error: `duplicate ${flag} parameter "${name}"` };
    const value = numericValue(raw.slice(eq + 1));
    if (value === undefined) return { error: `invalid ${flag} "${raw}"; expected a numeric value` };
    params[raw.slice(0, eq)] = value;
  }
  return { params };
}

/** `--param <name>=<value>`, repeatable: what binds a rule's declared parameter at judge time. */
const parseParamFlags = (flags: readonly string[]): { params: Record<string, number> } | { error: string } => parseNamedNumbers(flags, '--param');

/**
 * `--set <knob>=<value>`, repeatable: what a Run's Strategy is set to at the start (#58).
 *
 * The pair is parsed here and the value is not: what a knob may be is the *pack's* declaration, and
 * this face has not opened the pack. A value is carried as the person typed it, `startRun` reads it
 * as the knob's own kind — a number parsed for a number knob, the word as given for a choice knob —
 * and a value no declaration allows is refused there, in the words every face says it in.
 */
function parseSetFlags(flags: readonly string[]): { strategy: Record<string, string> } | { error: string } {
  const strategy: Record<string, string> = Object.create(null);
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] !== '--set') continue;
    const raw = flags[i + 1];
    const eq = raw?.indexOf('=') ?? -1;
    if (raw === undefined || eq <= 0 || eq === raw.length - 1) return { error: `invalid --set "${raw ?? ''}"; expected --set <knob>=<value>` };
    const name = raw.slice(0, eq);
    if (Object.hasOwn(strategy, name)) return { error: `duplicate --set parameter "${name}"` };
    strategy[name] = raw.slice(eq + 1);
  }
  return { strategy };
}

/**
 * Every word of a flag list this command did not consume, in words (#64).
 *
 * A flag face that reads the flags it knows and ignores the rest answers *something* for every
 * spelling a person can get wrong, and the answer is silence: `--test false` starts a test run and
 * leaves `false` lying there, `--test=false` is not `--test` at all and starts an ordinary Campaign,
 * and a misspelled `--generation 2` runs to the default limit. None of those is a refusal, and every
 * one of them is a Campaign the person did not ask for.
 *
 * @param flags - the words after the positional arguments.
 * @param takesAValue - the options that swallow the word after them.
 * @param bare - the options that say one thing and take no value.
 * @returns the refusal, naming the first word nothing consumed, or undefined when every word was.
 */
function unconsumedArgument(
  flags: readonly string[],
  takesAValue: readonly string[],
  bare: readonly string[],
): string | undefined {
  const seen = new Set<string>();
  for (let i = 0; i < flags.length; i++) {
    const word = flags[i]!;
    if (seen.has(word) && !['--goal', '--param', '--set'].includes(word)) return `duplicate option "${word}"`;
    seen.add(word);
    if (takesAValue.includes(word)) { i += 1; continue; }
    if (bare.includes(word)) continue;
    // `--anything` this command does not declare, including `--test=false`, which is one word and is
    // not the flag `--test`; and a bare word left over, which is what `--test false` leaves behind.
    return word.startsWith('-') ? `unknown option "${word}"` : `unexpected argument "${word}"`;
  }
  return undefined;
}

/**
 * One numeric flag of a Run, validated against what `runArguments` says it may be. `absent` when the
 * flag was not typed at all; an error when it was typed with no value, a non-number, or a number
 * this flag cannot mean — a flag typed wrongly never reads as "not given".
 */
function numericFlag(flags: readonly string[], name: RunArgumentName, spelling: string): { value: number | undefined } | { error: string } {
  if (!flagPresent(flags, spelling)) return { value: undefined };
  const raw = flagValue(flags, spelling);
  const value = numericValue(raw) ?? Number.NaN;
  if (raw === undefined || !allowsRunArgument(name, value)) return { error: badRunArgument(name, spelling, raw ?? '') };
  return { value };
}

export async function handleHimaCommand(deps: FabricDeps, { rawInput, agent }: CommandInvocation): Promise<CommandResult> {
  const [sub = '', ...rest] = rawInput.trim().split(/\s+/).filter(Boolean);
  if (sub === '' || sub === 'version') return { kind: 'success', text: versionLine() };
  if (sub === 'observe') {
    const [site, path, ...flags] = rest;
    const usage = 'usage: /hima observe <site> <path> [--reader <id>] [--run <runId>] [--judge <id,id,...>] [--param <name>=<value>]...';
    if (!site || !path) return { kind: 'error', text: usage };
    const reader = flagValue(flags, '--reader');
    const run = flagValue(flags, '--run');
    const rules = flagValue(flags, '--judge');
    // Validate flags before touching the ledger: a flag typed with no value must never read as "not given".
    if (flagPresent(flags, '--reader') && !reader) return { kind: 'error', text: usage };
    if (flagPresent(flags, '--run') && !run) return { kind: 'error', text: usage };
    if (flagPresent(flags, '--judge') && !rules) return { kind: 'error', text: usage };
    const parsedParams = parseParamFlags(flags);
    if ('error' in parsedParams) return { kind: 'error', text: `${usage}\n${parsedParams.error}` };
    let result: ObserveResult;
    try {
      if (run && deps.ledger.run(run)?.control) return { kind: 'error', text: 'Agent-owned Run observations require hima_execute with an admitted execution' };
      result = await observe(deps, { site, path, reader, run });
    } catch (err) {
      // A run reference the caller got wrong is theirs to fix and nothing was written; every other
      // fault propagates as it always has.
      if (err instanceof RunReferenceError) return { kind: 'error', text: `cannot observe ${path} on ${site}: ${err.message}` };
      throw err;
    }
    if (result.kind !== 'observed') return { kind: 'error', text: describeObserveResult(result) };
    if (!rules) return { kind: 'success', text: describeObserveResult(result) };
    // One invocation: read, ledger, judge.
    const ruled = await judged(deps, result.run.id, rules, parsedParams.params);
    return ruled.kind === 'success'
      ? { kind: 'success', text: [describeObserveResult(result), ruled.text].join('\n') }
      : { kind: 'error', text: [describeObserveResult(result), ruled.text].join('\n') };
  }
  if (sub === 'judge') {
    const [runId, ...flags] = rest;
    const rules = flagValue(flags, '--rules');
    if (!runId || !rules) return { kind: 'error', text: 'usage: /hima judge <runId> --rules <id,id,...> [--param <name>=<value>]...' };
    const parsedParams = parseParamFlags(flags);
    if ('error' in parsedParams) return { kind: 'error', text: parsedParams.error };
    return judged(deps, runId, rules, parsedParams.params);
  }
  if (sub === 'job') return handleJob(deps, rest);
  if (sub === 'pack') return handlePack(deps, rest);
  if (sub === 'run') return handleRun(deps, rest, String(agent.id));
  if (sub === 'resume') return handleResume(deps, rest, String(agent.id));
  if (sub === 'status') return handleStatus(deps, rest);
  if (sub === 'cancel') return handleCancel(deps, rest);
  return { kind: 'error', text: `unknown hima command "${sub}"; try /hima version, /hima observe <site> <path>, /hima judge <runId> --rules <id,...>, /hima job launch|status|tail|kill, /hima pack check|prepare|release, /hima run <pack> --site <site> --goal <name>=<value>, /hima resume <runId>, /hima status <runId>, or /hima cancel <runId>` };
}

/** Prepare a Campaign for this actual command conversation; business nodes remain Agent-owned. */
async function handleRun(deps: FabricDeps, rest: readonly string[], ownerSessionId: string): Promise<CommandResult> {
  const [pack = '', ...flags] = rest;
  const usage = 'usage: /hima run <pack> --site <site> --goal <name>=<value>... [--set <knob>=<value>]... [--test] [--time-box <minutes>] [--retries <n>] [--generations <n>]';
  const wrong = { kind: 'error', text: usage } as const;
  const site = flagValue(flags, '--site');
  if (!pack || pack.startsWith('--') || !site) return wrong;
  // Before anything is parsed out of them, every word of the flag list is one this command consumes
  // (#64). `--test` is the reason: a bare flag beside five that take values is exactly where a
  // person writes `--test false`, and a Campaign marked as a test when they asked for the opposite
  // is a Run whose whole meaning is wrong and which said nothing about it.
  const leftOver = unconsumedArgument(flags, ['--site', '--goal', '--set', '--time-box', '--retries', '--generations'], ['--test']);
  if (leftOver !== undefined) return { kind: 'error', text: `${usage}\n${leftOver}` };
  const goal = parseNamedNumbers(flags, '--goal');
  if ('error' in goal) return { kind: 'error', text: `${usage}\n${goal.error}` };
  if (Object.keys(goal.params).length === 0) return wrong;
  const set = parseSetFlags(flags);
  if ('error' in set) return { kind: 'error', text: `${usage}\n${set.error}` };
  const timeBox = numericFlag(flags, 'timeBox', '--time-box');
  if ('error' in timeBox) return { kind: 'error', text: `${usage}\n${timeBox.error}` };
  const retries = numericFlag(flags, 'retries', '--retries');
  if ('error' in retries) return { kind: 'error', text: `${usage}\n${retries.error}` };
  const generations = numericFlag(flags, 'generations', '--generations');
  if ('error' in generations) return { kind: 'error', text: `${usage}\n${generations.error}` };

  let result: StartRunResult;
  try {
    result = await startRun(deps, {
      ownerSessionId: legacyAutomaticAllowed() ? undefined : ownerSessionId,
      pack,
      site,
      goal: goal.params,
      strategy: set.strategy,
      // A bare flag, because it says one thing and has no value to get wrong (#64): a Run of a pack
      // this person is authoring is a test run whether or not they say so, and this is how they say
      // so of a released pack they want to exercise without it counting as a Campaign.
      ...(flagPresent(flags, '--test') ? { test: true } : {}),
      timeBoxMs: timeBox.value === undefined ? undefined : Math.round(timeBox.value * 60_000),
      retryAllowance: retries.value,
      generationLimit: generations.value,
    });
  } catch (err) {
    // A pack, a Site or a request the caller got wrong is theirs to fix; every other fault
    // propagates as it always has.
    if (err instanceof PackNotFoundError || err instanceof PackFolderError || err instanceof SiteNotFoundError || err instanceof RunStartError || err instanceof RunReferenceError) {
      return { kind: 'error', text: `/hima run ${pack}: ${err.message}` };
    }
    // A fault mid-drive is already recorded against the Run: the message, and the Run as it now
    // stands, which is what a person needs to see what the generation did get as far as.
    if (err instanceof RunFaultError) {
      const stopped = deps.ledger.run(err.runId);
      return { kind: 'error', text: stopped ? [err.message, describeRun(deps, stopped)].join('\n') : err.message };
    }
    // A Site that could not be asked is ours and not the caller's, and nothing was written for it
    // (#18): the message names the Site and says what could not be asked, which is where a person
    // goes next. No Run is shown with it, precisely because the Run's row is untouched — the Job
    // this harness launched may still be running there, and the next boot asks again.
    if (err instanceof SiteUnreadableError) return { kind: 'error', text: `/hima run ${pack}: ${err.message}` };
    throw err;
  }
  if (result.kind === 'unfit') return { kind: 'error', text: describePackCheck(result.check) };
  if (result.kind === 'unprepared') {
    return { kind: 'error', text: [describePrepare(result.prepared), describeRun(deps, result.run)].join('\n') };
  }
  const text = describeRun(deps, result.run);
  // A Run that reached a final state is a success, whichever one: `ended-goal-not-met` is a real
  // result, so is a spent time box, and so is a Run a person cancelled from another face while this
  // command waited for it. What is an error is a Run that stopped needing a person.
  return { kind: result.run.control || hasEnded(result.run.status) ? 'success' : 'error', text };
}

/**
 * The `/hima resume` face: clear a waiting Run and carry it on. The person who typed it is who the
 * ledger records — a Hard blocker is by definition something the harness could not clear itself,
 * so the record says whose session cleared it.
 *
 * The answer is the Run as `/hima status` shows it, and success means the same thing it means for
 * `/hima run`: a Run that ended, whichever way it ended — a cancel a person asked for from another
 * face while this command was still waiting included, because that cancel did exactly what it was
 * asked. A Run that could not be resumed, or that blocked again, is an error — it still needs a
 * person.
 */
async function handleResume(deps: FabricDeps, rest: readonly string[], who: string): Promise<CommandResult> {
  const [runId] = rest;
  if (!runId || rest.length > 1) return { kind: 'error', text: 'usage: /hima resume <runId>' };
  let result: ResumeResult;
  try {
    result = await resumeRun(deps, { runId, who });
  } catch (err) {
    // A run or a pack the caller got wrong is theirs to fix and nothing was written; a fault
    // mid-drive is already recorded against the Run and is shown with the Run it stopped.
    if (err instanceof RunReferenceError || err instanceof PackNotFoundError || err instanceof PackFolderError || err instanceof SiteNotFoundError) {
      return { kind: 'error', text: `/hima resume ${runId}: ${err.message}` };
    }
    if (err instanceof RunFaultError) {
      const stopped = deps.ledger.run(err.runId);
      return { kind: 'error', text: stopped ? [err.message, describeRun(deps, stopped)].join('\n') : err.message };
    }
    // As `/hima run`: ours, not the caller's, and nothing was written (#18).
    if (err instanceof SiteUnreadableError) return { kind: 'error', text: `/hima resume ${runId}: ${err.message}` };
    throw err;
  }
  if (result.kind === 'not-waiting') {
    return { kind: 'error', text: `cannot resume ${runId}: ${notWaitingToResume(result.run.status)}` };
  }
  if (result.kind === 'unresumable') return { kind: 'error', text: `cannot resume ${runId}: ${unresumableReason(result.reason)}` };
  const text = [`resumed ${runId} at node ${result.nodeId}; recorded as ${result.record.id}`, describeRun(deps, result.run)].join('\n');
  // The same final states `/hima run` counts as an ending, and for the same reason: `cancelled` is
  // now reachable from a drive this command is waiting on — a person resumes a blocked Run and then
  // stops it from another face — and answering that as an error would have one event told two ways
  // by two faces of one harness.
  return { kind: result.run.control || hasEnded(result.run.status) ? 'success' : 'error', text };
}

/** The `/hima status` face: where a Run stands, read from its records and nothing else. */
function handleStatus(deps: FabricDeps, rest: readonly string[]): CommandResult {
  const [runId] = rest;
  if (!runId || rest.length > 1) return { kind: 'error', text: 'usage: /hima status <runId>' };
  const run = deps.ledger.run(runId);
  if (!run) return { kind: 'error', text: `unknown run "${runId}": the HimaLedger holds no such run` };
  return { kind: 'success', text: describeRun(deps, run) };
}

/**
 * The `/hima cancel` face: stop a Run and say what was stopped.
 *
 * A Run that already ended is a success answering with its status — a person asking a finished Run
 * to stop has asked for something that is already true, and telling them so is the answer, not an
 * error. What is an error is a Run that was NOT stopped: a kill that did not take, and a Run
 * HimaFabric never started, where there is nothing to cancel at all.
 */
async function handleCancel(deps: FabricDeps, rest: readonly string[]): Promise<CommandResult> {
  const [runId] = rest;
  if (!runId || rest.length > 1) return { kind: 'error', text: 'usage: /hima cancel <runId>' };
  try {
    if (deps.ledger.run(runId)?.control) return { kind: 'error', text: 'use hima_context then hima_execute cancel with current owner epoch and revision' };
    const result = await cancelRun(deps, runId);
    const text = describeCancel(deps, result);
    return { kind: result.kind === 'cancelled' || result.kind === 'ended' ? 'success' : 'error', text };
  } catch (err) {
    // A run the caller got wrong is theirs to fix and nothing was written; every other fault
    // propagates as it always has.
    if (err instanceof RunReferenceError) return { kind: 'error', text: `/hima cancel ${runId}: ${err.message}` };
    // The Site could not be asked, so nothing was stopped and nothing may claim it was (#18). The
    // request itself is on the ledger, as it always is before anything is sent to a Site; what is
    // not there is a stop nobody observed.
    if (err instanceof SiteUnreadableError) return { kind: 'error', text: `/hima cancel ${runId}: ${err.message}` };
    throw err;
  }
}

/**
 * The `/hima pack` face: hold a HimaPack against a Site, and give a Campaign the workspace its
 * generations run in. Both name the pack first and the Site with `--site`, because a pack is the
 * thing being asked about and a Site is what it is being asked about against.
 */
async function handlePack(deps: FabricDeps, rest: readonly string[]): Promise<CommandResult> {
  const [verb = '', pack = '', ...flags] = rest;
  const usage = [
    'usage: /hima pack check <pack> --site <site>',
    '       /hima pack prepare <pack> --site <site> [--campaign <id>]',
    '       /hima pack release <pack>',
  ].join('\n');
  const wrong = { kind: 'error', text: usage } as const;
  if ((verb !== 'check' && verb !== 'prepare' && verb !== 'release') || !pack) return wrong;
  // The release names no Site and takes no other flag: it seals a folder against the Run that tested
  // it, and every fact it uses is on this machine. A `--site` typed at it is a person expecting it to
  // check something it does not check, which is worth the usage line rather than a silent pass.
  if (verb === 'release') {
    if (flags.length > 0) return wrong;
    try {
      const released = releasePack(deps, { pack });
      if (released.kind === 'refused') return { kind: 'error', text: released.reason };
      const { sealed } = released;
      return {
        kind: 'success',
        text: [
          `${released.rewritten ? 'resealed' : 'released'} pack ${sealed.pack}@${sealed.version} at ${released.file}`,
          `  ${counted(Object.keys(sealed.files).length, 'file')} sealed, on test record ${sealed.test.record} of run ${sealed.test.run}`,
        ].join('\n'),
      };
    } catch (err) {
      if (err instanceof PackNotFoundError) return { kind: 'error', text: `/hima pack release: ${err.message}` };
      throw err;
    }
  }
  const site = flagValue(flags, '--site');
  // A flag typed with no value must never read as "not given".
  if (!site) return wrong;
  const campaign = flagValue(flags, '--campaign');
  if (flagPresent(flags, '--campaign') && !campaign) return wrong;
  if (verb === 'check' && campaign !== undefined) return wrong;
  if (campaign !== undefined) {
    const issue = campaignIdIssue(campaign);
    if (issue) return { kind: 'error', text: `${usage}\n${issue}` };
  }
  try {
    if (verb === 'check') {
      const result = checkInstalledPack(deps, { pack, site });
      return { kind: packCheckFit(result) ? 'success' : 'error', text: describePackCheckResult(result) };
    }
    const result = await prepareWorkspace(deps, { pack, site, campaign });
    const text = describePrepare(result);
    return result.kind === 'prepared' || result.kind === 'reused' ? { kind: 'success', text } : { kind: 'error', text };
  } catch (err) {
    // A pack or a site the caller named wrongly is theirs to fix and nothing was written; so is a
    // folder that is not a folder of plain files (#64), which is a path a person can go and look at.
    // A pack whose own files are broken, or any other fault, propagates as it always has.
    if (err instanceof PackNotFoundError || err instanceof PackFolderError || err instanceof SiteNotFoundError || err instanceof RunReferenceError) {
      return { kind: 'error', text: `/hima pack ${verb}: ${err.message}` };
    }
    throw err;
  }
}

/**
 * The `/hima job` face: launch a Job on a Site, ask what became of it, read its log, stop it. Every
 * form but launch names the Run the Job belongs to and the tmux session it runs in, which is what
 * the launch's own record says — a Job is found again through the ledger, never through a handle.
 */
async function handleJob(deps: FabricDeps, rest: readonly string[]): Promise<CommandResult> {
  const [verb = '', ...args] = rest;
  const usage = [
    'usage: /hima job launch <site> <workspace> [--run <runId>] [--name <n>] -- <command...>',
    '       /hima job status <runId> <session>',
    '       /hima job tail <runId> <session> [--lines <n>]',
    '       /hima job kill <runId> <session>',
  ].join('\n');
  const wrong = { kind: 'error', text: usage } as const;
  try {
    if (verb === 'launch') {
      // Everything after `--` is the command; the words before it are this face's own. The command's
      // words are separated by whitespace, as every other argument of this command face is.
      const at = args.indexOf('--');
      if (at < 0) return wrong;
      const [siteName, workspace, ...flags] = args.slice(0, at);
      const argv = args.slice(at + 1);
      if (!siteName || !workspace || argv.length === 0) return wrong;
      const run = flagValue(flags, '--run');
      if (run && deps.ledger.run(run)?.control) return { kind: 'error', text: 'Agent-owned Run Jobs require hima_execute with an admitted execution' };
      const name = flagValue(flags, '--name');
      // A flag typed with no value must never read as "not given".
      if (flagPresent(flags, '--run') && !run) return wrong;
      if (flagPresent(flags, '--name') && !name) return wrong;
      // The Site's cap governs this face too, through the one claim-and-launch step in `job-cap.ts`,
      // which states why. What is this face's own is what it does with a full Site: refuse, and name
      // what is filling it.
      const site = loadSite(deps.sitesDir, siteName);
      const claimed = await claimSlot(deps, {
        // The Site as it names itself, never the name as typed, for the reason `claimSlot` states.
        site: { name: site.name, jobs: site.capacity.parallelJobs, licences: site.capacity.licences },
        // A Job launched by hand runs a command line a person typed, which no pack's contract
        // describes: nothing says what it would hold, so it reserves nothing and is counted against
        // the Site's job slots alone.
        holds: {},
        launch: () => launchJob(deps, { site: site.name, workspace, argv, name, run }),
      });
      if (claimed.kind === 'at-cap') return { kind: 'error', text: describeAtCap(site.name, claimed.full, claimed.holding) };
      // The Site would not say how many Jobs it is running, so nothing was launched and nothing was
      // written (#18). This face has no Run to wait for a slot on — there is only the launch a person
      // asked for — so it refuses by raising, and the handler's own catch below answers it in the
      // Site's own words.
      if (claimed.kind === 'unreadable') throw claimed.error;
      const text = describeLaunch(claimed.launched);
      return claimed.launched.kind === 'launched' ? { kind: 'success', text } : { kind: 'error', text };
    }
    if (verb === 'status' || verb === 'kill') {
      const [runId, session] = args;
      if (!runId || !session || args.length > 2) return wrong;
      if (verb === 'status') {
        return { kind: 'success', text: describeJobStatus(session, await jobStatus(deps, { run: runId, session })) };
      }
      if (deps.ledger.run(runId)?.control) return { kind: 'error', text: 'Agent-owned Run Job stopping requires hima_execute cancel' };
      const killed = await jobKill(deps, { run: runId, session });
      // A kill that did not take is not a success. `jobKill` waited for the session to be observed
      // gone and it is still there, so the Job is still running and nothing was recorded — the
      // caller has to know that from the outcome, not only from reading the sentence.
      const took = !killed.outcome.wasRunning || killed.outcome.gone;
      return { kind: took ? 'success' : 'error', text: describeJobKill(session, killed) };
    }
    if (verb === 'tail') {
      const [runId, session, ...flags] = args;
      if (!runId || !session) return wrong;
      const asked = flagValue(flags, '--lines');
      if (flagPresent(flags, '--lines') && !asked) return wrong;
      const lines = asked === undefined ? undefined : Number(asked);
      if (lines !== undefined && (!Number.isInteger(lines) || lines <= 0)) return wrong;
      const tailed = await jobTail(deps, { run: runId, session, lines });
      return { kind: 'success', text: tailed.text };
    }
    return wrong;
  } catch (err) {
    // A run or a session the caller got wrong is theirs to fix and nothing was written; every other
    // fault propagates as it always has.
    if (err instanceof RunReferenceError) return { kind: 'error', text: `/hima job ${verb}: ${err.message}` };
    // A Site that could not be asked is ours and not the caller's, and no state is claimed for the
    // Job (#18): not `gone`, not `finished`, not a kill that took. The message names the Site and
    // carries the Site's own words about why, which is what a person acts on.
    if (err instanceof SiteUnreadableError) return { kind: 'error', text: `/hima job ${verb}: ${err.message}` };
    throw err;
  }
}

/** Ask HimaJudge for a verdict per rule and report them; an unknown rule or run is an error, never a pass. */
async function judged(deps: FabricDeps, runId: string, rules: string, params?: Readonly<Record<string, number>>): Promise<CommandResult> {
  if (deps.ledger.run(runId)?.control) return { kind: 'error', text: 'Agent-owned Run judgment requires hima_execute with an admitted execution' };
  const ruleIds = ruleList(rules);
  if (ruleIds.length === 0) return { kind: 'error', text: 'no rule ids given; expected --rules <id,id,...>' };
  try {
    const verdicts = await deps.judge.evaluate({ runId, ruleIds, params });
    return { kind: 'success', text: verdicts.map(describeVerdict).join('\n') };
  } catch (err) {
    return { kind: 'error', text: `cannot judge ${runId}: ${(err as Error).message}` };
  }
}
