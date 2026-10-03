// @hima-seam agent wrapped
// Native Workshop/Team producers for the shared effect protocol. Native sessions are external
// capabilities; RunStore owns their intent, identity and facts. No Ledger drives this path.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { channelFor, mustRun } from './channel.js';
import { decideWrite } from './shell.js';
import { loadSite, type Site } from './sites.js';
import { interactiveSessionExists } from './interactive-job.js';
import type { JobIdentity } from './ledger.js';
import { HIMA_MOMENT_PRESET, openMoment, readMomentResult, type Moment } from './moments.js';
import { workshopTools, readBack, type WorkshopScope, type WorkshopAuthority } from './workshop.js';
import { createDelegation, delegationChildSessionId, delegationRequestDigest, readDelegationResult, cancelDelegation, followupDelegation, readNativeMessageReceipt, nativeMessagesCompletedThrough, type DelegationContract, type DelegationAuthority, type EffectiveDelegationContract, type OperatorDelegationGrant, type DelegationRuntimePolicy } from './delegation.js';
import { executeTaskEffect, commandTaskAdapter, taskEffectAdapterVersion, taskEffectStep, type TaskEffectAdapter, type TaskEffectRequest, type CommandTaskAdapterOptions, type EffectClosure } from './task-effects.js';
import { jsonDigest, type RunStore } from './run-store.js';
import { createTaskResult, type JsonValue, type TaskToolOutput, type TaskIdentity } from './task-contract.js';
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
const digest = (value: unknown) => jsonDigest(json(value));
const stableId = (request: TaskEffectRequest, suffix: string) => `session-hima-${createHash('sha256').update(`${request.identity.effectId}:${suffix}`).digest('hex').slice(0, 32)}`;
const remapOutput = (request: TaskEffectRequest, result: TaskToolOutput): TaskToolOutput => ({ ...result, artifacts: result.artifacts.map(artifact => ({ ...artifact, runId: request.identity.runId, taskId: request.identity.taskId, effectId: request.identity.effectId })) });
interface NativeOptions {
    readonly ctx: Context;
    readonly store: RunStore;
    readonly request: TaskEffectRequest;
    readonly sitesDir: string;
    readonly siteId: string;
    readonly workspace: string;
}
const currentSite = (options: NativeOptions) => loadSite(options.sitesDir, options.siteId);
async function admission(options: NativeOptions, permit: () => Promise<boolean>): Promise<void> {
    await options.store.assertEffectAdmission(options.request.admission, permit);
}
/** Explicit continuation is journaled only after this caller's fresh admission succeeds. Native
 * tools/model continuation may consume that scope; stale business senders still fail their own fence. */
