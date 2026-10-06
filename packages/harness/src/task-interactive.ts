// PG authority for the existing Operator/Tcl transport. No graph driving or Ledger writes.
import { createHash, randomBytes } from 'node:crypto';
import { channelFor } from './channel.js';
import { loadSite } from './sites.js';
import { decideLaunch, decideRead, decideWrite } from './shell.js';
import { retainedJobState } from './jobs.js';
import { nativeDelegationPolicy, readNativeSessionAdmission } from './native-task-adapters.js';
import type { EffectiveDelegationContract, OperatorDelegationGrant } from './delegation.js';
import { jsonDigest, type EffectAdmission, type RunStore } from './run-store.js';
import type { JsonValue, TaskIdentity } from './task-contract.js';
import type { InteractiveBindingBridge } from './interactive-binding.js';
import {
  foldInteractiveSessions, interactiveCallerDigest, interactiveDuplicateReceipt, nativeInteractiveSession,
  parseInteractiveRequest, qualifyInteractiveOperation,
  type DerivedInteractiveOperation, type InteractiveOperateRequest, type InteractiveOperateResult,
  type InteractiveSessionView,
} from './interactive-runtime.js';
import {
  closeInteractiveJob, interactiveCloseGrace, observeInteractiveToken, openInteractiveJob,
  parseInteractiveRecord, readInteractiveTranscript, sendInteractiveInput, signalInteractiveJob, recoverInteractiveJobIdentity, interactiveJobResourcesClosed, interactiveSessionExists,
  type InteractiveAuthority, type InteractiveIntent, type InteractiveJobIdentity,
  type InteractiveQualification, type InteractiveRecord,
} from './interactive-job.js';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const key = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const refused = (reason: string): InteractiveOperateResult => ({ status: 'refused', reason });
const protocol = (facts: Readonly<Record<string, JsonValue>>): InteractiveRecord[] =>
  Object.entries(facts).filter(([phase]) => phase.startsWith('interactive:record:')).map(([, fact]) => parseInteractiveRecord(fact));
const jobs = (facts: Readonly<Record<string, JsonValue>>) => Object.entries(facts)
  .filter(([phase]) => phase.startsWith('interactive:job:')).map(([, fact]) => fact as unknown as { event: string; job: InteractiveJobIdentity });
const views = (identity: TaskIdentity, facts: Readonly<Record<string, JsonValue>>): InteractiveSessionView[] =>
  foldInteractiveSessions(identity.runId, protocol(facts), jobs(facts)).map(view => {
    const prepared = Object.values(facts).find(fact => fact && typeof fact === 'object' && !Array.isArray(fact)
      && fact.toolSessionId === view.toolSessionId && fact.derived !== undefined) as unknown as TaskInteractivePrepared | undefined;
    // Even a lost tmux creation ACK retains the intended Job. Reads/cleanup can reconnect that
    // exact session; an absent completion receipt is never a new open or command permission.
    const job = jobs(facts).findLast(item => item.job.session === view.toolSessionId)?.job;
    return { ...view, ...(job ? { job } : {}), ...(prepared && !view.qualification ? { qualification: prepared.qualification } : {}) };
  });

/** Exact resolved operation is retained before opening, so a fresh Host can reconnect without
 * reconstructing a mutable graph or trusting model-supplied argv/path/qualification. */
export interface TaskInteractivePrepared {
  readonly derived: DerivedInteractiveOperation;
  readonly qualification: InteractiveQualification;
  readonly toolSessionId: string;
  readonly sessionDeadlineAt: string;
  readonly resourceIdentity: TaskIdentity;
  readonly actor: string;
  readonly executionId: string;
  readonly nodeId: string;
  readonly requestId: string;
}
export type TaskInteractiveOperateResult = InteractiveOperateResult | { readonly status: 'status'; readonly session: InteractiveSessionView; readonly process: 'running' | 'exited' | 'unknown' };
export interface TaskInteractiveDeps {
  readonly store: RunStore;
  readonly sitesDir: string;
  readonly bridge: Pick<InteractiveBindingBridge, 'verifyAdminBinding' | 'encodeCommand'>;
  /** U6 supplies the exact frozen Pack/Run/NodeExecution resolver. No live Ledger fold. */
  readonly resolveOperation?: (identity: TaskIdentity, grant: OperatorDelegationGrant) => Promise<DerivedInteractiveOperation | undefined>;
  readonly trustedTestQualification?: { readonly bindingId: string };
}
interface Grant {
  readonly effective: EffectiveDelegationContract;
  readonly deadlineAt: string;
  readonly guard: { readonly sitesDir: string; readonly siteId: string; readonly siteDigest: string; readonly admission: EffectAdmission };
}

