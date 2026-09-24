import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import {
  cancelDelegation, createDelegation, delegationToolDenial, followupDelegation, readDelegationResult, readDelegationTranscript,
  registerDelegationGuard, type DelegationAuthority, type DelegationContract, type DelegationRuntimePolicy,
  type DurableDelegationState, type EffectiveDelegationContract,
} from '../../packages/harness/src/delegation.ts';
import { bootInProcess, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeMomentScenario } from './support/moments.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '0';

interface StoredDelegation {
  requestDigest: string;
  state: DurableDelegationState['state'];
  childSessionId?: string;
  initialMessageId?: string;
  effective?: EffectiveDelegationContract;
  reason?: string;
  contract: DelegationContract;
  deadlineAt: string;
  followups: Map<string, { digest: string; messageId?: string; uncertain?: boolean }>;
  cancels: Map<string, { digest: string; effect?: 'confirmed' | 'unknown' }>;
}

class RunAuthority implements DelegationAuthority {
  readonly rows = new Map<string, StoredDelegation>();
  held = false;
  epoch = 1;
  revision = 0;
  usedElapsedMs = 0;
  readonly totalElapsedMs = 1_400;

  async admitCreation(input: { contract: DelegationContract; requestDigest: string; proposed: EffectiveDelegationContract }) {
    const old = this.rows.get(input.contract.delegationId);
    if (old) return { kind: 'duplicate' as const, durable: old };
    if (this.held) return { kind: 'refused' as const, reason: 'the parent Run is held' };
    if (input.contract.runRef?.expectedEpoch !== this.epoch || input.contract.runRef?.expectedRevision !== this.revision) {
      return { kind: 'refused' as const, reason: 'owner epoch/revision is stale' };
    }
    if (input.contract.dependencyIds.some((id) => !this.rows.has(id))) return { kind: 'refused' as const, reason: 'a dependency is missing' };
    if (this.usedElapsedMs + input.contract.budgetShare.maxElapsedMs > this.totalElapsedMs) return { kind: 'refused' as const, reason: 'the parent total elapsed-time budget has no such share remaining' };
    this.usedElapsedMs += input.contract.budgetShare.maxElapsedMs;
    const deadlineAt = new Date(Date.now() + input.contract.budgetShare.maxElapsedMs).toISOString();
    this.rows.set(input.contract.delegationId, { contract: input.contract, requestDigest: input.requestDigest,
      state: 'intent', effective: input.proposed, deadlineAt, followups: new Map(), cancels: new Map() });
    return { kind: 'reserved' as const, reservation: { reservationId: `reserve-${input.contract.delegationId}`, deadlineAt,
      admittedEpoch: this.epoch, admittedRevision: this.revision } };
  }

  async recordCreation(input: Parameters<DelegationAuthority['recordCreation']>[0]) {
    const row = this.rows.get(input.contract.delegationId); assert.ok(row);
    row.state = input.outcome === 'accepted' ? 'accepted' : input.outcome;
    row.effective = input.effective; row.childSessionId = input.childSessionId; row.initialMessageId = input.initialMessageId; row.reason = input.reason;
  }

  async admitFollowup(input: Parameters<DelegationAuthority['admitFollowup']>[0]) {
    const row = [...this.rows.values()].find((candidate) => candidate.childSessionId === input.childSessionId);
    if (!row || row.contract.parentSessionId !== input.parentSessionId) return { kind: 'refused' as const, reason: 'unknown parent/child address' };
    const prior = row.followups.get(input.requestId);
    if (prior) return prior.digest === input.requestDigest ? { kind: 'duplicate' as const, messageId: prior.messageId, uncertain: prior.uncertain }
      : { kind: 'refused' as const, reason: 'follow-up identity reused with different intent' };
    if (this.held || row.state !== 'accepted' || Date.now() >= Date.parse(row.deadlineAt)) return { kind: 'refused' as const, reason: 'the child is held, ended, or past its deadline' };
    if (row.followups.size >= row.contract.budgetShare.maxFollowups) return { kind: 'refused' as const, reason: 'the child follow-up cap is exhausted' };
    row.followups.set(input.requestId, { digest: input.requestDigest });
    return { kind: 'reserved' as const, reservationId: `followup-${input.requestId}` };
  }

  async recordFollowup(input: Parameters<DelegationAuthority['recordFollowup']>[0]) {
    const row = [...this.rows.values()].find((candidate) => candidate.childSessionId === input.childSessionId); assert.ok(row);
    row.followups.set(input.requestId, { digest: input.requestDigest, messageId: input.messageId, uncertain: input.outcome === 'uncertain' });
  }

