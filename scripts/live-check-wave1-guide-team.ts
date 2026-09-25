// @hima-seam agent wrapped
// @hima-seam tools direct
// Wave 1 lane C: real DeepSeek Guide + bounded native children + independent Reviewer/adoption.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readDelegationTranscript, readNativeSessionContext, runDelegations, type ExecutionActionRequest, type LedgerRecord } from '@hima/harness';
import { createRootAgent, toolCalls } from '../test/contract/support/boot-inprocess.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { waitUntil } from '../test/contract/support/fabric.ts';
import { installNumericPack, numericHome, runLive, type LiveCheck } from './live-check-workshop.ts';
import { bootInProcess } from '../test/contract/support/boot-inprocess.ts';

const jsonOf = (result: { content?: readonly { type: string; text?: string }[] }): Record<string, any> =>
  JSON.parse(result.content?.find(item => item.type === 'text')?.text ?? '{}') as Record<string, any>;
type DelegationRecord = Extract<LedgerRecord, { type: 'delegation' }>;

async function task(check: LiveCheck): Promise<void> {
  const { h } = await numericHome(check);
  const pack = path.join(packsDirOf(h), 'live-numeric'); installNumericPack(pack);
  const host = await bootInProcess(h); check.attach(host);
  const guide = check.track(await createRootAgent(host.ctx, h.workspace));
  check.require('the Guide uses the configured real DeepSeek Flash route', guide.options.model === 'deepseek-flash', guide.options);
  const prepared = jsonOf(await host.ctx.tools.execute({ callId: 'wave1-team-prepare' as never, name: 'hima_prepare',
    arguments: { pack: 'live-numeric', site: 'local' }, agent: guide, signal: AbortSignal.timeout(30_000) }));
  check.require('Guide preparation is ready and creates no Run', prepared.ready === true && host.ctx.hima.ledger.runs().length === 0, prepared);
  const owner = check.track(await createRootAgent(host.ctx, h.workspace)); const ownerId = String(owner.id);
  const confirmed = await host.ctx.hima.startRun({ proposalId: prepared.id, pack: 'live-numeric', site: 'local',
    goal: { minimum: 1 }, strategy: { limit: 10 }, ownerSessionId: ownerId, guideSessionId: String(guide.id), notifyOwnerOnOpen: false });
  check.require('one Guide confirmation creates one independent owner Run', confirmed.kind === 'ran', confirmed);
  if (confirmed.kind !== 'ran') throw new Error('independent owner Run was not created');
  const runId = confirmed.run.id; const run = host.ctx.hima.ledger.run(runId)!;
  check.require('Guide remains distinct from the Campaign owner', ownerId !== String(guide.id) && run.control?.guideSessionId === String(guide.id), run.control);
  check.beforeDispose(async () => { const current = host.ctx.hima.ledger.run(runId); if (current && ['running', 'waiting'].includes(current.status ?? '')) await host.ctx.hima.cancelRun(runId); });

  let sequence = 0;
  const context = () => host.ctx.hima.executionContext(runId);
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
    const control = context().run.control!;
    return host.ctx.hima.executionAction({ runId, actor: ownerId, origin: 'agent', action,
      expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `wave1-team-${++sequence}`, ...fields });
  };
  const complete = async (nodeId: string) => {
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', begin.reason); const executionId = begin.receipt?.executionId; assert.ok(executionId);
    assert.equal((await act('work', { executionId })).kind, 'accepted');
    await waitUntil(`${nodeId} settles`, () => context().executions.some(entry => entry.id === executionId && ['ready', 'failed'].includes(entry.phase)), 30_000, 100);
    assert.equal(context().executions.find(entry => entry.id === executionId)?.phase, 'ready');
    assert.equal((await act('complete', { nodeId, executionId })).kind, 'accepted'); return executionId;
  };
  await complete('prepare');
  const analyzeBegin = await act('begin', { nodeId: 'analyze' }); assert.equal(analyzeBegin.kind, 'accepted');
  const analyzeId = analyzeBegin.receipt?.executionId; assert.ok(analyzeId);
  const measured = await act('read', { executionId: analyzeId, output: 'measured' }); assert.equal(measured.kind, 'accepted', measured.reason);
  const input = host.ctx.hima.ledger.records({ runId, type: 'knowledge' }).findLast(record => record.type === 'knowledge' && record.nodeId === 'analyze'); assert.ok(input);

  await check.say(guide, `Inspect exact Run ${runId} with the sourced Hima context. Explain its current node, distinct owner, known facts and unknowns to the engineer. Do not execute, delegate, pause, continue or create another task.`);
  check.require('real Guide explanation uses a sourced read-only Hima tool and remains outside execution ownership',
    toolCalls(guide).some(call => ['hima_inspect', 'hima_context', 'hima_status'].includes(call.name)) && host.ctx.hima.ledger.run(runId)?.control?.owner === ownerId,
    { calls: toolCalls(guide), owner: host.ctx.hima.ledger.run(runId)?.control?.owner });

  const privateCoding = path.join(h.workspace, 'delegations/coding'); mkdirSync(privateCoding, { recursive: true });
  const delegate = async (body: Record<string, unknown>) => {
    const control = context().run.control!;
    return host.ctx.hima.delegate({ runId, actor: ownerId, expectedEpoch: control.epoch,
      expectedRevision: control.revision, ...body } as never, AbortSignal.timeout(45_000)) as Promise<Record<string, any>>;
  };
  const coding = await delegate({ action: 'create', requestId: 'create-coding', contract: { delegationId: 'coding', role: 'coding',
    task: `Create ${path.join(privateCoding, 'candidate.ts')} containing one exported function summarize(values: number[]): number that returns the sum. Use the write tool, then report the exact file and that this is candidate output pending owner verification.`,
    inputRefs: [], allowedTools: ['read', 'write', 'edit'], writeScope: { root: privateCoding },
    budgetShare: { maxElapsedMs: 45_000, maxFollowups: 1, maxTokensPerTurn: 1800 }, dependencyIds: [], recipient: { kind: 'run-owner', sessionId: ownerId } } });
  const research = await delegate({ action: 'create', requestId: 'create-research', contract: { delegationId: 'research', role: 'researcher',
    task: 'Read the one exact granted measured input with hima_delegation_input. Explain what it establishes and one explicit limitation. Return analysis only as a candidate for the Run owner.',
    inputRefs: [input.id], allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 50_000, maxFollowups: 1, maxTokensPerTurn: 2600 },
    dependencyIds: [], recipient: { kind: 'run-owner', sessionId: ownerId } } });
  check.require('two independent real children receive distinct roles/tools and one shared parent budget',
    coding.status === 'created' && research.status === 'created' && coding.receipt.childSessionId !== research.receipt.childSessionId
      && coding.effectiveContract.tools.includes('write') && research.effectiveContract.tools.includes('hima_delegation_input'),
    { coding, research });
  const codingAgent = host.ctx.get('agents')!.get(coding.receipt.childSessionId as never)!;
  const researchAgent = host.ctx.get('agents')!.get(research.receipt.childSessionId as never)!;
  await Promise.all([check.wait(codingAgent.whenIdle()), check.wait(researchAgent.whenIdle())]);
  check.require('real Coding child produced a private candidate artifact', existsSync(path.join(privateCoding, 'candidate.ts'))
    && /export function summarize/.test(readFileSync(path.join(privateCoding, 'candidate.ts'), 'utf8')), readDelegationTranscript(host.ctx, coding.receipt.childSessionId));
  check.require('real Research child actually read its exact granted Run fact',
    readDelegationTranscript(host.ctx, research.receipt.childSessionId).availability === 'available'
      && researchAgent.session.snapshotEvents().some(event => event.type === 'tool/call' && (event.data as { name?: string }).name === 'hima_delegation_input'),
    readDelegationTranscript(host.ctx, research.receipt.childSessionId));

  const resultOf = async (delegationId: string, childSessionId: string) => {
    let result = await delegate({ action: 'result', requestId: `result-${delegationId}-1`, delegationId });
    if (result.status !== 'candidate') {
      const follow = await delegate({ action: 'followup', requestId: `finish-${delegationId}`, delegationId,
        text: 'Return one concise final answer now from only the already recorded tool facts. Keep every limitation explicit.' });
      assert.equal(follow.status, 'accepted', JSON.stringify({ result, follow }));
      const resumed = host.ctx.get('agents')!.get(childSessionId as never); if (resumed) await check.wait(resumed.whenIdle());
      result = await delegate({ action: 'result', requestId: `result-${delegationId}-2`, delegationId });
    }
    return result;
  };
  const codingResult = await resultOf('coding', coding.receipt.childSessionId);
  const researchResult = await resultOf('research', research.receipt.childSessionId);
  check.require('both model results remain candidate-only until explicit adoption', codingResult.status === 'candidate' && researchResult.status === 'candidate',
    { codingResult, researchResult });
  const resultRecords = host.ctx.hima.ledger.records({ runId, type: 'delegation' })
    .filter((record): record is DelegationRecord => record.type === 'delegation' && record.event === 'result-observed');
  const codingRecord = resultRecords.find(record => record.delegationId === 'coding'); const researchRecord = resultRecords.find(record => record.delegationId === 'research'); assert.ok(codingRecord && researchRecord);

  const reviewer = await delegate({ action: 'create', requestId: 'create-reviewer', contract: { delegationId: 'reviewer', role: 'reviewer',
    task: 'Independently read both exact child result records. Check whether the code claim has a retained artifact and whether the research claim stays within its measured input. Return a candidate review with any limitation; do not adopt it yourself.',
    inputRefs: [codingRecord.id, researchRecord.id], allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 55_000, maxFollowups: 1, maxTokensPerTurn: 2800 },
    dependencyIds: ['coding', 'research'], recipient: { kind: 'run-owner', sessionId: ownerId } } });
  assert.equal(reviewer.status, 'created', reviewer.reason); const reviewerAgent = host.ctx.get('agents')!.get(reviewer.receipt.childSessionId as never)!;
  await check.wait(reviewerAgent.whenIdle());
  const reviewerResult = await resultOf('reviewer', reviewer.receipt.childSessionId);
  assert.equal(reviewerResult.status, 'candidate', reviewerResult.reason);
  const reviewerRecord = host.ctx.hima.ledger.records({ runId, type: 'delegation' })
    .findLast((record): record is DelegationRecord => record.type === 'delegation' && record.delegationId === 'reviewer' && record.event === 'result-observed'); assert.ok(reviewerRecord);
  const adopted = await delegate({ action: 'adopt', requestId: 'adopt-reviewer', delegationId: 'reviewer' });
  check.require('declared Run owner explicitly adopts the exact observed Reviewer result without changing Judge facts', adopted.status === 'accepted'
    && adopted.resultRecordId === reviewerRecord.id && host.ctx.hima.ledger.records({ runId, type: 'verdict' }).length === 0, adopted);

  const cancellable = await delegate({ action: 'create', requestId: 'create-cancellable', contract: { delegationId: 'cancellable', role: 'researcher',
    task: 'Read the granted input and wait for further direction before making any recommendation.', inputRefs: [input.id], allowedTools: ['hima_delegation_input'],
    budgetShare: { maxElapsedMs: 25_000, maxFollowups: 0, maxTokensPerTurn: 1200 }, dependencyIds: [], recipient: { kind: 'run-owner', sessionId: ownerId } } });
  assert.equal(cancellable.status, 'created', cancellable.reason);
  const cancelled = await delegate({ action: 'cancel', requestId: 'cancel-cancellable', delegationId: 'cancellable' });
  check.require('one child cancellation is scoped and truthfully reports the native stop effect', cancelled.status === 'accepted'
    && ['confirmed', 'unknown'].includes(cancelled.receipt?.effect), cancelled);

  const team = runDelegations((host.ctx.hima as unknown as { deps(): any }).deps(), runId);
  const allocated = team.reduce((sum, row) => sum + row.effective.budgetShare.maxElapsedMs, 0);
  const retainedTranscripts = await Promise.all(team.map(row => readNativeSessionContext(host.ctx, {
    sessionId: ownerId, targetSessionId: row.childSessionId, parentSessionId: ownerId,
  }, host.ctx.hima.ledger)));
  check.require('team receipts expose all transcripts/results and aggregate below the one parent budget', team.length === 4
    && allocated <= context().run.budget!.timeBoxMs && retainedTranscripts.every(view => view.events.length > 0),
  { allocated, parent: context().run.budget?.timeBoxMs, team, retainedTranscripts });

  let control = context().run.control!;
  const pause = await host.ctx.hima.executionAction({ runId, actor: String(guide.id), origin: 'human', action: 'pause', requestId: 'guide-human-pause',
    expectedEpoch: control.epoch, expectedRevision: control.revision }); assert.equal(pause.kind, 'accepted', pause.reason);
  control = context().run.control!;
  const resume = await host.ctx.hima.executionAction({ runId, actor: String(guide.id), origin: 'human', action: 'continue', requestId: 'guide-human-continue',
    expectedEpoch: control.epoch, expectedRevision: control.revision }); assert.equal(resume.kind, 'accepted', resume.reason);
  await check.say(guide, `The bounded team for Run ${runId} has returned and the owner adopted one exact Reviewer result. Inspect the current Run and child ${reviewer.receipt.childSessionId}; summarize result, cancellation/control receipts, unknowns, and next step without taking ownership or starting work.`);
  check.require('Guide remains responsive after handoff and cites current Run/child context', toolCalls(guide).filter(call => ['hima_inspect', 'hima_context', 'hima_status'].includes(call.name)).length >= 2
    && host.ctx.hima.ledger.run(runId)?.control?.owner === ownerId, toolCalls(guide));

  check.observed.laneC = { runId, guide: String(guide.id), owner: ownerId, inputRecord: input.id, coding, research, reviewer,
    adopted, cancelled, allocated, team, retainedTranscripts, pause: pause.receipt, resume: resume.receipt,
    productModelSessions: [...check.requestSessions], claimLimits: ['bounded local task; no EDA or business-value claim', 'Operator production delegation is separately evidenced'] };
}

await runLive('live-check-wave1-guide-team', 6, task);