export async function listTaskInteractiveSessions(store: RunStore, identity: TaskIdentity): Promise<InteractiveSessionView[]> {
  return views(identity, Object.fromEntries((await store.orderedExternalEffectFacts(identity, 'interactive:')).map(item => [item.phase, item.fact])));
}

/** Exact qualified operation retained by the Host before it mints the native child grant. */
export async function readTaskInteractiveOperation(store: RunStore, identity: TaskIdentity,
  target: { readonly executionId: string; readonly nodeId: string }): Promise<DerivedInteractiveOperation | undefined> {
  const fact = await store.externalEffectFact(identity, `interactive:operation:${key([target.executionId, target.nodeId])}`);
  return fact ? (fact as unknown as { derived: DerivedInteractiveOperation }).derived : undefined;
}

/** Host-only qualification for minting the existing native Operator grant. */
export async function taskInteractiveDelegationGrant(deps: TaskInteractiveDeps, identity: TaskIdentity,
  admission: EffectAdmission, target: { readonly executionId: string; readonly nodeId: string }): Promise<OperatorDelegationGrant> {
  const provisional: OperatorDelegationGrant = { runId: identity.runId, ...target, bindingDigest: '0'.repeat(64), mutation: 'qualified', testOnly: false, commands: [] };
  const derived = await readTaskInteractiveOperation(deps.store, identity, target) ?? await deps.resolveOperation?.(identity, provisional);
  if (!derived || derived.binding.packDigest !== identity.packSha256 || derived.binding.nodeId !== target.nodeId) throw new Error('Exact retained Pack has no qualified interactive operation for this task');
  const qualification = await qualifyInteractiveOperation({ ...deps.bridge, trustedTestQualification: deps.trustedTestQualification }, derived);
  if (qualification.mutation !== 'qualified') throw new Error('Exact Operator binding is not qualified for mutation');
  const site = loadSite(deps.sitesDir, derived.site);
  await deps.store.assertEffectAdmission(admission, async () => {
    const decision = await decideLaunch(site, derived.workspace, derived.argv, channelFor(site));
    return decision.ok && decision.workspace === derived.workspace;
  });
  await deps.store.recordExternalEffectFact(identity, `interactive:operation:${key([target.executionId, target.nodeId])}`, json({ derived, qualification }));
  return { runId: identity.runId, ...target, bindingDigest: qualification.bindingDigest, mutation: 'qualified', testOnly: qualification.testOnly, commands: derived.commands };
}

function reviewMutation(grant: Grant, request: InteractiveOperateRequest, record: Extract<InteractiveRecord, { event: 'input-intent' }>,
  derived: DerivedInteractiveOperation, records: readonly InteractiveRecord[]): InteractiveRecord {
  if (record.effect !== 'mutation' || request.action !== 'input') return record;
  const command = derived.commands.find(item => item.name === request.command.name);
  if (command?.effect === 'save') return record;
  const payload = grant.effective.recipe?.inlinePayload;
  if (!payload) throw new Error('Operator mutation requires its immutable owner-adopted reviewed action or scope');
  const values = request.command.args && typeof request.command.args === 'object' && !Array.isArray(request.command.args)
    ? request.command.args as Record<string, unknown> : {};
  if (payload.mode === 'scope') {
    if (!payload.scope.commands.includes(request.command.name)) throw new Error('Operator mutation is outside its owner-adopted reviewed scope');
    if (values[payload.planHashArgument] !== payload.planSha256) throw new Error('Operator mutation plan hash differs from the adopted reviewed plan');
    const used = records.filter(item => item.event === 'input-intent' && item.executionId === request.executionId
      && item.actor === request.actor && item.scopeMutation).length;
    if (used >= payload.scope.maxMutations) throw new Error('Owner-adopted reviewed scope mutation allocation is exhausted');
  } else {
    if (request.command.name !== payload.command || jsonDigest(json(values)) !== jsonDigest(json(payload.arguments))) throw new Error('Operator mutation differs from the immutable reviewed action');
    if (records.some(item => item.event === 'input-intent' && item.actor === request.actor && item.executionId === request.executionId && item.scopeMutation)) throw new Error('Owner-adopted reviewed action was already admitted');
  }
  return { ...record, scopeMutation: true };
}