async function retainNativeAdmission(options: NativeOptions, sessionId: string, permit: () => Promise<boolean>): Promise<void> {
    await admission(options, permit);
    await options.store.recordExternalEffectFact(options.request.identity, `admission:${sessionId}:${digest(options.request.admission)}`, json({ admission: options.request.admission }));
}
export async function readNativeSessionAdmission(store: RunStore, identity: TaskIdentity, sessionId: string, fallback: TaskEffectRequest['admission']): Promise<TaskEffectRequest['admission']> {
    const facts = await store.orderedExternalEffectFacts(identity, `admission:${sessionId}:`);
    return facts.length ? (facts.at(-1)!.fact as unknown as {
        admission: TaskEffectRequest['admission'];
    }).admission : fallback;
}
async function nativeAdmission(options: NativeOptions, sessionId: string): Promise<TaskEffectRequest['admission']> { return readNativeSessionAdmission(options.store, options.request.identity, sessionId, options.request.admission); }
async function nativeScopeAdmission(options: NativeOptions, sessionId: string, permit: () => Promise<boolean>): Promise<void> {
    await options.store.assertEffectAdmission(await nativeAdmission(options, sessionId), permit);
}
interface NativeCompletionSelection {
    readonly sessionId: string;
    readonly endSeq: number;
    readonly messageFacts: Readonly<Record<string, JsonValue>>;
    readonly dispatched: Readonly<Record<string, boolean>>;
}
function nativeMessageFacts(facts: Readonly<Record<string, JsonValue>>, sessionId: string): Record<string, JsonValue> {
    const ids = Object.entries(facts).filter(([phase, value]) => phase.startsWith('message:') && phase.endsWith(':intent') && value && typeof value === 'object' && !Array.isArray(value) && (value.childSessionId === sessionId || value.sessionId === sessionId)).map(([phase]) => phase.slice('message:'.length, -':intent'.length));
    return Object.fromEntries(Object.entries(facts).filter(([phase]) => ids.some(id => phase.startsWith(`message:${id}:`))));
}
async function nativeCompletionSelection(options: NativeOptions, sessionId: string, endSeq: number): Promise<NativeCompletionSelection> {
    const facts = nativeMessageFacts(await options.store.listExternalEffectFacts(options.request.identity, 'message:'), sessionId), dispatched: Record<string, boolean> = {}, messageIds: string[] = [];
    for (const phase of Object.keys(facts).filter(phase => phase.endsWith(':intent'))) {
        const id = phase.slice('message:'.length, -':intent'.length), sent = await options.store.effectDispatchExists(options.request.identity, `message:${id}`);
        dispatched[id] = sent;
        if (!sent)
            continue;
        const accepted = facts[`message:${id}:accepted`] as {
            messageId?: string;
        } | undefined;
        const receipt = accepted?.messageId ? { messageId: accepted.messageId } : await readNativeMessageReceipt(options.ctx, sessionId, `[hima-native-request:${id}]`);
        if (!receipt)
            throw new Error('Original dispatched native message has no consumed inbox receipt; wait on the same session');
        messageIds.push(receipt.messageId);
    }
    if (!await nativeMessagesCompletedThrough(options.ctx, sessionId, messageIds, endSeq))
        throw new Error('An accepted native message has no completed consuming turn in this selected result; wait for its original session');
    return { sessionId, endSeq, messageFacts: facts, dispatched };
}
async function sealNativeCompletion(options: NativeOptions, selections: readonly NativeCompletionSelection[]): Promise<void> {
    await taskEffectStep('hima.native.seal-completion', () => options.store.externalEffectTransaction(options.request.identity, { permit: async () => true }, async (_run, facts, record) => {
        for (const selection of selections) {
            if (digest(nativeMessageFacts(facts, selection.sessionId)) !== digest(selection.messageFacts))
                throw new Error('Native message receipts changed during result selection; recollect the same task');
            for (const [id, dispatched] of Object.entries(selection.dispatched))
                if (await options.store.effectDispatchExists(options.request.identity, `message:${id}`) !== dispatched)
                    throw new Error('Native message admission changed during result selection; recollect the same task');
        }
        await record('collection-seal', json({ sessions: selections.map(({ sessionId, endSeq }) => ({ sessionId, endSeq })) }));
    }));
}
async function assertWorkshopCodeIdle(options: NativeOptions): Promise<void> {
    const programs = await options.store.listExternalEffectFacts(options.request.identity, 'program:');
    for (const fact of Object.values(programs)) {
        const identity = (fact as unknown as {
            identity: TaskIdentity;
        }).identity;
        if ((await options.store.effectResources(identity.effectId)).some(lease => !lease.released))
            throw new Error('The original retained program Job owns this Workshop code; wait for its confirmed closure before writing');
    }
}
/** Immutable source facts survive the model Host. Returned Knowledge bytes have a retained copy. */
export function nativeWorkshopAuthority(options: NativeOptions, root: string): WorkshopAuthority {
    const record = (kind: string, data: unknown) => options.store.recordExternalEffectFact(options.request.identity, `${kind}:${digest(data)}`, json(data));
    return {
        reserveWrite: async (request) => {
            if (!request.callId)
                throw new Error('Native writer budget requires its actual DSH call identity');
            return options.store.reserveExternalResearchWrite(options.request.identity, { ...request, callId: request.callId });
        },
        appendCode: async (data, callId) => {
            if (!callId)
                throw new Error('Native Workshop write requires its actual DSH tool call identity');
            await options.store.recordExternalEffectFact(options.request.identity, `code:${callId}`, json({ ...data, toolCallId: callId }));
        }, appendKnowledge: data => record('knowledge', data), appendRefusal: data => record('refusal', data),
        async retain(bytes, sha256) {
            const at = path.join(root, sha256);
            await mkdir(root, { recursive: true });
            try {
                await writeFile(at, bytes, { flag: 'wx', mode: 0o600 });
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                    throw error;
                const info = await lstat(at);
                if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes.byteLength)
                    throw new Error('Retained native source is not the original plain file');
                const held = await readFile(at);
                if (createHash('sha256').update(held).digest('hex') !== sha256)
                    throw new Error('Retained native source bytes changed');
            }
            return at;
        },
        async beforeWrite(at, bytes, callId, kind = 'file') {
            if (!callId)
                throw new Error('Native Workshop write requires its actual DSH tool call identity');
            await options.store.recordExternalEffectFact(options.request.identity, `write:${callId}:${digest({ at, kind })}:intent`, json({ at, kind, bytes: bytes.byteLength, toolCallId: callId, sha256: createHash('sha256').update(bytes).digest('hex') }));
            if (!await options.store.claimEffectDispatch(await nativeAdmission(options, stableId(options.request, 'workshop')), async () => { await assertWorkshopCodeIdle(options); return (await decideWrite(currentSite(options), at, channelFor(currentSite(options)))).ok; }, `native-write:${callId}:${digest(at)}`, digest({ at, kind, sha256: createHash('sha256').update(bytes).digest('hex') })))
                throw new Error('Original native writer call already crossed its write boundary; inspect its same Code fact');
        },
    };
}
const workshopCapabilities = new WeakMap<Context, Map<string, {
    moment: Moment;
    fault: {
        why: string | undefined;
    };
}>>();
export interface NativeWorkshopOptions extends NativeOptions {
    /** Already resolved Pack declaration and explicit allowed inputs; contains no legacy Ledger. */
    readonly scope: Omit<WorkshopScope, 'ledger' | 'authority' | 'session' | 'fault' | 'site'>;
    readonly instructions: string;
    readonly prompt: string;
    readonly retainedMaterialsDir: string;
    readonly argv: readonly string[];
    /** Existing domain Reader/program collector. It uses its own Steps/child effects. */
    readonly collectProgram: CommandTaskAdapterOptions['collect'];
}
/** Model writes scoped code; a separate retained program Job and existing Reader produce data. */
export function workshopTaskAdapter(options: NativeWorkshopOptions): TaskEffectAdapter {
    const site = currentSite(options), sessionId = stableId(options.request, 'workshop'), live = workshopCapabilities.get(options.ctx) ?? new Map<string, {
        moment: Moment;
        fault: {
            why: string | undefined;
        };
    }>();
    workshopCapabilities.set(options.ctx, live);
    const configDigest = digest({ scope: options.scope, instructions: options.instructions, prompt: options.prompt, argv: options.argv, workspace: options.workspace, siteId: options.siteId });
    const check = (prepared: JsonValue) => {
        if ((prepared as {
            configDigest?: string;
        }).configDigest !== configDigest)
            throw new Error('Native Workshop resolved configuration differs from original effect');
    };
    const permit = async () => (await decideWrite(currentSite(options), options.scope.workshopAbs, channelFor(currentSite(options)))).ok;
    const connect = async (prepared: JsonValue, resumeOnly = false) => {
        const modelSelection = (prepared as {
            modelSelection?: {
                provider: string;
                model: string;
            };
        }).modelSelection;
        if (!modelSelection?.provider || !modelSelection.model)
            throw new Error('Original native Workshop has no frozen model route');
        const existing = live.get(sessionId);
        if (existing)
            return existing;
        const fault = { why: undefined as string | undefined };
        const scope: WorkshopScope = { ...options.scope, site: currentSite(options), session: { id: sessionId }, fault, authority: nativeWorkshopAuthority(options, options.retainedMaterialsDir) };
        const journal = { appendSession: async (_run: string, data: unknown) => {
                await options.store.recordExternalEffectFact(options.request.identity, `session:${(data as {
                    event: string;
                }).event}`, json(data));
                return data;
            } };
        const moment = await openMoment({ ctx: options.ctx, ledger: journal }, { runId: options.request.identity.runId, nodeId: options.request.identity.taskId, attempt: options.scope.attempt, preset: HIMA_MOMENT_PRESET, instructions: options.instructions, tools: workshopTools(scope), cwd: options.workspace, sessionId, resumeOnly, modelSelection, beforePrompt: () => nativeScopeAdmission(options, sessionId, permit), workshop: { id: options.scope.declaration.id, entry: options.scope.declaration.entry, entryPath: path.join(options.scope.workshopAbs, options.scope.declaration.entry) } });
        live.set(sessionId, { moment, fault });
        return { moment, fault };
    };
    return { kind: 'workshop', version: taskEffectAdapterVersion, resources: { siteId: site.name, jobs: 0, licences: {} }, capacity: { jobs: site.capacity.parallelJobs, licences: site.capacity.licences },
        async prepare() {
            const selection = options.ctx.get('agentDefaultModel')?.currentSelection();
            if (!selection)
                throw new Error('Native Workshop requires the actual Host model route');
            return { sessionId, workspace: options.workspace, workshop: options.scope.declaration.id, configDigest, modelSelection: json(selection) };
        },
        async permit(_prepared, operation) { return operation === 'release' || await permit(); },
        async stage(_prepared, beforeStage) {
            check(_prepared);
            await beforeStage();
            const fresh = currentSite(options), on = channelFor(fresh), decision = await decideWrite(fresh, options.scope.workshopAbs, on);
            if (!decision.ok)
                throw new Error(decision.reason);
            await admission(options, permit);
            await mustRun(on, ['mkdir', '-p', '--', decision.absPath], 'create retained native Workshop directory');
        },
        async submit(_prepared, beforeSubmit) {
            check(_prepared);
            await beforeSubmit();
            await retainNativeAdmission(options, sessionId, permit);
            const { moment, fault } = await connect(_prepared);
            await options.store.recordExternalEffectFact(options.request.identity, 'prompt:initial:intent', { sessionId, promptSha256: digest(options.prompt) });
            await admission(options, permit);
            const answer = await moment.ask(options.prompt);
            if (fault.why)
                throw new Error(fault.why);
            await options.store.recordExternalEffectFact(options.request.identity, 'prompt:initial:result', json(answer));
            return { sessionId };
        },
        async reconcile(prepared) { check(prepared); const answer = await readMomentResult(options.ctx, sessionId, options.workspace); return answer ? { state: 'ready', receipt: { sessionId } } : { state: 'unknown', reason: `Original native Workshop ${sessionId} has no retained completed turn; no prompt resend is permitted` }; },
        async collect(_prepared, _receipt, request) {
            check(_prepared);
            const facts = await taskEffectStep('hima.workshop.code-facts', () => options.store.orderedExternalEffectFacts(request.identity, 'code:'));
            const code = facts.map(item => item.fact) as unknown as {
                path: string;
                sha256: string;
                sessionId: string;
                toolCallId: string;
            }[];
            if (!code.some(item => item.sessionId === sessionId && item.path === path.join(options.scope.workshopAbs, options.scope.declaration.entry)))
                throw new Error('Completed Workshop has no source-linked entry Code fact');
            // Journal insertion ordering chooses the latest authored version of each path. No model text
            // or mutable filesystem alone may claim what the program executes.
            const latest = new Map(code.filter(item => item.sessionId === sessionId).map(item => [item.path, item]));
            await taskEffectStep('hima.workshop.verify-code', async () => {
                for (const item of latest.values()) {
                    const changed = await readBack(currentSite(options), channelFor(currentSite(options)), item.path, item.sha256, 'recorded');
                    if (changed)
                        throw new Error(changed);
                }
            });
            const input = request.input, suffix = digest({ input, code: [...latest.values()].map(({ path, sha256 }) => ({ path, sha256 })) });
            const childRequest: TaskEffectRequest = { ...request, input, identity: { ...request.identity, taskId: `${request.identity.taskId}:program`, effectId: `${request.identity.effectId}:program:${suffix}`, inputSha256: jsonDigest(input) }, admission: { ...request.admission, effectId: `${request.identity.effectId}:program:${suffix}` } };
            await taskEffectStep('hima.workshop.program-intent', () => options.store.recordExternalEffectFact(request.identity, `program:${suffix}`, json({ identity: childRequest.identity, code: [...latest.values()].map(({ path, sha256 }) => ({ path, sha256 })) })));
            const program = commandTaskAdapter({ sitesDir: options.sitesDir, siteId: options.siteId, workspace: options.workspace, name: `workshop-${options.scope.declaration.id}`, argv: options.argv, kind: 'program', licences: options.scope.declaration.licences, collect: options.collectProgram });
            const sourceReady = async () => {
                const writes = await options.store.listExternalEffectFacts(request.identity, 'write:');
                for (const fact of Object.values(writes)) {
                    const intent = fact as unknown as {
                        at: string;
                        toolCallId: string;
                        kind?: string;
                    };
                    if (intent.kind === 'directory')
                        continue;
                    if (!await options.store.effectDispatchExists(request.identity, `native-write:${intent.toolCallId}:${digest(intent.at)}`))
                        continue;
                    if (!await options.store.externalEffectFact(request.identity, `code:${intent.toolCallId}`))
                        throw new Error('Original admitted writer has no verified Code receipt; reconcile it before running this program');
                }
                for (const item of latest.values()) {
                    const changed = await readBack(currentSite(options), channelFor(currentSite(options)), item.path, item.sha256, 'recorded');
                    if (changed)
                        throw new Error(changed);
                }
            };
            const guarded: TaskEffectAdapter = { ...program,
                submit: (prepared, beforeSubmit) => program.submit(prepared, async () => { await sourceReady(); await beforeSubmit(); }),
                async reconcile(prepared, receipt) {
                    if (!await options.store.effectDispatchExists(childRequest.identity, 'submit')) {
                        try {
                            await sourceReady();
                        }
                        catch (error) {
                            return { state: 'failed', receipt: prepared, reason: error instanceof Error ? error.message : String(error) };
                        }
                    }
                    return program.reconcile(prepared, receipt);
                },
                async release(prepared, receipt) {
                    if (!await options.store.effectDispatchExists(childRequest.identity, 'submit')) {
                        const job = prepared as unknown as JobIdentity;
                        if (await interactiveSessionExists(channelFor(currentSite(options)), job.session))
                            return { closed: false, reason: 'Unadmitted program native name unexpectedly exists; preserve its original ownership' };
                        return { closed: true, proof: { session: job.session, neverAdmitted: true, nativeAbsent: true } };
                    }
                    return program.release(prepared, receipt);
                },
            };
            const result = await executeTaskEffect(options.store, childRequest, guarded);
            if (result.state !== 'succeeded')
                throw new Error(result.reason.message);
            return remapOutput(request, { schemaVersion: request.contract.output.version, value: result.result.value, artifacts: result.result.artifacts, diagnostics: result.result.diagnostics });
        },
        async message(_prepared, id, input, beforeSubmit) {
            check(_prepared);
            if (typeof input !== 'string' || !input.trim())
                throw new Error('Native Workshop message must be nonempty text');
            const marker = `[hima-native-request:${id}]`, text = `${input}\n${marker}`;
            await options.store.recordExternalEffectFact(options.request.identity, `message:${id}:intent`, { sessionId, textSha256: digest(text) });
            const { moment, fault } = await connect(_prepared, true);
            await beforeSubmit();
            await retainNativeAdmission(options, sessionId, permit);
            await admission(options, permit);
            const answer = await moment.ask(text);
            if (fault.why)
                throw new Error(fault.why);
            await options.store.recordExternalEffectFact(options.request.identity, `message:${id}:receipt`, json(answer));
            return json(answer);
        },
        async reconcileMessage(_prepared, id) {
            const held = await options.store.externalEffectFact(options.request.identity, `message:${id}:receipt`);
            if (held)
                return held;
            const original = await readNativeMessageReceipt(options.ctx, sessionId, `[hima-native-request:${id}]`);
            return original ? json(original) : undefined;
        },
        async release() {
            const held = live.get(sessionId);
            if (held) {
                await held.moment.close('completed');
                live.delete(sessionId);
            }
            else if (options.ctx.get('agents')?.get(sessionId as never))
                return { closed: false, reason: 'Original native Workshop is live but its disposal capability is unavailable' };
            return { closed: true, proof: { sessionId, closed: true } };
        },
    };
}
export interface NativeTeamMember {
    readonly contract: DelegationContract;
    readonly operatorGrant?: OperatorDelegationGrant;
}
export interface NativeTeamOptions extends NativeOptions {
    readonly members: readonly NativeTeamMember[];
    /** Host closes all retained interactive Jobs of an Operator before the Team can commit data. */
    readonly closeOperator?: (sessionId: string) => Promise<EffectClosure>;
    readonly permit: () => Promise<boolean>;
    /** Existing Pack result validation/aggregation, fed only native completed results with evidence. */
    readonly collectMembers: (members: readonly {
        effective: EffectiveDelegationContract;
        result: Awaited<ReturnType<typeof readDelegationResult>>;
    }[], request: TaskEffectRequest) => Promise<TaskToolOutput>;
}
function teamAuthority(options: NativeTeamOptions, beforeNative: () => Promise<void>): DelegationAuthority {
    const phase = (id: string) => `child:${id}`;
    const unused = async () => ({ kind: 'refused' as const, reason: 'Use shared effect message/cleanup identity for this native task' });
    return {
        async admitCreation({ contract, requestDigest, proposed }) {
            const key = phase(contract.delegationId), prior = await options.store.externalEffectFact(options.request.identity, `${key}:intent`);
            if (prior) {
                const old = prior as unknown as {
                    requestDigest: string;
                    effective: EffectiveDelegationContract;
                    deadlineAt: string;
                };
                if (old.requestDigest !== requestDigest)
                    throw new Error('Native child identity reused with different intent');
                if (digest(old.effective) !== digest(proposed))
                    throw new Error('Original native child model, scope or grant changed before its prepared send');
                if (await options.store.effectDispatchExists(options.request.identity, `native-child:${contract.delegationId}`)) {
                    const accepted = await options.store.externalEffectFact(options.request.identity, `${key}:receipt:accepted`) as {
                        initialMessageId?: string;
                    } | undefined;
                    return { kind: 'duplicate', durable: { requestDigest: old.requestDigest, state: accepted ? 'accepted' : 'intent', effective: old.effective, childSessionId: old.effective.childSessionId, ...(accepted?.initialMessageId ? { initialMessageId: accepted.initialMessageId } : {}) } };
                }
                return { kind: 'reserved', reservation: { reservationId: key, deadlineAt: old.deadlineAt } };
            }
            const run = await options.store.run(options.request.identity.runId), deadlineAt = new Date(Math.min(Date.parse(run.deadlineAt), Date.now() + contract.budgetShare.maxElapsedMs)).toISOString();
            await options.store.recordExternalEffectFact(options.request.identity, `${key}:intent`, json({ contract, requestDigest, effective: proposed, deadlineAt, guard: { sitesDir: options.sitesDir, siteId: options.siteId, siteDigest: digest(currentSite(options)), admission: options.request.admission } }));
            await beforeNative();
            return { kind: 'reserved', reservation: { reservationId: key, deadlineAt } };
        },
        async recordCreation(data) { await options.store.recordExternalEffectFact(options.request.identity, `${phase(data.contract.delegationId)}:receipt:${data.outcome}`, json(data)); },
        admitFollowup: unused, recordFollowup: async () => { throw new Error('Use shared native task message journal'); },
        admitCancel: async () => ({ kind: 'reserved', reservationId: 'cleanup' }), recordCancel: async (data) => { await options.store.recordExternalEffectFact(options.request.identity, `cleanup:${data.childSessionId}:${data.effect}`, json(data)); },
    };
}
/** Full native continuable Team lifecycle, preserving each child purpose, grant and source result. */
export function teamTaskAdapter(options: NativeTeamOptions): TaskEffectAdapter {
    const site = currentSite(options), signal = new AbortController().signal;
    const configDigest = digest({ members: options.members, workspace: options.workspace, siteId: options.siteId });
    const check = (prepared: JsonValue) => {
        if ((prepared as {
            configDigest?: string;
        }).configDigest !== configDigest)
            throw new Error('Native Team contracts/grants differ from original effect');
    };
    const startMember = async (member: NativeTeamMember, beforeFirst?: () => Promise<void>) => {
        const childId = delegationChildSessionId(member.contract.parentSessionId, member.contract.delegationId);
        return createDelegation(options.ctx, member.contract, teamAuthority(options, async () => { }), signal, member.operatorGrant, async () => {
            await beforeFirst?.();
            const intent = await options.store.externalEffectFact(options.request.identity, `child:${member.contract.delegationId}:intent`) as unknown as {
                deadlineAt: string;
            };
            if (Date.now() >= Date.parse(intent.deadlineAt))
                throw new Error('Original child allocation expired before native send');
            await retainNativeAdmission(options, childId, options.permit);
            if (!await options.store.claimEffectDispatch(options.request.admission, options.permit, `native-child:${member.contract.delegationId}`, delegationRequestDigest(member.contract)))
                throw new Error('Original native child dispatch is retained; reconnect without respawn');
            await admission(options, options.permit);
        });
    };
    return { kind: 'team', version: taskEffectAdapterVersion, resources: { siteId: site.name, jobs: 0, licences: {} }, capacity: { jobs: site.capacity.parallelJobs, licences: site.capacity.licences },
        async prepare() { return json({ configDigest, members: options.members.map(member => ({ contract: member.contract, childSessionId: delegationChildSessionId(member.contract.parentSessionId, member.contract.delegationId), requestDigest: delegationRequestDigest(member.contract) })) }); },
        async permit(_prepared, operation) {
            if (operation === 'message' && await options.store.externalEffectFact(options.request.identity, 'collection-seal'))
                return false;
            return operation === 'release' || await options.permit();
        },
        async submit(_prepared, beforeSubmit) {
            check(_prepared);
            let sent = false;
            for (const member of options.members) {
                const answer = await startMember(member, async () => {
                    if (!sent) {
                        await beforeSubmit();
                        sent = true;
                    }
                });
                if (answer.status === 'refused')
                    throw new Error(answer.reason);
                if (answer.status === 'uncertain')
                    throw new Error(answer.reason ?? 'Native child acknowledgement unknown');
            }
            return { submitted: true };
        },
        async reconcile(prepared) {
            check(prepared);
            // A prior overall admission may have sent only part of this frozen Team. Only members whose
            // own native API was never admitted can continue under this fresh explicit TaskRequest.
            if (await options.store.effectDispatchExists(options.request.identity, 'submit'))
                for (const member of options.members) {
                    if (await options.store.effectDispatchExists(options.request.identity, `native-child:${member.contract.delegationId}`))
                        continue;
                    try {
                        await admission(options, options.permit);
                        const answer = await startMember(member);
                        if (answer.status === 'refused' || answer.status === 'uncertain')
                            return { state: 'unknown', reason: answer.reason ?? 'Original native member acceptance remains unknown' };
                    }
                    catch (error) {
                        return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) };
                    }
                }
            for (const member of options.members) {
                const fact = await options.store.externalEffectFact(options.request.identity, `child:${member.contract.delegationId}:intent`) as unknown as {
                    effective: EffectiveDelegationContract;
                    requestDigest: string;
                } | undefined;
                if (!fact)
                    return { state: 'unknown', reason: 'Original native child has no retained effective grant; no respawn' };
                const result = await readDelegationResult(options.ctx, fact);
                if (result.status !== 'candidate')
                    return { state: 'running', reason: result.unknowns.join('; ') };
                try {
                    await nativeCompletionSelection(options, fact.effective.childSessionId, result.completedTurn!.endSeq);
                }
                catch (error) {
                    return { state: 'running', reason: error instanceof Error ? error.message : String(error) };
                }
            }
            return { state: 'ready', receipt: { completed: true } };
        },
        async collect(_prepared, _receipt, request) {
            check(_prepared);
            const selected = await taskEffectStep('hima.team.completed-members', async () => {
                const found = [], selections: NativeCompletionSelection[] = [];
                for (const member of options.members) {
                    const fact = await options.store.externalEffectFact(request.identity, `child:${member.contract.delegationId}:intent`) as unknown as {
                        effective: EffectiveDelegationContract;
                        requestDigest: string;
                    };
                    const result = await readDelegationResult(options.ctx, fact);
                    if (result.status !== 'candidate')
                        throw new Error(result.unknowns.join('; '));
                    selections.push(await nativeCompletionSelection(options, fact.effective.childSessionId, result.completedTurn!.endSeq));
                    found.push({ effective: fact.effective, result });
                }
                return { members: found, selections };
            });
            const output = await options.collectMembers(selected.members, request);
            createTaskResult(request.identity, request.contract, output, request.localSchemas);
            await sealNativeCompletion(options, selected.selections);
            return output;
        },
        async message(_prepared, id, input, beforeSubmit) {
            check(_prepared);
            if (!input || Array.isArray(input) || typeof input !== 'object' || typeof input.memberId !== 'string' || typeof input.text !== 'string')
                throw new Error('Native Team message names memberId and nonempty text');
            const member = options.members.find(item => item.contract.delegationId === input.memberId);
            if (!member)
                throw new Error('Native Team message member identity is outside this task');
            const childSessionId = delegationChildSessionId(member.contract.parentSessionId, member.contract.delegationId), marker = `[hima-native-request:${id}]`;
            const authority = teamAuthority(options, async () => { });
            authority.admitFollowup = async ({ requestDigest }) => {
                const prior = await options.store.externalEffectFact(options.request.identity, `message:${id}:intent`);
                if (prior)
                    return { kind: 'duplicate', uncertain: true };
                const messages = await options.store.listExternalEffectFacts(options.request.identity, 'message:');
                const used = Object.entries(messages).filter(([phase, value]) => phase.endsWith(':intent') && value && typeof value === 'object' && !Array.isArray(value) && value.childSessionId === childSessionId).length;
                if (used >= member.contract.budgetShare.maxFollowups)
                    return { kind: 'refused', reason: 'The declared child follow-up allocation is exhausted' };
                await options.store.recordExternalEffectFact(options.request.identity, `message:${id}:intent`, json({ childSessionId, requestDigest }));
                return { kind: 'reserved', reservationId: `message:${id}` };
            };
            authority.recordFollowup = async (data) => { await options.store.recordExternalEffectFact(options.request.identity, `message:${id}:${data.outcome}`, json(data)); };
            const answer = await followupDelegation(options.ctx, { parentSessionId: member.contract.parentSessionId, childSessionId, requestId: id, message: `${input.text}\n${marker}` }, authority, signal, async () => {
                await beforeSubmit();
                await retainNativeAdmission(options, childSessionId, options.permit);
                const policy = await nativeDelegationPolicy(options.store, childSessionId);
                if (!policy?.writesAllowed)
                    throw new Error(policy?.reason ?? 'Native child has no current message grant');
                await admission(options, options.permit);
            });
            if (answer.status !== 'accepted')
                throw new Error(answer.reason ?? 'Original native message acknowledgement unknown');
            return json(answer.receipt);
        },
        async reconcileMessage(_prepared, id, input) {
            if (!input || Array.isArray(input) || typeof input !== 'object' || typeof input.memberId !== 'string')
                return undefined;
            const member = options.members.find(item => item.contract.delegationId === input.memberId);
            if (!member)
                return undefined;
            const receipt = await options.store.externalEffectFact(options.request.identity, `message:${id}:accepted`);
            if (receipt)
                return receipt;
            const original = await readNativeMessageReceipt(options.ctx, delegationChildSessionId(member.contract.parentSessionId, member.contract.delegationId), `[hima-native-request:${id}]`);
            return original ? json(original) : undefined;
        },
        async release(_prepared, _receipt, beforeCleanup) {
            for (const member of options.members.filter(item => item.operatorGrant !== undefined)) {
                const id = delegationChildSessionId(member.contract.parentSessionId, member.contract.delegationId);
                if (!options.closeOperator)
                    return { closed: false, reason: 'Original Operator interactive Jobs require the Host cleanup bridge before Team result handoff' };
                const closed = await options.closeOperator(id);
                if (!closed.closed)
                    return closed;
                await options.store.recordExternalEffectFact(options.request.identity, `operator-closed:${id}`, closed.proof);
            }
            for (const member of options.members) {
                const id = delegationChildSessionId(member.contract.parentSessionId, member.contract.delegationId), input = json({ parentSessionId: member.contract.parentSessionId, childSessionId: id });
                if (!options.ctx.get('agents')?.get(id as never)) {
                    const fact = await options.store.externalEffectFact(options.request.identity, `child:${member.contract.delegationId}:intent`) as unknown as {
                        effective: EffectiveDelegationContract;
                        requestDigest: string;
                    };
                    const result = await readDelegationResult(options.ctx, fact);
                    if (result.status !== 'candidate')
                        return { closed: false, reason: 'Original cold child completion/closure cannot be proved' };
                    continue;
                }
                if (beforeCleanup && !await beforeCleanup(id, input)) {
                    const prior = await options.store.externalEffectFact(options.request.identity, `cleanup:${id}:confirmed`) as {
                        effect?: string;
                    } | undefined;
                    if (prior?.effect === 'confirmed')
                        continue;
                    return { closed: false, reason: 'Native child cleanup acknowledgement remains unknown' };
                }
                const answer = await cancelDelegation(options.ctx, { parentSessionId: member.contract.parentSessionId, childSessionId: id, requestId: `cleanup-${digest(id).slice(0, 20)}` }, teamAuthority(options, async () => { }));
                if (answer.receipt?.effect !== 'confirmed')
                    return { closed: false, reason: answer.reason ?? 'Native child closure unknown' };
            }
            return { closed: true, proof: { children: options.members.map(member => delegationChildSessionId(member.contract.parentSessionId, member.contract.delegationId)), closed: true } };
        },
    };
}
/** Root guard integration: lookup remains PG authoritative even after handoff/hold. */
export async function nativeTeamPolicy(options: NativeTeamOptions, childSessionId: string): Promise<DelegationRuntimePolicy | undefined> {
    const member = options.members.find(item => delegationChildSessionId(item.contract.parentSessionId, item.contract.delegationId) === childSessionId);
    if (!member)
        return undefined;
    const fact = await options.store.externalEffectFact(options.request.identity, `child:${member.contract.delegationId}:intent`) as unknown as {
        effective: EffectiveDelegationContract;
    } | undefined;
    if (!fact)
        return undefined;
    let writesAllowed = true, reason: string | undefined;
    try {
        await admission(options, options.permit);
    }
    catch (error) {
        writesAllowed = false;
        reason = error instanceof Error ? error.message : String(error);
    }
    return { effective: fact.effective, state: 'accepted', toolsAllowed: true, writesAllowed, ...(reason ? { reason } : {}) };
}
/** Host-wide lookup, including reopened tasks. Identity and grant are read from PG, never a
 * callback registry or projected Ledger. Every actual prompt/tool rereads current control/Permit. */
