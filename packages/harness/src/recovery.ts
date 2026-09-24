import { releaseExitFence } from './host-exit.js';
// Finding a Run again, and stopping one: what a host does with the Runs the last one left in flight,
// and what a person's cancel does to a Run that is still going. One reason to change: how a Run that
// nothing is driving is picked up, or put down.
//
// Production recovery observes already admitted Jobs and preserves execution ownership. Historical
// automatic Runs keep their records and need a verified explicit adoption before business work.
// The old driver below is reachable only in the explicitly enabled Node regression fixture.
//
// A Run is not stopped until the stop is observed, and a Run picked up again is never relaunched.
// Those two are what the whole of this module is written around: nothing here may say a licence was
// released while the tool still holds it, and nothing here may pay a second licence-minute for an
// attempt that is already running on the Site.
import { boundInputs, positionOf, substitute, workspaceFileName, type Pack, type PackNode } from './packs.js';
import { createHash } from 'node:crypto';
import { channelFor } from './channel.js';
import { decideRead } from './shell.js';
import { workspaceFile } from './workspace.js';
import { loadRunPack } from './release.js';
import { jobKill, jobStatus, reconcileLaunchIntent } from './jobs.js';
import { loadSite, pathsOf } from './sites.js';
import { existingRun, legacyAutomaticAllowed } from './runs.js';
import { recordNode } from './ledger.js';
import type { JobRecord, NodeState, RunFork, RunRecord, WorkspaceRecord } from './ledger.js';
import { openJobsOfRun } from './job-cap.js';
import { advance, endBudgetExhausted, attemptOf, attemptOfSession, currentAttemptOf, waitedMsOf } from './budget.js';
import { killDidNotTake, type Driving, type FabricDeps } from './node-turns.js';
import { SiteUnreadableError } from './errors.js';
import { counted } from './words.js';
import { drive, controlling, reconcileAppliedRevisions, scheduleExecutionDeadline, scheduleExecutionStop, executionDriving, observeExecution, updateExecution, identityOf, executionContext, type ExecutionActionRequest, type ExecutionActionResult } from './fabric.js';
import { owesAnExperience, owesRunAssets, writeExperience } from './experience.js';
import { closeInterruptedMoments } from './moments.js';

// ---------------------------------------------------------------------------------------------
// Finding a Run again: what a host does with the Runs the last one left in flight.
// ---------------------------------------------------------------------------------------------

/**
 * What reconciliation found for one Run, in the words the `reconciled` record carries. Answered
 * rather than only logged because the host has no other way to say what it did at start, and because
 * a test asserting on a restart must be able to ask what was found rather than infer it.
 */
export interface ReconcileOutcome {
  readonly runId: string;
  /**
   * `running`, `finished` and `gone` are what the Run's open Job turned out to be; `nothing-open` is
   * a Run left `running` with no Job of its current node to find; `never-started` a Run HimaFabric
   * opened and never gave a workspace; `stopped-elsewhere` a Run that stopped saying `running` while
   * this reconciliation was working towards it or asking the Site about it — a person's cancel — and
   * which is therefore left exactly as that face left it; `unreadable` a Run this host could not pick
   * up at all — its pack is not installed here, its Site file is gone, its workspace record is
   * missing; and `site-unreadable` a Run whose Site would not answer about the Job it has open (#18)
   * — or, for a Run that is already over, would not take the report it is owed — which is a fact
   * about a machine and not about the Run, and which the next boot asks about again. Those three
   * write nothing at all, and each says which of the two was being attempted.
   *
   * `experience` is the one Run this reconciliation touches that is already over: a Run whose ending
   * landed and whose Campaign report did not, because the host that ended it went away in between
   * (#30). Nothing about the Run moves — it ended as it ended — and what is written is the report it
   * was owed, on the Site and on the ledger.
   */
  readonly found: 'running' | 'finished' | 'gone' | 'nothing-open' | 'never-started' | 'stopped-elsewhere' | 'unreadable' | 'site-unreadable' | 'experience' | 'uncertain';
  readonly detail: string;
}

/**
 * Pick up every Run the last process left in flight, once, when a host starts.
 *
 * A Run's whole state is in the ledger, so this is the ledger's own question: which Runs still say
 * they are running, and what became of the Job each one was waiting for. Every answer is the Site's,
 * asked through the same `jobStatus` the waiting loop asks with, and every one of them is written
 * down as a `reconciled` node record before anything acts on it.
 *
 * **Nothing is relaunched.** A Job is found again through its own `launched` record and waited for
 * where it stands, so exactly one `launched` record exists per attempt whatever a host did in the
 * middle of it — which is what makes a restart cost nothing on a Site where a generation is two and a
 * half minutes of licensed synthesis.
 *
 * A Job that is *gone* is a failed attempt, and what becomes of it is the Retry allowance's to say,
 * exactly as it is for an attempt that failed while a host was watching: another turn at the node
 * while the allowance stands, and only when it is spent a Hard blocker and a Run waiting for a
 * person. So a host starting on a ledger whose Job vanished does launch a fresh Job with nobody
 * having asked — a licence-minute this boot spends — and that is a new attempt under a new number,
 * never a second launch of the one that vanished. Which is why the allowance is read off the run row
 * the person who started the Run set, and the attempt off the node's own records.
 *
 * Runs are picked up one after another, and a Run resumed here is waited for before the next is
 * looked at: a Site declares how many Jobs may run on it at once (one, on both Sites this harness
 * reaches), and a host that resumed every interrupted Run at the same moment would be the first thing
 * in this harness to ignore that. The cap itself is counted at every launch wherever it comes from
 * (`heldJobSlots`, through `claimSlotAndLaunch`); taking Runs one at a time here is what keeps a boot
 * from queueing every interrupted Run behind one slot before a person has seen any of them.
 *
 * @param deps - the ledger, HimaJudge, and where sites and packs are installed.
 * @returns what was found for each Run it touched, in the order it touched them.
 */