/** Called by the ordinary Host tool using its authenticated native child ID. */
export async function operateTaskInteractive(deps: TaskInteractiveDeps, actor: string, raw: unknown, host?: { readonly cleanup: true }): Promise<TaskInteractiveOperateResult> {
  const statusRequest = raw !== null && typeof raw === 'object' && (raw as { action?: unknown }).action === 'status';
  let request: InteractiveOperateRequest;
  try { request = parseInteractiveRequest(statusRequest ? { ...(raw as Record<string, unknown>), action: 'read' } : raw, actor); if (host?.cleanup) request = { ...request, hostStop: 'recovery' }; } catch (error) { return refused(errorText(error)); }
  try {
    const held = await deps.store.nativeSessionEffect(actor);
    if (!held) return refused('Authenticated native child has no PG Operator grant');
    const grant = held.fact as unknown as Grant;
    const operator = grant.effective.operator;
    if (grant.effective.role !== 'operator' || !operator || grant.effective.childSessionId !== actor
      || operator.runId !== request.runId || operator.nodeId !== request.nodeId || operator.executionId !== request.executionId
      || held.identity.runId !== request.runId) return refused('Operator target differs from its original native child grant');
    if (grant.guard.sitesDir !== deps.sitesDir) return refused('Operator Site registry differs from its retained native grant');
    const identity = held.identity;
    const admission = await readNativeSessionAdmission(deps.store, identity, actor, grant.guard.admission);
    if (request.action !== 'close' && request.action !== 'signal' && request.action !== 'read'
      && (request.ownerEpoch !== admission.epoch || request.controlRevision !== admission.revision)) return refused('Interactive request frame differs from its explicitly admitted native scope');
    const facts = Object.fromEntries((await deps.store.orderedExternalEffectFacts(identity, 'interactive:')).map(item => [item.phase, item.fact]));
    const records = protocol(facts), callerDigest = interactiveCallerDigest(request);
    const prior = records.filter(record => record.requestId === request.requestId);
    if (prior.length) {
      const intent = prior.find(record => record.event.endsWith('-intent'));
      const event = request.action === 'open' ? 'open-intent' : request.action === 'input' ? 'input-intent' : request.action === 'signal' ? 'signal-intent' : request.action === 'close' ? 'close-intent' : undefined;
      if (!intent || intent.event !== event || intent.actor !== actor || intent.callerDigest !== callerDigest) return refused('Request identity was reused with different action, target, actor or command');
      const view = views(identity, facts).find(item => item.toolSessionId === intent.toolSessionId);
      const originalSession = view && nativeInteractiveSession(view);
      if (request.action === 'close' && originalSession) {
        const originalPrepared = Object.values(facts).find(fact => fact && typeof fact === 'object' && !Array.isArray(fact)
          && fact.toolSessionId === intent.toolSessionId && fact.derived !== undefined) as unknown as TaskInteractivePrepared | undefined;
        if (originalPrepared) {
          const fresh = loadSite(deps.sitesDir, originalPrepared.derived.site), on = channelFor(fresh);
          if (jsonDigest(json(fresh)) !== grant.guard.siteDigest) return refused('Original cleanup Site identity changed');
          if (await interactiveJobResourcesClosed(on, originalSession.job)) {
            // A lost cleanup ACK queries the exact original process group/session. No resend,
            // replacement cleaner, new close identity or cached allowed result is needed.
            const phase = `interactive:record:closed:${key(intent.requestId)}`;
            if (!await deps.store.externalEffectFact(identity, phase)) await deps.store.recordExternalEffectFact(identity, phase, json(parseInteractiveRecord({
              runId: intent.runId, executionId: intent.executionId, nodeId: intent.nodeId, toolSessionId: intent.toolSessionId, requestId: intent.requestId, actor: intent.actor,
              ownerEpoch: intent.ownerEpoch, controlRevision: intent.controlRevision, callerDigest: intent.callerDigest, operationDigest: intent.operationDigest, at: intent.at, event: 'closed' })));
            if (!(await deps.store.effectResources(originalPrepared.resourceIdentity.effectId))[0]?.released) await deps.store.releaseExternalEffectResources(originalPrepared.resourceIdentity,
              json({ session: originalSession.job.session, processGroup: originalSession.job.pid ?? null, closed: true }));
            return { status: 'duplicate', process: 'exited' };
          }
        }
      }
      if (request.action === 'open' && originalSession && view?.status !== 'closed') {
        // A lost launch ACK queries the original transport, never repeats its startup line.
        const originalPrepared = Object.values(facts).find(fact => fact && typeof fact === 'object' && !Array.isArray(fact)
          && fact.toolSessionId === intent.toolSessionId && fact.derived !== undefined) as unknown as TaskInteractivePrepared | undefined;
        if (originalPrepared) {
          const fresh = loadSite(deps.sitesDir, originalPrepared.derived.site), on = channelFor(fresh);
          if (jsonDigest(json(fresh)) !== grant.guard.siteDigest) return refused('Original interactive Site identity changed');
          if (await on.absent(originalSession.transcriptPath)) return { status: 'uncertain', session: originalSession, reason: 'Original native creation has no transcript/startup receipt; preserve/query this exact session without starting another' };
          const read = await decideRead(fresh, originalSession.transcriptPath, on);
          if (!read.ok) return refused(read.reason);
          if (read.absPath !== originalSession.transcriptPath) return refused('Original transcript resolves to a different path');
          const transcript = await readInteractiveTranscript(on, originalSession);
          const marker = `HIMA:${originalSession.qualification.adapter.id}:${originalSession.qualification.adapter.version}:READY`;
          if (transcript.text.split(/\r?\n/).some(line => line.trim() === marker)) {
            const phase = `interactive:record:ready:${key(intent.toolSessionId)}`;
            if (!await deps.store.externalEffectFact(identity, phase)) await deps.store.recordExternalEffectFact(identity, phase, json(parseInteractiveRecord({ runId: intent.runId, executionId: intent.executionId, nodeId: intent.nodeId, toolSessionId: intent.toolSessionId, requestId: intent.requestId, actor: intent.actor, ownerEpoch: intent.ownerEpoch, controlRevision: intent.controlRevision, callerDigest: intent.callerDigest, operationDigest: intent.operationDigest, at: intent.at, event: 'opened', jobSession: intent.toolSessionId, qualification: originalSession.qualification, readiness: 'ready' })));
            return { status: 'duplicate', session: originalSession, readiness: 'ready' };
          }
          return { status: 'uncertain', session: originalSession, reason: 'Original open has no READY marker; query this retained session without restarting it' };
        }
      }
      return interactiveDuplicateReceipt(request.action as 'open' | 'input' | 'signal' | 'close', prior.map(payload => ({ payload })), view);
    }
    let prepared: TaskInteractivePrepared | undefined = request.action === 'open' ? facts[`interactive:prepared:${key([actor, request.requestId])}`] as unknown as TaskInteractivePrepared | undefined : undefined;
    if (request.action !== 'open') prepared = Object.values(facts).find(fact => fact && typeof fact === 'object' && !Array.isArray(fact)
      && fact.toolSessionId === request.toolSessionId && fact.derived !== undefined) as unknown as TaskInteractivePrepared | undefined;
    if (!prepared && request.action !== 'open') return refused('Original interactive session has no retained prepared binding');
    const derived = prepared?.derived ?? await readTaskInteractiveOperation(deps.store, identity, operator);
    if (!derived || derived.site !== grant.guard.siteId || derived.workspace !== grant.effective.workspace
      || derived.binding.packDigest !== identity.packSha256 || derived.binding.nodeId !== request.nodeId) return refused('Interactive binding differs from the exact frozen task/Pack/Site workspace');
    const qualification = await qualifyInteractiveOperation({ ...deps.bridge, trustedTestQualification: deps.trustedTestQualification }, derived);
    if (qualification.bindingDigest !== operator.bindingDigest || qualification.testOnly !== operator.testOnly) return refused('Interactive qualification differs from original Operator grant');
    const site = () => loadSite(deps.sitesDir, derived.site);
    const permit = async (cleanup = false): Promise<boolean> => {
      const fresh = site(), on = channelFor(fresh);
      if (jsonDigest(json(fresh)) !== grant.guard.siteDigest) return false;
      if (!cleanup && prepared) {
        const current = (await deps.store.orderedExternalEffectFacts(identity, 'interactive:record:')).map(item => parseInteractiveRecord(item.fact));
        if (current.some(item => item.event === 'close-intent' && item.toolSessionId === prepared!.toolSessionId)) throw new Error('Original interactive session is closing; new business dispatch is refused');
        const session = views(identity, Object.fromEntries((await deps.store.orderedExternalEffectFacts(identity, 'interactive:')).map(item => [item.phase, item.fact])))
          .find(item => item.toolSessionId === prepared!.toolSessionId);
        if (!session?.activeCommand) {
          const activity = current.filter(item => item.toolSessionId === prepared!.toolSessionId && (item.event === 'opened' || item.event === 'command-completed' || item.event === 'command-failed')).at(-1);
          if (activity && Date.now() >= Date.parse(activity.at) + derived.binding.limits.idleMaxMs) throw new Error('Original interactive idle deadline is exhausted');
        }
      }
      const q = await qualifyInteractiveOperation({ ...deps.bridge, trustedTestQualification: deps.trustedTestQualification }, derived);
      if (jsonDigest(json(q)) !== jsonDigest(json(qualification))) return false;
      if (cleanup) { const decision = await decideWrite(fresh, derived.workspace, on); return decision.ok && decision.absPath === derived.workspace; }
      const decision = await decideLaunch(fresh, derived.workspace, derived.argv, on);
      return decision.ok && decision.workspace === derived.workspace;
    };
    const business = async () => {
      if (Date.now() >= Date.parse(grant.deadlineAt)) throw new Error('Original native child deadline expired');
      const policy = await nativeDelegationPolicy(deps.store, actor);
      if (!policy?.writesAllowed) throw new Error(policy?.reason ?? 'Original native child has no current write grant');
    };
    const view = request.action === 'open' ? undefined : views(identity, facts).find(item => item.toolSessionId === request.toolSessionId);
    if (view && (view.operatorSessionId !== actor || view.executionId !== request.executionId || view.nodeId !== request.nodeId)) return refused('Interactive session belongs to a different Operator execution');
    if (request.action === 'open') {
      await business();
      const run = await deps.store.run(identity.runId);
      const toolSessionId = `hima-${key([identity.effectId, derived.site, derived.workspace, actor, request.requestId]).slice(0, 36)}`;
      const resourceIdentity = { ...identity, effectId: `${identity.effectId}:interactive:${key([actor, request.requestId])}` };
      prepared ??= { derived, qualification, toolSessionId, resourceIdentity, actor, executionId: request.executionId, nodeId: request.nodeId, requestId: request.requestId,
        sessionDeadlineAt: new Date(Math.min(Date.parse(run.deadlineAt), Date.parse(grant.deadlineAt), Date.now() + derived.binding.limits.sessionMaxMs)).toISOString() };
      await deps.store.prepareExternalEffect(resourceIdentity, json({ kind: 'interactive', callerDigest, prepared }));
      await deps.store.recordExternalEffectFact(identity, `interactive:prepared:${key([actor, request.requestId])}`, json(prepared));
      const fresh = site();
      if (!await deps.store.reserveExternalEffectResources(resourceIdentity, { siteId: fresh.name, jobs: 1, licences: derived.licences }, { jobs: fresh.capacity.parallelJobs, licences: fresh.capacity.licences })) return refused('Site Job/licence capacity is held by actual retained resources');
    }
    const original = prepared!;
    let dispatch = 0;
    let cleanupDispatch = 0;
    const authority: InteractiveAuthority = {
      async admit(intent: InteractiveIntent) {
        try {
          const cleanup = intent.action === 'close' || intent.action === 'signal';
          if (!cleanup) await business();
          return await deps.store.externalEffectTransaction(identity, { ...(cleanup ? {} : { admission }), permit: () => permit(cleanup) }, async (_run, current, record) => {
            const all = protocol(current), previous = all.filter(item => item.requestId === intent.record.requestId);
            if (previous.length) {
              const first = previous[0]!;
              if (first.actor !== actor || first.callerDigest !== callerDigest || first.event !== intent.record.event) return { kind: 'refused' as const, reason: 'Interactive request identity conflict' };
              return { kind: 'duplicate' as const, receipt: interactiveDuplicateReceipt(intent.action, previous.map(payload => ({ payload })), views(identity, current).find(item => item.toolSessionId === first.toolSessionId)) };
            }
            const currentViews = views(identity, current), session = currentViews.find(item => item.toolSessionId === intent.record.toolSessionId);
            if (intent.action === 'open' && currentViews.some(item => item.executionId === request.executionId && item.status !== 'closed')) throw new Error('Execution already has an open or uncertain interactive Job');
            if (intent.action === 'input' && all.some(item => item.event === 'close-intent' && item.toolSessionId === intent.record.toolSessionId)) throw new Error('Original interactive session is closing; new commands cannot cross its cleanup boundary');
            if (intent.action === 'input' && session?.activeCommand && !(intent.record.effect === 'reply' && intent.record.replyToCommandId === session.activeCommand.commandId && session.activeCommand.state === 'sent')) throw new Error('Original command still holds the single-writer lease; observe its completion');
            if (intent.action === 'input' && all.some(item => item.event === 'input-intent' && item.commandId === intent.record.commandId && item.executionId === request.executionId)) throw new Error('Command identity was already retained; query its original request');
            const payload = intent.action === 'input' ? reviewMutation(grant, request, intent.record, derived, all) : intent.record;
            await record(`interactive:record:${key([payload.requestId, payload.event])}`, json(payload));
            return { kind: 'reserved' as const, reservationId: `interactive:record:${key([payload.requestId, payload.event])}`, qualification };
          });
        } catch (error) { return { kind: 'refused', reason: errorText(error) }; }
      },
      async authorizeBeforeDispatch({ reservationId, operationDigest }) {
        try {
          const intent = await deps.store.externalEffectFact(identity, reservationId) as unknown as InteractiveRecord | undefined;
          if (!intent || intent.operationDigest !== operationDigest || intent.actor !== actor) throw new Error('Original interactive dispatch reservation is absent or mismatched');
          const cleanup = intent.event === 'close-intent' || intent.event === 'signal-intent';
          if (!cleanup) {
            await business();
            if (Date.now() >= Date.parse(original.sessionDeadlineAt) || intent.event === 'input-intent' && Date.now() >= Date.parse(intent.commandDeadlineAt)) throw new Error('Original interactive session/command deadline exhausted');
          }
          const id = `interactive:${key([actor, reservationId])}:${dispatch++}`;
          const claimed = cleanup
            ? await deps.store.claimEffectCleanup(original.resourceIdentity, () => permit(true), id, operationDigest)
            : await deps.store.claimEffectDispatch(admission, () => permit(), id, operationDigest);
          if (!claimed) throw new Error('Original dispatch boundary was already crossed; query original session without resend');
          return { kind: 'authorized', qualification };
        } catch (error) { return { kind: 'refused', reason: errorText(error) }; }
      },
      async record(record) {
        const parsed = parseInteractiveRecord(record);
        const all = protocol(await deps.store.listExternalEffectFacts(identity, 'interactive:record:'));
        if (parsed.runId !== identity.runId || parsed.actor !== actor || !all.some(item => item.requestId === parsed.requestId && item.operationDigest === parsed.operationDigest && item.callerDigest === parsed.callerDigest)) throw new Error('Interactive outcome has no original PG intent');
        // Observation may find a later cursor after a repeated read; retain the first confirmed
        // completion under its command identity rather than contradicting an immutable receipt.
        const phase = `interactive:record:${key([parsed.requestId, parsed.event])}`;
        if (!await deps.store.externalEffectFact(identity, phase)) await deps.store.recordExternalEffectFact(identity, phase, json(parsed));
      },
      async beforeCleanup(job) {
        const operation = jsonDigest(json({ session: job.session, pid: job.pid ?? null, cleanup: true }));
        if (!await deps.store.claimEffectCleanup(original.resourceIdentity, () => permit(true), `open-cleanup:${key([request.requestId, actor])}:${cleanupDispatch++}`, operation)) throw new Error('Original open cleanup was already dispatched; query its retained resource');
      },
      async recordJobIntent(job) { await deps.store.recordExternalEffectFact(identity, `interactive:job:${job.session}:intent`, json({ event: 'launched', job })); },
      async recordJobLaunch(job) { await deps.store.recordExternalEffectFact(identity, `interactive:job:${job.session}:launched`, json({ event: 'launched', job })); },
      async recordJobStop(job, outcome) {
        if (!outcome.observedGone || !await interactiveJobResourcesClosed(channelFor(site()), job)) return;
        await deps.store.recordExternalEffectFact(identity, `interactive:job:${job.session}:closed`, json({ event: 'finished', job }));
        if (!(await deps.store.effectResources(original.resourceIdentity.effectId))[0]?.released) await deps.store.releaseExternalEffectResources(original.resourceIdentity, json({ session: job.session, processGroup: job.pid ?? null, closed: true }));
      },
    };
    const on = channelFor(site()), waitMs = Math.min(request.action === 'input' || request.action === 'observe' ? request.waitMs ?? derived.binding.limits.callWaitMaxMs : 0, derived.binding.limits.callWaitMaxMs);
    if (request.action === 'open') {
      const result = await openInteractiveJob(on, { ...request, callerDigest, siteName: derived.site, workspace: derived.workspace, argv: derived.argv, name: derived.name,
        retainedJobSession: original.toolSessionId, sessionDeadlineAt: original.sessionDeadlineAt, startupWaitMs: derived.binding.limits.startupWaitMs, closeGrace: interactiveCloseGrace(derived.binding.limits.closeGraceMs) }, authority);
      if (result.status === 'refused' && !(await deps.store.effectResources(original.resourceIdentity.effectId))[0]?.released) {
        await deps.store.releaseExternalEffectResources(original.resourceIdentity, { session: original.toolSessionId, closed: true });
      }
      return result;
    }
    let session = view && nativeInteractiveSession(view);
    if (session && session.job.pid === undefined && view?.status !== 'closed') {
      const recovered = await recoverInteractiveJobIdentity(on, session.job);
      if (recovered.pid !== undefined) {
        await deps.store.recordExternalEffectFact(identity, `interactive:job:${recovered.session}:reconnected`, json({ event: 'launched', job: recovered }));
        session = { ...session, job: recovered };
      }
    }
    if (!view || !session) return refused('Original session receipt is incomplete; retain/query its original native identity');
    if (request.action === 'read') {
      if (statusRequest) {
        const allowed = await decideRead(site(), original.derived.workspace, on);
        if (!allowed.ok) return refused(allowed.reason);
        if (allowed.absPath !== original.derived.workspace) return refused('Original workspace resolves to a different path');
        const actual = await retainedJobState(site(), session.job);
        return { status: 'status', session: { ...view, job: session.job }, process: actual.state === 'running' ? 'running' : actual.state === 'finished' ? 'exited' : 'unknown' };
      }
      const allowed = await decideRead(site(), session.transcriptPath, on);
      if (!allowed.ok) return refused(allowed.reason);
      if (allowed.absPath !== session.transcriptPath) return refused('Original transcript resolves to a different path');
      return { status: 'read', transcript: await readInteractiveTranscript(on, session, request.cursor ?? 0, request.maxBytes ?? 65536) };
    }
    if (request.action === 'observe') {
      const allowed = await decideRead(site(), session.transcriptPath, on);
      if (!allowed.ok) return refused(allowed.reason);
      if (allowed.absPath !== session.transcriptPath) return refused('Original transcript resolves to a different path');
      const command = view.activeCommand;
      if (!command || command.commandId !== request.commandId) return refused('Named command is not the original active command lease');
      return observeInteractiveToken(on, { ...request, requestId: command.requestId, session, callerDigest: command.callerDigest, protocolToken: command.protocolToken,
        inputDigest: command.inputDigest, operationDigest: command.operationDigest, cursorBefore: command.cursorBefore, waitMs }, authority);
    }
    if (request.action === 'input') {
      if (view.status !== 'ready') return refused(`Interactive session is ${view.status}; query its original readiness`);
      const token = randomBytes(24).toString('base64url');
      const encoded = await deps.bridge.encodeCommand(derived.binding, { commandId: request.commandId, protocolToken: token, name: request.command.name, args: request.command.args, ...(request.replyToCommandId ? { replyToCommandId: request.replyToCommandId } : {}) });
      return sendInteractiveInput(on, { ...request, session, callerDigest, protocolToken: token, requestDigest: callerDigest, text: encoded.text, submit: encoded.submit, effect: encoded.effect,
        cursorBefore: view.lastCursor ?? 0, waitMs, commandDeadlineAt: new Date(Math.min(Date.now() + derived.binding.limits.commandMaxMs, Date.parse(original.sessionDeadlineAt), Date.parse(grant.deadlineAt))).toISOString() }, authority);
    }
    if (request.action === 'signal') return signalInteractiveJob(on, { ...request, callerDigest, session }, authority);
    const finalizers = derived.commands.filter(item => item.effect === 'close' && item.arguments !== undefined);
    const currentRun = await deps.store.run(identity.runId);
    if (!request.hostStop && !currentRun.hold && !currentRun.cancelled && Date.now() < Date.parse(grant.deadlineAt) && finalizers.length && !records.some(item => item.event === 'input-intent' && item.toolSessionId === session.toolSessionId && item.effect === 'close'
      && records.some(done => done.event === 'command-completed' && done.commandId === item.commandId && done.toolSessionId === item.toolSessionId))) return refused('close-command-required: complete the declared close-effect command before closing transport');
    return closeInteractiveJob(on, { ...request, callerDigest, session, grace: interactiveCloseGrace(derived.binding.limits.closeGraceMs) }, authority);
  } catch (error) { return refused(errorText(error)); }
}