  async admitCancel(input: Parameters<DelegationAuthority['admitCancel']>[0]) {
    const row = [...this.rows.values()].find((candidate) => candidate.childSessionId === input.childSessionId);
    if (!row || row.contract.parentSessionId !== input.parentSessionId) return { kind: 'refused' as const, reason: 'unknown parent/child address' };
    const old = row.cancels.get(input.requestId);
    if (old) return old.digest === input.requestDigest ? { kind: 'duplicate' as const, effect: old.effect }
      : { kind: 'refused' as const, reason: 'cancel identity reused with different intent' };
    row.cancels.set(input.requestId, { digest: input.requestDigest });
    return { kind: 'reserved' as const, reservationId: `cancel-${input.requestId}` };
  }

  async recordCancel(input: Parameters<DelegationAuthority['recordCancel']>[0]) {
    const row = [...this.rows.values()].find((candidate) => candidate.childSessionId === input.childSessionId); assert.ok(row);
    row.cancels.set(input.requestId, { digest: input.requestDigest, effect: input.effect });
    row.state = input.effect === 'confirmed' ? 'cancelled' : 'cancel-requested'; row.reason = input.reason;
  }

  policy(childId: string): DelegationRuntimePolicy | undefined {
    const row = [...this.rows.values()].find((candidate) => candidate.childSessionId === childId);
    if (!row?.effective) return undefined;
    // The locked intent is the pre-spawn write authority: native prompt acceptance can wake the
    // child before the later accepted receipt is appended.  A bare/non-reserved intent never enters
    // this map, and the same deadline/hold check applies on every call.
    const active = (row.state === 'intent' || row.state === 'accepted') && !this.held && Date.now() < Date.parse(row.deadlineAt);
    return { effective: row.effective, state: row.state, toolsAllowed: active || this.held, writesAllowed: active,
      ...(active ? {} : { reason: this.held ? 'the parent Run is held; child writes are frozen' : 'the delegation is no longer active' }) };
  }
}

const contractFor = (parentSessionId: string, workspace: string, privateRoot: string, id = 'coding-1'): DelegationContract => ({
  delegationId: id, parentSessionId, role: 'coding', task: 'Create the requested TypeScript file and report evidence.',
  inputRefs: ['record:input-1'], workspaceRef: workspace, runRef: { runId: 'run-1', expectedEpoch: 1, expectedRevision: 0 },
  nodeRef: 'research-code', allowedTools: ['read', 'glob', 'write', 'edit', 'bash', 'subagent', 'hima_execute'], writeScope: { root: privateRoot },
  budgetShare: { maxElapsedMs: 1_000, maxFollowups: 1, maxTokensPerTurn: 512 }, dependencyIds: [],
  recipient: { kind: 'run-owner', sessionId: parentSessionId }, status: 'requested',
});