export async function reconcileRuns(deps: FabricDeps): Promise<ReconcileOutcome[]> {
  const out: ReconcileOutcome[] = [];
  // Before any Run is looked at: a Model moment lives in one process, so every moment this ledger
  // still has open belonged to the host that went away, and the close it is missing is written here
  // (#59). Over every Run rather than inside the walk below, because that walk passes over the Runs
  // this reconciliation has nothing else to do with — a Run that is over, or one no fabric started —
  // and a session left hanging open on such a Run would be one no boot ever closed.
  for (const closed of await closeInterruptedMoments(deps.ledger)) {
    deps.log?.(`hima: closed an interrupted model moment of ${closed.runId}: session ${closed.sessionId} at ${closed.nodeId}`);
  }
  for (const run of deps.ledger.runs()) {
    // A Run HimaFabric opened is one carrying the pack it runs; anything else in this ledger is an
    // observation's own Probe-campaign Run, which no fabric ever started and none may end.
    if (run.packId === undefined) continue;
    // An ending owes the same mechanical report in every execution mode. Do this before mode
    // dispatch, which deliberately never sends owned/historical Runs into the automatic driver.
    if (owesAnExperience(deps.ledger, run) || owesRunAssets(deps.ledger, run)) {
      try { out.push(await reportExperience(deps, run)); }
      catch (error) {
        out.push({ runId: run.id, found: error instanceof SiteUnreadableError ? 'site-unreadable' : 'unreadable',
          detail: `this run has ended and its campaign's experience could not be written: ${(error as Error).message}` });
      }
      continue;
    }
    if (run.control !== undefined) {
      try { out.push(await controlling(deps, run.id, () => reconcileControlledRun(deps, run))); }
      catch (error) { out.push({ runId: run.id, found: 'unreadable', detail: (error as Error).message }); }
      scheduleExecutionDeadline(deps, run.id);
      if (existingRun(deps.ledger, run.id).control?.stop !== undefined) scheduleExecutionStop(deps, run.id);
      continue;
    }
    if (!legacyAutomaticAllowed()) {
      try { out.push(await reconcileHistoricalRun(deps, run)); }
      catch (error) { out.push({ runId: run.id, found: error instanceof SiteUnreadableError ? 'site-unreadable' : 'unreadable', detail: (error as Error).message }); }
      continue;
    }
    // A Run that is over is not this reconciliation's to advance, and there is exactly one thing it
    // may still owe: the Campaign's technical report, if the host that ended it went away before it
    // could be written (#30). A Run that has its report is passed over as it always was.
    const over = run.status !== 'running' && run.status !== undefined;
    if (over && !owesAnExperience(deps.ledger, run)) continue;
    try {
      out.push(over
        ? await reportExperience(deps, run)
        : run.status === undefined ? await reportNeverStarted(deps, run) : await reconcileRunningRun(deps, run));
    } catch (err) {
      // What failed, said as the thing that was being attempted: a Run that is over was asked for
      // nothing but its Campaign's report (#30) and has no open Job to be asked about, so the two
      // are not described in one another's words. Neither writes anything either way.
      const attempted = over
        ? `this run has ended and its campaign's experience could not be written`
        : `this run's site could not be asked about the job it has open`;
      // Ticket #18: a Site that would not answer about this Run's Job is its own outcome, and not
      // this machine's inability to rebuild the Run. The Run is whole, its Job may well still be
      // running, and the only thing missing is an answer — so it is reported as what it is, left
      // exactly as it was, and asked about again at the next boot. Reading it as a Job that is gone
      // would relaunch a node behind a Job that is still holding a licence. A Site that would not
      // take an ended Run's report is the same shape of fact: the ending stands, the report is still
      // owed, and the next boot writes it.
      if (err instanceof SiteUnreadableError) {
        out.push({ runId: run.id, found: 'site-unreadable', detail: `${attempted}: ${err.message}` });
        continue;
      }
      // A pack that is no longer installed, a Site file that was removed, a workspace record that is
      // not there: this machine cannot rebuild the Run, and nothing is written for it. The Run keeps
      // exactly what it had, and the reason is answered so the host can log it.
      out.push({ runId: run.id, found: 'unreadable', detail: over ? `${attempted}: ${(err as Error).message}` : (err as Error).message });
    }
  }
  return out;
}

/** Old history remains old history. Collect only an already launched Job and its reader facts. */
async function reconcileHistoricalRun(deps: FabricDeps, run: RunRecord): Promise<ReconcileOutcome> {
  const records = deps.ledger.records({ runId: run.id });
  let found: ReconcileOutcome['found'] = 'nothing-open';
  for (const launch of records) {
    if (launch.type !== 'job' || launch.event !== 'launched') continue;
    if (records.some((record) => record.type === 'node' && record.jobSession === launch.job.session && ['done', 'retrying', 'blocked', 'cancelled'].includes(record.state))) continue;
    const status = await jobStatus(deps, { run: run.id, session: launch.job.session });
    found = status.state.state === 'running' ? 'running' : status.state.state === 'finished' ? 'finished' : 'gone';
    if (run.packDigest === undefined || launch.nodeId === undefined || launch.generation !== (run.loop?.generation ?? run.generation) || launch.loopId !== run.loop?.id) continue;
    const ctx = drivingFor(deps, run);
    const node = positionOf(ctx.pack, launch.nodeId)?.node;
    if (node !== undefined) observeExecution({ ...ctx, nonblocking: true, passiveObservation: true, ...(launch.branchId === undefined ? {} : { branchId: launch.branchId }) }, node, undefined, launch.job.session);
  }
  return { runId: run.id, found, detail: 'historical Run retained; only existing Job/reader facts are observed; explicit safe adoption is required before new business work' };
}