export async function nativeDelegationPolicy(store: RunStore, childSessionId: string): Promise<DelegationRuntimePolicy | undefined> {
    const held = await store.nativeSessionEffect(childSessionId);
    if (!held)
        return undefined;
    const fact = held.fact as unknown as {
        effective: EffectiveDelegationContract;
        deadlineAt: string;
        guard: {
            sitesDir: string;
            siteId: string;
            siteDigest: string;
            admission: TaskEffectRequest['admission'];
        };
    };
    if (!fact.guard)
        throw new Error('Original native child grant lacks its current-Permit binding');
    let writesAllowed = true, reason: string | undefined;
    const current = await readNativeSessionAdmission(store, held.identity, childSessionId, fact.guard.admission);
    try {
        if (Date.now() >= Date.parse(fact.deadlineAt))
            throw new Error('Native child task allocation deadline expired');
        await store.assertEffectAdmission(current, async () => digest(loadSite(fact.guard.sitesDir, fact.guard.siteId)) === fact.guard.siteDigest);
        const closed = await store.externalEffectFact(held.identity, `cleanup:${childSessionId}:confirmed`) ?? await store.externalEffectFact(held.identity, 'collection-seal');
        if (closed) {
            writesAllowed = false;
            reason = 'Original native child is already closed';
        }
    }
    catch (error) {
        writesAllowed = false;
        reason = error instanceof Error ? error.message : String(error);
    }
    return { effective: fact.effective, state: writesAllowed ? 'accepted' : 'cancel-requested', toolsAllowed: true, writesAllowed, admittedAuthority: { owner: current.owner, epoch: current.epoch, revision: current.revision }, ...(reason ? { reason } : {}) };
}