test('native bounded delegation creates, edits, follows up, guards scope, survives restart, and stays below Run authority', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const scenario = await writeMomentScenario(home, 'coding', path.join(repoRoot, 'test/fixtures/delegation'));
  await writeReplayOverlay(home.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(home.home), QUIET_TITLE_ROW);
  const authority = new RunAuthority();
  let parentId: string; let model: { provider: string; model: string };
  let host = await bootInProcess(home);
  try {
    const parent = await createRootAgent(host.ctx, home.home);
    parentId = String(parent.id); model = { provider: parent.options.provider!, model: parent.options.model! };
    const privateRoot = path.dirname(scenario.readyFile);
    await mkdir(privateRoot, { recursive: true });
    const disposeGuard = registerDelegationGuard(host.ctx, (childId) => authority.policy(childId));
    t.after(disposeGuard);

    authority.held = true;
    const held = await createDelegation(host.ctx, contractFor(parentId, home.home, privateRoot, 'held'), authority, new AbortController().signal);
    assert.equal(held.status, 'refused'); assert.match(held.reason!, /held/);
    authority.held = false;

    authority.epoch = 2;
    const stale = await createDelegation(host.ctx, contractFor(parentId, home.home, privateRoot, 'stale'), authority, new AbortController().signal);
    assert.equal(stale.status, 'refused'); assert.match(stale.reason!, /stale/);
    authority.epoch = 1;

    const foreign = path.join(home.home, 'foreign'); await mkdir(foreign);
    const wrongWorkspace = await createDelegation(host.ctx, { ...contractFor(parentId, home.home, privateRoot, 'foreign'), workspaceRef: foreign }, authority, new AbortController().signal);
    assert.equal(wrongWorkspace.status, 'refused'); assert.match(wrongWorkspace.reason!, /does not match/);

    const contract = contractFor(parentId, home.home, privateRoot);
    const created = await createDelegation(host.ctx, contract, authority, new AbortController().signal);
    assert.equal(created.status, 'created', created.reason); assert.ok(created.receipt?.childSessionId);
    assert.deepEqual(created.effectiveContract?.tools, ['read', 'glob', 'write', 'edit']);
    assert.deepEqual(created.effectiveContract?.inputRefs, contract.inputRefs);
    assert.equal(created.effectiveContract?.readScope?.root, privateRoot, 'generic file reads are confined to the coding child private directory');
    assert.ok(created.unknowns.some((item) => item.includes('bash')));
    assert.ok(created.unknowns.some((item) => item.includes('subagent')));
    assert.ok(created.unknowns.some((item) => item.includes('hima_execute')));
    const childId = created.receipt!.childSessionId!;
    const child = host.ctx.get('agents')!.get(childId as never); assert.ok(child);
    await child.whenIdle();
    let written: string;
    try { written = await readFile(scenario.readyFile, 'utf8'); }
    catch (error) { assert.fail(`native child produced no guarded edit: ${String(error)}\n${JSON.stringify(child.session.deriveMessages(), null, 2)}`); }
    assert.equal(written!, 'export const answer = 42;\n', 'the real native child write must land inside its guarded private directory');
    assert.equal(host.ctx.get('agents')!.isOwnedBy(child.id, parent), true);
    assert.equal(child.session.header.parentSession, parent.id);
    assert.equal(host.ctx.tools.schemas(child).some((tool) => tool.name === 'hima_execute'), false, 'child cannot take over Run actions');
    assert.equal(host.ctx.tools.schemas(child).some((tool) => tool.name === 'bash'), false, 'child has no arbitrary command execution');

    const transcript = readDelegationTranscript(host.ctx, childId);
    assert.equal(transcript.availability, 'available');
    if (transcript.availability === 'available') {
      assert.equal(transcript.source, 'native-live-session');
      assert.match(transcript.lastAssistantText!, /still owns verification/);
      assert.ok(transcript.messages.some((message) => message.role === 'user' && message.text.includes('Task:')));
      assert.ok(transcript.nativeMessages.some((message) => message.content.some((block) => block.type === 'tool-call' && block.name === 'write')),
        'the transcript source must be the actual native Session, including its tool trace');
    }
    const candidate = await readDelegationResult(host.ctx, { effective: created.effectiveContract!, requestDigest: created.receipt!.requestDigest });
    assert.equal(candidate.status, 'candidate');
    assert.match(candidate.output?.filter((block) => block.type === 'text').map((block) => block.text).join('') ?? '', /owner still owns|parent still owns/i);
    assert.deepEqual(candidate.evidence.artifactRefs, [{ path: path.basename(scenario.readyFile), sha256: createHash('sha256').update(written!).digest('hex'), bytes: Buffer.byteLength(written!), tool: 'write', toolCallId: 'call-delegation-write' }]);
    assert.deepEqual(candidate.evidence.testRefs, [], 'a file write does not fabricate a test result');
    assert.ok(candidate.evidence.limitations.some((item) => /test/i.test(item)));

    const unrelatedParentFile = path.join(home.home, 'unrelated-parent-secret.txt');
    await writeFile(unrelatedParentFile, 'must remain outside delegated inputs');
    const outsideDenial = delegationToolDenial((id) => authority.policy(id), { name: 'read', arguments: { file_path: unrelatedParentFile }, agent: child } as never);
    assert.match(outsideDenial!, /private task directory/);
    assert.match(delegationToolDenial((id) => authority.policy(id), { name: 'read', arguments: { file_path: path.basename(unrelatedParentFile) }, agent: child } as never)!, /private task directory/, 'relative paths keep the native parent cwd and cannot be reinterpreted inside the private scope');
    assert.match(delegationToolDenial((id) => authority.policy(id), { name: 'glob', arguments: { pattern: '**/*' }, agent: child } as never)!, /private task directory/, 'an omitted search root cannot enumerate the parent workspace');
    authority.held = true;
    const heldWrite = await host.ctx.tools.execute({ callId: 'held-write' as never, name: 'write', arguments: { file_path: path.join(privateRoot, 'held.ts'), content: 'no' }, agent: child, signal: new AbortController().signal });
    assert.equal(heldWrite.isError, true); assert.match(heldWrite.content.map((item) => item.type === 'text' ? item.text : '').join(''), /writes are frozen/);
    const heldReadDenial = delegationToolDenial((id) => authority.policy(id), { name: 'read', arguments: { file_path: scenario.readyFile }, agent: child } as never);
    assert.equal(heldReadDenial, undefined, 'a parent hold freezes child writes but preserves useful reads');
    const refusedFollowup = await followupDelegation(host.ctx, { parentSessionId: parentId, childSessionId: childId, requestId: 'follow-held', message: 'inspect again' }, authority, new AbortController().signal);
    assert.equal(refusedFollowup.status, 'refused');
    authority.held = false;

    const followup = await followupDelegation(host.ctx, { parentSessionId: parentId, childSessionId: childId, requestId: 'follow-1', message: 'Confirm the same session received this follow-up.' }, authority, new AbortController().signal);
    assert.equal(followup.status, 'accepted', followup.reason);
    await host.ctx.get('agents')!.get(childId as never)!.whenIdle();
    const afterFollowup = readDelegationTranscript(host.ctx, childId);
    assert.equal(afterFollowup.availability, 'available');
    if (afterFollowup.availability === 'available') assert.match(afterFollowup.lastAssistantText!, /same native child session/);
    const repeatedFollowup = await followupDelegation(host.ctx, { parentSessionId: parentId, childSessionId: childId, requestId: 'follow-1', message: 'Confirm the same session received this follow-up.' }, authority, new AbortController().signal);
    assert.equal(repeatedFollowup.status, 'duplicate');
    const overFollowups = await followupDelegation(host.ctx, { parentSessionId: parentId, childSessionId: childId, requestId: 'follow-2', message: 'One more.' }, authority, new AbortController().signal);
    assert.equal(overFollowups.status, 'refused'); assert.match(overFollowups.reason!, /cap/);

    const duplicate = await createDelegation(host.ctx, contract, authority, new AbortController().signal);
    assert.equal(duplicate.status, 'duplicate'); assert.equal(duplicate.receipt?.childSessionId, childId);
    const overBudget = await createDelegation(host.ctx, { ...contractFor(parentId, home.home, privateRoot, 'coding-2'), budgetShare: { maxElapsedMs: 500, maxFollowups: 0 } }, authority, new AbortController().signal);
    assert.equal(overBudget.status, 'refused'); assert.match(overBudget.reason!, /budget/);
    const unsupportedTotal = await createDelegation(host.ctx, { ...contractFor(parentId, home.home, privateRoot, 'coding-total'), budgetShare: { maxElapsedMs: 100, maxFollowups: 0, maxTotalTokens: 1_000 } }, authority, new AbortController().signal);
    assert.equal(unsupportedTotal.status, 'refused'); assert.match(unsupportedTotal.reason!, /no enforceable task-total token/);

    const cancelled = await cancelDelegation(host.ctx, { parentSessionId: parentId, childSessionId: childId, requestId: 'cancel-1' }, authority);
    assert.equal(cancelled.status, 'accepted'); assert.ok(['confirmed', 'unknown'].includes(cancelled.receipt?.effect ?? ''), 'cancel reports the actually observed native stop state');
    const duplicateCancel = await cancelDelegation(host.ctx, { parentSessionId: parentId, childSessionId: childId, requestId: 'cancel-1' }, authority);
    assert.equal(duplicateCancel.status, 'duplicate'); assert.equal(duplicateCancel.receipt?.effect, cancelled.receipt?.effect);
    const afterCancel = await followupDelegation(host.ctx, { parentSessionId: parentId, childSessionId: childId, requestId: 'follow-cancelled', message: 'must not run' }, authority, new AbortController().signal);
    assert.equal(afterCancel.status, 'refused');
    const cancelledRead = await host.ctx.tools.execute({ callId: 'cancelled-read' as never, name: 'read', arguments: { file_path: scenario.readyFile }, agent: child, signal: new AbortController().signal });
    assert.equal(cancelledRead.isError, true, 'cancel fences every child tool, including reads');
  } finally { await host.dispose(); }

  host = await bootInProcess(home);
  try {
    const parent = await resumeTestAgent(host.ctx, parentId!, model!);
    try {
      const disposeGuard = registerDelegationGuard(host.ctx, (childId) => authority.policy(childId));
      const privateRoot = path.dirname(scenario.readyFile);
      const afterRestart = await createDelegation(host.ctx, contractFor(parentId!, home.home, privateRoot), authority, new AbortController().signal);
      assert.equal(afterRestart.status, 'duplicate');
      assert.equal(afterRestart.receipt?.childSessionId, authority.rows.get('coding-1')?.childSessionId);
      assert.equal(host.ctx.get('agents')!.list().length, 1, 'restart duplicate check must not spawn another child');
      disposeGuard();
    } finally { await parent.dispose(); }
  } finally { await host.dispose(); }
});