/** Host lifecycle cleanup closes only the original child's retained sessions. It never creates
 * a replacement grant, command, native session or licensed Job under a pause/cancel. */
export async function closeTaskInteractiveSessions(deps: TaskInteractiveDeps, actor: string): Promise<{ readonly closed: true; readonly proof: JsonValue } | { readonly closed: false; readonly reason: string }> {
  const held = await deps.store.nativeSessionEffect(actor);
  if (!held) return { closed: true, proof: { actor, resources: [] } };
  const grant = held.fact as unknown as Grant, operator = grant.effective.operator;
  if (!operator) return { closed: true, proof: { actor, resources: [] } };
  const run = await deps.store.run(held.identity.runId);
  const retainedFacts = await deps.store.listExternalEffectFacts(held.identity, 'interactive:');
  const prepared = Object.entries(retainedFacts).filter(([phase]) => phase.startsWith('interactive:prepared:'))
    .map(([, value]) => value as unknown as TaskInteractivePrepared).filter(value => value.actor === actor);
  for (const original of prepared) {
    // The transport always records Job intent before its physical creation boundary. A crash
    // before that fact cannot have launched a tool; check the exact native name as well.
    const jobIntent = retainedFacts[`interactive:job:${original.toolSessionId}:intent`];
    if (jobIntent) continue;
    const fresh = loadSite(deps.sitesDir, original.derived.site);
    if (jsonDigest(json(fresh)) !== grant.guard.siteDigest) return { closed: false, reason: 'Original cleanup Site identity changed' };
    if (await interactiveSessionExists(channelFor(fresh), original.toolSessionId)) return { closed: false, reason: 'Original native session exists without its required pre-launch Job intent; preserve uncertain ownership' };
    const lease = (await deps.store.effectResources(original.resourceIdentity.effectId))[0];
    if (lease && !lease.released) await deps.store.releaseExternalEffectResources(original.resourceIdentity, { session: original.toolSessionId, neverLaunched: true, closed: true });
    const intent = protocol(retainedFacts).find(item => item.event === 'open-intent' && item.toolSessionId === original.toolSessionId);
    if (intent) {
      const phase = `interactive:record:never-launched:${key(original.toolSessionId)}`;
      if (!await deps.store.externalEffectFact(held.identity, phase)) await deps.store.recordExternalEffectFact(held.identity, phase, json(parseInteractiveRecord({
        runId: intent.runId, executionId: intent.executionId, nodeId: intent.nodeId, toolSessionId: intent.toolSessionId, requestId: intent.requestId, actor: intent.actor,
        ownerEpoch: intent.ownerEpoch, controlRevision: intent.controlRevision, callerDigest: intent.callerDigest, operationDigest: intent.operationDigest, at: intent.at,
        event: 'open-released', jobSession: original.toolSessionId, reason: 'Original Job was never physically created; exact native name is absent' })));
    }
  }
  for (const view of await listTaskInteractiveSessions(deps.store, held.identity)) {
    if (view.operatorSessionId !== actor || view.status === 'closed' && !view.job) continue;
    const answer = await operateTaskInteractive(deps, actor, { action: 'close', runId: operator.runId, executionId: operator.executionId, nodeId: operator.nodeId,
      toolSessionId: view.toolSessionId, requestId: `host-close-${key(view.toolSessionId)}`, ownerEpoch: run.epoch, controlRevision: run.revision }, { cleanup: true });
    if (answer.status !== 'closed' && !(answer.status === 'duplicate' && 'process' in answer && answer.process === 'exited')) return { closed: false, reason: 'reason' in answer ? answer.reason : 'Original interactive cleanup is not confirmed' };
  }
  const resources = [];
  for (const original of prepared) {
    const lease = (await deps.store.effectResources(original.resourceIdentity.effectId))[0];
    if (!lease) continue;
    if (!lease.released || !lease.proof) return { closed: false, reason: 'Original Operator resource lease has no confirmed process-group closure proof' };
    resources.push({ effectId: original.resourceIdentity.effectId, proof: lease.proof });
  }
  return { closed: true, proof: json({ actor, resources }) };
}