/** Rebuild only the exact admitted effect. No business operation or hidden Agent is started. */
async function reconcileControlledRun(deps: FabricDeps, snapshot: RunRecord): Promise<ReconcileOutcome> {
  let found: ReconcileOutcome['found'] = 'nothing-open';
  const details: string[] = [];
  const uncertainExecutions: string[] = [];
  const revisions = await reconcileAppliedRevisions(deps, snapshot.id);
  for (const revisionId of revisions.repaired) details.push(`revision ${revisionId}: completed its recorded applied effect; no business work was started`);
  for (const problem of revisions.problems) details.push(`revision recovery refused: ${problem}`);
  const recoveredSnapshot = existingRun(deps.ledger, snapshot.id);
  for (const execution of Object.values(recoveredSnapshot.control!.executions)) {
    if (execution.supersededBy !== undefined) continue;
    if (execution.phase !== 'working' && execution.phase !== 'uncertain') continue;
    const requests = Object.entries(existingRun(deps.ledger, snapshot.id).control!.requests)
      .filter(([, request]) => request.receipt.executionId === execution.id && request.state !== 'done');
    const uncertain = async (reason: string): Promise<void> => {
      uncertainExecutions.push(execution.id); details.push(`${execution.id}: ${reason}`);
      await updateExecution(deps, snapshot.id, execution.id, { phase: 'uncertain', reason });
      for (const [requestId] of requests) await updateExecution(deps, snapshot.id, execution.id, {}, requestId, 'uncertain');
    };
    if (requests.some(([, request]) => request.receipt.action !== 'work')) {
      await uncertain('the Host was interrupted during an admitted non-Job action; its prior Job does not establish whether that action committed; it was not replayed');
      continue;
    }
    let session = execution.jobSession;
    if (execution.intent !== undefined) {
      const recovered = await reconcileLaunchIntent(deps, execution.intent);
      if (recovered.kind === 'uncertain') { await uncertain(recovered.reason); continue; }
      session = recovered.record.job.session;
    }
    if (session === undefined) {
      await uncertain('the Host was interrupted after admission without a confirmed effect; inspect the original request and evidence; it was not replayed');
      continue;
    }
    try {
      const ctx = executionDriving(deps, existingRun(deps.ledger, snapshot.id), execution);
      const node = positionOf(ctx.pack, execution.nodeId)?.node;
      if (node === undefined) throw new Error('the retained method does not declare this execution node');
      const status = await jobStatus(deps, { run: snapshot.id, session });
      if (status.job === undefined) { await uncertain(`no recorded Job establishes session ${session}`); continue; }
      await updateExecution(deps, snapshot.id, execution.id, { phase: 'working', jobSession: session });
      for (const [requestId] of requests) await updateExecution(deps, snapshot.id, execution.id, {}, requestId);
      found = status.state.state === 'running' ? 'running' : status.state.state === 'finished' ? 'finished' : 'gone';
      details.push(`${execution.id}: observing original Job ${session}; no next node was started`);
      observeExecution(ctx, node, execution, session);
    } catch (error) { await uncertain((error as Error).message); }
  }
  // Non-Job admissions have no recoverable process effect. Preserve the request and expose its gap.
  const run = existingRun(deps.ledger, snapshot.id);
  const control = run.control!;
  const interrupted = Object.entries(control.requests).filter(([, request]) => request.state === 'admitted' && request.receipt.action !== 'cancel');
  if (interrupted.length > 0) {
    const requests = { ...control.requests };
    const executions = { ...control.executions };
    for (const [id, request] of interrupted) {
      requests[id] = { ...request, state: 'uncertain' };
      const execution = request.receipt.executionId === undefined ? undefined : executions[request.receipt.executionId];
      if (execution !== undefined && execution.phase !== 'completed') executions[execution.id] = { ...execution, phase: 'uncertain', reason: 'the Host was interrupted after admission without a confirmed effect; this action was not replayed' };
    }
    await deps.ledger.advanceRun(run.id, { control: { ...control, requests, executions } });
    found = 'uncertain'; details.push('an admitted request has no confirmed effect and was not replayed');
  }
  // A crash can follow the actual launch before claimSlotAndLaunch counted it. Recovered receipts
  // are actual expenditure too; never lower an existing historical meter or count a Job twice.
  const launched = deps.ledger.records({ runId: run.id, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched' && record.nodeId !== undefined).length;
  const held = existingRun(deps.ledger, run.id).meters?.jobsLaunched ?? 0;
  if (launched > held) await advance(deps.ledger, run.id, { jobs: launched - held });
  if (uncertainExecutions.length === 0 && revisions.problems.length === 0 && !Object.values(existingRun(deps.ledger,run.id).control!.requests).some(r=>r.state==='uncertain')) await releaseExitFence(deps.ledger,run.id);
  return { runId: run.id, found: uncertainExecutions.length > 0 || revisions.problems.length > 0 ? 'uncertain' : found, detail: details.join('; ') || 'Agent-owned context retained; waiting for an explicit business action from its owner' };
}

/** Called only under Fabric's existing admission queue. Verification records present evidence. */
export async function adoptHistoricalRun(deps: FabricDeps, req: ExecutionActionRequest): Promise<ExecutionActionResult> {
  const answer = (kind: ExecutionActionResult['kind'], reason?: string): ExecutionActionResult => ({ kind, context: executionContext(deps, req.runId), ...(reason === undefined ? {} : { reason }) });
  const run = existingRun(deps.ledger, req.runId);
  if (!deps.host?.get('agents')?.list().some((agent) => String(agent.id) === req.actor)) return answer('refused', 'adoption requires the actual live conversation on this Host');
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(req.requestId)) return answer('refused', 'request identity must be a bounded plain identifier');
  const digest = identityOf(req);
  const before = run.control?.requests[req.requestId];
  if (run.control !== undefined) return before?.digest === digest && run.control.owner === req.actor && before.receipt.action === 'adopt'
    ? { ...answer('duplicate'), receipt: before.receipt } : answer('refused', 'this Run already has an owner; use explicit handoff');
  if (req.expectedEpoch !== 0 || req.expectedRevision !== 0) return answer('refused', 'historical adoption requires expected owner epoch and control revision 0');
  if (run.status !== 'running' && run.status !== 'waiting') return answer('refused', 'adoption requires a prepared unfinished Run at a safe node boundary');
  try {
    if (run.packId === undefined || run.packDigest === undefined) throw new Error('the original Run method digest is missing; the current Pack cannot establish that historical identity');
    const pack = loadRunPack(deps.packsDir, run.packId, run.packDigest);
    if (run.goal === undefined || run.budget === undefined || run.strategy === undefined || run.firstStrategy === undefined || run.generation === undefined || positionOf(pack, run.currentNode) === undefined) throw new Error('the original Goal, budget, strategy, generation or node boundary is missing');
    if (run.loop !== undefined || run.fork !== undefined) throw new Error('historical adoption requires an outer node boundary with no open Loop or fork');
    const records = deps.ledger.records({ runId: run.id });
    const prepared = records.findLast((record): record is WorkspaceRecord => record.type === 'workspace');
    if (prepared === undefined) throw new Error('the original workspace record is missing');
    const boundary = records.findLast((record) => record.type === 'node');
    const explicitWait = boundary?.type === 'node' && boundary.kind === 'wait' && boundary.state === 'blocked' && boundary.nodeId === run.currentNode;
    const closedJobBoundary = boundary?.type === 'node' && boundary.jobSession !== undefined && ['done', 'retrying', 'blocked', 'cancelled'].includes(boundary.state)
      && records.some((record) => record.type === 'job' && record.job.session === boundary.jobSession && record.event !== 'launched');
    if (!explicitWait && !closedJobBoundary) throw new Error('the historical boundary has no verified closed Job or explicit Wait node; absence of a launch receipt cannot prove no effect');
    for (const launch of records) {
      if (launch.type !== 'job' || launch.event !== 'launched') continue;
      const closed = records.some((record) => record.type === 'job' && record.job.session === launch.job.session && record.event !== 'launched');
      if (!closed) {
        const status = await jobStatus(deps, { run: run.id, session: launch.job.session });
        if (status.state.state !== 'finished') throw new Error(`Job ${launch.job.session} is ${status.state.state}; adoption requires no in-flight or uncertain Job`);
      }
      if (launch.nodeId !== undefined && !records.some((record) => record.type === 'node' && record.jobSession === launch.job.session && ['done', 'retrying', 'blocked', 'cancelled'].includes(record.state))) throw new Error(`Job ${launch.job.session} has no collected node/reader result; wait for existing fact collection before adoption`);
    }
    for (const session of records) {
      if (session.type === 'session' && session.event === 'opened' && !records.some((record) => record.type === 'session' && record.event === 'closed' && record.sessionId === session.sessionId)) throw new Error(`session ${session.sessionId} is still open; adoption needs a closed code/session boundary`);
    }
    const site = loadSite(deps.sitesDir, run.siteId);
    const channel = channelFor(site);
    const metadataPath = pathsOf(site).join(prepared.workspace, workspaceFileName);
    const permit = await decideRead(site, metadataPath, channel);
    if (!permit.ok) throw new Error(`workspace metadata cannot be verified: ${permit.reason}`);
    const bytes = await channel.readFile(permit.absPath);
    const parsed = workspaceFile.safeParse(JSON.parse(Buffer.from(bytes).toString('utf8')));
    if (!parsed.success) throw new Error('workspace.json is not valid original preparation metadata');
    const file = parsed.data;
    const mismatches: string[] = [];
    if ((file.pack.digest !== undefined && file.pack.digest !== run.packDigest) || (prepared.packDigest !== undefined && prepared.packDigest !== run.packDigest)) mismatches.push('method digest');
    if (file.pack.id !== run.packId || file.pack.id !== prepared.packId || file.pack.version !== prepared.packVersion || file.pack.version !== pack.contract.version) mismatches.push('Pack identity/version');
    if (file.campaign !== run.campaignId || file.campaign !== prepared.campaignId || file.site !== run.siteId) mismatches.push('Campaign/Site identity');
    if (file.workspace !== prepared.workspace || file.flowRoot !== prepared.flowRoot || file.design !== prepared.design || file.containerName !== prepared.containerName || file.preparedAt !== prepared.preparedAt || identityOf(file.copied) !== identityOf(prepared.copied)) mismatches.push('historical workspace/input metadata');
    const bindings = boundInputs(pack, site);
    if (bindings.flowRoot !== file.flowRoot || bindings.design !== file.design || pathsOf(site).join(bindings.workspaceRoot!, run.campaignId) !== file.workspace) mismatches.push('current Site input bindings');
    const copied = pack.contract.workspace.copy.map((entry) => substitute(entry, bindings, 'adoption copy identity'));
    if (identityOf([...copied].sort()) !== identityOf([...file.copied].sort())) mismatches.push('original method copy list');
    const unknownInputs = pack.contract.inputs.filter((input) => !['flowRoot', 'design', 'workspaceRoot'].includes(input.name));
    if (unknownInputs.length > 0) mismatches.push(`unrecorded input bindings: ${unknownInputs.map((input) => input.name).join(', ')}`);
    if (mismatches.length > 0) throw new Error(`cannot verify adoption: ${mismatches.join('; ')}`);
    const at = new Date().toISOString();
    const lastResume = records.findLast((record) => record.type === 'resumed')?.seq ?? 0;
    const blocker = run.status === 'waiting' ? records.findLast((record) => record.type === 'blocker' && record.seq > lastResume) : undefined;
    const legacyWaitedMs = waitedMsOf(deps.ledger, run.id) + (blocker === undefined ? 0 : Math.max(0, Date.parse(at) - Date.parse(blocker.at)));
    const receipt = { requestId: req.requestId, action: 'adopt', owner: req.actor, epoch: 1, data: { scope: '*', newHold: true } };
    await advance(deps.ledger, run.id, {}, { status: 'running', control: {
      mode: 'agent', owner: req.actor, epoch: 1, revision: 1, paused: ['*'], executions: {}, siteDigest: identityOf(site),
      adoption: { at, workspaceSeq: prepared.seq, workspaceMetadataSha256: createHash('sha256').update(bytes).digest('hex'), methodDigest: run.packDigest, legacyWaitedMs },
      requests: { [req.requestId]: { digest, actor: req.actor, epoch: 0, revision: 0, at, state: 'done', origin: req.origin ?? 'agent', receipt } },
    } });
    scheduleExecutionDeadline(deps, run.id);
    return { ...answer('accepted'), receipt };
  } catch (error) { return answer('refused', (error as Error).message); }
}

/**
 * A Run that ended under a host that then went away without writing its Campaign's technical report.
 *
 * The one thing a reconciliation does to a Run that is already over, and it does nothing to the Run:
 * the ending is on the ledger and final, the records it is composed from cannot move, and the report
 * this writes now is the same document that host would have written (#30, D44). A Site that will not
 * take it raises, and the Run is asked about again at the next boot — which is exactly the promise
 * the report's absence makes.
 */
async function reportExperience(deps: FabricDeps, run: RunRecord): Promise<ReconcileOutcome> {
  const wrote = await writeExperience(deps, run.id);
  const detail = wrote.kind === 'written'
    ? `this run ended as ${run.status ?? 'ended'} without its campaign's experience; it is now written to ${wrote.record.markdown.path} and ${wrote.record.json.path}`
    : wrote.kind === 'already'
      ? `this run's experience was already written to ${wrote.record.markdown.path}`
      : `this run ended as ${run.status ?? 'ended'} and has no experience to write: ${wrote.why}`;
  return { runId: run.id, found: 'experience', detail };
}

/**
 * A Run HimaFabric opened and never started: its Goal, its Budget and its pack are on the row and it
 * has no status at all, because preparing the Campaign workspace never finished.
 *
 * One shape reaches here, and the reason is written for it: a host that went away in the middle of
 * the preparation. A preparation that *answered* — a Permit refusal, an occupied workspace — is
 * blocked at the entry node by `startRun` in the words that answer used, and a fault preparation
 * threw is recorded there too, so neither of those is left for this. Which means there is no message
 * to recover here: the process that would have written one is gone. Nothing was launched either, so
 * there is nothing to find on the Site. The Run is reported as blocked at the node it would have
 * started at, and waits for a person.
 */
async function reportNeverStarted(deps: FabricDeps, run: RunRecord): Promise<ReconcileOutcome> {
  const pack = packOf(deps, run);
  const entry = pack.graph.nodes.find((n) => n.id === pack.graph.entry);
  const detail = `HimaFabric opened this run and never started it: campaign ${run.campaignId} got no workspace to run in, so nothing was launched anywhere`;
  if (entry) {
    await recordNode(deps.ledger, run.id, entry, 'blocked', attemptOf(deps.ledger, run.id, entry.id), { reason: `${detail}. The host that was preparing it went away before it could finish or say why; start the campaign again once a person has looked at it` });
  }
  await advance(deps.ledger, run.id, {}, { status: 'waiting', currentNode: pack.graph.entry });
  return { runId: run.id, found: 'never-started', detail };
}

/**
 * One Run that still says `running`, asked of the Site and carried on from what it answers.
 *
 * Every decision here is made from the run row **as it stands now**, never from the snapshot
 * `reconcileRuns` iterates. Those two are not the same row: Runs are picked up one after another and
 * each is waited for, so a Run's turn comes however long every Run ahead of it took — minutes, for a
 * resumed synthesis — and the routes have been answering since the host started. A person who
 * cancels a Run inside that window has ended it: the `killed` record, the node `cancelled`, the
 * status and `meters.endedBy` are all written, and the ledger is the only run state there is. A
 * reconciliation working from the stale row would then find nothing open (correctly — the cancel
 * stopped it), decide the Run had been left running with no Job, and write a blocker and `waiting`
 * over an ending a person asked for, putting a finished Run back in front of them as one needing
 * help. So the row is read again here and again before each write, and a Run that no longer says
 * `running` is left exactly as it is and reported as one this host did not touch.
 */
async function reconcileRunningRun(deps: FabricDeps, run: RunRecord): Promise<ReconcileOutcome> {
  const stillRunning = (): boolean => existingRun(deps.ledger, run.id).status === 'running';
  const leftAlone = (what: string): ReconcileOutcome => ({
    runId: run.id,
    found: 'stopped-elsewhere',
    detail: `${what}; the run was stopped from another face while it was being picked up, so nothing was written`,
  });
  if (!stillRunning()) return leftAlone('this run no longer says it is running');

  const ctx = drivingFor(deps, run);
  // A Run inside a fork is not waiting on the node it stands at — it stands at the join, which
  // launches nothing — but on one Job per branch (#29). So it is picked up branch by branch: each
  // branch with a Job open on the Site gets the `reconciled` record that says a second process took
  // that attempt over, and the drive then re-enters every branch, waiting for the Jobs that are still
  // there and re-running the nodes of the branches that have none. Nothing is relaunched that is
  // already running, which is the whole promise of picking a Run up rather than starting it again.
  const fork = existingRun(deps.ledger, run.id).fork;
  if (fork !== undefined) return reconcileFork(deps, run, ctx, fork);
  const at = existingRun(deps.ledger, run.id).currentNode;
  // Across the whole pack, its drill-down loops included: a Run interrupted inside a Loop stands at
  // one of that Loop's nodes, and node ids are unique across a pack precisely so a row's one
  // `currentNode` finds it wherever it was declared (#28).
  const node = positionOf(ctx.pack, at)?.node;
  const open = node === undefined ? undefined : await openJob(deps, run, node.id);
  if (node === undefined || open === undefined) {
    // The Run says `running` and its current node has no Job open on the Site: the host went away
    // between nodes, or at a node that launches nothing. Re-running such a node is not this host's
    // call to make on its own — it would read a report or judge one a second time without anyone
    // asking — so the Run is handed to a person, who resumes it (#15). What is not left standing is
    // the claim: a Run nothing is advancing does not go on saying it is running.
    const detail = node === undefined
      ? `this run stands at node ${at ?? '(none)'}, which pack ${ctx.pack.id} no longer declares`
      : `this run was left running at node ${node.id} with no job of that node open on the site`;
    // Asking the Site whether the launches this Run had accounted for are really gone took a round
    // trip of its own, and a person's cancel may have landed inside it. Read again before writing.
    if (!stillRunning()) return leftAlone(detail);
    if (node) {
      await recordNode(deps.ledger, run.id, node, 'blocked', currentAttemptOf(deps.ledger, run.id, node.id), { reason: `reconciled at start: ${detail}; nothing was relaunched` });
    }
    await advance(deps.ledger, run.id, {}, { status: 'waiting' });
    return { runId: run.id, found: 'nothing-open', detail };
  }

  const session = open.job.session;
  // The Site's own answer, through the same operation the waiting loop uses — which also writes the
  // `finished` record when this is the first look to see the Job end, exactly as a look from the loop
  // would have. The exit code is the one the launch wrote, never one inferred from a missing session.
  const state = (await jobStatus(deps, { run: run.id, session })).state;
  const found = state.state === 'running' ? 'running' : state.state === 'finished' ? 'finished' : 'gone';
  const detail = state.state === 'running'
    ? `job "${node.id}" in tmux session ${session} is still running; this run waits for it again`
    : state.state === 'finished'
      ? `job "${node.id}" in tmux session ${session} finished while no host was watching it: exit ${state.exitCode}`
      : `job "${node.id}" in tmux session ${session} is gone, and it wrote no exit status`;
  // Asking the Site took a round trip, and a person may have cancelled this Run inside it — the
  // routes answer from the moment the host starts, while this reconciliation is still running. That
  // face has written the Run's ending, including this node's own `cancelled` record, so nothing is
  // written on top of it: a `reconciled` record after a `cancelled` one would say a host took a node
  // over that nobody is advancing any more.
  if (!stillRunning()) return leftAlone(detail);
  // The attempt the interrupted turn opened, never a new one: this is the same attempt at the same
  // node, picked up by a second process, and numbering it afresh would say a Job was launched twice.
  const attempt = attemptOfSession(deps.ledger, run.id, node.id, session);
  await recordNode(deps.ledger, run.id, node, 'reconciled', attempt, { jobSession: session, reason: `reconciled at start: ${detail}` });
  try {
    await drive(ctx, { attempt, session });
  } catch (err) {
    // A fault while carrying the Run on is already recorded against the Run by the drive's own fault
    // boundary — the node blocked with the message, the Run waiting. It is reported here rather than
    // raised, because one Run that could not be carried on must not stop the next from being picked up.
    return { runId: run.id, found, detail: `${detail}; carrying it on then stopped: ${(err as Error).message}` };
  }
  return { runId: run.id, found, detail };
}

/**
 * One Run interrupted inside a fork, picked up branch by branch (#29).
 *
 * Every branch that is not `done` is re-entered, and what re-entering means is the branch drive's
 * own answer: a branch whose Job is still on the Site waits for that Job, and one with none re-runs
 * the node it stands at. This writes only what a reconciliation is for — the `reconciled` record
 * that says a second process took an attempt over, one per branch that had a Job to take over — and
 * then hands the Run to `drive`, which finds the fork on the row and drives it exactly as the host
 * that opened it would have.
 *
 * The row is read again before each write, as everywhere else here: a person can cancel a Run while
 * this is asking the Site about its branches, and a `reconciled` record written after a `cancelled`
 * one would say a host took over a node nobody is advancing any more.
 */
async function reconcileFork(deps: FabricDeps, run: RunRecord, ctx: Driving, fork: RunFork): Promise<ReconcileOutcome> {
  const stillRunning = (): boolean => existingRun(deps.ledger, run.id).status === 'running';
  const took: string[] = [];
  for (const [id, branch] of Object.entries(fork.branches)) {
    // A done branch has nothing to pick up, and a blocked one is a person's to clear: re-entering it
    // here would write a `reconciled` record over a blocker nobody has cleared, and `driveBranch`
    // would not re-enter it anyway.
    if (branch.state === 'done' || branch.state === 'blocked') continue;
    const node = positionOf(ctx.pack, branch.currentNode)?.node;
    if (node === undefined) continue;
    const open = (await openJobsOfRun(deps, run, node.id))[0];
    if (open === undefined) continue;
    if (!stillRunning()) {
      return { runId: run.id, found: 'stopped-elsewhere', detail: `this run was stopped from another face while its fork was being picked up, so nothing was written` };
    }
    const session = open.job.session;
    await recordNode(deps.ledger, run.id, node, 'reconciled', attemptOfSession(deps.ledger, run.id, node.id, session), {
      jobSession: session,
      branchId: id,
      reason: `reconciled at start: branch ${id} of the fork at ${fork.from} was left waiting for job "${node.id}" in tmux session ${session}`,
    });
    took.push(`${id} at ${node.id} in ${session}`);
  }
  const detail = took.length === 0
    ? `this run was left inside the fork at ${fork.from} with no branch holding a job on the site; every branch that has not reached ${fork.join} runs its node again`
    : `this run was left inside the fork at ${fork.from}; ${counted(took.length, 'branch')} still had a job on the site: ${took.join(', ')}`;
  if (!stillRunning()) return { runId: run.id, found: 'stopped-elsewhere', detail };
  try {
    await drive(ctx);
  } catch (err) {
    return { runId: run.id, found: took.length === 0 ? 'nothing-open' : 'running', detail: `${detail}; carrying it on then stopped: ${(err as Error).message}` };
  }
  return { runId: run.id, found: took.length === 0 ? 'nothing-open' : 'running', detail };
}

/**
 * The `Driving` context of a Run already under way, rebuilt out of the ledger and the files this
 * machine holds: the Site and the pack from their own directories, the workspace from the workspace
 * record the Run carries, the Campaign from the run row. This is what `Driving` holding nothing but
 * derivable state was for — a second process picks a Run up exactly where the first one left it, with
 * no handle passed between them.
 */
function drivingFor(deps: FabricDeps, run: RunRecord): Driving {
  const site = loadSite(deps.sitesDir, run.siteId);
  const pack = packOf(deps, run);
  const workspace = deps.ledger
    .records({ runId: run.id, type: 'workspace' })
    .findLast((r): r is WorkspaceRecord => r.type === 'workspace')?.workspace;
  if (workspace === undefined) throw new Error(`run ${run.id} holds no workspace record, so there is no campaign workspace to carry it on in`);
  // Read from the records, exactly as `resumeRun` reads it: the wait a Run did for a person before its
  // host went away is still what its time box is widened by, and a reconciliation that rebuilt the
  // drive without it would hold the resumed Run to a deadline the process it replaces did not have.
  return { deps, runId: run.id, site, pack, bindings: boundInputs(pack, site), workspace, campaignId: run.campaignId, waitedMs: waitedMsOf(deps.ledger, run.id) };
}

/** The pack a Run runs, as its own row says. Throws when this machine no longer has that pack. */
function packOf(deps: FabricDeps, run: RunRecord): Pack {
  if (run.packId === undefined) throw new Error(`run ${run.id} does not say which pack it runs`);
  return loadRunPack(deps.packsDir, run.packId, run.packDigest);
}

/**
 * The Job this Run has open at one node, or the newest it has open anywhere: `openJobsOf` in
 * `job-cap.ts` is the one rule, and this is the one answer of it a reconciliation wants.
 *
 * The two callers want two different things, and both are that rule. A reconciliation is picking one
 * node's interrupted attempt up, and names it. A cancel is asking what of this Run is still on the
 * Site, and must not name one — because a Run no longer stands at the node whose launch is
 * unsettled: a Run whose Retry allowance is spent is routed to the pack's Wait node with the node
 * that failed behind it, and a Run inside a fork stands at the join with a Job open in every branch.
 * Asking only about the node a Run stands at would tell a person their Run had nothing to stop while
 * the tool still held the licence, and a Run final at `cancelled` is one `reconcileRuns` passes over
 * for ever. So the cancel takes them all.
 */
async function openJob(deps: FabricDeps, run: RunRecord, nodeId?: string): Promise<JobRecord | undefined> {
  return (await openJobsOfRun(deps, run, nodeId))[0];
}

// ---------------------------------------------------------------------------------------------
// Cancel: a person stops a Run, and it is not stopped until something saw it stop.
// ---------------------------------------------------------------------------------------------

export type CancelResult =
  /**
   * The Run is over: every Job it had open was stopped and seen to stop, or it had none to stop.
   *
   * `stopped` is the first of those stops, which is what the answer names. A Run inside a fork has
   * one open Job per branch and every one of them is stopped (#29); each stop is a `killed` job
   * record of its own, which is where a face showing all of them reads them, because what actually
   * stopped is a fact of the ledger and never of this answer.
   */
  | { readonly kind: 'cancelled'; readonly run: RunRecord; readonly stopped: JobRecord | undefined }
  /** It had already reached a final state. Its status is the answer, and nothing was written. */
  | { readonly kind: 'ended'; readonly run: RunRecord }
  /** HimaFabric never started this Run, so there is nothing of it to stop. Nothing was written. */
  | { readonly kind: 'not-started'; readonly run: RunRecord }
  /**
   * The kill did not take within its bounded wait: the session is still there. The Run is NOT
   * cancelled — nothing may say a licence was released while the tool still holds it — so the node is
   * blocked naming the session and the Run waits for a person.
   */
  | { readonly kind: 'not-stopped'; readonly run: RunRecord; readonly session: string; readonly reason: string };

/**
 * Stop a Run: kill every Job it has open, wait for each session to be observed gone, and end the Run.
 *
 * Every Job and not the newest, because a Run can hold several at once: a fork drives an act node
 * per branch and each of them launches (#29), and a Run whose allowance was spent stands at a Wait
 * node with the Job it gave up on possibly still on the Site. One that stopped only the first would
 * end the Run saying its licences were released while the tool still held one.
 *
 * The request and the observed stop are two records (#9), in that order and never merged: the `cancel`
 * record says a person asked, the `killed` job record and the `cancelled` node record say what
 * actually stopped, and the Run's status moves only after the second exists. Writing the request first
 * has a second use — it is what a `drive` loop waiting on that same Job reads to know that the Job
 * about to disappear was stopped on purpose, so it does not record the disappearance as a fault.
 *
 * @param deps - the ledger, HimaJudge, and where sites and packs are installed.
 * @param runId - the Run to stop.
 * @returns what was stopped, or why nothing was.
 * @throws RunReferenceError when the ledger holds no such Run.
 */
/** Trusted service emergency path still fences admission; slow stop I/O uses a separate key in
 * the same existing queue map so context, duplicate receipts and refusals stay responsive. */
export async function cancelRun(deps: FabricDeps, runId: string, requestedReason: 'cancel' | 'budget' = 'cancel'): Promise<CancelResult> {
  await controlling(deps, runId, async () => {
    const run = existingRun(deps.ledger, runId);
    if (run.control !== undefined && (run.status === 'running' || run.status === 'waiting')
        && (run.control.stop === undefined || (requestedReason === 'cancel' && run.control.stop.reason === 'budget'))) {
      await deps.ledger.advanceRun(runId, { control: { ...run.control, revision: run.control.revision + 1,
        paused: [...new Set([...run.control.paused, '*'])], stop: { reason: requestedReason, status: 'requested' } } });
    }
  });
  let result: CancelResult | undefined;
  let fault: unknown;
  try { result = await controlling(deps, `stop:${runId}`, () => cancelFencedRun(deps, runId)); }
  catch (error) { fault = error; }
  await controlling(deps, runId, async () => {
    const run = existingRun(deps.ledger, runId);
    const control = run.control;
    const stop = control?.stop;
    if (control === undefined || stop === undefined || stop.status === 'confirmed') return;
    const confirmed = run.status === 'cancelled' || run.status === 'ended-budget-exhausted';
    const reason = result?.kind === 'not-stopped' ? result.reason : fault === undefined ? undefined : String(fault);
    const session = result?.kind === 'not-stopped' ? result.session : undefined;
    const request = stop.requestId === undefined ? undefined : control.requests[stop.requestId];
    await deps.ledger.advanceRun(runId, { control: { ...control,
      stop: { ...stop, status: confirmed ? 'confirmed' : 'uncertain',
        ...(reason === undefined ? {} : { detail: reason }), ...(session === undefined ? {} : { session }) },
      ...(request === undefined || stop.requestId === undefined ? {} : { requests: { ...control.requests, [stop.requestId]: {
        ...request, state: confirmed ? 'done' : 'uncertain', receipt: { ...request.receipt, stop: confirmed ? 'cancelled' : 'not-stopped',
          ...(reason === undefined ? {} : { reason }), ...(session === undefined ? {} : { session }) },
      } } }),
    } });
    deps.notify?.(control.owner, runId, stop.requestId ?? `stop:${runId}`,
      confirmed
        ? 'The requested Campaign stop is complete. Acknowledge the final state and start no further node.'
        : `The requested Campaign stop could not be confirmed${reason === undefined ? '' : `: ${reason}`}. Read current facts and ask the user before any further action.`);
  });
  if (fault !== undefined) throw fault;
  return { ...result!, run: existingRun(deps.ledger, runId) };
}

/** Caller holds the stop-effect queue and has already persisted the business admission fence. */
async function cancelFencedRun(deps: FabricDeps, runId: string): Promise<CancelResult> {
  const run = existingRun(deps.ledger, runId);
  if (run.control !== undefined && run.control.stop === undefined && (run.status === 'running' || run.status === 'waiting')) throw new Error('controlled cancellation needs a durable stop fence under the admission queue');
  // A Run with no fabric state was never HimaFabric's, and a Run that has reached a final state is
  // over. Both are answers, and neither writes anything: a cancel records that a Run was stopped, and
  // neither of these was.
  if (run.status === undefined) return { kind: 'not-started', run };
  if (run.status !== 'running' && run.status !== 'waiting') return { kind: 'ended', run };

  for (const execution of Object.values(run.control?.executions ?? {})) {
    if (execution.intent === undefined) continue;
    const recovered = await reconcileLaunchIntent(deps, execution.intent);
    if (recovered.kind === 'uncertain') return { kind: 'not-stopped', run: existingRun(deps.ledger, runId), session: execution.intent.job.session, reason: recovered.reason };
  }

  // Every launch this Run still has open, at every node and not only the one it stands at: a Run
  // routed to a Wait node when its Retry allowance was spent stands away from the node whose Job may
  // still be on the Site, and a Run inside a fork stands at the join with a Job open in every branch
  // (#29). All of them are stopped, and each stop is recorded where it happened.
  const open = await openJobsOfRun(deps, run);
  // The status above was read before the launches were counted, and counting them may have awaited a
  // Site round trip asking whether a launch this Run had accounted for is really gone. A drive or a
  // resume can move a Run inside that window, and both are live paths now that a failed attempt
  // writes `retrying` and a person can resume a waiting Run. So the row is read again before the
  // request is written: a Run that reached a final state in the meantime is answered with that state
  // and nothing is written, rather than having a `cancel` record and a `cancelled` status put over
  // the ending it just got.
  const moved = existingRun(deps.ledger, runId);
  if (moved.status === undefined) return { kind: 'not-started', run: moved };
  if (moved.status !== 'running' && moved.status !== 'waiting') return { kind: 'ended', run: moved };
  await deps.ledger.appendCancel(run.id, {
    // An absent key, never an undefined one: a Run standing at no node, or holding no Job, says so.
    // The two can name different nodes, and each says what it is: `nodeId` is where the Run stood
    // when the request was read, `jobSessions` **every** Job that was open anywhere in the graph.
    //
    // One record and every session it found (#29). A fork holds a Job per branch, and each branch's
    // own waiting loop asks this record whether the cancel is stopping *its* Job (`cancelStopped`):
    // a record that named one of two would have the other branch conclude that somebody else was
    // stopping a Job nobody had ever seen, and leave it running on the Site with the Run already
    // final. `jobSession` is the head of the same list, kept because every face names one Job.
    ...(moved.currentNode === undefined ? {} : { nodeId: moved.currentNode }),
    ...(open[0] === undefined ? {} : { jobSession: open[0].job.session, jobSessions: open.map((r) => r.job.session) }),
  });
  /** The node one of these Jobs belongs to, or the node the Run stands at where its launch names
   *  none, moved to where the cancel left it. The attempt is the one under way. */
  const settle = async (nodeId: string | undefined, state: NodeState, extra: { jobSession?: string; reason?: string } = {}): Promise<void> => {
    const node = nodeOf(deps, moved, nodeId);
    if (node) await recordNode(deps.ledger, run.id, node, state, currentAttemptOf(deps.ledger, run.id, node.id), extra);
  };
  // The ending, and the Campaign's technical report at it (#30). Written here rather than by the
  // caller because a cancel is the one ending no drive returns from — the loop holding the Job sees
  // the `cancel` record and stops without ending anything — so this is the moment the Run is over.
  // `writeExperience` decides whether there is anything to do; a Site that will not take the report
  // raises, and the ending stands on the ledger either way.
  const ended = async (): Promise<RunRecord> => {
    const cancelled = existingRun(deps.ledger, run.id).control?.stop?.reason === 'budget'
      ? await endBudgetExhausted(deps.ledger, run.id)
      : await advance(deps.ledger, run.id, { endedBy: 'cancel' }, { status: 'cancelled' });
    await writeExperience(deps, run.id);
    return cancelled;
  };

  if (open.length === 0) {
    // Nothing of this Run is running on the Site: it stands at a node that launches nothing, or its
    // Job has already been accounted for. There is no stop to observe, so the node is cancelled where
    // it stands and the Run ends.
    await settle(moved.currentNode, 'cancelled');
    return { kind: 'cancelled', run: await ended(), stopped: undefined };
  }

  /** The first stop this cancel observed, which is what its answer names; every one of them is on
   *  record as a `killed` job record, which is where a fork's other branches are read. */
  let stopped: JobRecord | undefined;
  /** The first Job this cancel could not stop. One is enough to keep the Run from being cancelled. */
  let notStopped: { readonly session: string; readonly reason: string } | undefined;
  for (const launch of open) {
    const session = launch.job.session;
    const at = launch.nodeId ?? moved.currentNode;
    const killed = await jobKill(deps, { run: run.id, session });
    if (killed.outcome.wasRunning && killed.outcome.gone) {
      await settle(at, 'cancelled', { jobSession: session });
      stopped ??= killed.record;
      continue;
    }
    if (killed.outcome.wasRunning) {
      const reason = killDidNotTake('asked to stop by a cancel', session);
      await settle(at, 'blocked', { jobSession: session, reason });
      notStopped ??= { session, reason };
      continue;
    }
    // The session was already gone: the Job won the race between the request and the kill. Nothing
    // was killed and nothing may claim otherwise, so the node settles from what the launch itself
    // wrote, as a spent time box does.
    const after = await jobStatus(deps, { run: run.id, session });
    if (after.state.state === 'finished') {
      const exitCode = after.state.exitCode;
      const why = exitCode === 0 ? {} : { reason: `job "${launch.job.name}" in tmux session ${session} exited ${exitCode}` };
      await settle(at, exitCode === 0 ? 'done' : 'blocked', { jobSession: session, ...why });
    } else {
      await settle(at, 'blocked', { jobSession: session, reason: `the cancel found tmux session ${session} already gone, and it wrote no exit status` });
    }
  }
  if (notStopped) {
    // One Job still on the Site is enough: nothing may say a licence was released while the tool
    // still holds it, so the Run is not cancelled and a person is told which session to look at.
    await advance(deps.ledger, run.id, {}, { status: 'waiting' });
    return { kind: 'not-stopped', run: existingRun(deps.ledger, run.id), ...notStopped };
  }
  // A person asked this Run to stop, and every Job it had open has been seen to stop.
  return { kind: 'cancelled', run: await ended(), stopped };
}

/**
 * One of a Run's nodes by id, when this machine can still read the pack that declares it. A cancel
 * must stop a Job whatever became of the pack directory, so a pack that cannot be read costs the node
 * record and nothing else — the Job is still killed and the Run still ends.
 */
function nodeOf(deps: FabricDeps, run: RunRecord, nodeId: string | undefined): PackNode | undefined {
  try {
    return positionOf(packOf(deps, run), nodeId)?.node;
  } catch {
    return undefined;
  }
}
